import assert from 'assert';
import { RolloverRoutingHelper } from '../cli/rollover-routing-helper.js';
import { RolloverWorkflow } from '../src/ui/controllers/rollover-workflow.js';
import { RolloverCommand } from '../cli/rollover-command.js';
import { LtvCalculator } from '../src/core/math/ltv-calculator.js';

console.log('Running ADR-0003 Cross-Loan Routing & Iterative Swap Quoter Tests (TDD)...');

// --------------------------------------------------------------------------
// Test 1: RolloverRoutingHelper strictly uses 2-Step Iterative Swap Solver
// even when collateral oracle prices are available (MATH-01)
// --------------------------------------------------------------------------
async function testCliRoutingEnforcesTwoStepQuoter() {
  console.log('  Testing RolloverRoutingHelper enforces 2-step iterative swap solver with oracles present...');

  const fetchCalls = [];
  const mockRouterClient = {
    fetchSwapRoute: async (inputToken, inputAmount, outputToken, slippage, receiver, sender) => {
      fetchCalls.push({ inputToken, inputAmount, outputToken, slippage, receiver, sender });
      if (fetchCalls.length === 1) {
        // Step 1: Nominal probe (1.0 apxUSD = 10^18 -> returns 0.8394 USDC = 839400 units)
        return {
          outputs: [{ amount: '839400' }],
          tx: { to: '0x0000000000000000000000000000000000000006', data: '0x1111' }
        };
      } else {
        // Step 2: Solved execution route for exact debt amount
        const output = (inputAmount * 839400n) / 10n ** 18n;
        return {
          outputs: [{ amount: output.toString() }],
          tx: { to: '0x0000000000000000000000000000000000000007', data: '0x2222' }
        };
      }
    }
  };

  const assessment = {
    debtAmount: 6000n * 10n ** 6n, // 6,000 USDC
    slippage: 0.5,
    destLoanAddress: '0x98A878b1Cd98131B271883B390f68D2c90674665', // apxUSD (18 dec)
    sourceLoanAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0CE3606eB48', // USDC (6 dec)
    sourceMarketParams: {
      loanDecimals: 6,
      collateralDecimals: 18,
      lltv: 860000000000000000n
    },
    destMarketParams: {
      loanDecimals: 18,
      collateralDecimals: 18,
      lltv: 860000000000000000n
    }
  };

  // Provide collateral oracle prices that imply an inaccurate rate (e.g. 1.17 / 1.38 = 0.8478 instead of 0.8394)
  const oldOraclePrice = 117n * 10n ** 22n; // 1.17
  const newOraclePrice = 138n * 10n ** 34n; // 1.38
  const expectedNewCollateral = 10000n * 10n ** 18n;

  const result = await RolloverRoutingHelper.solveCrossLoanRoute({
    routerClient: mockRouterClient,
    poolService: null, // Force router client quoter
    publicClient: null,
    assessment,
    strictSlippageBps: 50n,
    slippageFrac: 0.005,
    expectedNewCollateral,
    newOraclePrice,
    oldOraclePrice,
    ltvCalculator: new LtvCalculator(),
    options: { capBorrow: true },
    bundlerAddress: '0xBundler',
    adapterAddress: '0xAdapter'
  });

  assert.strictEqual(
    fetchCalls.length,
    2,
    `Expected exactly 2 swap quoter calls (Step 1 nominal probe + Step 2 final route), but got ${fetchCalls.length}`
  );

  // Call 1 must be nominal probe
  assert.strictEqual(
    fetchCalls[0].inputAmount,
    10n ** 18n,
    'First call must be a nominal rate probe of 1.0 unit (10^18)'
  );

  // Call 2 must be solved input based on router quoter (desiredOutput = 6000e6 * 10000 / 9950 = 6030150753; loanExpectedInput ~ 7183.88 apxUSD)
  // NOT based on collateral oracle ratio (which would be ~7112.31 apxUSD)
  assert.ok(
    result.loanExpectedInput > 7150n * 10n ** 18n && result.loanExpectedInput < 7250n * 10n ** 18n,
    `loanExpectedInput should be sized via router rate (~7184 apxUSD), but was: ${result.loanExpectedInput}`
  );
  console.log('    ✅ RolloverRoutingHelper 2-step iterative swap solver verified.');
}

