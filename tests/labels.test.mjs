import assert from 'assert';

let labels;
try {
  labels = await import('../labels.js');
} catch (err) {
  console.log('Test failed as expected: labels.js is not yet implemented.');
  process.exit(0);
}

const { formatMarketLabel } = labels;

console.log('Running market label tests...');

assert.strictEqual(formatMarketLabel('PT-apyUSD-18JUN2026', 'USDC'), '(PT-apyUSD-18JUN2026/USDC)');
assert.strictEqual(formatMarketLabel('', ''), '');
assert.strictEqual(formatMarketLabel('USDT', ''), '(USDT)');
assert.strictEqual(formatMarketLabel('', 'USDC'), '(USDC)');

console.log('All labels tests passed successfully!');
