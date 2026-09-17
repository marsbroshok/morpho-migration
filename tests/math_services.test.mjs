import assert from 'assert';
import { ScalingService } from '../src/core/math/scaling-service.js';
import { LtvCalculator } from '../src/core/math/ltv-calculator.js';
import { SlippageService } from '../src/core/math/slippage-service.js';

console.log('Running Mathematical & Sizing Services unit tests (TDD)...');

// ==========================================
// 1. ScalingService Tests
// ==========================================
console.log('Testing ScalingService...');

// Test 1.1: scaleUp and scaleDown
assert.strictEqual(ScalingService.scaleUp(1000n, 6, 18), 1000n * 10n ** 12n);
assert.strictEqual(ScalingService.scaleDown(1000n * 10n ** 12n, 18, 6), 1000n);
assert.strictEqual(ScalingService.scaleUp(500n, 8, 8), 500n);
assert.strictEqual(ScalingService.scaleDown(500n, 8, 8), 500n);

assert.throws(() => ScalingService.scaleUp(100n, 18, 6), /fromDecimals must be <= toDecimals/);
assert.throws(() => ScalingService.scaleDown(100n, 6, 18), /fromDecimals must be >= toDecimals/);

// Test 1.2: scalePrice
// Oracle price for 18 dec collateral and 6 dec loan is scaled by 10^(36 + 6 - 18) = 10^24
const rawPrice18to6 = 950000000000000000000000n; // 0.95 scaled to 1e24
assert.strictEqual(ScalingService.scalePrice(rawPrice18to6, 6, 18), rawPrice18to6);

// Test 1.3: calculateCollateralValue
// 18 decimals collateral, 1e24 oracle price -> 6 decimals value
const collateral18 = 8000320000000000000000n; // 8000.32 PT
const val6 = ScalingService.calculateCollateralValue(collateral18, rawPrice18to6);
assert.strictEqual(val6, 7600304000n); // 7600.304 USDC

// Zero checks
assert.strictEqual(ScalingService.calculateCollateralValue(0n, rawPrice18to6), 0n);
assert.strictEqual(ScalingService.calculateCollateralValue(collateral18, 0n), 0n);

// Test 1.4: formatUnits and parseUnits
assert.strictEqual(ScalingService.formatUnits(1234567890000000000n, 18, 2), '1.23');
assert.strictEqual(ScalingService.formatUnits(5000000n, 6, 2), '5.00');
assert.strictEqual(ScalingService.formatUnits(0n, 6, 2), '0.00');
assert.strictEqual(ScalingService.formatUnits(1050000n, 6, 4), '1.0500');

assert.strictEqual(ScalingService.parseUnits('1.2345', 6), 1234500n);
assert.strictEqual(ScalingService.parseUnits('0.5', 18), 500000000000000000n);
assert.strictEqual(ScalingService.parseUnits('100', 6), 100000000n);
assert.strictEqual(ScalingService.parseUnits('0', 18), 0n);
assert.strictEqual(ScalingService.parseUnits('1.1234567', 6), 1123456n); // Truncates beyond precision

console.log('✅ ScalingService tests passed!');

// ==========================================
// 2. LtvCalculator Tests
// ==========================================
console.log('Testing LtvCalculator...');

const ltvCalc = new LtvCalculator();

// Test 2.1: calculateLtv
assert.strictEqual(ltvCalc.calculateLtv(6195880000n, 7600304000n), 81.52);
assert.strictEqual(ltvCalc.calculateLtv(0n, 7600304000n), 0);
assert.strictEqual(ltvCalc.calculateLtv(5000n, 0n), 0);

// Test 2.2: calculateLeverage
assert.strictEqual(ltvCalc.calculateLeverage(7600304000n, 6195880000n), '5.41x');
assert.strictEqual(ltvCalc.calculateLeverage(7600304000n, 0n), '1.00x');
assert.strictEqual(ltvCalc.calculateLeverage(0n, 0n), '1.00x');
assert.strictEqual(ltvCalc.calculateLeverage(0n, 5000n), 'Infinite');
assert.strictEqual(ltvCalc.calculateLeverage(5000n, 5000n), 'Infinite');
assert.strictEqual(ltvCalc.calculateLeverage(5000n, 6000n), 'Infinite');

// Test 2.3: calculateHealthFactor
// Health Factor = (CollateralValue * LLTV) / Debt
const lltv86 = 860000000000000000n; // 86% LLTV (18 decimals)
const hf = ltvCalc.calculateHealthFactor(7600304000n, 6195880000n, lltv86);
// (7600.304 * 0.86) / 6195.88 = 6536.26 / 6195.88 = 1.0549
assert.strictEqual(Number(hf.toFixed(4)), 1.0549);

// Zero debt = infinite health factor
assert.strictEqual(ltvCalc.calculateHealthFactor(7600304000n, 0n, lltv86), Infinity);
// Zero collateral = 0 health factor
assert.strictEqual(ltvCalc.calculateHealthFactor(0n, 5000n, lltv86), 0);

