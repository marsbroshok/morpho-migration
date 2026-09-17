/**
 * @fileoverview Resolves exact realized post-swap token outputs using eth_simulateV1 nominal traces.
 */

import { encodeFunctionData, decodeAbiParameters } from 'viem';
import { MORPHO_BLUE_ABI, ERC20_ABI } from '../../core/contracts/abis.js';
import config from '../../../config.js';

/**
 * Service to execute nominal simulation and parse before/after balance differentials.
 */
export class NominalOutputResolver {
  /**
   * Simulates the nominal bundle to detect actual post-swap balances on-chain.
   *
   * @param {object} params
   * @param {string} params.rpcUrl
   * @param {string} params.userAddress
   * @param {string} params.destMarketId
   * @param {object} params.sourceMarketParams
   * @param {boolean} params.isSameCollateral
   * @param {boolean} params.isSameLoan
   * @param {object} params.nominalResult
   * @returns {Promise<{ actualCollateralOutput: bigint|null, actualLoanOutput: bigint|null }>}
   */
  static async resolve({
    rpcUrl,
    userAddress,
    destMarketId,
    sourceMarketParams,
    isSameCollateral,
    isSameLoan,
    nominalResult
  }) {
    let actualCollateralOutput = null;
    let actualLoanOutput = null;

    const calls = [];
    let collateralBeforeIdx = -1;
    let userBalanceBeforeIdx = -1;

    if (!isSameCollateral) {
      calls.push({
        from: userAddress,
        to: config.MORPHO_BLUE,
        value: '0x0',
        data: encodeFunctionData({
          abi: MORPHO_BLUE_ABI,
          functionName: 'position',
          args: [destMarketId, userAddress]
        })
      });
      collateralBeforeIdx = calls.length - 1;
    }

    if (!isSameLoan) {
      calls.push({
        from: userAddress,
        to: sourceMarketParams.loanToken,
        value: '0x0',
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [userAddress]
        })
      });
      userBalanceBeforeIdx = calls.length - 1;
    }

    // Add main bundle execution
    calls.push({
      from: userAddress,
      to: config.MORPHO_BUNDLER_V3,
      value: '0x0',
      data: nominalResult.finalCalldata
    });

    const afterCollatIdx = calls.length;
    if (!isSameCollateral) {
      calls.push({
        from: userAddress,
        to: config.MORPHO_BLUE,
        value: '0x0',
        data: encodeFunctionData({
          abi: MORPHO_BLUE_ABI,
          functionName: 'position',
          args: [destMarketId, userAddress]
        })
      });
    }

    const afterLoanIdx = calls.length;
    if (!isSameLoan) {
      calls.push({
        from: userAddress,
        to: sourceMarketParams.loanToken,
        value: '0x0',
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [userAddress]
        })
      });
    }

    const blockTag = (typeof process !== 'undefined' && process.env.FORK_BLOCK_NUMBER)
      ? (process.env.FORK_BLOCK_NUMBER.startsWith('0x') ? process.env.FORK_BLOCK_NUMBER : `0x${BigInt(process.env.FORK_BLOCK_NUMBER).toString(16)}`)
      : 'latest';

    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_simulateV1',
        params: [{ blockStateCalls: [{ calls }] }, blockTag]
      })
    });

    const resJson = await res.json();
    if (!resJson.error && resJson.result?.[0]?.calls) {
      const traceCalls = resJson.result[0].calls;
      if (!isSameCollateral && traceCalls[afterCollatIdx] && traceCalls[collateralBeforeIdx]) {
        const before = decodeAbiParameters(
          [{ type: 'uint256' }, { type: 'uint128' }, { type: 'uint128' }],
          traceCalls[collateralBeforeIdx].returnData || '0x0'
        );
        const after = decodeAbiParameters(
          [{ type: 'uint256' }, { type: 'uint128' }, { type: 'uint128' }],
          traceCalls[afterCollatIdx].returnData || '0x0'
        );
        actualCollateralOutput = BigInt(after[2] || 0n) - BigInt(before[2] || 0n);
      }
      if (!isSameLoan && traceCalls[afterLoanIdx] && traceCalls[userBalanceBeforeIdx]) {
        const bBefore = BigInt(traceCalls[userBalanceBeforeIdx].returnData || '0x0');
        const bAfter = BigInt(traceCalls[afterLoanIdx].returnData || '0x0');
        actualLoanOutput = nominalResult.flashLoanAmount + (bAfter - bBefore);
      }
    }

    return { actualCollateralOutput, actualLoanOutput };
  }
}
