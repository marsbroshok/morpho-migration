/**
 * Computes the equivalent value of a collateral asset in loan asset terms.
 * Equation: Value = (CollateralAmount * OraclePrice) / 10^36
 * Decimals Scaling:
 * - collateralAmount is scaled by collateral decimals (e.g., 18).
 * - oraclePrice is scaled by 10^(36 + loanDecimals - collateralDecimals).
 * - The result is scaled by loan decimals (e.g., 6 for USDC).
 *
 * @param {bigint} collateralAmount
 * @param {bigint} oraclePrice
 * @returns {bigint} Collateral value in loan token decimals
 */
export function calculateCollateralValue(collateralAmount, oraclePrice) {
  return (collateralAmount * oraclePrice) / 10n ** 36n;
}

/**
 * Calculates the Loan-to-Value (LTV) percentage.
 * Equation: LTV = (DebtAmount / CollateralValue) * 100
 * Both parameters must have the same decimal scaling (typically loan decimals).
 *
 * @param {bigint} debtAmount
 * @param {bigint} collateralValue
 * @returns {number} LTV as a percentage float (e.g., 81.52)
 */
export function calculateLtv(debtAmount, collateralValue) {
  if (collateralValue === 0n) return 0;
  return Number((debtAmount * 10000n) / collateralValue) / 100;
}

/**
 * Calculates the leverage ratio based on collateral value and debt.
 * Equation: Leverage = CollateralValue / (CollateralValue - DebtAmount)
 * Both parameters must have the same decimal scaling.
 *
 * @param {bigint} collateralValue
 * @param {bigint} debtAmount
 * @returns {string} Leverage formatted string (e.g., "5.41x" or "Infinite")
 */
export function calculateLeverage(collateralValue, debtAmount) {
  if (collateralValue === 0n) {
    return debtAmount === 0n ? "1.00x" : "Infinite";
  }
  if (collateralValue <= debtAmount) return "Infinite";
  const denominator = collateralValue - debtAmount;
  return (Number((collateralValue * 100n) / denominator) / 100).toFixed(2) + "x";
}

/**
 * Solves the exact token borrow/sell amounts required to adjust a position to a target leverage.
 * Equations solved:
 * - Target LTV = 1 - (1 / TargetLeverage)
 * - For Deleverage: CollateralToSell = (Debt - CollateralValue * TargetLTV) / (SwapPrice - OraclePrice * TargetLTV)
 * - For Leverage Up: DebtToBorrow = (CollateralValue * TargetLTV - Debt) / (1 - TargetLTV)
 *
 * @param {bigint} liveDebt Current position debt (scaled by loan decimals)
 * @param {bigint} liveCollateral Current position collateral (scaled by collateral decimals)
 * @param {bigint} oraclePrice Collateral price in loan (scaled by 10^(36 + loanDec - collDec))
 * @param {bigint} swapPrice Collateral to loan swap conversion price (scaled by 10^(36 + loanDec - collDec))
 * @param {number} targetLeverage Target leverage ratio (e.g., 3.0)
 * @returns {object} { mode: 'deleverage'|'leverage-up'|'deleverage-to-1x', debtAmount: bigint, collateralAmount: bigint }
 */
export function calculateLeverageAdjustmentParams(liveDebt, liveCollateral, oraclePrice, swapPrice, targetLeverage) {
  // Safety check: Leverage target must be between 1.0 and 6.0
  if (targetLeverage < 1.0 || targetLeverage > 6.0) {
    throw new Error("Leverage target exceeds safe maximum limit (1.0x - 6.0x).");
  }

  // Target LTV
  const targetLtvNumeric = 1.0 - (1.0 / targetLeverage);
  const targetLtvBig = BigInt(Math.floor(targetLtvNumeric * 1e18));

  // Current Collateral Value in assets (scaled by 6 decimals, USDC)
  const collateralValue = (liveCollateral * oraclePrice) / 10n ** 36n;

  if (collateralValue === 0n) {
    throw new Error("Cannot adjust leverage of a position with zero collateral.");
  }

  const currentLtvBig = (liveDebt * 10n ** 18n) / collateralValue;

  if (targetLeverage === 1.0) {
    // Deleverage to exactly 1.0x (unleveraged)
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
      throw new Error("Mathematical error in deleveraging calculations (denominator <= 0).");
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
