import assert from 'assert';
import { encodeFunctionData, getAddress, decodeFunctionData as viemDecode } from 'viem';
import { RolloverCommand } from '../cli/rollover-command.js';
import { ADAPTER_ABI } from '../builders.js';

console.log('Running Rollover Command Dynamic Curve Integration Tests...');

// Mock addresses
const ADDRESS_PROVIDER = '0x0000000022D53366457F9d5E68Ec105046FC4383';
const MOCK_REGISTRY = '0xF98B45FA17DE75FB1aD0e7aFD971b0ca00e379fC';
const MOCK_POOL = '0xE1B96555BbecA40E583BbB41a11C68Ca4706A414';
const APX_USD = '0x98A878b1Cd98131B271883B390f68D2c90674665';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

const mockOldMarketParams = {
  loanToken: USDC,
  collateralToken: '0x3365554a61CeFF74A76528f9e86C1E87946d16a5', // PT-old
  loanSymbol: 'USDC',
  collateralSymbol: 'PT-old',
  loanDecimals: 6,
  collateralDecimals: 18,
  oracle: '0x0000000000000000000000000000000000000002',
  irm: '0x0000000000000000000000000000000000000003',
  lltv: 860000000000000000n
};

const mockNewMarketParams = {
  loanToken: APX_USD,
  collateralToken: '0x3365554a61CeFF74A76528f9e86C1E87946d16a5', // Same collateral PT
  loanSymbol: 'apxUSD',
  collateralSymbol: 'PT-old',
  loanDecimals: 18,
  collateralDecimals: 18,
  oracle: '0x0000000000000000000000000000000000000004',
  irm: '0x0000000000000000000000000000000000000005',
  lltv: 860000000000000000n
};

class MockBlockchainClient {
  constructor(curveRateNumerator = 81n, mockDebt = 800n * 10n ** 6n) {
    this.mockDebt = mockDebt;
    this.publicClient = {
      readContract: async ({ address, functionName, args }) => {
        const addr = getAddress(address);
        if (addr === getAddress(ADDRESS_PROVIDER) && functionName === 'get_address') {
          return MOCK_REGISTRY;
        }
        if (addr === getAddress(MOCK_REGISTRY) && functionName === 'find_pool_for_coins') {
          return MOCK_POOL;
        }
        if (addr === getAddress(MOCK_POOL) && functionName === 'coins') {
          const index = args[0];
          if (index === 0n) return APX_USD;
          if (index === 1n) return USDC;
          throw new Error('Index out of bounds');
        }
        if (addr === getAddress(MOCK_POOL) && functionName === 'get_dy') {
          // input token APX_USD (18 decimals), output USDC (6 decimals)
          const dx = args[2];
          return (dx * curveRateNumerator) / 100n / 10n ** 12n; 
        }
         if (functionName === 'price') {
          if (addr === getAddress(mockOldMarketParams.oracle)) {
            return 117n * 10n ** 22n; // 1.17 USDC/collateral
          }
          if (addr === getAddress(mockNewMarketParams.oracle)) {
            return 138n * 10n ** 34n; // 1.38 apxUSD/collateral
          }
          return 950000n * 10n ** 18n;
        }
        throw new Error(`Unexpected readContract call to ${address}.${functionName}`);
      }
    };
  }

  async fetchMarketParams(marketId) {
    if (marketId === 'old') return mockOldMarketParams;
    if (marketId === 'new') return mockNewMarketParams;
    throw new Error('Unknown marketId');
  }

  async fetchMorphoPosition() {
    return {
      collateral: 1000n * 10n ** 18n,
      debt: this.mockDebt,
      borrowShares: this.mockDebt
    };
  }

  async checkCollateralMaturity() {
    return { expiryDate: '11/05/2026', isExpired: false };
  }
}

class MockSwapRouterClient {
  async fetchSwapRoute() {
    throw new Error('Swap Router should not be called when Curve pool is available!');
  }
}

class MockSimulationEngine {
  async simulateTransaction() {
    return { success: true };
  }
}

class MockTransactionAuditor {}

async function testCurveSuccess() {
  console.log('  Running testCurveSuccess...');
  const blockchain = new MockBlockchainClient();
  const router = new MockSwapRouterClient();
  const simulation = new MockSimulationEngine();
  const auditor = new MockTransactionAuditor();

  const command = new RolloverCommand(blockchain, router, simulation, auditor);

  const result = await command.execute({
    user: '0xE14f5DAab7E7fF2527F3B3cE582033e4A1Df8D0a',
    oldMarketId: 'old',
    newMarketId: 'new',
    type: 'partial',
    debt: 100,
    slippage: 1.0,
    simulation: true
  });

  assert.ok(result.swap.loanRouteData, 'loanRouteData should be populated');
  assert.strictEqual(result.swap.loanRouteData.isCurveDirect, true, 'Should use Curve pool directly');
  assert.strictEqual(result.swap.loanRouteData.poolAddress, MOCK_POOL, 'Should use correct mock pool address');

  const stepsString = result.steps.join('\n').toLowerCase();
  assert.ok(stepsString.includes('curve'), 'Steps should mention Curve swap');
}

async function testLtvValidationFail() {
  console.log('  Running testLtvValidationFail...');
  // 81n (normal Curve rate), but position debt is 1000 USDC against 1000 collateral (high LTV)
  const blockchain = new MockBlockchainClient(81n, 1000n * 10n ** 6n);
  const router = new MockSwapRouterClient();
  const simulation = new MockSimulationEngine();
  const auditor = new MockTransactionAuditor();

  const command = new RolloverCommand(blockchain, router, simulation, auditor);

  await assert.rejects(async () => {
    await command.execute({
      user: '0xE14f5DAab7E7fF2527F3B3cE582033e4A1Df8D0a',
      oldMarketId: 'old',
      newMarketId: 'new',
      type: 'partial',
      debt: 100,
      slippage: 1.0,
      simulation: true
    });
  }, /Projected Target LTV.*exceeds Target Market LLTV/, 'Should reject with Projected Target LTV exceeds Target Market LLTV error');
}

async function testLtvCappedSuccess() {
  console.log('  Running testLtvCappedSuccess...');
  const blockchain = new MockBlockchainClient(81n, 1000n * 10n ** 6n);
  const router = new MockSwapRouterClient();
  const simulation = new MockSimulationEngine();
  const auditor = new MockTransactionAuditor();

  const command = new RolloverCommand(blockchain, router, simulation, auditor);

  const result = await command.execute({
    user: '0xE14f5DAab7E7fF2527F3B3cE582033e4A1Df8D0a',
    oldMarketId: 'old',
    newMarketId: 'new',
    type: 'partial',
    debt: 100,
    slippage: 1.0,
    capBorrow: true,
    simulation: true
  });

  // Verify LTV is capped at LLTV - 0.5% (which is 85.50%)
  assert.strictEqual(result.newLtv, 85.5);
  console.log(`    Capped Target LTV verified: ${result.newLtv}%`);
}

async function runAll() {
  await testCurveSuccess();
  await testLtvValidationFail();
  await testLtvCappedSuccess();
  console.log('✅ Rollover Command Dynamic Curve Integration Tests Passed!');
}

runAll().catch(err => {
  console.error('❌ Test Failed:', err);
  process.exit(1);
});
