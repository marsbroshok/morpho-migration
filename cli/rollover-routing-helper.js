/**
 * @fileoverview Routing and cross-loan swap solver helper for rollover operations.
 */

import { ScalingService } from '../src/core/math/scaling-service.js';

export class RolloverRoutingHelper {
  /**
   * Solves cross-loan asset routing, calculating required borrow amount under LLTV safety limits
   * and fetching swap routes to convert borrowed dest loan asset to source loan asset.
   *
   * @param {object} params
   * @param {object} params.routerClient
   * @param {object} params.assessment
   * @param {bigint} params.strictSlippageBps
   * @param {number} params.slippageFrac
   * @param {bigint} params.expectedNewCollateral
   * @param {bigint} params.newOraclePrice
   * @param {object} params.ltvCalculator
   * @param {object} params.options
   * @param {string} params.bundlerAddress
   * @param {string} params.adapterAddress
   * @returns {Promise<{ loanRouteData: object, loanExpectedInput: bigint, loanExpectedOutput: bigint, loanOracleRate: bigint, loanPriceImpact: number }>}
   */
  static async solveCrossLoanRoute({
    routerClient,
    poolService,
    publicClient,
    assessment,
    strictSlippageBps,
    slippageFrac,
    expectedNewCollateral,
    newOraclePrice,
    oldOraclePrice,
    ltvCalculator,
    options,
    bundlerAddress,
    adapterAddress
  }) {
    const decDiff = BigInt(assessment.destMarketParams.loanDecimals) - BigInt(assessment.sourceMarketParams.loanDecimals);
    const exp = 18n + BigInt(assessment.destMarketParams.loanDecimals) - BigInt(assessment.sourceMarketParams.loanDecimals);

    let loanOracleRate = 0n;
    let loanExpectedInput = 0n;

    // 1. If oracles are available, compute oracle rate and initial borrow expectation
    if (oldOraclePrice && newOraclePrice) {
      loanOracleRate = (oldOraclePrice * 10n ** exp) / newOraclePrice;
      const estimatedInput = (assessment.debtAmount * 10n ** 18n * 10n ** decDiff) / loanOracleRate;
      const slippageBuffer = BigInt(Math.max(50, Math.ceil(assessment.slippage * 100)));
      loanExpectedInput = (estimatedInput * (10000n + slippageBuffer)) / 10000n;
    }

    // 2. Validate/cap borrow amount based on Target Market LLTV safety threshold
    const targetLltv = assessment.destMarketParams.lltv;
    const safeLtv = targetLltv - 5000000000000000n;
    const newCollateralValue = ScalingService.calculateCollateralValue(expectedNewCollateral, newOraclePrice);
    const maxSafeBorrowAmount = (newCollateralValue * safeLtv) / 10n ** 18n;

    if (loanExpectedInput > maxSafeBorrowAmount) {
      if (options.capBorrow) {
        console.warn(`\n⚠️  Warning: Projected borrow amount exceeds Target Market LLTV limit. Capping borrow amount at safe threshold (${(Number(safeLtv) / 1e16).toFixed(2)}% LTV) to prevent reversion. Shortfall will be funded by user wallet.`);
        loanExpectedInput = maxSafeBorrowAmount;
      } else {
        const projectedLtv = ltvCalculator.calculateLtv(loanExpectedInput, newCollateralValue);
        throw new Error(`Projected Target LTV (${projectedLtv.toFixed(2)}%) exceeds Target Market LLTV (${(Number(targetLltv) / 1e16).toFixed(2)}%). Rollover would revert on-chain. Try again with --cap-borrow flag to automatically cap target leverage.`);
      }
    }

    // 3. Try to find a direct Curve pool for dynamic exchange
    let curvePool = null;
    if (poolService && publicClient) {
      const probeAmount = loanExpectedInput > 0n ? loanExpectedInput : (10n ** BigInt(assessment.destMarketParams.loanDecimals));
      curvePool = await poolService.findCurvePoolAndIndices(
        publicClient,
        assessment.destLoanAddress,
        assessment.sourceLoanAddress,
        probeAmount
      );
    }

    let loanRouteData = null;
    let loanExpectedOutput = 0n;

    if (curvePool) {
      loanRouteData = {
        isCurveDirect: true,
        poolAddress: curvePool.poolAddress,
        i: curvePool.i,
        j: curvePool.j,
        indexType: curvePool.indexType
      };
      loanExpectedOutput = curvePool.expectedOutput;
    } else {
      // 4. Fallback to Router Client (e.g. Pendle Convert / DEX aggregators)
      if (!loanExpectedInput || !loanOracleRate) {
        const guessAmount = assessment.debtAmount * (10n ** BigInt(assessment.destMarketParams.loanDecimals)) / (10n ** BigInt(assessment.sourceMarketParams.loanDecimals));
        const nominalInput = guessAmount > 0n ? guessAmount : (10n ** BigInt(assessment.destMarketParams.loanDecimals));

        const nominalRoute = await routerClient.fetchSwapRoute(
          assessment.destLoanAddress,
          nominalInput,
          assessment.sourceLoanAddress,
          slippageFrac,
          bundlerAddress,
          bundlerAddress
        );
        const nominalOutput = BigInt(nominalRoute.outputs[0].amount);
        loanOracleRate = (nominalOutput * 10n ** (18n + decDiff)) / nominalInput;

        const desiredOutput = (assessment.debtAmount * 10000n) / (10000n - strictSlippageBps);
        loanExpectedInput = (desiredOutput * nominalInput) / nominalOutput;

        if (loanExpectedInput > maxSafeBorrowAmount) {
          if (options.capBorrow) {
            console.warn(`\n⚠️  Warning: Projected borrow amount exceeds Target Market LLTV limit. Capping borrow amount at safe threshold (${(Number(safeLtv) / 1e16).toFixed(2)}% LTV) to prevent reversion. Shortfall will be funded by user wallet.`);
            loanExpectedInput = maxSafeBorrowAmount;
          } else {
            const projectedLtv = ltvCalculator.calculateLtv(loanExpectedInput, newCollateralValue);
            throw new Error(`Projected Target LTV (${projectedLtv.toFixed(2)}%) exceeds Target Market LLTV (${(Number(targetLltv) / 1e16).toFixed(2)}%). Rollover would revert on-chain. Try again with --cap-borrow flag to automatically cap target leverage.`);
          }
        }
      }

      let swapInputAmount = loanExpectedInput - 100000n;
      loanRouteData = await routerClient.fetchSwapRoute(
        assessment.destLoanAddress,
        swapInputAmount,
        assessment.sourceLoanAddress,
        slippageFrac,
        adapterAddress,
        bundlerAddress
      );
      loanExpectedOutput = BigInt(loanRouteData.outputs[0].amount);
      let minSwapOutput = (loanExpectedOutput * (10000n - strictSlippageBps)) / 10000n;

      if (minSwapOutput < assessment.debtAmount && loanExpectedInput < maxSafeBorrowAmount) {
        const adjustedInput = (loanExpectedInput * assessment.debtAmount) / minSwapOutput;
        loanExpectedInput = adjustedInput > maxSafeBorrowAmount ? maxSafeBorrowAmount : adjustedInput;

        if (loanExpectedInput > swapInputAmount) {
          swapInputAmount = loanExpectedInput - 100000n;
          loanRouteData = await routerClient.fetchSwapRoute(
            assessment.destLoanAddress,
            swapInputAmount,
            assessment.sourceLoanAddress,
            slippageFrac,
            adapterAddress,
            bundlerAddress
          );
          loanExpectedOutput = BigInt(loanRouteData.outputs[0].amount);
        }
      }
    }

    const loanQuotedRate = loanExpectedInput > 0n ? (loanExpectedOutput * 10n ** (18n + decDiff)) / loanExpectedInput : 0n;
    if (!loanOracleRate && loanQuotedRate > 0n) {
      loanOracleRate = loanQuotedRate;
    }
    const loanPriceImpact = loanOracleRate > 0n ? Number((loanOracleRate - loanQuotedRate) * 10000n / loanOracleRate) / 100 : 0.0;

    return {
      loanRouteData,
      loanExpectedInput,
      loanExpectedOutput,
      loanOracleRate,
      loanPriceImpact
    };
  }

