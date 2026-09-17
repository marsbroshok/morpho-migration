/**
 * @fileoverview SlippageService provides bounds checking, basis points calculations,
 * price impact evaluations, and MEV frontrunning protection for trade and migration execution.
 */

/**
 * Service responsible for slippage calculations and MEV protection constraints.
 */
export class SlippageService {
  /**
   * Applies slippage tolerance to calculate the minimum acceptable output amount.
   * Equation: MinimumAmount = ExpectedAmount * (10000 - SlippageBps) / 10000
   *
   * @param {bigint} expectedAmount Expected output token amount.
   * @param {bigint} slippageBps Slippage tolerance in basis points (1 bp = 0.01%, 50 bps = 0.5%).
   * @returns {bigint} Minimum acceptable output amount.
   * @throws {Error} If slippageBps > 10000 (exceeds 100%).
   */
  applySlippageTolerance(expectedAmount, slippageBps) {
    if (slippageBps > 10000n) {
      throw new Error(`Slippage tolerance exceeds 100% (${slippageBps} bps)`);
    }
    if (slippageBps === 0n || expectedAmount === 0n) {
      return expectedAmount;
    }
    const multiplier = 10000n - slippageBps;
    return (expectedAmount * multiplier) / 10000n;
  }

  /**
   * Computes the price impact percentage between an expected conversion rate and a realized rate.
   * Equation: Price Impact = ((ExpectedRate - RealizedRate) / ExpectedRate) * 100
   *
   * @param {bigint} expectedRate Expected rate scaled by 1e18.
   * @param {bigint} realizedRate Realized rate scaled by 1e18.
   * @returns {number} Price impact as a percentage float (e.g., 0.50). Positive means unfavorable.
   */
  calculatePriceImpact(expectedRate, realizedRate) {
    if (expectedRate === 0n) {
      return 0;
    }
    const diff = expectedRate - realizedRate;
    // Scale by 10000 for 2 decimal places of percentage (100 * 100)
    const impactBps = (diff * 10000n) / expectedRate;
    return Number(impactBps) / 100;
  }

  /**
   * Validates and converts user-provided percentage slippage into integer basis points.
   * Enforces safety boundaries (0.001% - 10.00%).
   *
   * @param {number} slippagePercent User slippage as a percentage (e.g. 0.5 for 0.5%).
   * @returns {bigint} Slippage in basis points (e.g. 50n).
   * @throws {Error} If slippage is non-numeric, <= 0, or > 10.0%.
   */
  validateSlippage(slippagePercent) {
    if (typeof slippagePercent !== 'number' || isNaN(slippagePercent)) {
      throw new Error('Slippage tolerance must be a valid number.');
    }
    if (slippagePercent <= 0) {
      throw new Error('Slippage must be greater than 0%.');
    }
    if (slippagePercent > 10.0) {
      throw new Error(`Slippage tolerance (${slippagePercent}%) exceeds maximum allowed safe threshold (10.0%).`);
    }
    return BigInt(Math.round(slippagePercent * 100));
  }

  /**
   * Enforces MEV sandwich and frontrunning protection by capping slippage tolerance.
   * Default MEV protection limit is 50 basis points (0.50%).
   *
   * @param {bigint} requestedSlippageBps Requested slippage in basis points.
   * @param {bigint} [maxAllowedSlippageBps=50n] Maximum safe basis points limit.
   * @returns {bigint} Effective slippage tolerance.
   */
  enforceMevProtection(requestedSlippageBps, maxAllowedSlippageBps = 50n) {
    if (requestedSlippageBps > maxAllowedSlippageBps) {
      return maxAllowedSlippageBps;
    }
    return requestedSlippageBps;
  }
}
