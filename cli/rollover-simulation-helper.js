/**
 * @fileoverview Helper service for preparing simulation environment and resolving actual swap outputs.
 */

import { getAddress, encodeFunctionData } from 'viem';
import { ERC20_ABI, PERMIT2_ABI, MORPHO_BLUE_ABI } from '../src/core/contracts/abis.js';
import config from '../config.js';

export class RolloverSimulationHelper {
  /**
   * Runs a nominal simulation to resolve the exact swap outputs for collateral and/or loan tokens.
   *
   * @param {object} params
   * @param {object} params.simulationEngine
   * @param {string} params.userAddress
   * @param {string} params.bundlerAddress
   * @param {object} params.nominalResult
   * @param {object} params.swap
   * @param {object} params.assessment
   * @returns {Promise<{ actualCollateralOutput: bigint|null, actualLoanOutput: bigint|null }>}
   */
  static async resolveActualOutputs({ simulationEngine, userAddress, bundlerAddress, nominalResult, swap, assessment }) {
    const prependCalls = [];
    let userBalanceBeforeIdx = -1;

    if (!swap.isSameLoan) {
      prependCalls.push({
        from: userAddress,
        to: assessment.sourceMarketParams.loanToken,
        value: '0x0',
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [userAddress]
        })
      });
      userBalanceBeforeIdx = prependCalls.length - 1;
    }

    const tokensToCheck = [];
    const queryMap = {};
    if (!swap.isSameCollateral) {
      tokensToCheck.push(assessment.destMarketParams.collateralToken);
      queryMap.collateral = tokensToCheck.length - 1;
    }
    if (!swap.isSameLoan) {
      tokensToCheck.push(assessment.sourceMarketParams.loanToken);
      queryMap.loan = tokensToCheck.length - 1;
    }

    const simResult = await simulationEngine.simulateTransaction(
      userAddress,
      bundlerAddress,
      nominalResult.finalCalldata,
      0n,
      prependCalls,
      tokensToCheck
    );

    if (!simResult?.calls || !Array.isArray(simResult.calls)) {
      return { actualCollateralOutput: null, actualLoanOutput: null };
    }

    const leakCheckCallsCount = tokensToCheck.length * 3;
    const mainCallIdx = simResult.calls.length - leakCheckCallsCount - 1;
    const mainCall = simResult.calls[mainCallIdx];
    if (mainCall.status !== '0x1') {
      const errStr = mainCall.error && typeof mainCall.error === 'object' ? JSON.stringify(mainCall.error) : (mainCall.error || 'unknown error');
      throw new Error(`Nominal simulation reverted: ${errStr}`);
    }

    let actualCollateralOutput = null;
    let actualLoanOutput = null;

    if (!swap.isSameCollateral) {
      const balanceCall = simResult.calls[simResult.calls.length - leakCheckCallsCount + queryMap.collateral * 3 + 1];
      if (balanceCall.status !== '0x1') {
        throw new Error(`Collateral balance query call failed: ${balanceCall.error || 'unknown error'}`);
      }
      actualCollateralOutput = BigInt(balanceCall.returnData || '0x0');
      console.log(`[CLI] Resolved actual collateral swap output: ${actualCollateralOutput.toString()}`);
    }

    if (!swap.isSameLoan) {
      const balanceCallBefore = simResult.calls[userBalanceBeforeIdx];
      const balanceCallAfter = simResult.calls[simResult.calls.length - leakCheckCallsCount + queryMap.loan * 3 + 2];
      if (balanceCallBefore.status !== '0x1' || balanceCallAfter.status !== '0x1') {
        throw new Error(`Loan balance query call failed: before status=${balanceCallBefore.status}, after status=${balanceCallAfter.status}`);
      }
      const balBefore = BigInt(balanceCallBefore.returnData || '0x0');
      const balAfter = BigInt(balanceCallAfter.returnData || '0x0');
      actualLoanOutput = nominalResult.flashLoanAmount + (balAfter - balBefore);
      console.log(`[CLI] Resolved actual loan swap output: ${actualLoanOutput.toString()}`);
    }

    return { actualCollateralOutput, actualLoanOutput };
  }

  /**
   * Prepares prepend simulation calls to establish necessary wallet balances, authorizations, and debt states.
   *
   * @param {object} params
   * @param {object} params.calldataResult
   * @param {object} params.blockchainClient
   * @param {object} params.poolService
   * @param {string} params.bundlerAddress
   * @param {string} params.adapterAddress
   * @param {string} params.morphoBlueAddress
   * @param {string} [params.permit2Address]
   * @returns {Promise<Array<object>>}
   */
  static async preparePrependCalls({
    calldataResult,
    blockchainClient,
    poolService,
    bundlerAddress,
    adapterAddress,
    morphoBlueAddress,
    permit2Address = config.PERMIT2_ADDRESS
  }) {
    const prependCalls = [];

    try {
      const loanToken = calldataResult.sourceMarketParams.loanToken;
      const loanDecimals = calldataResult.sourceMarketParams.loanDecimals;

      const poolWhale = await poolService.findUniswapV3Pool(blockchainClient.publicClient, loanToken, getAddress);
      if (poolWhale) {
        prependCalls.push({
          from: poolWhale,
          to: loanToken,
          value: '0x0',
          data: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: 'transfer',
            args: [getAddress(calldataResult.userAddress), 1000n * 10n ** BigInt(loanDecimals)]
          })
        });
      }

      const tokensToApprove = new Set([
        getAddress(calldataResult.sourceMarketParams.collateralToken),
        getAddress(calldataResult.destMarketParams.collateralToken),
        getAddress(calldataResult.sourceMarketParams.loanToken),
        getAddress(calldataResult.destMarketParams.loanToken)
      ]);

      const spendersToApprove = new Set([
        getAddress(adapterAddress),
        getAddress(bundlerAddress),
        getAddress(morphoBlueAddress)
      ]);

      if (calldataResult.swap?.routeData) {
        spendersToApprove.add(getAddress(calldataResult.swap.routeData.tx.to));
        if (calldataResult.swap.routeData.limitRouter) {
          spendersToApprove.add(getAddress(calldataResult.swap.routeData.limitRouter));
        }
        if (calldataResult.swap.routeData.inputs) {
          calldataResult.swap.routeData.inputs.forEach(i => tokensToApprove.add(getAddress(i.token)));
        }
        if (calldataResult.swap.routeData.outputs) {
          calldataResult.swap.routeData.outputs.forEach(o => tokensToApprove.add(getAddress(o.token)));
        }
      }

      if (calldataResult.swap?.loanRouteData) {
        spendersToApprove.add(getAddress(calldataResult.swap.loanRouteData.tx.to));
        if (calldataResult.swap.loanRouteData.limitRouter) {
          spendersToApprove.add(getAddress(calldataResult.swap.loanRouteData.limitRouter));
        }
        if (calldataResult.swap.loanRouteData.inputs) {
          calldataResult.swap.loanRouteData.inputs.forEach(i => tokensToApprove.add(getAddress(i.token)));
        }
        if (calldataResult.swap.loanRouteData.outputs) {
          calldataResult.swap.loanRouteData.outputs.forEach(o => tokensToApprove.add(getAddress(o.token)));
        }
      }

      for (const token of tokensToApprove) {
        for (const spender of spendersToApprove) {
          prependCalls.push({
            from: bundlerAddress,
            to: token,
            value: '0x0',
            data: encodeFunctionData({
              abi: ERC20_ABI,
              functionName: 'approve',
              args: [spender, 2n ** 256n - 1n]
            })
          });
        }
      }

      const permit2Checksum = getAddress(permit2Address);
      const userAddress = getAddress(calldataResult.userAddress);
      const loanTokenAddr = getAddress(loanToken);

      prependCalls.push({
        from: userAddress,
        to: loanTokenAddr,
        value: '0x0',
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [permit2Checksum, 2n ** 256n - 1n]
        })
      });

      prependCalls.push({
        from: userAddress,
        to: permit2Checksum,
        value: '0x0',
        data: encodeFunctionData({
          abi: PERMIT2_ABI,
          functionName: 'approve',
          args: [loanTokenAddr, getAddress(adapterAddress), 2n ** 160n - 1n, 2n ** 48n - 1n]
        })
      });

      const livePosition = await blockchainClient.fetchMorphoPosition(calldataResult.sourceMarketId, calldataResult.userAddress, true);
      const liveDebt = livePosition.debt;
      if (liveDebt < calldataResult.debtAmount) {
        const borrowDiff = calldataResult.debtAmount - liveDebt;
        prependCalls.push({
          from: calldataResult.userAddress,
          to: morphoBlueAddress,
          value: '0x0',
          data: encodeFunctionData({
            abi: MORPHO_BLUE_ABI,
            functionName: 'borrow',
            args: [calldataResult.sourceMarketParams, borrowDiff, 0n, calldataResult.userAddress, calldataResult.userAddress]
          })
        });
      }

      const destLoanToken = calldataResult.destMarketParams.loanToken;
      const targetPosition = await blockchainClient.fetchMorphoPosition(calldataResult.destMarketId, calldataResult.userAddress);
      if (targetPosition.debt > 0n) {
        const targetRepayWhale = await poolService.findUniswapV3Pool(blockchainClient.publicClient, destLoanToken, getAddress);
        if (targetRepayWhale) {
          prependCalls.push({
            from: targetRepayWhale,
            to: destLoanToken,
            value: '0x0',
            data: encodeFunctionData({
              abi: ERC20_ABI,
              functionName: 'approve',
              args: [morphoBlueAddress, targetPosition.debt]
            })
          });

          prependCalls.push({
            from: targetRepayWhale,
            to: morphoBlueAddress,
            value: '0x0',
            data: encodeFunctionData({
              abi: MORPHO_BLUE_ABI,
              functionName: 'repay',
              args: [calldataResult.destMarketParams, targetPosition.debt, 0n, calldataResult.userAddress, '0x']
            })
          });
        }
      }
    } catch (e) {
      // Ignore funding error and attempt simulation anyway
    }

    return prependCalls;
  }
}
