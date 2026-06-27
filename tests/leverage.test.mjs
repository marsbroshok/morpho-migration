import assert from 'assert';

import { calculateCollateralValue, calculateLtv, calculateLeverage } from '../math.js';

console.log('Running leverage and LTV tests...');

const collateral = 8000320000000000000000n; // 8000.32 apyUSD (18 dec)
const oraclePrice = 1052631578947368421052631578947368421n; // 1.0526 apyUSD per USDC (36 dec)
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

console.log('All tests passed successfully!');
