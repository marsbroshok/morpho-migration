/**
 * @fileoverview LtvCalculator provides mathematical models and solvers for Loan-to-Value (LTV),
 * leverage multipliers, health factor risk boundaries, safe borrowing thresholds, and exact
 * collateral/debt sizing for leverage adjustment operations on Morpho Blue positions.
 */

import { ScalingService } from './scaling-service.js';

/**
 * Service responsible for position risk, leverage, and solvency math.
 */
export class LtvCalculator {
  /**
   * Calculates the Loan-to-Value (LTV) percentage.
   * Equation: LTV = (DebtAmount / CollateralValue) * 100
   *
   * @param {bigint} debtAmount Debt amount in loan decimals.
   * @param {bigint} collateralValue Collateral value in loan decimals.
   * @returns {number} LTV as a percentage float (e.g., 81.52).
   */
  calculateLtv(debtAmount, collateralValue) {
    if (collateralValue === 0n) {
      return 0;
    }
    return Number((debtAmount * 10000n) / collateralValue) / 100;
  }

  /**
   * Calculates the leverage multiplier string based on collateral value and debt.
   * Equation: Leverage = CollateralValue / (CollateralValue - DebtAmount)
   *
   * @param {bigint} collateralValue Collateral value in loan decimals.
   * @param {bigint} debtAmount Debt amount in loan decimals.
   * @returns {string} Leverage formatted string (e.g., "5.41x", "1.00x", or "Infinite").
   */
  calculateLeverage(collateralValue, debtAmount) {
    if (collateralValue === 0n) {
      return debtAmount === 0n ? '1.00x' : 'Infinite';
    }
    if (collateralValue <= debtAmount) {
      return 'Infinite';
    }
    const denominator = collateralValue - debtAmount;
    return (Number((collateralValue * 100n) / denominator) / 100).toFixed(2) + 'x';
  }

  /**
   * Calculates the position Health Factor.
   * Equation: Health Factor = (CollateralValue * LLTV) / Debt
   * A health factor > 1.0 indicates a solvent, safe position.
   * A health factor <= 1.0 indicates a position eligible for liquidation.
   *
   * @param {bigint} collateralValue Collateral value in loan decimals.
   * @param {bigint} debtAmount Debt amount in loan decimals.
   * @param {bigint} lltv Market Liquidation Loan-to-Value, scaled by 1e18 (e.g. 0.86e18).
   * @returns {number} Health factor as a float.
   */
  calculateHealthFactor(collateralValue, debtAmount, lltv) {
    if (debtAmount === 0n) {
      return Infinity;
    }
    if (collateralValue === 0n) {
      return 0;
    }
    const maxBorrowAllowed = (collateralValue * lltv) / 10n ** 18n;
    return Number((maxBorrowAllowed * 10000n) / debtAmount) / 10000;
  }

  /**
   * Calculates the maximum safe borrow amount given collateral value and LLTV with an optional safety buffer.
   * Equation: MaxSafeBorrow = (CollateralValue * LLTV * (10000 - SafetyBufferBps)) / (1e18 * 10000)
   *
   * @param {bigint} collateralValue Collateral value in loan decimals.
   * @param {bigint} lltv Market LLTV (scaled by 1e18).
   * @param {bigint} [safetyBufferBps=50n] Safety buffer in basis points (default 50 bps = 0.50%).
   * @returns {bigint} Safe maximum borrow amount in loan decimals.
   */
  calculateMaxBorrow(collateralValue, lltv, safetyBufferBps = 50n) {
    if (collateralValue === 0n || lltv === 0n) {
      return 0n;
    }
    const rawMaxBorrow = (collateralValue * lltv) / 10n ** 18n;
    const safeMultiplier = 10000n - safetyBufferBps;
    return (rawMaxBorrow * safeMultiplier) / 10000n;
  }

  /**
   * Calculates the maximum safe leverage dynamically from the market's specific LLTV parameter
   * with a configurable safety buffer (default 200 bps = 2.0%).
   * Equation: MaxSafeLeverage = 10^18 / (10^18 - (LLTV - Buffer))
   *
   * @param {bigint|number|string} lltv Market LLTV (scaled by 1e18, e.g. 0.86e18).
   * @param {bigint|number} [bufferBps=200n] Safety buffer in basis points (default 200 bps).
   * @returns {number} Maximum safe leverage multiplier as a float (e.g. 4.00, 6.25, 18.18).
   * @throws {Error} If effective LLTV exceeds or equals 100%.
   */
  calculateMaxSafeLeverage(lltv, bufferBps = 200n) {
    const lltvBig = BigInt(lltv);
    const bufferBpsBig = BigInt(bufferBps);
    const bufferScaled = (bufferBpsBig * 10n ** 18n) / 10000n;
    const effectiveLltv = lltvBig - bufferScaled;
    const denominator = 10n ** 18n - effectiveLltv;
    if (denominator <= 0n) {
      throw new Error('Effective LLTV exceeds or equals 100%, cannot compute safe leverage.');
    }
    return Number((10n ** 22n) / denominator) / 10000;
  }

