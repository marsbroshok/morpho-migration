import assert from 'assert';

import { calculateLeverageAdjustmentParams } from '../math.js';

console.log('Running leverage adjustment unit tests...');

// Price: 0.95 USDC per PT (0.95 * 10^24)
const oraclePrice = 950000000000000000000000n;
const swapPrice = 950000000000000000000000n;

// Test Case 1: Deleveraging (5x -> 3x)
// Collateral: 8000.32 PT (8000320000000000000000n wei)
// Current Debt: 6080 USDC (6080000000n) -> Current LTV is 6080 / (8000.32 * 0.95) = 80% (5.00x leverage)
// Target Leverage: 3.0x -> Target LTV = 1 - 1/3 = 66.67% (0.6666666...)
const collateral1 = 8000320000000000000000n;
const debt1 = 6080000000n;
const targetLeverage1 = 3.0;

const result1 = calculateLeverageAdjustmentParams(debt1, collateral1, oraclePrice, swapPrice, targetLeverage1);

assert.strictEqual(result1.mode, 'deleverage');
// Target LTV is 2/3 (66.666...). Under IEEE-754 float precision (targetLtvBig = 666666666666666752n)
// This yields collateral to sell: 3199.36 PT (3199360001052632397983n wei) and debt repayment: 3039.39 USDC (3039392000n)
assert.strictEqual(result1.collateralAmount, 3199360001052632397983n);
assert.strictEqual(result1.debtAmount, 3039392001n);

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

// Test Case 4: Over-leverage boundary validation
assert.throws(() => {
  calculateLeverageAdjustmentParams(debt1, collateral1, oraclePrice, swapPrice, 6.5);
}, /Leverage target exceeds safe maximum limit/);

console.log('All leverage adjustment tests passed successfully!');
