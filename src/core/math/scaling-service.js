/**
 * @fileoverview ScalingService handles multi-decimal conversions, fixed-point asset scaling,
 * oracle price normalizations, and unit formatting between disparate token decimal precisions.
 */

/**
 * Service responsible for decimal precision scaling and price conversions.
 */
export class ScalingService {
  /**
   * Scales an amount up from a lower decimal precision to a higher decimal precision.
   *
   * @param {bigint} amount The base amount to scale.
   * @param {number} fromDecimals Source decimal precision.
   * @param {number} toDecimals Target decimal precision.
   * @returns {bigint} Scaled amount.
   * @throws {Error} If fromDecimals > toDecimals.
   */
  static scaleUp(amount, fromDecimals, toDecimals) {
    if (fromDecimals > toDecimals) {
      throw new Error(`fromDecimals must be <= toDecimals (received from=${fromDecimals}, to=${toDecimals})`);
    }
    if (fromDecimals === toDecimals) {
      return amount;
    }
    const diff = BigInt(toDecimals - fromDecimals);
    return amount * 10n ** diff;
  }

  /**
   * Scales an amount down from a higher decimal precision to a lower decimal precision (truncated).
   *
   * @param {bigint} amount The base amount to scale down.
   * @param {number} fromDecimals Source decimal precision.
   * @param {number} toDecimals Target decimal precision.
   * @returns {bigint} Scaled down amount.
   * @throws {Error} If fromDecimals < toDecimals.
   */
  static scaleDown(amount, fromDecimals, toDecimals) {
    if (fromDecimals < toDecimals) {
      throw new Error(`fromDecimals must be >= toDecimals (received from=${fromDecimals}, to=${toDecimals})`);
    }
    if (fromDecimals === toDecimals) {
      return amount;
    }
    const diff = BigInt(fromDecimals - toDecimals);
    return amount / 10n ** diff;
  }

  /**
   * Normalizes oracle price scaling to loan token decimals.
   * Morpho Blue oracle prices are 1e36 scale:
   * 1 collateral asset = (oraclePrice / 10^(36 + loanDecimals - collateralDecimals)) loan assets.
   *
   * @param {bigint} oraclePrice Raw oracle price from Morpho Blue oracle.
   * @param {number} loanDecimals Decimal precision of loan token.
   * @param {number} collateralDecimals Decimal precision of collateral token.
   * @returns {bigint} Normalized oracle price.
   */
  static scalePrice(oraclePrice, loanDecimals, collateralDecimals) {
    return oraclePrice;
  }

  /**
   * Computes the equivalent value of a collateral asset in loan asset terms.
   * Equation: Value = (CollateralAmount * OraclePrice) / 10^36
   *
   * @param {bigint} collateralAmount Collateral balance in collateral token decimals.
   * @param {bigint} oraclePrice Oracle price scaled by 10^(36 + loanDecimals - collateralDecimals).
   * @returns {bigint} Collateral value in loan token decimals.
   */
  static calculateCollateralValue(collateralAmount, oraclePrice) {
    if (collateralAmount === 0n || oraclePrice === 0n) {
      return 0n;
    }
    return (collateralAmount * oraclePrice) / 10n ** 36n;
  }

  /**
   * Formats a bigint token amount into a human-readable decimal string with fixed precision.
   *
   * @param {bigint} amount Raw token amount.
   * @param {number} decimals Token decimals.
   * @param {number} [precision=2] Number of fractional digits to display.
   * @returns {string} Formatted string (e.g., "123.45").
   */
  static formatUnits(amount, decimals, precision = 2) {
    if (amount === 0n) {
      return (0).toFixed(precision);
    }
    const divisor = 10n ** BigInt(decimals);
    const integerPart = amount / divisor;
    const remainder = amount % divisor;

    if (precision === 0) {
      return integerPart.toString();
    }

    const paddedRemainder = remainder.toString().padStart(decimals, '0');
    const decimalPart = paddedRemainder.slice(0, precision).padEnd(precision, '0');
    return `${integerPart.toString()}.${decimalPart}`;
  }

  /**
   * Parses a user-input decimal string into a BigInt token amount.
   * Truncates excess fractional digits if input precision exceeds token decimals.
   *
   * @param {string} amountStr Human-readable number string (e.g. "1.2345").
   * @param {number} decimals Token decimals.
   * @returns {bigint} Raw bigint amount.
   */
  static parseUnits(amountStr, decimals) {
    if (!amountStr || amountStr.trim() === '' || amountStr === '0') {
      return 0n;
    }
    const cleanStr = amountStr.trim();
    const parts = cleanStr.split('.');
    const integerPart = parts[0] ? BigInt(parts[0]) : 0n;
    const base = integerPart * 10n ** BigInt(decimals);

    if (parts.length < 2 || !parts[1]) {
      return base;
    }

    const fractionStr = parts[1].slice(0, decimals).padEnd(decimals, '0');
    return base + BigInt(fractionStr);
  }
}
