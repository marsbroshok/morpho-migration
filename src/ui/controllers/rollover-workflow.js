/**
 * @fileoverview Workflow controller for Morpho Blue position rollover operations.
 */

import { getAddress, encodeFunctionData, decodeAbiParameters } from 'viem';
import { mainnet } from 'viem/chains';
import { calculateCollateralValue, calculateLtv, calculateLeverage } from '../../../math.js';
import { buildRolloverBundle } from '../../../builders.js';
import config from '../../../config.js';
import { MORPHO_BLUE_ABI, ERC20_ABI } from '../../core/contracts/abis.js';
import { AuditWorkflow } from './audit-workflow.js';

export class RolloverWorkflow {
  /**
   * @param {object} dependencies
   * @param {object} dependencies.marketService
   * @param {object} dependencies.swapQuoterService
   * @param {object} dependencies.simulationService
   * @param {AuditWorkflow} [dependencies.auditWorkflow]
   */
  constructor({ marketService, swapQuoterService, simulationService, auditWorkflow = new AuditWorkflow() }) {
    this.marketService = marketService;
    this.swapQuoterService = swapQuoterService;
    this.simulationService = simulationService;
    this.auditWorkflow = auditWorkflow;
  }

  async fetchMarketParams(marketId) {
    return await this.marketService.fetchMarketParams(marketId);
  }

  async checkCollateralMaturity(client, collateralAddress) {
    return await this.marketService.checkCollateralMaturity(client, collateralAddress);
  }

  async fetchMorphoPosition(publicClient, marketId, userAddress) {
    return await this.marketService.fetchPosition(publicClient, marketId, userAddress);
  }

  async fetchSwapRoute(inputToken, inputAmount, outputToken, slippage, receiver, sender = null) {
    const slippageBps = slippage <= 1 ? Math.round(slippage * 10000) : slippage;
    return await this.swapQuoterService.fetchSwapRoute({
      inputToken,
      inputAmount,
      outputToken,
      slippageBps,
      receiver,
      sender
    });
  }

