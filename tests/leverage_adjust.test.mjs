import assert from 'assert';

import { calculateLeverageAdjustmentParams, calculateMaxSafeLeverage } from '../math.js';

console.log('Running leverage adjustment unit tests...');

// Price: 0.95 USDC per PT (0.95 * 10^24)
const oraclePrice = 950000000000000000000000n;
const swapPrice = 950000000000000000000000n;

// Test Case 1: Deleveraging (5x -> 3x)
// Collateral: 8000 PT (8000000000000000000000n wei)
// Current Debt: 6080 USDC (6080000000n) -> Current LTV is 6080 / (8000 * 0.95) = 80% (5.00x leverage)
// Target Leverage: 3.0x -> Target LTV = 1 - 1/3 = 66.67% (2/3)
const collateral1 = 8000000000000000000000n;
const debt1 = 6080000000n;
const targetLeverage1 = 3.0;

const result1 = calculateLeverageAdjustmentParams(debt1, collateral1, oraclePrice, swapPrice, targetLeverage1);

assert.strictEqual(result1.mode, 'deleverage');
// Target LTV is exact rational 2/3 (66.666...%).
// Solved exactly in BigInt without IEEE-754 float drift:
// Collateral to sell: 3200 PT (3200 * 10^18)
// Debt repayment: 3040 USDC (3040 * 10^6)
assert.strictEqual(result1.collateralAmount, 3200000000000000000000n);
assert.strictEqual(result1.debtAmount, 3040000000n);

// Test Case 1b: Deleveraging with swap slippage (swapPrice < oraclePrice)
// Oracle Price: 0.95 USDC per PT
// Swap Price: 0.90 USDC per PT
const swapPriceSlipped = 900000000000000000000000n;
const result1b = calculateLeverageAdjustmentParams(debt1, collateral1, oraclePrice, swapPriceSlipped, targetLeverage1);

assert.strictEqual(result1b.mode, 'deleverage');
assert.ok(result1b.collateralAmount > result1.collateralAmount, "Slipped swap price must yield higher collateral amount to sell");
// Exact analytical values under rational BigInt:
// Collateral to sell: 3800 PT (3800 * 10^18)
// Debt repayment: 3420 USDC (3420 * 10^6)
const expectedCollateral1b = 3800000000000000000000n;
const expectedDebt1b = 3420000000n;
assert.strictEqual(result1b.collateralAmount, expectedCollateral1b);
assert.strictEqual(result1b.debtAmount, expectedDebt1b);

// Test Case 2: Leveraging Up (3x -> 5x)
// Collateral: 4800 PT (4800n * 1e18)
// Current Debt: 3040 USDC (3040n * 1e6) -> Current LTV is 3040 / (4800 * 0.95) = 66.67% (3.00x leverage)
// Target Leverage: 5.0x -> Target LTV = 80% (0.8)
const collateral2 = 4800000000000000000000n;
const debt2 = 3040000000n;
const targetLeverage2 = 5.0;

const result2 = calculateLeverageAdjustmentParams(debt2, collateral2, oraclePrice, swapPrice, targetLeverage2);

assert.strictEqual(result2.mode, 'leverage-up');
// Solving X = (Collateral * P * LTV - Debt) / (1 - LTV)
// X = (4560 * 0.8 - 3040) / (1 - 0.8) = (3648 - 3040) / 0.2 = 608 / 0.2 = 3040 USDC (3040000000n)
// Y = X / P = 3040 / 0.95 = 3200 PT
assert.strictEqual(result2.debtAmount, 3040000000n);
assert.strictEqual(result2.collateralAmount, 3200000000000000000000n);

// Test Case 3: Deleverage to exactly 1.0x (Unleveraged, clearing debt)
const result3 = calculateLeverageAdjustmentParams(debt1, collateral1, oraclePrice, swapPrice, 1.0);
assert.strictEqual(result3.mode, 'deleverage-to-1x');
assert.strictEqual(result3.debtAmount, debt1);
// Collateral to withdraw and sell to cover the entire debt: Y = Debt / P = 6080 / 0.95 = 6400 PT
assert.strictEqual(result3.collateralAmount, 6400000000000000000000n);

// Test Case 4: Dynamic LLTV Safe Maximum Leverage Calculation
// LLTV Tiers:
// 1. 77.0% LLTV: Buffer 200 bps -> Effective 75.0% -> Max Safe Leverage = 1 / (1 - 0.75) = 4.00x
const maxLev77 = calculateMaxSafeLeverage(770000000000000000n, 200n);
assert.strictEqual(Number(maxLev77.toFixed(2)), 4.00);

// 2. 86.0% LLTV: Buffer 200 bps -> Effective 84.0% -> Max Safe Leverage = 1 / (1 - 0.84) = 6.25x
const maxLev86 = calculateMaxSafeLeverage(860000000000000000n, 200n);
assert.strictEqual(Number(maxLev86.toFixed(2)), 6.25);

// 3. 94.5% LLTV: Buffer 200 bps -> Effective 92.5% -> Max Safe Leverage = 1 / (1 - 0.925) = 13.33x
const maxLev945 = calculateMaxSafeLeverage(945000000000000000n, 200n);
assert.strictEqual(Number(maxLev945.toFixed(2)), 13.33);

// 4. 96.5% LLTV: Buffer 200 bps -> Effective 94.5% -> Max Safe Leverage = 1 / (1 - 0.945) = 18.18x
const maxLev965 = calculateMaxSafeLeverage(965000000000000000n, 200n);
assert.strictEqual(Number(maxLev965.toFixed(2)), 18.18);

// Test Case 5: Dynamic LLTV ceiling enforcement in calculateLeverageAdjustmentParams
// Low LLTV Market (77%): 4.5x exceeds 4.00x max safe leverage -> must throw
assert.throws(() => {
  calculateLeverageAdjustmentParams(debt1, collateral1, oraclePrice, swapPrice, 4.5, 770000000000000000n);
}, /safe maximum limit/);

// High LLTV Market (96.5%): 10.0x is well within 18.18x max safe leverage -> must succeed
const resultHighLev = calculateLeverageAdjustmentParams(debt1, collateral1, oraclePrice, swapPrice, 10.0, 965000000000000000n);
assert.strictEqual(resultHighLev.mode, 'leverage-up');
assert.ok(resultHighLev.debtAmount > 0n);
assert.ok(resultHighLev.collateralAmount > 0n);

// Default ceiling when LLTV is omitted (6.0x default boundary)
assert.throws(() => {
  calculateLeverageAdjustmentParams(debt1, collateral1, oraclePrice, swapPrice, 6.5);
}, /safe maximum limit/);

console.log('All leverage adjustment tests passed successfully!');

