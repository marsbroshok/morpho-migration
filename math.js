/**
 * @fileoverview Mathematical utility functions for Morpho Blue position calculations,
 * Loan-to-Value (LTV) ratios, leverage multipliers, and leverage adjustment parameters.
 * Backward-compatible wrapper delegating to modular core math services.
 */

import { ScalingService } from './src/core/math/scaling-service.js';
import { LtvCalculator } from './src/core/math/ltv-calculator.js';

const ltvCalculator = new LtvCalculator();

/**
 * Computes the equivalent value of a collateral asset in loan asset terms.
 * Equation: Value = (CollateralAmount * OraclePrice) / 10^36
 *
 * @param {bigint} collateralAmount Collateral amount in collateral decimals
 * @param {bigint} oraclePrice Oracle price scaled by 10^(36 + loanDecimals - collateralDecimals)
 * @returns {bigint} Collateral value in loan token decimals
 */
export function calculateCollateralValue(collateralAmount, oraclePrice) {
  return ScalingService.calculateCollateralValue(collateralAmount, oraclePrice);
}

/**
 * Calculates the Loan-to-Value (LTV) percentage.
 * Equation: LTV = (DebtAmount / CollateralValue) * 100
 *
 * @param {bigint} debtAmount Debt amount in loan decimals
 * @param {bigint} collateralValue Collateral value in loan decimals
 * @returns {number} LTV as a percentage float (e.g., 81.52)
 */
export function calculateLtv(debtAmount, collateralValue) {
  return ltvCalculator.calculateLtv(debtAmount, collateralValue);
}

/**
 * Calculates the leverage ratio based on collateral value and debt.
 * Equation: Leverage = CollateralValue / (CollateralValue - DebtAmount)
 *
 * @param {bigint} collateralValue Collateral value in loan decimals
 * @param {bigint} debtAmount Debt amount in loan decimals
 * @returns {string} Leverage formatted string (e.g., "5.41x", "1.00x", or "Infinite")
 */
export function calculateLeverage(collateralValue, debtAmount) {
  return ltvCalculator.calculateLeverage(collateralValue, debtAmount);
}

/**
 * Solves the exact token borrow/sell amounts required to adjust a position to a target leverage.
 *
 * @param {bigint} liveDebt Current position debt (scaled by loan decimals)
 * @param {bigint} liveCollateral Current position collateral (scaled by collateral decimals)
 * @param {bigint} oraclePrice Collateral price in loan (scaled by 10^(36 + loanDec - collDec))
 * @param {bigint} swapPrice Collateral to loan swap conversion price (scaled by 10^(36 + loanDec - collDec))
 * @param {number} targetLeverage Target leverage ratio (e.g., 3.0)
 * @returns {{ mode: 'deleverage'|'leverage-up'|'deleverage-to-1x', debtAmount: bigint, collateralAmount: bigint }}
 */
export function calculateLeverageAdjustmentParams(liveDebt, liveCollateral, oraclePrice, swapPrice, targetLeverage) {
  return ltvCalculator.calculateLeverageAdjustmentParams(liveDebt, liveCollateral, oraclePrice, swapPrice, targetLeverage);
}
