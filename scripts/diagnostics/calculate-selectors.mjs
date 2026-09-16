#!/usr/bin/env node
/**
 * @file calculate-selectors.mjs
 * Computes 4-byte function and error selectors for Morpho Blue Bundlers and Adapters.
 * Useful for decoding hex revert data and raw trace logs.
 */

import { keccak256 } from 'viem';

const MORPHO_ERRORS = [
  'ZeroAddress()',
  'UnauthorizedSender()',
  'AdapterAddress()',
  'ZeroAmount()',
  'AlreadyInitiated()',
  'IncorrectReenterHash()',
  'EmptyBundle()',
  'MissingExpectedReenter()',
  'ZeroShares()',
  'SlippageExceeded()',
  'UnexpectedOwner()',
  'LtvExceeded()',
  'LtvExceeded(uint256,uint256)',
  'LtvExceeded(uint256)',
  'LtvExceeded(uint128)',
  'TransferFromReverted()',
  'InconsistentTransfer()',
  'InsufficientCollateral()',
  'AllowanceExpired()'
];

console.log('Morpho Blue & Bundler Error Selectors:');
console.log('----------------------------------------');
for (const err of MORPHO_ERRORS) {
  const hash = keccak256(new TextEncoder().encode(err));
  const selector = hash.slice(0, 10);
  console.log(`${selector} -> ${err}`);
}
