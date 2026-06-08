export function formatMarketLabel(collateralSymbol, loanSymbol) {
  if (!collateralSymbol && !loanSymbol) return '';
  if (collateralSymbol && !loanSymbol) return `(${collateralSymbol})`;
  if (!collateralSymbol && loanSymbol) return `(${loanSymbol})`;
  return `(${collateralSymbol}/${loanSymbol})`;
}
