import assert from 'assert';
import { encodeFunctionData, getAddress } from 'viem';
import { ApprovalBuilder } from '../src/core/builders/approval-builder.js';
import { LeverageBundleBuilder } from '../src/core/builders/leverage-bundle-builder.js';
import { RolloverBundleBuilder } from '../src/core/builders/rollover-bundle-builder.js';
import { ERC20_ABI, BUNDLER_ABI, ADAPTER_ABI } from '../builders.js';
import config from '../config.js';

console.log('Running modular builder services TDD tests...');

// 1. ApprovalBuilder Tests
const approvalBuilder = new ApprovalBuilder();

const mockRouteData = {
  tx: {
    to: '0x888888888889758F76e7103c6CbF23ABbF58F946',
    data: '0x1234'
  },
  router: '0x1111111254EEB25477B68fb85Ed929f73A960582',
  invalidAddr: '0xnotanaddress',
  zeroAddr: '0x0000000000000000000000000000000000000000'
};

const spenders = approvalBuilder.getSpendersToApprove(mockRouteData);
assert.ok(Array.isArray(spenders), 'Spenders should be an array');
assert.ok(spenders.includes(getAddress('0x888888888889758F76e7103c6CbF23ABbF58F946')), 'Should include Pendle Router');
assert.ok(spenders.includes(getAddress(config.PENDLE_LIMIT_ROUTER)), 'Should auto-include Pendle Limit Router');
assert.ok(spenders.includes(getAddress('0x1111111254EEB25477B68fb85Ed929f73A960582')), 'Should include 1inch Router');
assert.ok(!spenders.includes('0x0000000000000000000000000000000000000000'), 'Should exclude zero address');

