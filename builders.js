/**
 * @fileoverview Morpho Blue transaction builders facade.
 * Preserves backward compatibility while delegating core operations to modular builder services.
 */

import { getAddress } from 'viem';
import config from './config.js';
import { ApprovalBuilder } from './src/core/builders/approval-builder.js';
import { LeverageBundleBuilder } from './src/core/builders/leverage-bundle-builder.js';
import { RolloverBundleBuilder } from './src/core/builders/rollover-bundle-builder.js';
import { LiquidityPoolService } from './src/core/services/liquidity-pool-service.js';

export { ERC20_ABI, BUNDLER_ABI, ADAPTER_ABI } from './src/core/contracts/abis.js';

// Singleton instances for delegation
const approvalBuilder = new ApprovalBuilder();
const leverageBundleBuilder = new LeverageBundleBuilder(approvalBuilder);
const poolService = new LiquidityPoolService();
const rolloverBundleBuilder = new RolloverBundleBuilder(approvalBuilder, poolService);

/**
 * Dynamically resolves spenders to approve from a swap route payload.
 *
 * @param {object} routeData
 * @returns {string[]}
 */
export function getSpendersToApprove(routeData) {
  return approvalBuilder.getSpendersToApprove(routeData);
}

/**
 * Appends ERC20 and Permit2 approval calls to the multicall bundle.
 *
 * @param {Array<object>} bundle
 * @param {string} token
 * @param {string} spender
 * @param {Function} encodeFunctionData
 */
export function appendApprovals(bundle, token, spender, encodeFunctionData) {
  approvalBuilder.appendApprovals(bundle, token, spender, encodeFunctionData);
}

/**
 * Builds the atomic multicall bundle for deleveraging positions.
 *
 * @param {object} params
 * @returns {Array<object>}
 */
export function buildDeleveragingBundle(params) {
  return leverageBundleBuilder.buildDeleveragingBundle(params);
}

/**
 * Builds the atomic multicall bundle for leveraging up positions.
 *
 * @param {object} params
 * @returns {Array<object>}
 */
export function buildLeveragingUpBundle(params) {
  return leverageBundleBuilder.buildLeveragingUpBundle(params);
}

/**
 * Finds Curve pool and indices for token pair.
 */
export async function findCurvePoolAndIndices(publicClient, fromToken, toToken, amount, getAddress) {
  return poolService.findCurvePoolAndIndices(publicClient, fromToken, toToken, amount, getAddress);
}

/**
 * Finds Uniswap V3 pool for token paired with WETH.
 */
export async function findUniswapV3Pool(publicClient, tokenAddress, getAddress) {
  return poolService.findUniswapV3Pool(publicClient, tokenAddress, getAddress);
}

/**
 * Builds the atomic multicall bundle for cross-market and same-market rollovers.
 *
 * @param {object} params
 * @returns {{ outerBundle?: Array<object>, reenterBundle?: Array<object>, flashLoanAmount: bigint, repayAmount: bigint, repayShares?: bigint, borrowAmount: bigint, finalCalldata: string }}
 */
export function buildRolloverBundle(params) {
  return rolloverBundleBuilder.buildRolloverBundle(params);
}
