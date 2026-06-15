import assert from 'assert';

import { formatMarketLabel } from '../labels.js';

console.log('Running market label tests...');

assert.strictEqual(formatMarketLabel('PT-apyUSD-18JUN2026', 'USDC'), '(PT-apyUSD-18JUN2026/USDC)');
assert.strictEqual(formatMarketLabel('', ''), '');
assert.strictEqual(formatMarketLabel('USDT', ''), '(USDT)');
assert.strictEqual(formatMarketLabel('', 'USDC'), '(USDC)');

console.log('All labels tests passed successfully!');
