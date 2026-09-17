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
   * Solves the exact token borrow or sell amounts required to transition a position to a target leverage.
   *
   * Solved equations:
   * - Target LTV = 1 - (1 / TargetLeverage)
   * - Deleverage: CollateralToSell = (Debt - CollateralValue * TargetLTV) / (SwapPrice - OraclePrice * TargetLTV)
   * - Leverage Up: DebtToBorrow = (CollateralValue * TargetLTV - Debt) / (1 - TargetLTV)
   *
   * @param {bigint} liveDebt Current debt in loan token decimals.
   * @param {bigint} liveCollateral Current collateral in collateral token decimals.
   * @param {bigint} oraclePrice Collateral price in loan (scaled by 10^(36 + loanDec - collDec)).
   * @param {bigint} swapPrice Collateral swap execution price (scaled by 10^(36 + loanDec - collDec)).
   * @param {number} targetLeverage Target leverage multiplier (between 1.0 and 6.0).
   * @returns {{ mode: 'deleverage'|'leverage-up'|'deleverage-to-1x', debtAmount: bigint, collateralAmount: bigint }}
   * @throws {Error} If targetLeverage is out of bounds or calculation encounters zero collateral.
   */
  calculateLeverageAdjustmentParams(liveDebt, liveCollateral, oraclePrice, swapPrice, targetLeverage) {
    if (targetLeverage < 1.0 || targetLeverage > 6.0) {
      throw new Error('Leverage target exceeds safe maximum limit (1.0x - 6.0x).');
    }

    const targetLtvNumeric = 1.0 - 1.0 / targetLeverage;
    const targetLtvBig = BigInt(Math.floor(targetLtvNumeric * 1e18));

    const collateralValue = ScalingService.calculateCollateralValue(liveCollateral, oraclePrice);
    if (collateralValue === 0n) {
      throw new Error('Cannot adjust leverage of a position with zero collateral.');
    }

    const currentLtvBig = (liveDebt * 10n ** 18n) / collateralValue;

    if (targetLeverage === 1.0) {
      const collateralToSell = (liveDebt * 10n ** 36n) / swapPrice;
      return {
        mode: 'deleverage-to-1x',
        debtAmount: liveDebt,
        collateralAmount: collateralToSell
      };
    }

    if (targetLtvBig < currentLtvBig) {
      // Mode: Deleverage
      const numeratorPart2 = (liveCollateral * oraclePrice * targetLtvBig) / 10n ** 54n;
      const numerator = liveDebt - numeratorPart2;

      const denominatorPart2 = (oraclePrice * targetLtvBig) / 10n ** 18n;
      const denominator = swapPrice - denominatorPart2;

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
      const numeratorPart1 = (liveCollateral * oraclePrice * targetLtvBig) / 10n ** 54n;
      const numerator = numeratorPart1 - liveDebt;

      const denominator = 10n ** 18n - targetLtvBig;
      const debtToBorrow = (numerator * 10n ** 18n) / denominator;
      const collateralToBuy = (debtToBorrow * 10n ** 36n) / swapPrice;

      return {
        mode: 'leverage-up',
        debtAmount: debtToBorrow,
        collateralAmount: collateralToBuy
      };
    }
  }
}
