/**
 * @fileoverview Service for querying Morpho Blue market parameters, positions, and oracle rates.
 */

import { getAddress } from 'viem';
import config from '../../../config.js';
import { MORPHO_BLUE_ABI } from '../contracts/abis.js';

/**
 * Service providing high-level queries for Morpho Blue markets and user positions.
 */
export class MorphoMarketService {
  /**
   * @param {string} [morphoBlueAddress] - Morpho Blue contract address (defaults to config.MORPHO_BLUE).
   * @param {string} [graphQlEndpoint] - Morpho Blue GraphQL endpoint.
   */
  constructor(
    morphoBlueAddress = config.MORPHO_BLUE,
    graphQlEndpoint = 'https://blue-api.morpho.org/graphql'
  ) {
    this.morphoBlueAddress = morphoBlueAddress;
    this.graphQlEndpoint = graphQlEndpoint;
  }

  /**
   * Fetches and normalizes market parameters from Morpho Blue GraphQL API.
   *
   * @param {string} marketId - The 32-byte hex market ID.
   * @returns {Promise<{ loanToken: string, collateralToken: string, loanSymbol: string, collateralSymbol: string, loanDecimals: number, collateralDecimals: number, oracle: string, irm: string, lltv: bigint }>}
   */
  async fetchMarketParams(marketId) {
    const query = `
      query GetMarket($id: String!) {
        markets(where: { uniqueKey_in: [$id] }) {
          items {
            loanAsset { address symbol decimals }
            collateralAsset { address symbol decimals }
            oracleAddress
            irmAddress
            lltv
          }
        }
      }
    `;

    const response = await fetch(this.graphQlEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { id: marketId } })
    });

    if (!response.ok) {
      throw new Error(`Morpho Blue GraphQL API request failed: ${response.statusText}`);
    }

    const result = await response.json();
    if (result.errors && result.errors.length > 0) {
      throw new Error(`Morpho Blue GraphQL API error: ${result.errors[0].message}`);
    }

    const items = result.data?.markets?.items || [];
    if (items.length === 0) {
      throw new Error(`Market ID ${marketId} not found on Morpho Blue.`);
    }

    const market = items[0];
    return {
      loanToken: getAddress(market.loanAsset.address),
      collateralToken: getAddress(market.collateralAsset.address),
      loanSymbol: market.loanAsset.symbol,
      collateralSymbol: market.collateralAsset.symbol,
      loanDecimals: Number(market.loanAsset.decimals),
      collateralDecimals: Number(market.collateralAsset.decimals),
      oracle: getAddress(market.oracleAddress),
      irm: getAddress(market.irmAddress),
      lltv: BigInt(market.lltv)
    };
  }

  /**
   * Fetches user position on Morpho Blue, calculating exact debt from shares and pool state.
   *
   * @param {object} publicClient - Viem public client.
   * @param {string} marketId - Market identifier (bytes32).
   * @param {string} userAddress - User address.
   * @param {bigint} [blockNumber] - Pinned block number for deterministic querying.
   * @param {object|null} [mockOverrides] - Optional mock overrides for testing.
   * @returns {Promise<{ collateral: bigint, debt: bigint, borrowShares: bigint }>}
   */
  async fetchPosition(publicClient, marketId, userAddress, blockNumber = undefined, mockOverrides = null) {
    if (mockOverrides) {
      return {
        collateral: mockOverrides.collateral ?? 0n,
        debt: mockOverrides.debt ?? 0n,
        borrowShares: mockOverrides.borrowShares ?? mockOverrides.debt ?? 0n
      };
    }

    const [posData, marketData] = await Promise.all([
      publicClient.readContract({
        address: this.morphoBlueAddress,
        abi: MORPHO_BLUE_ABI,
        functionName: 'position',
        args: [marketId, userAddress],
        blockNumber
      }),
      publicClient.readContract({
        address: this.morphoBlueAddress,
        abi: MORPHO_BLUE_ABI,
        functionName: 'market',
        args: [marketId],
        blockNumber
      })
    ]);

    const [, borrowShares, collateral] = posData;
    const [, , totalBorrowAssets, totalBorrowShares] = marketData;

    let debt = 0n;
    if (borrowShares > 0n && totalBorrowShares > 0n) {
      debt = (borrowShares * totalBorrowAssets) / totalBorrowShares;
    }

    return {
      collateral: BigInt(collateral),
      debt: BigInt(debt),
      borrowShares: BigInt(borrowShares)
    };
  }

  /**
   * Fetches the raw 36-decimal scaled price from the Morpho Blue oracle contract.
   *
   * @param {object} publicClient - Viem public client.
   * @param {string} oracleAddress - Oracle contract address.
   * @param {bigint} [blockNumber] - Pinned block number.
   * @returns {Promise<bigint>} Raw 36-decimal oracle price.
   */
  async fetchOraclePrice(publicClient, oracleAddress, blockNumber = undefined) {
    return await publicClient.readContract({
      address: oracleAddress,
      abi: [
        {
          inputs: [],
          name: 'price',
          outputs: [{ name: '', type: 'uint256' }],
          stateMutability: 'view',
          type: 'function'
        }
      ],
      functionName: 'price',
      blockNumber
    });
  }

  /**
   * Queries ERC20 token decimals on-chain.
   *
   * @param {object} publicClient - Viem public client.
   * @param {string} tokenAddress - ERC20 token contract address.
   * @param {bigint} [blockNumber] - Pinned block number.
   * @returns {Promise<number>} Token decimals.
   */
  async fetchTokenDecimals(publicClient, tokenAddress, blockNumber = undefined) {
    const decimals = await publicClient.readContract({
      address: tokenAddress,
      abi: [
        {
          inputs: [],
          name: 'decimals',
          outputs: [{ name: '', type: 'uint8' }],
          stateMutability: 'view',
          type: 'function'
        }
      ],
      functionName: 'decimals',
      blockNumber
    });
    return Number(decimals);
  }

  /**
   * Checks collateral maturity for fixed-yield assets (such as Pendle Principal Tokens).
   *
   * @param {object} publicClient - Viem public client.
   * @param {string} collateralAddress - Collateral token address.
   * @param {bigint} [blockNumber] - Pinned block number.
   * @returns {Promise<{ expiryDate: string, isExpired: boolean }>}
   */
  async checkCollateralMaturity(publicClient, collateralAddress, blockNumber = undefined) {
    try {
      const expiry = await publicClient.readContract({
        address: collateralAddress,
        abi: [
          {
            inputs: [],
            name: 'expiry',
            outputs: [{ name: '', type: 'uint256' }],
            stateMutability: 'view',
            type: 'function'
          }
        ],
        functionName: 'expiry',
        blockNumber
      });
      const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));
      return {
        expiryDate: new Date(Number(expiry) * 1000).toLocaleDateString(),
        isExpired: expiry <= currentTimestamp
      };
    } catch {
      return { expiryDate: 'Unknown', isExpired: false };
    }
  }

  /**
   * Checks whether a delegatee/spender is authorized by the user on Morpho Blue.
   *
   * @param {object} publicClient - Viem public client.
   * @param {string} userAddress - Position owner address.
   * @param {string} spenderAddress - Spender / delegatee address (e.g. Bundler or Adapter).
   * @param {string} [morphoBlueAddress] - Morpho Blue contract address.
   * @param {bigint} [blockNumber] - Pinned block number.
   * @returns {Promise<boolean>}
   */
  async isAuthorized(
    publicClient,
    userAddress,
    spenderAddress,
    morphoBlueAddress = this.morphoBlueAddress,
    blockNumber = undefined
  ) {
    return await publicClient.readContract({
      address: morphoBlueAddress,
      abi: MORPHO_BLUE_ABI,
      functionName: 'isAuthorized',
      args: [userAddress, spenderAddress],
      blockNumber
    });
  }
}
