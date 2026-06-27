import assert from 'assert';

import { calculateCollateralValue, calculateLtv, calculateLeverage } from '../math.js';

console.log('Running leverage and LTV tests...');

const collateral = 8000320000000000000000n; // 8000.32 apyUSD (18 dec)
const oraclePrice = 950000000000000000000000000000000000n; // 0.95 USDC per PT (36 dec)
const debt = 6195880000000000000000n; // 6195.88 USDC/apxUSD (18 dec)

const val = calculateCollateralValue(collateral, oraclePrice);
assert.strictEqual(val, 7600304000000000000000n); // 7600.304 apxUSD (18 dec)

const ltv = calculateLtv(debt, val);
assert.strictEqual(ltv, 81.52);

const leverage = calculateLeverage(val, debt);
assert.strictEqual(leverage, '5.41x');

assert.strictEqual(calculateCollateralValue(0n, oraclePrice), 0n);
assert.strictEqual(calculateLtv(debt, 0n), 0);
assert.strictEqual(calculateLeverage(0n, debt), 'Infinite');

// Test Case: Mixed Decimals (Loan = USDC with 6 decimals, Collateral = PT with 18 decimals)
console.log('Testing mixed decimals (USDC/PT)...');
const collateralUSDC = 8000320000000000000000n; // 8000.32 PT (18 dec)
const oraclePriceUSDC = 950000000000000000000000n; // 0.95 USDC per PT (scaled by 1e24)
const debtUSDC = 6195880000n; // 6195.88 USDC (6 dec)

const valUSDC = calculateCollateralValue(collateralUSDC, oraclePriceUSDC);
assert.strictEqual(valUSDC, 7600304000n); // 7600.304 USDC (6 dec)

const ltvUSDC = calculateLtv(debtUSDC, valUSDC);
assert.strictEqual(ltvUSDC, 81.52);

const leverageUSDC = calculateLeverage(valUSDC, debtUSDC);
assert.strictEqual(leverageUSDC, '5.41x');

console.log('All tests passed successfully!');
