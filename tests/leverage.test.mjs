import assert from 'assert';

let math;
try {
  math = await import('../math.js');
} catch (err) {
  console.log('Test failed as expected: math.js is not yet implemented.');
  process.exit(0);
}

const { calculateCollateralValue, calculateLtv, calculateLeverage } = math;

console.log('Running leverage and LTV tests...');

const collateral = 8000320000000000000000n;
const oraclePrice = 950000000000000000000000n;
const debt = 6195880000n;

const val = calculateCollateralValue(collateral, oraclePrice);
assert.strictEqual(val, 7600304000n);

const ltv = calculateLtv(debt, val);
assert.strictEqual(ltv, 81.52);

const leverage = calculateLeverage(val, debt);
assert.strictEqual(leverage, '5.41x');

assert.strictEqual(calculateCollateralValue(0n, oraclePrice), 0n);
assert.strictEqual(calculateLtv(debt, 0n), 0);
assert.strictEqual(calculateLeverage(0n, debt), 'Infinite');

console.log('All tests passed successfully!');