const bundle = [];
approvalBuilder.appendApprovals(bundle, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', '0x1111111254EEB25477B68fb85Ed929f73A960582', encodeFunctionData);
assert.strictEqual(bundle.length, 3, 'Should append 3 approval calls (Spender + Permit2 + Permit2 internal)');
assert.strictEqual(bundle[0].to, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
assert.strictEqual(bundle[1].to, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
assert.strictEqual(bundle[2].to, config.PERMIT2_ADDRESS);

// If spender is Permit2, only 1 approval should be created
const permit2Bundle = [];
approvalBuilder.appendApprovals(permit2Bundle, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', config.PERMIT2_ADDRESS, encodeFunctionData);
assert.strictEqual(permit2Bundle.length, 1, 'Should only create 1 approval if spender is Permit2 itself');

console.log('✅ ApprovalBuilder unit tests passed');

// 2. LeverageBundleBuilder Tests
const leverageBuilder = new LeverageBundleBuilder(approvalBuilder);

const mockMarketParams = {
  loanToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  collateralToken: '0x3365554a61CeFF74A76528f9e86C1E87946d16a5',
  oracle: '0x0000000000000000000000000000000000000001',
  irm: '0x0000000000000000000000000000000000000002',
  lltv: 860000000000000000n
};

const delevBundle = leverageBuilder.buildDeleveragingBundle({
  encodeFunctionData,
  marketParams: mockMarketParams,
  collateralAmount: 100000000000000000000n,
  debtAmount: 80000000n,
  is1x: false,
  collateralAddress: mockMarketParams.collateralToken,
  loanAddress: mockMarketParams.loanToken,
  routeData: {
    tx: { to: '0x1111111254EEB25477B68fb85Ed929f73A960582', data: '0xdeadbeef' },
    outputs: [{ amount: '80000000' }]
  },
  userAddress: '0xF0A6e66B4396a70eE0620064da847821BeE70731',
  ETHER_GENERAL_ADAPTER_1: config.ETHER_GENERAL_ADAPTER_1,
  MORPHO_BUNDLER_V3: config.MORPHO_BUNDLER_V3,
  flashLoanAmount: 80000000n
});

assert.ok(Array.isArray(delevBundle), 'Deleveraging bundle should be an array');
assert.strictEqual(delevBundle[0].to, config.ETHER_GENERAL_ADAPTER_1, 'Call 0 should be morphoRepay via adapter');
assert.strictEqual(delevBundle[1].to, config.ETHER_GENERAL_ADAPTER_1, 'Call 1 should be morphoWithdrawCollateral via adapter');
assert.ok(delevBundle.some(c => c.to === '0x1111111254EEB25477B68fb85Ed929f73A960582'), 'Should contain router swap call');

const levUpBundle = leverageBuilder.buildLeveragingUpBundle({
  encodeFunctionData,
  marketParams: mockMarketParams,
  collateralAmount: 100000000000000000000n,
  debtAmount: 80000000n,
  collateralAddress: mockMarketParams.collateralToken,
  loanAddress: mockMarketParams.loanToken,
  routeData: {
    tx: { to: '0x1111111254EEB25477B68fb85Ed929f73A960582', data: '0xdeadbeef' },
    outputs: [{ amount: '100000000000000000000' }]
  },
  userAddress: '0xF0A6e66B4396a70eE0620064da847821BeE70731',
  ETHER_GENERAL_ADAPTER_1: config.ETHER_GENERAL_ADAPTER_1,
  MORPHO_BUNDLER_V3: config.MORPHO_BUNDLER_V3
});

assert.ok(Array.isArray(levUpBundle), 'Leveraging up bundle should be an array');
assert.strictEqual(levUpBundle[0].to, config.ETHER_GENERAL_ADAPTER_1, 'Call 0 should be erc20Transfer to bundler');
assert.ok(levUpBundle.some(c => c.to === '0x1111111254EEB25477B68fb85Ed929f73A960582'), 'Should contain router swap call');

console.log('✅ LeverageBundleBuilder unit tests passed');

// 3. RolloverBundleBuilder Tests
const rolloverBuilder = new RolloverBundleBuilder(approvalBuilder);
assert.ok(typeof rolloverBuilder.buildRolloverBundle === 'function', 'buildRolloverBundle should be a function');

const mockDestMarketParams = {
  loanToken: '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
  collateralToken: '0x3365554a61CeFF74A76528f9e86C1E87946d16a5',
  oracle: '0x0000000000000000000000000000000000000001',
  irm: '0x0000000000000000000000000000000000000002',
  lltv: 860000000000000000n,
  loanDecimals: 18
};
const mockSourceMarketParams = {
  ...mockMarketParams,
  loanDecimals: 6
};

const mockLoanRouteDataCurve = {
  isCurveDirect: true,
  poolAddress: '0x0000000000000000000000000000000000000099',
  indexType: 'int128',
  i: 0,
  j: 1
};

const expectedOutputAmount = 10000000000n;

// Test 3.1: Default slippage must translate to 9950 multiplier (50 bps = 0.5%) instead of 9999
let capturedExchangeArgsDefault = null;
const customEncodeDefault = ({ abi, functionName, args }) => {
  if (functionName === 'exchange') {
    capturedExchangeArgsDefault = args;
  }
  return encodeFunctionData({ abi, functionName, args });
};

rolloverBuilder.buildRolloverBundle({
  encodeFunctionData: customEncodeDefault,
  sourceMarketParams: mockSourceMarketParams,
  destMarketParams: mockDestMarketParams,
  collateralAmount: 100000000000000000000n,
  debtAmount: 80000000n,
  isFull: false,
  sourceCollateralAddress: mockSourceMarketParams.collateralToken,
  destCollateralAddress: mockDestMarketParams.collateralToken,
  userAddress: '0xF0A6e66B4396a70eE0620064da847821BeE70731',
  ETHER_GENERAL_ADAPTER_1: config.ETHER_GENERAL_ADAPTER_1,
  MORPHO_BUNDLER_V3: config.MORPHO_BUNDLER_V3,
  isSameCollateral: true,
  isSameLoan: false,
  loanRouteData: mockLoanRouteDataCurve,
  loanExpectedInput: 12000000000000000000n,
  loanExpectedOutput: expectedOutputAmount
});

assert.ok(capturedExchangeArgsDefault !== null, 'Curve exchange should be called');
assert.strictEqual(
  capturedExchangeArgsDefault[3],
  9950000000n,
  'Default slippage must yield 9950 multiplier (50 bps), not 9999'
);

// Test 3.2: Explicit slippageBps = 100n (1.0% slippage -> 9900 multiplier)
let capturedExchangeArgs100bps = null;
const customEncode100bps = ({ abi, functionName, args }) => {
  if (functionName === 'exchange') {
    capturedExchangeArgs100bps = args;
  }
  return encodeFunctionData({ abi, functionName, args });
};

rolloverBuilder.buildRolloverBundle({
  encodeFunctionData: customEncode100bps,
  sourceMarketParams: mockSourceMarketParams,
  destMarketParams: mockDestMarketParams,
  collateralAmount: 100000000000000000000n,
  debtAmount: 80000000n,
  isFull: false,
  sourceCollateralAddress: mockSourceMarketParams.collateralToken,
  destCollateralAddress: mockDestMarketParams.collateralToken,
  userAddress: '0xF0A6e66B4396a70eE0620064da847821BeE70731',
  ETHER_GENERAL_ADAPTER_1: config.ETHER_GENERAL_ADAPTER_1,
  MORPHO_BUNDLER_V3: config.MORPHO_BUNDLER_V3,
  isSameCollateral: true,
  isSameLoan: false,
  loanRouteData: mockLoanRouteDataCurve,
  loanExpectedInput: 12000000000000000000n,
  loanExpectedOutput: expectedOutputAmount,
  slippageBps: 100n
});

assert.ok(capturedExchangeArgs100bps !== null, 'Curve exchange should be called for 100bps test');
assert.strictEqual(
  capturedExchangeArgs100bps[3],
  9900000000n,
  'Explicit slippageBps=100n must yield 9900 multiplier (100 bps)'
);

console.log('✅ RolloverBundleBuilder unit tests passed');

console.log('🎉 All modular builder services tests passed successfully!');

