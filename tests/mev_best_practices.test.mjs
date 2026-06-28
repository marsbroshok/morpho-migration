import assert from 'assert';
import { getAddress, encodeFunctionData } from 'viem';
import { buildRolloverBundle, ERC20_ABI, BUNDLER_ABI } from '../builders.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables manually
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let val = match[2] || '';
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      else if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      process.env[key] = val.trim();
    }
  }
}


console.log('Running MEV Best Practices & Reversion Fix unit tests...');

const USDC = getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
const apxUSD = getAddress('0x98A878b1CD98131b271883B390f68D2c90674665');
const apyUSD = getAddress('0x38eeb52F0771140D10c4E9a9a72349a329fe8A6a');

const ETHER_GENERAL_ADAPTER_1 = getAddress('0x4A6c312ec70E8747a587EE860a0353cd42Be0aE0');
const MORPHO_BUNDLER_V3 = getAddress('0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245');

const mockSourceMarketParams = {
  loanToken: USDC,
  collateralToken: apyUSD,
  oracle: getAddress('0x0000000000000000000000000000000000000002'),
  irm: getAddress('0x0000000000000000000000000000000000000003'),
  lltv: 860000000000000000n,
  loanDecimals: 6,
  collateralDecimals: 18
};

const mockDestMarketParams = {
  loanToken: apxUSD,
  collateralToken: apyUSD,
  oracle: getAddress('0x0000000000000000000000000000000000000004'),
  irm: getAddress('0x0000000000000000000000000000000000000005'),
  lltv: 860000000000000000n,
  loanDecimals: 18,
  collateralDecimals: 18
};

const mockLoanRouteData = {
  tx: {
    to: getAddress('0x888888888889758F76e7103c6CbF23ABbF58F946'), // Pendle Router
    data: '0x010203'
  }
};

async function runTest() {
  const userAddress = getAddress(process.env.USER_ADDRESS || '0xdC382CDF2a25790F535a518EC26958c227e9DCF2');
  const debtAmount = 50n * 10n ** 6n; // 50 USDC
  const loanExpectedInput = 69n * 10n ** 18n; // 69 apxUSD
  
  // 1. Scenario: minOutAmount (at 0.5% slippage) is less than flashLoanAmount (50 USDC)
  // Expected swap output = 49.5 USDC (deliberate shortfall)
  const loanExpectedOutputLow = 49500000n; 
  
  const resultLow = buildRolloverBundle({
    encodeFunctionData,
    encodeAbiParameters: (types, values) => {
      // Mock parameter encoding to return a mock hex string
      return '0xabc';
    },
    keccak256: (data) => '0x0000000000000000000000000000000000000000000000000000000000000000',
    sourceMarketParams: mockSourceMarketParams,
    destMarketParams: mockDestMarketParams,
    collateralAmount: 100n * 10n ** 18n,
    debtAmount,
    isFull: false,
    sourceCollateralAddress: apyUSD,
    destCollateralAddress: apyUSD,
    routeData: null,
    userAddress,
    ETHER_GENERAL_ADAPTER_1,
    MORPHO_BUNDLER_V3,
    isSameCollateral: true,
    isSameLoan: false,
    loanRouteData: mockLoanRouteData,
    loanExpectedInput,
    loanExpectedOutput: loanExpectedOutputLow,
    slippage: 0.5, // 0.5% slippage
    borrowShares: 0n
  });

  const reenterBundleLow = resultLow.reenterBundle;
  
  // Assertions for Low Output (Shortfall path compiled):
  // 1. Swap input token (apxUSD) approved to Pendle Router
  const hasApxUSDApproval = reenterBundleLow.some(step => 
    step.to.toLowerCase() === apxUSD.toLowerCase() &&
    step.data.includes(mockLoanRouteData.tx.to.toLowerCase().slice(2))
  );
  assert.ok(hasApxUSDApproval, "Should approve swap input token (apxUSD) to spender");

  // 2. Gas Optimization: Unrelated tokens (collateral, SY, PT) should NOT be approved
  const approvedTokens = reenterBundleLow.filter(step => {
    if (!step.data.startsWith('0x095ea7b3')) return false; // approve selector
    return step.to.toLowerCase() !== apxUSD.toLowerCase();
  });
  assert.strictEqual(approvedTokens.length, 0, "Should NOT approve unrelated tokens (collateral, SY, PT) to prevent gas bomb");

  // 3. Shortfall pull (permit2TransferFrom) should be generated
  const hasPermit2Pull = reenterBundleLow.some(step => 
    step.to.toLowerCase() === ETHER_GENERAL_ADAPTER_1.toLowerCase() &&
    step.data.includes('827fcfcc') // permit2TransferFrom selector: 0x827fcfcc
  );
  assert.ok(hasPermit2Pull, "Should generate permit2TransferFrom pull for shortfall");

  // 4. Clean surplus transfers: Should NOT contain redundant surplus transfer call
  const hasSurplusTransfer = reenterBundleLow.some(step => 
    step.to.toLowerCase() === USDC.toLowerCase() &&
    step.data.startsWith('0xa9059cbb') && // transfer selector
    step.data.includes(userAddress.toLowerCase().slice(2))
  );
  assert.strictEqual(hasSurplusTransfer, false, "Should NOT contain redundant surplus transfer to user wallet");

  console.log("✅ MEV Best Practices & Reversion Fix TDD tests passed!");
}

runTest().catch(err => {
  console.error("❌ Test Failed:", err);
  process.exit(1);
});
