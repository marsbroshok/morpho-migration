#!/usr/bin/env node
/**
 * @file inspect-market-liquidity.mjs
 * Inspects supply, borrow, utilization, and available borrow liquidity for a Morpho Blue market.
 * Usage: node scripts/diagnostics/inspect-market-liquidity.mjs <marketId> [rpcUrl]
 */

import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import config from '../../config.js';

const MORPHO_BLUE = config.MORPHO_BLUE;
const MORPHO_BLUE_ABI = [
  {
    "inputs": [{ "name": "id", "type": "bytes32" }],
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
  }
];

const marketId = process.argv[2];
const rpcUrl = process.argv[3] || process.env.RPC_URL || 'https://cloudflare-eth.com';

if (!marketId) {
  console.log('Usage: node inspect-market-liquidity.mjs <marketId> [rpcUrl]');
  process.exit(1);
}

const client = createPublicClient({
  chain: mainnet,
  transport: http(rpcUrl)
});

try {
  const [totalSupplyAssets, totalSupplyShares, totalBorrowAssets, totalBorrowShares, lastUpdate, fee] =
    await client.readContract({
      address: MORPHO_BLUE,
      abi: MORPHO_BLUE_ABI,
      functionName: 'market',
      args: [marketId]
    });

  const availableLiquidity = totalSupplyAssets > totalBorrowAssets ? totalSupplyAssets - totalBorrowAssets : 0n;
  const utilizationBps = totalSupplyAssets > 0n ? (totalBorrowAssets * 10000n) / totalSupplyAssets : 0n;

  console.log(`\nMarket Liquidity Inspection for ${marketId}:`);
  console.log(`-----------------------------------------------------------------`);
  console.log(`Total Supply Assets: ${totalSupplyAssets.toString()}`);
  console.log(`Total Borrow Assets: ${totalBorrowAssets.toString()}`);
  console.log(`Available Borrow Liquidity: ${availableLiquidity.toString()}`);
  console.log(`Utilization: ${(Number(utilizationBps) / 100).toFixed(2)}%`);
  console.log(`Fee: ${(Number(fee) / 1e16).toFixed(2)}%`);
  console.log(`Last Update Timestamp: ${lastUpdate.toString()}\n`);
} catch (err) {
  console.error(`Error querying market state: ${err.message}`);
  process.exit(1);
}
