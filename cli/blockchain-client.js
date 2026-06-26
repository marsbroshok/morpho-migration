import { createPublicClient, createWalletClient, http, getAddress } from 'viem';
import { mainnet } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const MORPHO_BLUE = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";

const MORPHO_BLUE_ABI = [
  {
    "inputs": [
      { "name": "id", "type": "bytes32" },
      { "name": "user", "type": "address" }
    ],
    "name": "position",
    "outputs": [
      { "name": "supplyShares", "type": "uint256" },
      { "name": "borrowShares", "type": "uint128" },
      { "name": "collateral", "type": "uint128" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "name": "id", "type": "bytes32" }
    ],
    "name": "market",
    "outputs": [
      { "name": "totalSupplyAssets", "type": "uint128" },
      { "name": "totalSupplyShares", "type": "uint128" },
      { "name": "totalBorrowAssets", "type": "uint128" },
      { "name": "totalBorrowShares", "type": "uint128" },
      { "name": "lastUpdate", "type": "uint128" },
      { "name": "fee", "type": "uint128" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "name": "authorizer", "type": "address" },
      { "name": "delegatee", "type": "address" }
    ],
    "name": "isAuthorized",
    "outputs": [
      { "name": "", "type": "bool" }
    ],
    "stateMutability": "view",
    "type": "function"
  }
];

export class BlockchainClient {
  /**
   * @param {string|null} rpcUrl 
   * @param {string|object|null} walletSigner 
   */
  constructor(rpcUrl, walletSigner) {
    const transportUrl = rpcUrl || 'https://cloudflare-eth.com';
    this.publicClient = createPublicClient({
      chain: mainnet,
      transport: http(transportUrl)
    });

    if (typeof walletSigner === 'string' && walletSigner.startsWith('0x')) {
      // Local Private Key signer
      const account = privateKeyToAccount(walletSigner);
      this.walletClient = createWalletClient({
        account,
        chain: mainnet,
        transport: http(transportUrl)
      });
      this.userAddress = account.address;
    } else if (walletSigner && typeof walletSigner === 'object') {
      // WalletConnect custom walletClient
      this.walletClient = walletSigner;
      // Retrieve address from the walletClient when initialized
      this.userAddress = null;
    } else {
      this.walletClient = null;
      this.userAddress = null;
    }
  }

  getBlockNumber() {
    return process.env.FORK_BLOCK_NUMBER ? BigInt(process.env.FORK_BLOCK_NUMBER) : undefined;
  }

  async fetchMorphoPosition(marketId, userAddress, forceLive = false) {
    if (!forceLive && (process.env.MOCK_POSITION_DEBT !== undefined || process.env.MOCK_POSITION_COLLATERAL !== undefined)) {
      const debt = process.env.MOCK_POSITION_DEBT ? BigInt(process.env.MOCK_POSITION_DEBT) : 0n;
      const collateral = process.env.MOCK_POSITION_COLLATERAL ? BigInt(process.env.MOCK_POSITION_COLLATERAL) : 1000000000000000000n;
      const borrowShares = debt;
      return { collateral, debt, borrowShares };
    }
    const [posData, marketData] = await Promise.all([
      this.publicClient.readContract({
        address: MORPHO_BLUE,
        abi: MORPHO_BLUE_ABI,
        functionName: 'position',
        args: [marketId, userAddress],
        blockNumber: this.getBlockNumber()
      }),
      this.publicClient.readContract({
        address: MORPHO_BLUE,
        abi: MORPHO_BLUE_ABI,
        functionName: 'market',
        args: [marketId],
        blockNumber: this.getBlockNumber()
      })
    ]);

    const [, borrowShares, collateral] = posData;
    const [,, totalBorrowAssets, totalBorrowShares] = marketData;

    let debt = 0n;
    if (borrowShares > 0n && totalBorrowShares > 0n) {
      debt = (borrowShares * totalBorrowAssets) / totalBorrowShares;
    }

    return { collateral, debt, borrowShares };
  }

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
    const response = await fetch('https://blue-api.morpho.org/graphql', {
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
    const items = result.data.markets.items;
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

  async fetchDecimals(tokenAddress) {
    return await this.publicClient.readContract({
      address: tokenAddress,
      abi: [{"inputs":[],"name":"decimals","outputs":[{"name":"","type":"uint8"}],"stateMutability":"view","type":"function"}],
      functionName: 'decimals',
      blockNumber: this.getBlockNumber()
    });
  }

  async checkCollateralMaturity(collateralAddress) {
    try {
      const expiry = await this.publicClient.readContract({
        address: collateralAddress,
        abi: [{"inputs":[],"name":"expiry","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"}],
        functionName: 'expiry',
        blockNumber: this.getBlockNumber()
      });
      const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));
      return {
        expiryDate: new Date(Number(expiry) * 1000).toLocaleDateString(),
        isExpired: expiry <= currentTimestamp
      };
    } catch (err) {
      return { expiryDate: "Unknown", isExpired: false };
    }
  }

