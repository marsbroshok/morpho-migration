import assert from 'assert';
import { decodeFunctionData as viemDecode, encodeFunctionData } from 'viem';
import { buildDeleveragingBundle, buildLeveragingUpBundle } from '../builders.js';

console.log('Running transaction builder unit tests...');

// Mock data
const marketParams = {
  loanToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  collateralToken: '0x3365554a61CeFF74A76528f9e86C1E87946d16a5',
  oracle: '0x0000000000000000000000000000000000000000',
  irm: '0x0000000000000000000000000000000000000000',
  lltv: 0n
};
const collateralAmount = 1000n * 10n ** 18n;
const debtAmount = 500n * 10n ** 6n;
const ptAddress = '0x3365554a61CeFF74A76528f9e86C1E87946d16a5';
const usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const routeData = {
  tx: {
    to: '0x2CC8d502a65824B4cF9A58DB03490bA024BDB806',
    data: '0x'
  }
};
const userAddress = '0xdC382CDF2a25790F535a518EC26958c227e9DCF2';
const ETHER_GENERAL_ADAPTER_1 = '0x4A6c312ec70E8747a587EE860a0353cd42Be0aE0';
const MORPHO_BUNDLER_V3 = '0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245';

// Test 1: Deleveraging Bundle Construction
const bundle1 = buildDeleveragingBundle({
  encodeFunctionData,
  marketParams,
  collateralAmount,
  debtAmount,
  is1x: false,
  ptAddress,
  usdcAddress,
  routeData,
  userAddress,
  ETHER_GENERAL_ADAPTER_1,
  MORPHO_BUNDLER_V3
});

// We expect 4 calls in the reenter bundle:
// 0: Repay Morpho debt
// 1: Withdraw collateral PT (receiver should be MORPHO_BUNDLER_V3)
// 2: Approve Pendle Swap Router to spend PT
// 3: Execute Swap
assert.strictEqual(bundle1.length, 4);
assert.strictEqual(bundle1[1].to, ETHER_GENERAL_ADAPTER_1);
console.log('Test 1: Deleveraging bundle recipient check');
// Decode and verify the PT withdraw recipient is MORPHO_BUNDLER_V3

const decodedWithdraw = viemDecode({
  abi: [
    {
      "inputs": [
        {
          "components": [
            { "name": "loanToken", "type": "address" },
            { "name": "collateralToken", "type": "address" },
            { "name": "oracle", "type": "address" },
            { "name": "irm", "type": "address" },
            { "name": "lltv", "type": "uint256" }
          ],
          "name": "marketParams",
          "type": "tuple"
        },
        { "name": "assets", "type": "uint256" },
        { "name": "receiver", "type": "address" }
      ],
      "name": "morphoWithdrawCollateral",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    }
  ],
  data: bundle1[1].data
});

assert.strictEqual(decodedWithdraw.args[2], MORPHO_BUNDLER_V3);
console.log('Test 1 passed!');

// Test 2: Leveraging Up Bundle Construction
const bundle2 = buildLeveragingUpBundle({
  encodeFunctionData,
  marketParams,
  collateralAmount,
  debtAmount,
  ptAddress,
  usdcAddress,
  routeData,
  userAddress,
  ETHER_GENERAL_ADAPTER_1,
  MORPHO_BUNDLER_V3
});

// We expect 5 calls:
// 0: Transfer USDC from Adapter to Bundler (New step!)
// 1: Approve Router to spend USDC
// 2: Execute Swap
// 3: Supply PT collateral (amount should be type(uint256).max)
// 4: Borrow USDC
assert.strictEqual(bundle2.length, 5);

// Let's decode Call 0 (Transfer USDC from Adapter to Bundler)
const decodedTransfer = viemDecode({
  abi: [
    {
      "inputs": [
        { "name": "token", "type": "address" },
        { "name": "receiver", "type": "address" },
        { "name": "amount", "type": "uint256" }
      ],
      "name": "erc20Transfer",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    }
  ],
  data: bundle2[0].data
});
assert.strictEqual(decodedTransfer.args[0], usdcAddress);
assert.strictEqual(decodedTransfer.args[1], MORPHO_BUNDLER_V3);
assert.strictEqual(decodedTransfer.args[2], debtAmount);

// Let's decode Call 3 (Supply PT collateral)
const decodedSupply = viemDecode({
  abi: [
    {
      "inputs": [
        {
          "components": [
            { "name": "loanToken", "type": "address" },
            { "name": "collateralToken", "type": "address" },
            { "name": "oracle", "type": "address" },
            { "name": "irm", "type": "address" },
            { "name": "lltv", "type": "uint256" }
          ],
          "name": "marketParams",
          "type": "tuple"
        },
        { "name": "assets", "type": "uint256" },
        { "name": "onBehalf", "type": "address" },
        { "name": "data", "type": "bytes" }
      ],
      "name": "morphoSupplyCollateral",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    }
  ],
  data: bundle2[3].data
});
assert.strictEqual(decodedSupply.args[1], 2n ** 256n - 1n);

console.log('Test 2 passed!');
console.log('All transaction builder tests passed successfully!');