  /**
   * Formats human-readable execution steps and computes shortfall and fair value metrics.
   *
   * @param {object} params
   * @returns {{ steps: string[], loanFairMarketValue: bigint, loanFairValueLoss: bigint, loanWalletShortfall: bigint }}
   */
  static formatStepsAndMetrics({
    assessment,
    swap,
    borrowAmount,
    flashLoanAmount,
    repayAmount,
    strictSlippageBps
  }) {
    const oldLoanDec = 10 ** assessment.sourceMarketParams.loanDecimals;
    const oldCollDec = 10 ** assessment.sourceMarketParams.collateralDecimals;
    const newLoanDec = 10 ** assessment.destMarketParams.loanDecimals;
    const newCollDec = 10 ** assessment.destMarketParams.collateralDecimals;

    const steps = [];
    if (assessment.debtAmount > 0n) {
      steps.push(`Flashloan: Borrow ${Number(flashLoanAmount) / oldLoanDec} ${assessment.oldMarket.loanSymbol} from Adapter`);
      steps.push(`Repay Debt: Repay ${Number(repayAmount) / oldLoanDec} ${assessment.oldMarket.loanSymbol} on old market`);
    }
    steps.push(`Withdraw: Withdraw ${Number(assessment.collateralAmount) / oldCollDec} ${assessment.oldMarket.collateralSymbol} from old market`);

    if (!swap.isSameCollateral) {
      steps.push(`Approve: Approve Swap Router for ${Number(assessment.collateralAmount) / oldCollDec} ${assessment.oldMarket.collateralSymbol}`);
      steps.push(`Swap: Swap ${assessment.oldMarket.collateralSymbol} for ${Number(swap.expectedNewCollateral) / newCollDec} ${assessment.newMarket.collateralSymbol}`);
    }

    steps.push(`Supply: Supply ${assessment.newMarket.collateralSymbol} to new market`);

    if (assessment.debtAmount > 0n) {
      steps.push(`Borrow: Borrow ${Number(borrowAmount) / newLoanDec} ${assessment.newMarket.loanSymbol} from new market`);
    }

    if (!swap.isSameLoan) {
      if (swap.loanRouteData?.isCurveDirect) {
        steps.push(`Approve Curve Swap: Approve Curve Pool for ${Number(swap.loanExpectedInput) / newLoanDec} ${assessment.newMarket.loanSymbol}`);
        steps.push(`Swap Loan Asset: Swap ${assessment.newMarket.loanSymbol} for USDC on Curve Pool`);
      } else {
        steps.push(`Approve Loan Swap: Approve Router for ${Number(swap.loanExpectedInput) / newLoanDec} ${assessment.newMarket.loanSymbol}`);
        steps.push(`Swap Loan Asset: Swap ${assessment.newMarket.loanSymbol} for ${Number(swap.loanExpectedOutput) / oldLoanDec} ${assessment.oldMarket.loanSymbol}`);
      }
    }

    let loanFairMarketValue = 0n;
    let loanFairValueLoss = 0n;
    let loanWalletShortfall = 0n;

    if (!swap.isSameLoan) {
      const exp = 18n + BigInt(assessment.destMarketParams.loanDecimals) - BigInt(assessment.sourceMarketParams.loanDecimals);
      loanFairMarketValue = (swap.loanExpectedInput * swap.loanOracleRate) / 10n ** exp;
      loanFairValueLoss = loanFairMarketValue - swap.loanExpectedOutput;
      const minSwapOutput = swap.loanRouteData?.isCurveDirect
        ? (swap.loanExpectedOutput * BigInt(Math.floor((100 - assessment.slippage) * 100))) / 10000n
        : (swap.loanExpectedOutput * (10000n - strictSlippageBps)) / 10000n;
      loanWalletShortfall = flashLoanAmount - minSwapOutput;
    } else {
      loanWalletShortfall = flashLoanAmount - borrowAmount;
    }

    return {
      steps,
      loanFairMarketValue,
      loanFairValueLoss,
      loanWalletShortfall
    };
  }
}
