/**
 * @fileoverview Service for querying Curve and Uniswap V3 on-chain liquidity pools and indices.
 */

import { getAddress } from 'viem';

export const ADDRESS_PROVIDER = '0x0000000022D53366457F9d5E68Ec105046FC4383';
export const UNISWAP_V3_FACTORY = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
export const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

/**
 * Service for dynamically discovering on-chain liquidity pool addresses and indices.
 */
export class LiquidityPoolService {
  /**
   * Resolves Curve pool address and token indices for swapping fromToken to toToken.
   *
   * @param {object} publicClient viem public client
   * @param {string} fromToken Input token address
   * @param {string} toToken Output token address
   * @param {bigint} amount Input amount to test rate quote
   * @param {Function} [getAddressFn=getAddress] Checksum address resolver
   * @returns {Promise<{ poolAddress: string, i: number, j: number, indexType: string, expectedOutput: bigint } | null>}
   */
  async findCurvePoolAndIndices(publicClient, fromToken, toToken, amount, getAddressFn = getAddress) {
    const fromAddr = getAddressFn(fromToken);
    const toAddr = getAddressFn(toToken);

    try {
      const metaRegistryAddress = await publicClient.readContract({
        address: ADDRESS_PROVIDER,
        abi: [{
          "inputs": [{ "name": "id", "type": "uint256" }],
          "name": "get_address",
          "outputs": [{ "name": "", "type": "address" }],
          "stateMutability": "view",
          "type": "function"
        }],
        functionName: 'get_address',
        args: [7n]
      });

      let index = 0n;
      while (index < 10n) {
        const poolAddress = await publicClient.readContract({
          address: metaRegistryAddress,
          abi: [{
            "inputs": [
              { "name": "_from", "type": "address" },
              { "name": "_to", "type": "address" },
              { "name": "i", "type": "uint256" }
            ],
            "name": "find_pool_for_coins",
            "outputs": [{ "name": "", "type": "address" }],
            "stateMutability": "view",
            "type": "function"
          }],
          functionName: 'find_pool_for_coins',
          args: [fromAddr, toAddr, index]
        });

        if (poolAddress === '0x0000000000000000000000000000000000000000') {
          break;
        }

        index++;

        // Find token indices in the pool
        let i = -1;
        let j = -1;
        for (let k = 0n; k < 8n; k++) {
          try {
            const coin = await publicClient.readContract({
              address: poolAddress,
              abi: [{
                "inputs": [{ "name": "i", "type": "uint256" }],
                "name": "coins",
                "outputs": [{ "name": "", "type": "address" }],
                "stateMutability": "view",
                "type": "function"
              }],
              functionName: 'coins',
              args: [k]
            });
            if (getAddressFn(coin) === fromAddr) i = Number(k);
            if (getAddressFn(coin) === toAddr) j = Number(k);
          } catch (e) {
            break;
          }
        }

        if (i === -1 || j === -1) {
          continue;
        }

        // Try int128 type for get_dy
        try {
          const dy = await publicClient.readContract({
            address: poolAddress,
            abi: [{
              "inputs": [
                { "name": "i", "type": "int128" },
                { "name": "j", "type": "int128" },
                { "name": "dx", "type": "uint256" }
              ],
              "name": "get_dy",
              "outputs": [{ "name": "", "type": "uint256" }],
              "stateMutability": "view",
              "type": "function"
            }],
            functionName: 'get_dy',
            args: [i, j, amount]
          });
          if (dy > 0n) {
            return {
              poolAddress,
              i,
              j,
              indexType: 'int128',
              expectedOutput: dy
            };
          }
        } catch (e) {}

        // Try uint256 type for get_dy
        try {
          const dy = await publicClient.readContract({
            address: poolAddress,
            abi: [{
              "inputs": [
                { "name": "i", "type": "uint256" },
                { "name": "j", "type": "uint256" },
                { "name": "dx", "type": "uint256" }
              ],
              "name": "get_dy",
              "outputs": [{ "name": "", "type": "uint256" }],
              "stateMutability": "view",
              "type": "function"
            }],
            functionName: 'get_dy',
            args: [i, j, amount]
          });
          if (dy > 0n) {
            return {
              poolAddress,
              i,
              j,
              indexType: 'uint256',
              expectedOutput: dy
            };
          }
        } catch (e) {}
      }
    } catch (e) {
      // Registry or Pool not found/supported, fallback
    }

    return null;
  }

  /**
   * Resolves Uniswap V3 pool address for tokenAddress against WETH across standard fee tiers.
   *
   * @param {object} publicClient viem public client
   * @param {string} tokenAddress Target token address
   * @param {Function} [getAddressFn=getAddress] Checksum address resolver
   * @returns {Promise<string | null>} Pool address or null
   */
  async findUniswapV3Pool(publicClient, tokenAddress, getAddressFn = getAddress) {
    const tokenAddr = getAddressFn(tokenAddress);

    if (tokenAddr === getAddressFn(WETH)) {
      return '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640';
    }

    const fees = [3000, 500, 10000];
    for (const fee of fees) {
      try {
        const pool = await publicClient.readContract({
          address: UNISWAP_V3_FACTORY,
          abi: [{
            "inputs": [
              { "name": "tokenA", "type": "address" },
              { "name": "tokenB", "type": "address" },
              { "name": "fee", "type": "uint24" }
            ],
            "name": "getPool",
            "outputs": [{ "name": "", "type": "address" }],
            "stateMutability": "view",
            "type": "function"
          }],
          functionName: 'getPool',
          args: [tokenAddr, WETH, fee]
        });
        if (pool && pool !== '0x0000000000000000000000000000000000000000') {
          return pool;
        }
      } catch (e) {}
    }
    return null;
  }
}
