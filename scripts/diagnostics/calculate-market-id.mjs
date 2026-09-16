#!/usr/bin/env node
/**
 * @file calculate-market-id.mjs
 * Calculates Morpho Blue market ID (bytes32 keccak256 hash) from MarketParams.
 * Usage: node scripts/diagnostics/calculate-market-id.mjs <loanToken> <collateralToken> <oracle> <irm> <lltv>
 */

import { keccak256, encodeAbiParameters, getAddress } from 'viem';

export function calculateMarketId(params) {
  return keccak256(
    encodeAbiParameters(
      [
        { name: 'loanToken', type: 'address' },
        { name: 'collateralToken', type: 'address' },
        { name: 'oracle', type: 'address' },
        { name: 'irm', type: 'address' },
        { name: 'lltv', type: 'uint256' }
      ],
      [
        getAddress(params.loanToken),
        getAddress(params.collateralToken),
        getAddress(params.oracle),
        getAddress(params.irm),
        BigInt(params.lltv)
      ]
    )
  );
}

const args = process.argv.slice(2);
if (args.length >= 5) {
  const [loanToken, collateralToken, oracle, irm, lltv] = args;
  const id = calculateMarketId({ loanToken, collateralToken, oracle, irm, lltv });
  console.log(`Market ID: ${id}`);
} else if (process.argv[1] === import.meta.filename) {
  console.log('Usage: node calculate-market-id.mjs <loanToken> <collateralToken> <oracle> <irm> <lltv>');
}