// Test 2.4: calculateMaxBorrow
// Max borrow with safety buffer of 50 bps (0.5%)
const maxBorrow = ltvCalc.calculateMaxBorrow(7600304000n, lltv86, 50n);
assert.ok(maxBorrow > 0n);
assert.ok(maxBorrow < (7600304000n * lltv86) / 10n ** 18n);

// Test 2.5: calculateLeverageAdjustmentParams
const liveDebt = 6195880000n; // 6195.88 USDC
const liveCollateral = 8000320000000000000000n; // 8000.32 PT
const oraclePrice = 950000000000000000000000n; // 0.95 scaled by 1e24
const swapPrice = 945000000000000000000000n; // 0.945 scaled by 1e24

// Invalid target leverage limits (< 1.0 or > 6.0)
assert.throws(() => ltvCalc.calculateLeverageAdjustmentParams(liveDebt, liveCollateral, oraclePrice, swapPrice, 0.9), /safe maximum limit/);
assert.throws(() => ltvCalc.calculateLeverageAdjustmentParams(liveDebt, liveCollateral, oraclePrice, swapPrice, 6.5), /safe maximum limit/);
assert.throws(() => ltvCalc.calculateLeverageAdjustmentParams(liveDebt, 0n, oraclePrice, swapPrice, 2.0), /zero collateral/);

// Deleverage to 1.0x (unleveraged)
const delev1x = ltvCalc.calculateLeverageAdjustmentParams(liveDebt, liveCollateral, oraclePrice, swapPrice, 1.0);
assert.strictEqual(delev1x.mode, 'deleverage-to-1x');
assert.strictEqual(delev1x.debtAmount, liveDebt);
assert.strictEqual(delev1x.collateralAmount, (liveDebt * 10n ** 36n) / swapPrice);

// Deleverage to 2.0x
const delev = ltvCalc.calculateLeverageAdjustmentParams(liveDebt, liveCollateral, oraclePrice, swapPrice, 2.0);
assert.strictEqual(delev.mode, 'deleverage');
assert.ok(delev.collateralAmount > 0n);
assert.ok(delev.debtAmount > 0n);

// Leverage up to 5.8x
const levUp = ltvCalc.calculateLeverageAdjustmentParams(liveDebt, liveCollateral, oraclePrice, swapPrice, 5.8);
assert.strictEqual(levUp.mode, 'leverage-up');
assert.ok(levUp.debtAmount > 0n);
assert.ok(levUp.collateralAmount > 0n);

console.log('✅ LtvCalculator tests passed!');

// ==========================================
// 3. SlippageService Tests
// ==========================================
console.log('Testing SlippageService...');

const slipService = new SlippageService();

// Test 3.1: applySlippageTolerance
const expectedOut = 1000000000n; // 1000 USDC
const minOut50bps = slipService.applySlippageTolerance(expectedOut, 50n); // 0.5%
assert.strictEqual(minOut50bps, 995000000n); // 995 USDC

const minOut0bps = slipService.applySlippageTolerance(expectedOut, 0n);
assert.strictEqual(minOut0bps, expectedOut);

assert.throws(() => slipService.applySlippageTolerance(expectedOut, 10001n), /exceeds 100%/);

// Test 3.2: calculatePriceImpact
// Expected rate 1.0, Realized rate 0.995 -> 0.50% price impact
const impact = slipService.calculatePriceImpact(1000000000000000000n, 995000000000000000n);
assert.strictEqual(impact, 0.5);

// Realized rate better than expected -> negative impact (favorable)
const favorableImpact = slipService.calculatePriceImpact(1000000000000000000n, 1005000000000000000n);
assert.strictEqual(favorableImpact, -0.5);

// Zero expected rate fallback
assert.strictEqual(slipService.calculatePriceImpact(0n, 100n), 0);

// Test 3.3: validateSlippage
assert.strictEqual(slipService.validateSlippage(0.5), 50n); // 0.5% -> 50 bps
assert.strictEqual(slipService.validateSlippage(1.0), 100n); // 1.0% -> 100 bps
assert.strictEqual(slipService.validateSlippage(0.01), 1n);

assert.throws(() => slipService.validateSlippage(0), /Slippage must be greater than 0/);
assert.throws(() => slipService.validateSlippage(-1), /Slippage must be greater than 0/);
assert.throws(() => slipService.validateSlippage(15), /exceeds maximum allowed/);
assert.throws(() => slipService.validateSlippage('invalid'), /number/);

// Test 3.4: enforceMevProtection
// Capped at 50 bps (0.5%) if higher
assert.strictEqual(slipService.enforceMevProtection(100n, 50n), 50n);
assert.strictEqual(slipService.enforceMevProtection(25n, 50n), 25n);
assert.strictEqual(slipService.enforceMevProtection(50n, 50n), 50n);

console.log('✅ SlippageService tests passed!');
console.log('🎉 All Mathematical & Sizing Services unit tests passed successfully!');