  /**
   * Check allowance of a spender for a specific token and user.
   */
  async checkAllowance(tokenAddress, ownerAddress, spenderAddress) {
    return await this.publicClient.readContract({
      address: tokenAddress,
      abi: [
        {
          "inputs": [
            { "name": "owner", "type": "address" },
            { "name": "spender", "type": "address" }
          ],
          "name": "allowance",
          "outputs": [{ "name": "", "type": "uint256" }],
          "stateMutability": "view",
          "type": "function"
        }
      ],
      functionName: 'allowance',
      args: [ownerAddress, spenderAddress],
      blockNumber: this.getBlockNumber()
    });
  }

  /**
   * Execute ERC20 token approval.
   */
  async approveToken(tokenAddress, spenderAddress, amount) {
    const { encodeFunctionData } = await import('viem');
    const data = encodeFunctionData({
      abi: [{
        "inputs": [
          { "name": "spender", "type": "address" },
          { "name": "amount", "type": "uint256" }
        ],
        "name": "approve",
        "outputs": [{ "name": "", "type": "bool" }],
        "stateMutability": "nonpayable",
        "type": "function"
      }],
      functionName: 'approve',
      args: [spenderAddress, amount]
    });

    return await this.executeTransaction({
      to: tokenAddress,
      data,
      value: 0n
    });
  }

  /**
   * Check internal Permit2 allowance of a spender for a specific token and user.
   */
  async checkPermit2Allowance(tokenAddress, ownerAddress, spenderAddress) {
    const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
    const [amount, expiration, nonce] = await this.publicClient.readContract({
      address: PERMIT2_ADDRESS,
      abi: [
        {
          "inputs": [
            { "name": "owner", "type": "address" },
            { "name": "token", "type": "address" },
            { "name": "spender", "type": "address" }
          ],
          "name": "allowance",
          "outputs": [
            { "name": "amount", "type": "uint160" },
            { "name": "expiration", "type": "uint48" },
            { "name": "nonce", "type": "uint48" }
          ],
          "stateMutability": "view",
          "type": "function"
        }
      ],
      functionName: 'allowance',
      args: [ownerAddress, tokenAddress, spenderAddress],
      blockNumber: this.getBlockNumber()
    });

    // Check if the allowance has expired
    const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));
    if (expiration <= currentTimestamp) {
      return 0n;
    }
    return amount;
  }

  /**
   * Execute Permit2 token approval.
   */
  async approvePermit2(tokenAddress, spenderAddress, amount) {
    const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
    const { encodeFunctionData } = await import('viem');
    
    // Default expiration to max uint48 (approx 8900 years)
    const maxExpiration = 281474976710655n; 
    
    const data = encodeFunctionData({
      abi: [{
        "inputs": [
          { "name": "token", "type": "address" },
          { "name": "spender", "type": "address" },
          { "name": "amount", "type": "uint160" },
          { "name": "expiration", "type": "uint48" }
        ],
        "name": "approve",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      }],
      functionName: 'approve',
      args: [tokenAddress, spenderAddress, amount, maxExpiration]
    });

    return await this.executeTransaction({
      to: PERMIT2_ADDRESS,
      data,
      value: 0n
    });
  }


  async isAuthorized(userAddress, spenderAddress) {
    return await this.publicClient.readContract({
      address: MORPHO_BLUE,
      abi: MORPHO_BLUE_ABI,
      functionName: 'isAuthorized',
      args: [userAddress, spenderAddress],
      blockNumber: this.getBlockNumber()
    });
  }

  async executeTransaction({ to, data, value }) {
    if (!this.walletClient) {
      throw new Error("Wallet execution required. Please provide a private key or connect via WalletConnect.");
    }
    if (!this.userAddress) {
      const addresses = await this.walletClient.getAddresses();
      this.userAddress = getAddress(addresses[0]);
    }
    
    return await this.walletClient.sendTransaction({
      account: this.userAddress,
      to,
      data,
      value: value || 0n
    });
  }
}