  /**
   * Solves the exact token borrow or sell amounts required to transition a position to a target leverage.
   * Operates strictly in rational BigInt arithmetic without IEEE-754 floating-point drift.
   *
   * Solved rational equations:
   * - Target LTV ratio: A / B = (TargetLeverageScaled - ScaleFactor) / TargetLeverageScaled
   * - Deleverage:
   *   CollateralToSell = ((Debt * B - CollateralValue * A) * 10^36) / (SwapPrice * B - OraclePrice * A)
   *   DebtToRepay = (CollateralToSell * SwapPrice) / 10^36
   * - Leverage Up:
   *   DebtToBorrow = (CollateralValue * A - Debt * B) / (B - A)
   *   CollateralToBuy = (DebtToBorrow * 10^36) / SwapPrice
   *
   * @param {bigint} liveDebt Current debt in loan token decimals.
   * @param {bigint} liveCollateral Current collateral in collateral token decimals.
   * @param {bigint} oraclePrice Collateral price in loan (scaled by 10^(36 + loanDec - collDec)).
   * @param {bigint} swapPrice Collateral swap execution price (scaled by 10^(36 + loanDec - collDec)).
   * @param {number|bigint|string} targetLeverage Target leverage multiplier.
   * @param {bigint|number|string|null} [lltv=null] Optional market LLTV (scaled by 1e18) for dynamic safety ceiling.
   * @param {bigint|number} [bufferBps=200n] Safety buffer in basis points when dynamic LLTV is provided.
   * @returns {{ mode: 'deleverage'|'leverage-up'|'deleverage-to-1x', debtAmount: bigint, collateralAmount: bigint }}
   * @throws {Error} If targetLeverage is out of bounds or position has zero collateral.
   */
  calculateLeverageAdjustmentParams(liveDebt, liveCollateral, oraclePrice, swapPrice, targetLeverage, lltv = null, bufferBps = 200n) {
    const maxSafeLeverage = lltv != null ? this.calculateMaxSafeLeverage(lltv, bufferBps) : 6.0;
    const targetLevNum = Number(targetLeverage);
    if (targetLevNum < 1.0 || targetLevNum > maxSafeLeverage) {
      throw new Error(`Leverage target exceeds safe maximum limit (must be between 1.0x and ${maxSafeLeverage.toFixed(2)}x).`);
    }

    const scaleFactor = 10000n;
    const targetLeverageScaled = BigInt(Math.round(targetLevNum * Number(scaleFactor)));
    const targetLtvNumerator = targetLeverageScaled - scaleFactor; // A
    const targetLtvDenominator = targetLeverageScaled;            // B

    if (targetLeverageScaled === scaleFactor) {
      const collateralToSell = (liveDebt * 10n ** 36n) / swapPrice;
      return {
        mode: 'deleverage-to-1x',
        debtAmount: liveDebt,
        collateralAmount: collateralToSell
      };
    }

    const collateralValue = ScalingService.calculateCollateralValue(liveCollateral, oraclePrice);
    if (collateralValue === 0n) {
      throw new Error('Cannot adjust leverage of a position with zero collateral.');
    }

    const targetLtvBig = (targetLtvNumerator * 10n ** 18n) / targetLtvDenominator;
    const currentLtvBig = (liveDebt * 10n ** 18n) / collateralValue;

    if (targetLtvBig < currentLtvBig) {
      // Mode: Deleverage
      // Using exact rational substitution to eliminate floating-point and integer truncation drift:
      // CollateralToSell = (Debt * B - CollateralValue * A) / (SwapPrice * B - OraclePrice * A)
      const numerator = liveDebt * targetLtvDenominator - collateralValue * targetLtvNumerator;
      const denominator = swapPrice * targetLtvDenominator - oraclePrice * targetLtvNumerator;

      if (denominator <= 0n) {
        throw new Error('Mathematical error in deleveraging calculations (denominator <= 0).');
      }

      const collateralToSell = (numerator * 10n ** 36n) / denominator;
      const debtToRepay = (collateralToSell * swapPrice) / 10n ** 36n;

      return {
        mode: 'deleverage',
        collateralAmount: collateralToSell,
        debtAmount: debtToRepay
      };
    } else {
      // Mode: Leverage Up
      // DebtToBorrow = (CollateralValue * A - Debt * B) / (B - A)
      const numerator = collateralValue * targetLtvNumerator - liveDebt * targetLtvDenominator;
      const denominator = targetLtvDenominator - targetLtvNumerator;

      const debtToBorrow = numerator / denominator;
      const collateralToBuy = (debtToBorrow * 10n ** 36n) / swapPrice;

      return {
        mode: 'leverage-up',
        debtAmount: debtToBorrow,
        collateralAmount: collateralToBuy
      };
    }
  }
}

