export function calculateCollateralValue(collateralAmount, oraclePrice) {
  return (collateralAmount * oraclePrice) / 10n ** 36n;
}

export function calculateLtv(debtAmount, collateralValue) {
  if (collateralValue === 0n) return 0;
  return Number((debtAmount * 10000n) / collateralValue) / 100;
}

export function calculateLeverage(collateralValue, debtAmount) {
  if (collateralValue === 0n) {
    return debtAmount === 0n ? "1.00x" : "Infinite";
  }
  if (collateralValue <= debtAmount) return "Infinite";
  const denominator = collateralValue - debtAmount;
  return (Number((collateralValue * 100n) / denominator) / 100).toFixed(2) + "x";
}

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
