import assert from 'node:assert';
import { MorphoMarketService } from '../src/core/services/morpho-market-service.js';
import { SwapQuoterService } from '../src/core/services/swap-quoter-service.js';
import { SimulationService } from '../src/core/services/simulation-service.js';

console.log('--- Running Core Services Unit Tests (TDD) ---');

// ==========================================
// 1. MorphoMarketService Tests
// ==========================================
console.log('Testing MorphoMarketService...');

const marketService = new MorphoMarketService();

// Test 1.1: fetchMarketParams parsing and validation
{
  const mockMarketId = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.strictEqual(url, 'https://blue-api.morpho.org/graphql');
    const body = JSON.parse(options.body);
    assert.strictEqual(body.variables.id, mockMarketId);
    return {
      ok: true,
      json: async () => ({
        data: {
          markets: {
            items: [
              {
                loanAsset: { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', symbol: 'USDC', decimals: 6 },
                collateralAsset: { address: '0x3365554a61ceff74a76528f9e86c1e87946d16a5', symbol: 'PT-USDe-27MAR2025', decimals: 18 },
                oracleAddress: '0x0000000000000000000000000000000000000001',
                irmAddress: '0x0000000000000000000000000000000000000002',
                lltv: '860000000000000000'
              }
            ]
          }
        }
      })
    };
  };

  const params = await marketService.fetchMarketParams(mockMarketId);
  assert.strictEqual(params.loanSymbol, 'USDC');
  assert.strictEqual(params.collateralSymbol, 'PT-USDe-27MAR2025');
  assert.strictEqual(params.loanDecimals, 6);
  assert.strictEqual(params.collateralDecimals, 18);
  assert.strictEqual(params.lltv, 860000000000000000n);
  assert.strictEqual(params.loanToken, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
  globalThis.fetch = originalFetch;
}

// Test 1.2: fetchPosition calculation with interest accrual
{
  const mockClient = {
    readContract: async ({ functionName }) => {
      if (functionName === 'position') {
        // [supplyShares, borrowShares, collateral]
        return [0n, 1000n, 5000n];
      }
      if (functionName === 'market') {
        // [totalSupplyAssets, totalSupplyShares, totalBorrowAssets, totalBorrowShares, lastUpdate, fee]
        return [0n, 0n, 2200n, 2000n, 0n, 0n];
      }
      throw new Error(`Unexpected function ${functionName}`);
    }
  };

  const pos = await marketService.fetchPosition(
    mockClient,
    '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    '0x00000000000000000000000000000000000000aa'
  );

  // debt = (1000 * 2200) / 2000 = 1100
  assert.strictEqual(pos.collateral, 5000n);
  assert.strictEqual(pos.debt, 1100n);
  assert.strictEqual(pos.borrowShares, 1000n);
}

// Test 1.3: isAuthorized check
{
  const mockClient = {
    readContract: async ({ functionName, args }) => {
      assert.strictEqual(functionName, 'isAuthorized');
      return args[0] === '0x0000000000000000000000000000000000000001';
    }
  };

  const isAuth = await marketService.isAuthorized(
    mockClient,
    '0x0000000000000000000000000000000000000001',
    '0x0000000000000000000000000000000000000002'
  );
  assert.strictEqual(isAuth, true);
}
console.log('✅ MorphoMarketService tests passed!');

// ==========================================
// 2. SwapQuoterService Tests
// ==========================================
console.log('Testing SwapQuoterService...');

const quoterService = new SwapQuoterService();

// Test 2.1: fetchSwapRoute and retry mechanism
{
  let callCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    callCount++;
    if (callCount === 1) {
      return { status: 429, ok: false, json: async () => ({ message: 'rate limited' }) };
    }
    return {
      status: 200,
      ok: true,
      json: async () => ({
        routes: [
          {
            tx: { to: '0x1111111111111111111111111111111111111111', data: '0xabcdef' },
            outputs: [{ token: '0x2222222222222222222222222222222222222222', amount: '1000000' }]
          }
        ]
      })
    };
  };

  const route = await quoterService.fetchSwapRoute({
    inputToken: '0x3333333333333333333333333333333333333333',
    inputAmount: 1000000000000000000n,
    outputToken: '0x2222222222222222222222222222222222222222',
    slippageBps: 50,
    receiver: '0x4444444444444444444444444444444444444444',
    maxRetries: 2,
    baseRetryDelayMs: 10
  });

  assert.strictEqual(callCount, 2);
  assert.strictEqual(route.tx.data, '0xabcdef');
  assert.strictEqual(route.outputs[0].amount, '1000000');
  globalThis.fetch = originalFetch;
}