  async compileRolloverPayload(params) {
    const {
      sourceMarketParams,
      destMarketParams,
      collateralAmount,
      debtAmount,
      isFull,
      slippage,
      sourceCollateralAddress,
      destCollateralAddress,
      sourceLoanAddress,
      destLoanAddress,
      userAddress,
      liveBorrowShares,
      capBorrow,
      publicClient,
      rpcUrl
    } = params;

    const userSlippageBps = BigInt(Math.round(slippage * 10000));
    const strictSlippageBps = userSlippageBps > 50n ? 50n : userSlippageBps;

    const isSameCollateral = sourceCollateralAddress.toLowerCase() === destCollateralAddress.toLowerCase();
    const isSameLoan = sourceLoanAddress.toLowerCase() === destLoanAddress.toLowerCase();

    let routeData = null;
    let expectedNewCollateral = collateralAmount;

    if (!isSameCollateral) {
      routeData = await this.fetchSwapRoute(
        sourceCollateralAddress,
        collateralAmount,
        destCollateralAddress,
        slippage,
        config.MORPHO_BUNDLER_V3,
        config.MORPHO_BUNDLER_V3
      );
      expectedNewCollateral = BigInt(routeData.outputs[0].amount);
    }

    const [oldOraclePrice, newOraclePrice] = await Promise.all([
      this.marketService.fetchOraclePrice(publicClient, sourceMarketParams.oracle),
      this.marketService.fetchOraclePrice(publicClient, destMarketParams.oracle)
    ]);

    let loanRouteData = null;
    let loanExpectedInput = 0n;
    let loanExpectedOutput = 0n;

    if (!isSameLoan) {
      const executionSlippage = Number(strictSlippageBps) / 10000;

      const guessAmount = (debtAmount * 10n ** BigInt(destMarketParams.loanDecimals)) / 10n ** BigInt(sourceMarketParams.loanDecimals);
      const nominalInput = guessAmount > 0n ? guessAmount : 10n ** BigInt(destMarketParams.loanDecimals);

      const nominalRoute = await this.fetchSwapRoute(
        destLoanAddress,
        nominalInput,
        sourceLoanAddress,
        executionSlippage,
        config.ETHER_GENERAL_ADAPTER_1,
        config.MORPHO_BUNDLER_V3
      );

      const nominalOutput = BigInt(nominalRoute.outputs[0].amount);
      const desiredOutput = (debtAmount * 10000n) / (10000n - strictSlippageBps);
      loanExpectedInput = (desiredOutput * nominalInput) / nominalOutput;

      const targetLltv = destMarketParams.lltv;
      const safeLtv = targetLltv - 5000000000000000n;
      const newCollateralValue = calculateCollateralValue(expectedNewCollateral, newOraclePrice);
      const maxSafeBorrowAmount = (newCollateralValue * safeLtv) / 10n ** 18n;

      if (loanExpectedInput > maxSafeBorrowAmount) {
        if (capBorrow) {
          loanExpectedInput = maxSafeBorrowAmount;
        } else {
          const projectedLtv = calculateLtv(loanExpectedInput, newCollateralValue);
          throw new Error(`Projected Target LTV (${projectedLtv.toFixed(2)}%) exceeds Target Market LLTV (${(Number(targetLltv) / 1e16).toFixed(2)}%). Rollover would revert on-chain.`);
        }
      }

      loanRouteData = await this.fetchSwapRoute(
        destLoanAddress,
        loanExpectedInput,
        sourceLoanAddress,
        executionSlippage,
        config.MORPHO_BUNDLER_V3,
        config.MORPHO_BUNDLER_V3
      );
      loanExpectedOutput = BigInt(loanRouteData.outputs[0].amount);
    }

    let actualCollateralOutput = null;
    let actualLoanOutput = null;

    if ((!isSameCollateral || !isSameLoan) && rpcUrl) {
      // Phase 1 Nominal Simulation to discover post-swap balances
      const nominalResult = buildRolloverBundle({
        sourceMarketParams,
        destMarketParams,
        collateralAmount,
        debtAmount,
        isFull,
        sourceCollateralAddress,
        destCollateralAddress,
        routeData,
        userAddress,
        ETHER_GENERAL_ADAPTER_1: config.ETHER_GENERAL_ADAPTER_1,
        MORPHO_BUNDLER_V3: config.MORPHO_BUNDLER_V3,
        isSameCollateral,
        isSameLoan,
        loanRouteData,
        loanExpectedInput,
        loanExpectedOutput,
        slippage: Number(strictSlippageBps) / 100,
        borrowShares: liveBorrowShares,
        actualLoanOutput: null,
        actualCollateralOutput: null
      });

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
            args: [params.destMarketId, userAddress]
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
            args: [params.destMarketId, userAddress]
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
    }

    // Phase 2 Final Bundle Construction
    const finalBundle = buildRolloverBundle({
      sourceMarketParams,
      destMarketParams,
      collateralAmount,
      debtAmount,
      isFull,
      sourceCollateralAddress,
      destCollateralAddress,
      routeData,
      userAddress,
      ETHER_GENERAL_ADAPTER_1: config.ETHER_GENERAL_ADAPTER_1,
      MORPHO_BUNDLER_V3: config.MORPHO_BUNDLER_V3,
      isSameCollateral,
      isSameLoan,
      loanRouteData,
      loanExpectedInput,
      loanExpectedOutput,
      slippage: Number(strictSlippageBps) / 100,
      borrowShares: liveBorrowShares,
      actualLoanOutput,
      actualCollateralOutput
    });

    const oldScale = 36n + BigInt(sourceMarketParams.loanDecimals) - BigInt(sourceMarketParams.collateralDecimals);
    const newScale = 36n + BigInt(destMarketParams.loanDecimals) - BigInt(destMarketParams.collateralDecimals);
    const oldOracleUSD = (oldOraclePrice * 10n ** 18n) / (10n ** oldScale);
    const newOracleUSD = (newOraclePrice * 10n ** 18n) / (10n ** newScale);

    const oracleRatio = isSameCollateral ? 10n ** 18n : (oldOracleUSD * 10n ** 18n) / newOracleUSD;
    const quotedRate = isSameCollateral ? 10n ** 18n : (expectedNewCollateral * 10n ** 18n) / collateralAmount;
    const slippagePct = oracleRatio > 0n ? Number((oracleRatio - quotedRate) * 10000n / oracleRatio) / 100 : 0.0;

    const oldOraclePriceUsdc = Number(oldOracleUSD) / 1e18;
    const newOraclePriceUsdc = Number(newOracleUSD) / 1e18;
    const expectedRate = Number(quotedRate) / 1e18;
    const impliedOldPriceUsdc = expectedRate * newOraclePriceUsdc;
    const expectedOutput = (Number(expectedNewCollateral) / (10 ** destMarketParams.collateralDecimals)).toFixed(4);
    const maturity = await this.checkCollateralMaturity(publicClient, sourceCollateralAddress);

    const borrowAmount = finalBundle.borrowAmount;
    const newCollateralValue = calculateCollateralValue(expectedNewCollateral, newOraclePrice);
    const newLtv = calculateLtv(borrowAmount, newCollateralValue);
    const newLeverage = calculateLeverage(newCollateralValue, borrowAmount);

    let loanNotice = '';
    if (!isSameLoan) {
      const decDiff = BigInt(destMarketParams.loanDecimals) - BigInt(sourceMarketParams.loanDecimals);
      const loanQuotedRate = loanExpectedInput > 0n ? (loanExpectedOutput * 10n ** (18n + decDiff)) / loanExpectedInput : 0n;
      loanNotice = `
        <div style="margin-top: 12px; border-top: 1px dashed #334155; padding-top: 12px;">
          <strong style="color: #60a5fa; font-size: 12px; display: block; text-transform: uppercase; letter-spacing: 0.05em;">Cross-Loan Asset Swap</strong>
          Expected Swap Rate: <span style="font-family: monospace; color: #f8fafc;">1 ${destMarketParams.loanSymbol} = ${(Number(loanQuotedRate)/1e18).toFixed(4)} ${sourceMarketParams.loanSymbol}</span>
        </div>
      `;
    }

    const pendingTx = {
      to: config.MORPHO_BUNDLER_V3,
      data: finalBundle.finalCalldata,
      value: 0n,
      type: 'rollover',
      oracleRate: Number(oracleRatio) / 1e18,
      estimatedRate: Number(quotedRate) / 1e18,
      estimatedPriceImpact: slippagePct
    };

    return {
      bundleResult: finalBundle,
      pendingTx,
      routeData,
      loanRouteData,
      expectedNewCollateral,
      actualCollateralOutput,
      actualLoanOutput,
      sourceMarketParams,
      destMarketParams,
      expectedRate,
      impliedOldPriceUsdc,
      oracleRatio,
      oldOraclePriceUsdc,
      newOraclePriceUsdc,
      slippagePct,
      loanNotice,
      expectedOutput,
      borrowAmount,
      newLtv,
      newLeverage,
      finalCalldata: finalBundle.finalCalldata,
      userAddress,
      maturity
    };
  }

  async auditRealizedPrice(params) {
    return await this.auditWorkflow.auditRealizedPrice(params);
  }
}