// --------------------------------------------------------------------------
// Test 2: RolloverWorkflow (UI) strictly uses 2-Step Iterative Swap Solver
// even when collateral oracle prices are available (MATH-01)
// --------------------------------------------------------------------------
async function testUiWorkflowEnforcesTwoStepQuoter() {
  console.log('  Testing RolloverWorkflow enforces 2-step iterative swap solver with oracles present...');

  const loanQuoterCalls = [];
  const mockSwapQuoterService = {
    fetchSwapRoute: async ({ inputToken, inputAmount, outputToken, slippageBps, receiver, sender }) => {
      if (inputToken === '0x98A878b1Cd98131B271883B390f68D2c90674665') {
        loanQuoterCalls.push({ inputToken, inputAmount, outputToken, slippageBps });
        if (loanQuoterCalls.length === 1) {
          // Nominal probe
          return {
            outputs: [{ amount: '839400' }],
            tx: { to: '0x0000000000000000000000000000000000000006', data: '0x1111' }
          };
        } else {
          // Final route
          const output = (inputAmount * 839400n) / 10n ** 18n;
          return {
            outputs: [{ amount: output.toString() }],
            tx: { to: '0x0000000000000000000000000000000000000007', data: '0x2222' }
          };
        }
      }
      // Collateral swap (same collateral bypass or nominal)
      return {
        outputs: [{ amount: inputAmount.toString() }],
        tx: { to: '0x0000000000000000000000000000000000000008', data: '0x3333' }
      };
    }
  };

  const mockMarketService = {
    fetchOraclePrice: async (publicClient, oracleAddress) => {
      if (oracleAddress === '0x0000000000000000000000000000000000000002') return 117n * 10n ** 22n;
      if (oracleAddress === '0x0000000000000000000000000000000000000004') return 138n * 10n ** 34n;
      return 10n ** 18n;
    },
    checkCollateralMaturity: async () => ({ isExpired: false })
  };

  const workflow = new RolloverWorkflow({
    marketService: mockMarketService,
    swapQuoterService: mockSwapQuoterService,
    simulationService: { simulateTransaction: async () => ({ success: true }) },
    poolService: null
  });

  const payload = await workflow.compileRolloverPayload({
    sourceMarketParams: {
      oracle: '0x0000000000000000000000000000000000000002',
      irm: '0x0000000000000000000000000000000000000003',
      loanToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      collateralToken: '0x3365554a61CeFF74A76528f9e86C1E87946d16a5',
      loanDecimals: 6,
      collateralDecimals: 18,
      lltv: 860000000000000000n
    },
    destMarketParams: {
      oracle: '0x0000000000000000000000000000000000000004',
      irm: '0x0000000000000000000000000000000000000003',
      loanToken: '0x98A878b1Cd98131B271883B390f68D2c90674665',
      collateralToken: '0x3365554a61CeFF74A76528f9e86C1E87946d16a5',
      loanDecimals: 18,
      collateralDecimals: 18,
      lltv: 860000000000000000n
    },
    collateralAmount: 10000n * 10n ** 18n,
    debtAmount: 6000n * 10n ** 6n,
    isFull: true,
    slippage: 0.005,
    sourceCollateralAddress: '0x3365554a61CeFF74A76528f9e86C1E87946d16a5',
    destCollateralAddress: '0x3365554a61CeFF74A76528f9e86C1E87946d16a5',
    sourceLoanAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    destLoanAddress: '0x98A878b1Cd98131B271883B390f68D2c90674665',
    userAddress: '0x0000000000000000000000000000000000000005',
    liveBorrowShares: 6000n * 10n ** 6n,
    capBorrow: true,
    publicClient: {},
    rpcUrl: null
  });

  assert.strictEqual(
    loanQuoterCalls.length,
    2,
    `Expected exactly 2 loan quoter calls in RolloverWorkflow, but got ${loanQuoterCalls.length}`
  );
  console.log('    ✅ RolloverWorkflow 2-step iterative swap solver verified.');
}

// --------------------------------------------------------------------------
// Test 3: CLI Partial Debt String Parsing with Full BigInt Precision (MATH-05)
// --------------------------------------------------------------------------
async function testCliPartialDebtStringParsing() {
  console.log('  Testing CLI RolloverCommand partial debt parsing with high BigInt precision...');

  const mockBlockchainClient = {
    fetchMarketParams: async (id) => ({
      loanToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      collateralToken: '0x3365554a61CeFF74A76528f9e86C1E87946d16a5',
      loanDecimals: 18,
      collateralDecimals: 18,
      loanSymbol: 'WETH',
      collateralSymbol: 'PT',
      oracle: '0x0000000000000000000000000000000000000001',
      lltv: 860000000000000000n
    }),
    fetchMorphoPosition: async () => ({
      collateral: 100n * 10n ** 18n,
      debt: 100n * 10n ** 18n,
      borrowShares: 100n * 10n ** 18n
    }),
    checkCollateralMaturity: async () => ({ isExpired: false })
  };

  const command = new RolloverCommand(mockBlockchainClient, {}, {}, {});

  // High precision fractional debt amount: 1.000000000000000001 WETH (18 decimals)
  const assessment1 = await command.assessPosition({
    user: '0x0000000000000000000000000000000000000005',
    oldMarketId: '0xOld',
    newMarketId: '0xNew',
    type: 'partial',
    debt: '1.000000000000000001'
  });

  assert.strictEqual(
    assessment1.debtAmount,
    1000000000000000001n,
    `Expected debtAmount to be exactly 1000000000000000001n, but got ${assessment1.debtAmount}`
  );

  // Multi-digit fractional amount: 5.123456789012345678 WETH
  const assessment2 = await command.assessPosition({
    user: '0x0000000000000000000000000000000000000005',
    oldMarketId: '0xOld',
    newMarketId: '0xNew',
    type: 'partial',
    debt: '5.123456789012345678'
  });

  assert.strictEqual(
    assessment2.debtAmount,
    5123456789012345678n,
    `Expected debtAmount to be exactly 5123456789012345678n, but got ${assessment2.debtAmount}`
  );

  console.log('    ✅ CLI partial debt high-precision BigInt parsing verified.');
}

async function runAll() {
  await testCliRoutingEnforcesTwoStepQuoter();
  await testUiWorkflowEnforcesTwoStepQuoter();
  await testCliPartialDebtStringParsing();
  console.log('🎉 All Cross-Loan Routing & Iterative Swap Quoter tests passed successfully!');
}

runAll().catch(err => {
  console.error('❌ Test failed with error:\n', err);
  process.exit(1);
});
