/**
 * @fileoverview Service for resolving dynamic token spenders and building ERC-20 & Permit2 approvals.
 */

import { getAddress, encodeFunctionData as defaultEncodeFunctionData } from 'viem';
import config from '../../../config.js';
import { ERC20_ABI, PERMIT2_ABI } from '../contracts/abis.js';
export { ERC20_ABI, PERMIT2_ABI };

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Builds token and Permit2 approvals for Morpho Blue Bundler operations.
 */
export class ApprovalBuilder {
  /**
   * @param {string} [permit2Address] Optional Permit2 contract address override
   * @param {string} [pendleRouter] Optional Pendle router contract address override
   * @param {string} [pendleLimitRouter] Optional Pendle limit router contract address override
   */
  constructor(permit2Address = config.PERMIT2_ADDRESS, pendleRouter = config.PENDLE_ROUTER, pendleLimitRouter = config.PENDLE_LIMIT_ROUTER) {
    this.permit2Address = getAddress(permit2Address);
    this.pendleRouter = pendleRouter ? getAddress(pendleRouter) : null;
    this.pendleLimitRouter = pendleLimitRouter ? getAddress(pendleLimitRouter) : null;
  }

  /**
   * Dynamically traverses route payload to extract active spenders without false positives.
   *
   * @param {object} routeData Swap route response containing router addresses
   * @returns {string[]} Unique list of checksummed spender addresses to approve
   */
  getSpendersToApprove(routeData) {
    if (!routeData) return [];
    const spenders = new Set();
    if (routeData.tx && routeData.tx.to) {
      try {
        spenders.add(getAddress(routeData.tx.to));
      } catch (e) {
        // Ignore invalid address
      }
    }

    // Recursive walker to find valid 42-character hex addresses in structured properties
    const walk = (obj) => {
      if (!obj) return;
      if (typeof obj === 'string') {
        if (obj.startsWith('0x') && obj.length === 42) {
          try {
            spenders.add(getAddress(obj));
          } catch (e) {
            // Ignore non-address hex strings
          }
        }
      } else if (Array.isArray(obj)) {
        obj.forEach(walk);
      } else if (typeof obj === 'object') {
        Object.values(obj).forEach(walk);
      }
    };

    walk(routeData);

    // If Pendle Router is present, ensure Pendle Limit Router is also approved
    if (this.pendleRouter && this.pendleLimitRouter && spenders.has(this.pendleRouter)) {
      spenders.add(this.pendleLimitRouter);
    }

    spenders.delete(ZERO_ADDRESS);
    return Array.from(spenders);
  }

  /**
   * Builds an array of approval calls for a specific token and spender.
   * Generates direct ERC20 approval and secondary Permit2 approval.
   *
   * @param {string} token Address of token requiring approval
   * @param {string} spender Address of spender contract
   * @param {Function} encodeFunctionData viem encodeFunctionData function
   * @param {bigint} [amount=2n ** 256n - 1n] Amount to approve
   * @returns {Array<{ to: string, data: string, value: bigint, skipRevert: boolean, callbackHash: string }>}
   */
  buildApprovalCalls(token, spender, encFn = null, amount = 2n ** 256n - 1n) {
    const encodeFunctionData = encFn || defaultEncodeFunctionData;
    const checksumToken = getAddress(token);
    const checksumSpender = getAddress(spender);
    const calls = [];

    // 1. ERC20 Approve Spender directly
    calls.push({
      to: checksumToken,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [checksumSpender, amount]
      }),
      value: 0n,
      skipRevert: false,
      callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
    });

    if (checksumSpender.toLowerCase() === this.permit2Address.toLowerCase()) {
      return calls;
    }

    // 2. ERC20 Approve Permit2
    calls.push({
      to: checksumToken,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [this.permit2Address, amount]
      }),
      value: 0n,
      skipRevert: false,
      callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
    });

    // 3. Permit2 Approve Spender
    calls.push({
      to: this.permit2Address,
      data: encodeFunctionData({
        abi: PERMIT2_ABI,
        functionName: 'approve',
        args: [checksumToken, checksumSpender, 2n ** 160n - 1n, 2n ** 48n - 1n]
      }),
      value: 0n,
      skipRevert: false,
      callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
    });

    return calls;
  }

  /**
   * Appends ERC20 and Permit2 approval calls directly onto a bundle array.
   *
   * @param {Array<object>} bundle Target multicall bundle array
   * @param {string} token Address of token to approve
   * @param {string} spender Address of spender contract
   * @param {Function} [encodeFunctionData] viem encodeFunctionData function
   */
  appendApprovals(bundle, token, spender, encodeFunctionData = null) {
    const calls = this.buildApprovalCalls(token, spender, encodeFunctionData);
    for (const call of calls) {
      bundle.push(call);
    }
  }
}
