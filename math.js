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