// Test 2.2: 2-step iterative debt solver
{
  const originalFetch = globalThis.fetch;
  let step = 0;
  globalThis.fetch = async (url, options) => {
    step++;
    const body = JSON.parse(options.body);
    const inAmt = BigInt(body.inputs[0].amount);
    if (step === 1) {
      // Step 1: Nominal query with 1.0 PT (1e18) -> returns 0.95 USDC (950,000)
      return {
        ok: true,
        json: async () => ({
          routes: [{
            tx: { to: '0x1111111111111111111111111111111111111111', data: '0xstep1' },
            outputs: [{ token: '0xusdc', amount: '950000' }]
          }]
        })
      };
    } else {
      // Step 2: Solved query -> should request around (1900000 / 950000) * 1e18 = 2e18 PT
      assert.strictEqual(inAmt, 2000000000000000000n);
      return {
        ok: true,
        json: async () => ({
          routes: [{
            tx: { to: '0x1111111111111111111111111111111111111111', data: '0xstep2' },
            outputs: [{ token: '0xusdc', amount: '1900000' }]
          }]
        })
      };
    }
  };

  const { requiredInput, route } = await quoterService.estimateRequiredInputAmount({
    inputToken: '0xpt',
    targetOutputAmount: 1900000n, // 1.9 USDC
    outputToken: '0xusdc',
    slippageBps: 50,
    receiver: '0xrec',
    inputDecimals: 18,
    outputDecimals: 6
  });

  assert.strictEqual(requiredInput, 2000000000000000000n);
  assert.strictEqual(route.tx.data, '0xstep2');
  globalThis.fetch = originalFetch;
}
console.log('✅ SwapQuoterService tests passed!');

// ==========================================
// 3. SimulationService Tests
// ==========================================
console.log('Testing SimulationService...');

const simService = new SimulationService();

// Test 3.1: Successful simulation parsing and leak check (clean)
{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    return {
      ok: true,
      json: async () => ({
        result: [
          {
            calls: [
              // Main call
              {
                status: '0x1',
                gasUsed: '0x12a05f', // 1220703
                logs: [{ address: '0xcontract', topics: ['0x111'] }],
                calls: []
              },
              // Adapter leak check for Token A
              { status: '0x1', returnData: '0x0000000000000000000000000000000000000000000000000000000000000000' },
              // Bundler leak check for Token A
              { status: '0x1', returnData: '0x0000000000000000000000000000000000000000000000000000000000000000' },
              // User balance query for Token A
              { status: '0x1', returnData: '0x0000000000000000000000000000000000000000000000000000000000000064' }
            ]
          }
        ]
      })
    };
  };

  const result = await simService.simulateTransaction({
    rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/test-key',
    fromAddress: '0x0000000000000000000000000000000000000001',
    toAddress: '0x0000000000000000000000000000000000000002',
    calldata: '0x123456',
    value: 0n,
    tokensToCheck: ['0x0000000000000000000000000000000000000003']
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.gasUsed, 1220703n);
  assert.strictEqual(result.leaks.length, 0);
  assert.strictEqual(result.logs.length, 1);
  globalThis.fetch = originalFetch;
}

// Test 3.2: Transient Contract Leak Detection
{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    return {
      ok: true,
      json: async () => ({
        result: [
          {
            calls: [
              // Main call
              {
                status: '0x1',
                gasUsed: '0x50000',
                calls: []
              },
              // Adapter leak check: holds 500 residual wei!
              { status: '0x1', returnData: '0x00000000000000000000000000000000000000000000000000000000000001f4' },
              // Bundler leak check: 0
              { status: '0x1', returnData: '0x0000000000000000000000000000000000000000000000000000000000000000' },
              // User balance
              { status: '0x1', returnData: '0x0000000000000000000000000000000000000000000000000000000000000000' }
            ]
          }
        ]
      })
    };
  };

  const result = await simService.simulateTransaction({
    rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/test-key',
    fromAddress: '0x0000000000000000000000000000000000000001',
    toAddress: '0x0000000000000000000000000000000000000002',
    calldata: '0x123456',
    value: 0n,
    tokensToCheck: ['0x0000000000000000000000000000000000000003']
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.leaks.length, 1);
  assert.strictEqual(result.leaks[0].contract, 'Adapter');
  assert.strictEqual(result.leaks[0].balance, 500n);
  globalThis.fetch = originalFetch;
}

// Test 3.3: Reversion detection
{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    return {
      ok: true,
      json: async () => ({
        result: [
          {
            calls: [
              {
                status: '0x0',
                gasUsed: '0x50000',
                error: { message: 'execution reverted: LLTV exceeded' }
              }
            ]
          }
        ]
      })
    };
  };

  const result = await simService.simulateTransaction({
    rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/test-key',
    fromAddress: '0x0000000000000000000000000000000000000001',
    toAddress: '0x0000000000000000000000000000000000000002',
    calldata: '0x123456'
  });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.error.message, 'execution reverted: LLTV exceeded');
  globalThis.fetch = originalFetch;
}

console.log('✅ SimulationService tests passed!');
console.log('🎉 All Core Services unit tests passed successfully!');
