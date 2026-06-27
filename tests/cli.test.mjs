import assert from 'assert';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getAddress } from 'viem';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('Running CLI unit and integration tests (TDD)...');

// Load environment variables if .env exists
let apiKey = process.env.ALCHEMY_API_KEY;
if (!apiKey) {
  try {
    const envPath = path.resolve(__dirname, '../.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const match = envContent.match(/ALCHEMY_API_KEY\s*=\s*(.*)/);
      if (match) {
        apiKey = match[1].trim();
      }
    }
  } catch (err) {
    // Ignore env read failure
  }
}

// MOCKS FOR OFFLINE UNIT TESTS
const mockMarketParams = {
  loanToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  collateralToken: '0x3365554a61CeFF74A76528f9e86C1E87946d16a5',
  loanSymbol: 'USDC',
  collateralSymbol: 'PT-apyUSD-18JUN2026',
  loanDecimals: 6,
  collateralDecimals: 18,
  oracle: '0x0000000000000000000000000000000000000002',
  irm: '0x0000000000000000000000000000000000000003',
  lltv: 860000000000000000n
};

const mockPosition = {
  collateral: 8000000000000000000n, // 8 PT
  debt: 6000000000n, // 6000 USDC
  borrowShares: 6000000000n
};

class MockBlockchainClient {
  constructor() {
    this.publicClient = {
      readContract: async ({ functionName }) => {
        if (functionName === 'price') return 950000n * 10n ** 18n; // $0.95 scaled by 1e24
        return 0n;
      }
    };
  }
  async fetchMarketParams() {
    return mockMarketParams;
  }
  async fetchMorphoPosition() {
    return mockPosition;
  }
  async checkCollateralMaturity() {
    return { expiryDate: '11/05/2026', isExpired: false };
  }
  async isAuthorized() {
    return true;
  }
}

class MockSwapRouterClient {
  async fetchSwapRoute() {
    return {
      outputs: [{ amount: '7800000000000000000' }], // 7.8 PT
      tx: { to: '0x0000000000000000000000000000000000000004', data: '0x00' }
    };
  }
}

class MockSimulationEngine {
  async simulateTransaction(from, to, data, value, prependCalls) {
    console.log('[Mock Simulation] Executed successfully.');
    return {
      success: true,
      gasUsed: 120000n,
      logs: [],
      traceTree: { to: to || '0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245', status: '0x1', gasUsed: '0x1d4c0' }
    };
  }
}

class MockTransactionAuditor {
  async auditRealizedPrice() {
    console.log('[Mock Auditor] Audited successfully.');
  }
}

// 1. Test imports
async function testImports() {
  console.log('Testing CLI module imports...');
  const { CliRunner } = await import('../cli/cli-runner.js');
  const { BlockchainClient } = await import('../cli/blockchain-client.js');
  const { WalletConnector } = await import('../cli/wallet-connector.js');
  const { SimulationEngine } = await import('../cli/simulation-engine.js');
  const { SwapRouterClient } = await import('../cli/swap-router-client.js');
  const { RolloverCommand } = await import('../cli/rollover-command.js');
  const { LeverageCommand } = await import('../cli/leverage-command.js');
  const { TransactionAuditor } = await import('../cli/transaction-auditor.js');
  const { SimulateRawCommand } = await import('../cli/simulate-raw-command.js');

  assert.ok(CliRunner, 'CliRunner should be exported');
  assert.ok(BlockchainClient, 'BlockchainClient should be exported');
  assert.ok(WalletConnector, 'WalletConnector should be exported');
  assert.ok(SimulationEngine, 'SimulationEngine should be exported');
  assert.ok(SwapRouterClient, 'SwapRouterClient should be exported');
  assert.ok(RolloverCommand, 'RolloverCommand should be exported');
  assert.ok(LeverageCommand, 'LeverageCommand should be exported');
  assert.ok(TransactionAuditor, 'TransactionAuditor should be exported');
  assert.ok(SimulateRawCommand, 'SimulateRawCommand should be exported');
  console.log('✅ Imports verified successfully!');
}

// 2. Test arguments parsing
async function testCliRunnerArgParsingOptions() {
  console.log('Testing CliRunner argument parsing options...');
  const { CliRunner } = await import('../cli/cli-runner.js');
  const runner = new CliRunner();

  // Test: Missing command
  assert.throws(() => {
    runner.parseArgs([]);
  }, /No command specified.*--help/, 'Should throw on empty command and recommend --help');

  // Test: Unknown command
  assert.throws(() => {
    runner.parseArgs(['unknown-command']);
  }, /Unknown command.*--help/, 'Should throw on unknown command and recommend --help');

  // Test: --help parsing
  const helpGeneralOptions = runner.parseArgs(['--help']);
  assert.strictEqual(helpGeneralOptions.help, true);
  assert.strictEqual(helpGeneralOptions.helpCommand, null);

  const helpGeneralOptionsShort = runner.parseArgs(['-h']);
  assert.strictEqual(helpGeneralOptionsShort.help, true);
  assert.strictEqual(helpGeneralOptionsShort.helpCommand, null);

  // Test: command specific --help parsing
  const helpRolloverOptions = runner.parseArgs(['rollover', '--help']);
  assert.strictEqual(helpRolloverOptions.help, true);
  assert.strictEqual(helpRolloverOptions.helpCommand, 'rollover');

  const helpLeverageOptions = runner.parseArgs(['-h', 'adjust-leverage']);
  assert.strictEqual(helpLeverageOptions.help, true);
  assert.strictEqual(helpLeverageOptions.helpCommand, 'adjust-leverage');

  // Test: Linked flags validation (--private-key requires --rpc)
  assert.throws(() => {
    runner.parseArgs(['rollover', '--private-key', '0x123']);
  }, /--private-key requires --rpc/, 'Should throw when --private-key is provided without --rpc');

  // Test: --rpc can be provided without --private-key for read-only simulation mode
  const rpcOnlyOptions = runner.parseArgs(['rollover', '--rpc', 'http://127.0.0.1:8545']);
  assert.strictEqual(rpcOnlyOptions.rpc, 'http://127.0.0.1:8545');
  assert.strictEqual(rpcOnlyOptions.simulation, true, 'Default simulation should remain true');

  // Test: Successful parse for rollover with WalletConnect
  const wcOptions = runner.parseArgs(['rollover', '--old-market-id', '0x123', '--new-market-id', '0x456', '--walletconnect']);
  assert.strictEqual(wcOptions.command, 'rollover');
  assert.strictEqual(wcOptions.oldMarketId, '0x123');
  assert.strictEqual(wcOptions.newMarketId, '0x456');
  assert.strictEqual(wcOptions.walletconnect, true);
  assert.strictEqual(wcOptions.simulation, false, 'Default simulation should be false when execute options are set');

  // Test: Successful parse with simulation flag override
  const simOptions = runner.parseArgs(['rollover', '--old-market-id', '0x123', '--new-market-id', '0x456', '--simulation']);
  assert.strictEqual(simOptions.command, 'rollover');
  assert.strictEqual(simOptions.simulation, true, '--simulation flag should force simulation to true');

  // Test: Partial rollover simulation options parsing
  const partialOptions = runner.parseArgs(['rollover', '--old-market-id', '0x123', '--new-market-id', '0x456', '--type', 'partial', '--debt', '1500', '--simulation']);
  assert.strictEqual(partialOptions.type, 'partial');
  assert.strictEqual(partialOptions.debt, 1500);
  assert.strictEqual(partialOptions.simulation, true);

  // Test: Leverage adjustment simulation options parsing
  const leverageOptions = runner.parseArgs(['adjust-leverage', '--market-id', '0x123', '--target-leverage', '3.5', '--simulation']);
  assert.strictEqual(leverageOptions.command, 'adjust-leverage');
  assert.strictEqual(leverageOptions.marketId, '0x123');
  assert.strictEqual(leverageOptions.targetLeverage, 3.5);
  assert.strictEqual(leverageOptions.simulation, true);

  // Test: simulate-raw parsing
  const rawOptions = runner.parseArgs(['simulate-raw', '--file', 'tests/sample_raw_tx.json']);
  assert.strictEqual(rawOptions.command, 'simulate-raw');
  assert.strictEqual(rawOptions.file, 'tests/sample_raw_tx.json');
  assert.strictEqual(rawOptions.simulation, true, 'simulate-raw command should force simulation to true');

  const rawOptionsShort = runner.parseArgs(['simulate-raw', '-f', 'tests/sample_raw_tx.json']);
  assert.strictEqual(rawOptionsShort.command, 'simulate-raw');
  assert.strictEqual(rawOptionsShort.file, 'tests/sample_raw_tx.json');

  // Test: simulate-raw missing file option throws error
  assert.throws(() => {
    runner.parseArgs(['simulate-raw']);
  }, /--file <path> is required for simulate-raw command/);

  // Test: --save-simulation flag parsing
  const saveSimOptions = runner.parseArgs(['rollover', '--old-market-id', '0x123', '--new-market-id', '0x456', '--save-simulation', 'temp_out.json']);
  assert.strictEqual(saveSimOptions.saveSimulation, 'temp_out.json');
  assert.strictEqual(saveSimOptions.simulation, true, 'saveSimulation should auto-enable simulation');

  // Test: --save-simulation with --no-simulation throws error
  assert.throws(() => {
    runner.parseArgs(['rollover', '--old-market-id', '0x123', '--new-market-id', '0x456', '--no-simulation', '--save-simulation', 'temp_out.json']);
  }, /Cannot use --save-simulation when simulation is disabled/);

  // Test: --debug flag parsing
  const debugOptions = runner.parseArgs(['rollover', '--old-market-id', '0x123', '--new-market-id', '0x456', '--debug']);
  assert.strictEqual(debugOptions.debug, true, '--debug flag should parse options.debug as true');

  const defaultDebugOptions = runner.parseArgs(['rollover', '--old-market-id', '0x123', '--new-market-id', '0x456']);
  assert.strictEqual(defaultDebugOptions.debug, false, '--debug flag should default to false');

  console.log('✅ CliRunner argument parsing options tests passed!');
}

// 3. Test Rollover Command Mock Execution
async function testRolloverCommandMock() {
  console.log('Testing RolloverCommand with mock clients...');
  const { RolloverCommand } = await import('../cli/rollover-command.js');
  
  const blockchain = new MockBlockchainClient();
  const router = new MockSwapRouterClient();
  const simulation = new MockSimulationEngine();
  const auditor = new MockTransactionAuditor();

  const cmd = new RolloverCommand(blockchain, router, simulation, auditor);
  
  const result = await cmd.execute({
    user: '0xE14f5DAab7E7fF2527F3B3cE582033e4A1Df8D0a',
    oldMarketId: '0xa75bb490ecfee90c86a9d22ebc2dde42fb83478b3f18722b9fc6f5f668cab124',
    newMarketId: '0xb37c30f34bff11c81ee8400133965f450a5f7c5d81ba2cf5740076f49eabc95c',
    type: 'full',
    slippage: 1.0,
    simulation: true
  });

  assert.ok(result.simulationResult, 'Simulation result should be returned');
  assert.strictEqual(result.simulationResult.traceTree.to, '0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245', 'Trace tree destination should be Morpho Bundler V3');

  console.log('✅ RolloverCommand mock execution passed!');
}

// 4. Test Leverage Command Mock Execution
async function testLeverageCommandMock() {
  console.log('Testing LeverageCommand with mock clients...');
  const { LeverageCommand } = await import('../cli/leverage-command.js');
  
  const blockchain = new MockBlockchainClient();
  const router = new MockSwapRouterClient();
  const simulation = new MockSimulationEngine();
  const auditor = new MockTransactionAuditor();

  const cmd = new LeverageCommand(blockchain, router, simulation, auditor);

  // Test Leverage Up
  await cmd.execute({
    user: '0xE14f5DAab7E7fF2527F3B3cE582033e4A1Df8D0a',
    marketId: '0xb37c30f34bff11c81ee8400133965f450a5f7c5d81ba2cf5740076f49eabc95c',
    targetLeverage: 4.5,
    slippage: 1.0,
    simulation: true
  });

  // Test Deleverage
  await cmd.execute({
    user: '0xE14f5DAab7E7fF2527F3B3cE582033e4A1Df8D0a',
    marketId: '0xb37c30f34bff11c81ee8400133965f450a5f7c5d81ba2cf5740076f49eabc95c',
    targetLeverage: 2.0,
    slippage: 1.0,
    simulation: true
  });

  console.log('✅ LeverageCommand mock execution passed!');
}

async function testSimulateRawCommandMock() {
  console.log('Testing SimulateRawCommand with mock clients...');
  const { SimulateRawCommand } = await import('../cli/simulate-raw-command.js');

  const blockchain = new MockBlockchainClient();
  const simulation = new MockSimulationEngine();
  const cmd = new SimulateRawCommand(blockchain, simulation);

  // Create valid temporary JSON
  const validPath = './tests/temp_valid_tx.json';
  fs.writeFileSync(validPath, JSON.stringify({
    from: "0xdC382CDF2a25790F535a518EC26958c227e9DCF2",
    to: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    data: "0x70a08231000000000000000000000000dc382cdf2a25790f535a518ec26958c227e9dcf2",
    value: "0x0"
  }));

  try {
    // 1. Test load valid transaction data
    const txData = cmd.loadTransactionData(validPath);
    assert.strictEqual(txData.from, '0xdC382CDF2a25790F535a518EC26958c227e9DCF2');
    assert.strictEqual(txData.to, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
    assert.strictEqual(txData.data, '0x70a08231000000000000000000000000dc382cdf2a25790f535a518ec26958c227e9dcf2');
    assert.strictEqual(txData.value, 0n);

    // 2. Test mock execution simulation
    const simResult = await cmd.runSimulation(txData);
    assert.ok(simResult.success, 'Simulation should succeed');
    assert.strictEqual(simResult.traceTree.to, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');

    // 3. Test missing properties throws
    const invalidPath = './tests/temp_invalid_tx.json';
    
    // Missing "from"
    fs.writeFileSync(invalidPath, JSON.stringify({
      to: "0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245",
      data: "0x00"
    }));
    assert.throws(() => cmd.loadTransactionData(invalidPath), /Missing "from" address/);

    // Missing "to"
    fs.writeFileSync(invalidPath, JSON.stringify({
      from: "0xdC382CDF2a25790F535a518EC26958c227e9DCF2",
      data: "0x00"
    }));
    assert.throws(() => cmd.loadTransactionData(invalidPath), /Missing "to" address/);

    // Missing "data"
    fs.writeFileSync(invalidPath, JSON.stringify({
      from: "0xdC382CDF2a25790F535a518EC26958c227e9DCF2",
      to: "0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245"
    }));
    assert.throws(() => cmd.loadTransactionData(invalidPath), /Missing "data" calldata/);

    // Invalid "from" address
    fs.writeFileSync(invalidPath, JSON.stringify({
      from: "0xinvalid",
      to: "0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245",
      data: "0x00"
    }));
    assert.throws(() => cmd.loadTransactionData(invalidPath), /Invalid "from" address/);

    // Invalid "data" hex
    fs.writeFileSync(invalidPath, JSON.stringify({
      from: "0xdC382CDF2a25790F535a518EC26958c227e9DCF2",
      to: "0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245",
      data: "not-hex"
    }));
    assert.throws(() => cmd.loadTransactionData(invalidPath), /Invalid "data" hex string/);

    // Clean up invalid path
    if (fs.existsSync(invalidPath)) fs.unlinkSync(invalidPath);

  } finally {
    // Clean up valid path
    if (fs.existsSync(validPath)) fs.unlinkSync(validPath);
  }

  console.log('✅ SimulateRawCommand mock execution passed!');
}


// 5. Live Simulation integration tests (Only run if Alchemy API Key is available)
async function runLiveForkSimulationTests() {
  if (!apiKey) {
    console.log('⚠️ Skipping Live Mainnet Fork Simulation tests because ALCHEMY_API_KEY is not set.');
    return;
  }

  console.log('\n--- Running Live Mainnet Fork Simulation tests ---');
  const { BlockchainClient } = await import('../cli/blockchain-client.js');
  const { SwapRouterClient } = await import('../cli/swap-router-client.js');
  const { SimulationEngine } = await import('../cli/simulation-engine.js');
  const { TransactionAuditor } = await import('../cli/transaction-auditor.js');
  const { RolloverCommand } = await import('../cli/rollover-command.js');
  const { LeverageCommand } = await import('../cli/leverage-command.js');

  const rpcUrl = `https://eth-mainnet.g.alchemy.com/v2/${apiKey}`;
  const blockchain = new BlockchainClient(rpcUrl, null);
  const router = new SwapRouterClient();
  const simulation = new SimulationEngine(blockchain, apiKey);
  const auditor = new TransactionAuditor(blockchain.publicClient);

  process.env.FORK_BLOCK_NUMBER = '25340000';

  try {
    // Rollover simulation using old position holder (Full Rollover)
    const rolloverCmd = new RolloverCommand(blockchain, router, simulation, auditor);
    console.log('Simulating live full rollover collateral on Alchemy fork...');
    const fullRolloverResult = await rolloverCmd.execute({
      user: '0xE14f5DAab7E7fF2527F3B3cE582033e4A1Df8D0a',
      oldMarketId: '0xa75bb490ecfee90c86a9d22ebc2dde42fb83478b3f18722b9fc6f5f668cab124',
      newMarketId: '0xb37c30f34bff11c81ee8400133965f450a5f7c5d81ba2cf5740076f49eabc95c',
      type: 'full',
      slippage: 1.0,
      simulation: true,
      capBorrow: true
    });
    assert.strictEqual(typeof fullRolloverResult.simulationResult.success, 'boolean', 'Full rollover simulation should execute');

    // Rollover simulation using old position holder (Partial Rollover)
    console.log('Simulating live partial rollover collateral on Alchemy fork...');
    const partialRolloverResult = await rolloverCmd.execute({
      user: '0xE14f5DAab7E7fF2527F3B3cE582033e4A1Df8D0a',
      oldMarketId: '0xa75bb490ecfee90c86a9d22ebc2dde42fb83478b3f18722b9fc6f5f668cab124',
      newMarketId: '0xb37c30f34bff11c81ee8400133965f450a5f7c5d81ba2cf5740076f49eabc95c',
      type: 'partial',
      debt: 2,
      slippage: 1.0,
      simulation: true,
      capBorrow: true
    });
    assert.strictEqual(typeof partialRolloverResult.simulationResult.success, 'boolean', 'Partial rollover simulation should execute');

    // Leverage simulation using active position holder (Deleveraging)
    const leverageCmd = new LeverageCommand(blockchain, router, simulation, auditor);
    console.log('Simulating live deleveraging on Alchemy fork...');
    const deleverageResult = await leverageCmd.execute({
      user: '0xE14f5DAab7E7fF2527F3B3cE582033e4A1Df8D0a',
      marketId: '0xa75bb490ecfee90c86a9d22ebc2dde42fb83478b3f18722b9fc6f5f668cab124',
      targetLeverage: 2.0,
      slippage: 1.0,
      simulation: true
    });
    assert.strictEqual(typeof deleverageResult.simulationResult.success, 'boolean', 'Deleveraging simulation should execute');

    // Leverage simulation using active position holder (Leveraging up)
    console.log('Simulating live leveraging up on Alchemy fork...');
    const leverageUpResult = await leverageCmd.execute({
      user: '0xa9BAbD59748a5077AdD757DA038F5F7083bCE9bD',
      marketId: '0xb37c30f34bff11c81ee8400133965f450a5f7c5d81ba2cf5740076f49eabc95c',
      pt: '0xb5Be35D8fF83D431899b95851CB17a2B4bcEF150',
      targetLeverage: 4.5,
      slippage: 1.0,
      simulation: true
    });
    assert.strictEqual(typeof leverageUpResult.simulationResult.success, 'boolean', 'Leveraging up simulation should execute');

    console.log('✅ Live Mainnet Fork Simulation tests passed successfully!');
  } finally {
    delete process.env.FORK_BLOCK_NUMBER;
  }
}

// 6. Test Formatter and Resolver logic
async function testFormattingAndResolver() {
  console.log('Testing CliFormatter and AddressLabelResolver...');
  const { CliFormatter } = await import('../cli/formatter.js');
  const { AddressLabelResolver } = await import('../cli/address-label-resolver.js');

  // Test formatter amount formatting
  const formatted1 = CliFormatter.formatAmount(123456789000000000000n, 18, 2);
  assert.strictEqual(formatted1, '123.46', 'Should format 18 decimals bigint with precision 2');

  const formatted2 = CliFormatter.formatAmount(5400000n, 6, 2);
  assert.strictEqual(formatted2, '5.40', 'Should format 6 decimals bigint with precision 2');

  // Test resolver static known contracts
  const mockPublicClient = {
    readContract: async () => 'USDC' // fallback ERC20 symbol response
  };
  const resolver = new AddressLabelResolver(mockPublicClient);

  const morphoBlueLabel = await resolver.resolveLabel('0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb');
  assert.strictEqual(morphoBlueLabel, 'Morpho Blue Core', 'Should resolve Morpho Blue static core address');

  // Test resolver market params contextual mapping
  const marketParams = {
    collateralToken: '0x3365554a61CeFF74A76528f9e86C1E87946d16a5',
    collateralSymbol: 'PT-token',
    loanToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    loanSymbol: 'USDC'
  };

  const collateralLabel = await resolver.resolveLabel(marketParams.collateralToken, marketParams);
  assert.strictEqual(collateralLabel, 'Collateral (PT-token)', 'Should resolve collateral token with market params');

  // Test dynamic symbol query
  const dynamicLabel = await resolver.resolveLabel('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
  assert.strictEqual(dynamicLabel, 'USDC', 'Should resolve USDC symbol dynamically from public client contract read');

  console.log('✅ CliFormatter and AddressLabelResolver tests passed!');
}

// Test BlockchainClient checkAllowance and approveToken methods (TDD)
async function testBlockchainClientAllowanceAndApprove() {
  console.log('Testing BlockchainClient checkAllowance and approveToken...');
  const { BlockchainClient } = await import('../cli/blockchain-client.js');

  let readContractCalls = [];
  let executeTransactionCalls = [];

  const mockPublicClient = {
    readContract: async (args) => {
      readContractCalls.push(args);
      if (args.functionName === 'allowance') {
        const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
        if (args.address.toLowerCase() === PERMIT2_ADDRESS.toLowerCase()) {
          return [5000000n, 9999999999n, 0n];
        }
        return 5000000n; // 5 USDC
      }
      return 0n;
    }

  };

  const client = new BlockchainClient('http://mock-rpc-url', '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
  client.publicClient = mockPublicClient;
  client.executeTransaction = async (args) => {
    executeTransactionCalls.push(args);
    return '0xmock-approval-tx-hash';
  };

  // 1. Test checkAllowance
  const owner = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
  const spender = '0x4A6c312ec70E8747a587EE860a0353cd42Be0aE0';
  const token = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  
  const allowance = await client.checkAllowance(token, owner, spender);
  assert.strictEqual(allowance, 5000000n, 'allowance should return the value from publicClient');
  assert.strictEqual(readContractCalls.length, 1);
  assert.strictEqual(readContractCalls[0].address, token);
  assert.strictEqual(readContractCalls[0].functionName, 'allowance');
  assert.deepStrictEqual(readContractCalls[0].args, [owner, spender]);

  // 2. Test approveToken
  const amount = 10000000n; // 10 USDC
  const txHash = await client.approveToken(token, spender, amount);
  assert.strictEqual(txHash, '0xmock-approval-tx-hash', 'approveToken should return executed transaction hash');
  assert.strictEqual(executeTransactionCalls.length, 1);
  assert.strictEqual(executeTransactionCalls[0].to, token);
  assert.ok(executeTransactionCalls[0].data.startsWith('0x095ea7b3'), 'calldata should start with approve selector (0x095ea7b3)');

  console.log('✅ BlockchainClient checkAllowance and approveToken tests passed!');
}

// Test CliRunner allowance checking and auto-approval (TDD)
async function testCliRunnerAllowanceCheckAndApproval() {
  console.log('Testing CliRunner allowance checking and auto-approval...');
  const { CliRunner } = await import('../cli/cli-runner.js');
  const { BlockchainClient } = await import('../cli/blockchain-client.js');

  let checkAllowanceCalled = 0;
  let approveTokenCalled = 0;

  // Stub publicClient property descriptor via prototype chain
  // Stub publicClient property descriptor via prototype chain
  Object.defineProperty(BlockchainClient.prototype, 'publicClient', {
    get() {
      return this._mockPublicClient;
    },
    set(val) {
      this._mockPublicClient = {
        readContract: async ({ address, functionName, args }) => {

          const addr = getAddress(address);
          const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
          
          if (addr === getAddress(PERMIT2_ADDRESS) && functionName === 'allowance') {
            return [0n, 0n, 0n]; // return empty Permit2 allowance tuple
          }
          
          let res = 0n;
          if (addr === getAddress('0x0000000022D53366457F9d5E68Ec105046FC4383') && functionName === 'get_address') {

            res = '0xF98B45FA17DE75FB1aD0e7aFD971b0ca00e379fC';
          } else if (addr === getAddress('0xF98B45FA17DE75FB1aD0e7aFD971b0ca00e379fC') && functionName === 'find_pool_for_coins') {
            res = args[2] === 0n ? '0xE1B96555BbecA40E583BbB41a11C68Ca4706A414' : '0x0000000000000000000000000000000000000000';
          } else if (addr === getAddress('0xE1B96555BbecA40E583BbB41a11C68Ca4706A414') && functionName === 'coins') {
            const index = args[0];
            if (index === 0n) res = '0x98A878b1Cd98131B271883B390f68D2c90674665'; // apxUSD
            if (index === 1n) res = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC
          } else if (addr === getAddress('0xE1B96555BbecA40E583BbB41a11C68Ca4706A414') && functionName === 'get_dy') {
            const dx = args[2];
            res = (dx * 81n) / 100n / 10n ** 12n; // 1 apxUSD = 0.81 USDC
          } else if (functionName === 'price') {
            if (addr === getAddress('0x0000000000000000000000000000000000000002')) {
              res = 117n * 10n ** 22n; // 1.17 USDC/collateral
            } else if (addr === getAddress('0x0000000000000000000000000000000000000004')) {
              res = 138n * 10n ** 34n; // 1.38 apxUSD/collateral
            } else {
              res = 950000n * 10n ** 18n;
            }
          }
          
          return res;
        },
        waitForTransactionReceipt: async () => {
          return { status: 'success', logs: [] };
        }
      };
    },
    configurable: true
  });

  const { SwapRouterClient } = await import('../cli/swap-router-client.js');
  const { SimulationEngine } = await import('../cli/simulation-engine.js');

  const originalCheckAllowance = BlockchainClient.prototype.checkAllowance;
  const originalApproveToken = BlockchainClient.prototype.approveToken;
  const originalExecuteTransaction = BlockchainClient.prototype.executeTransaction;
  const originalFetchMarketParams = BlockchainClient.prototype.fetchMarketParams;
  const originalFetchMorphoPosition = BlockchainClient.prototype.fetchMorphoPosition;
  const originalCheckCollateralMaturity = BlockchainClient.prototype.checkCollateralMaturity;
  const originalFetchSwapRoute = SwapRouterClient.prototype.fetchSwapRoute;
  const originalSimulateTransaction = SimulationEngine.prototype.simulateTransaction;

  SwapRouterClient.prototype.fetchSwapRoute = async () => ({
    outputs: [{ amount: '7800000000000000000' }],
    tx: { to: '0x0000000000000000000000000000000000000004', data: '0x00' }
  });

  SimulationEngine.prototype.simulateTransaction = async (from, to, data, value, prependCalls) => {
    return {
      success: true,
      gasUsed: 120000n,
      logs: [],
      traceTree: { to: to || '0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245', status: '0x1', gasUsed: '0x1d4c0' },
      calls: [
        { status: '0x1', returnData: '0x0000000000000000000000000000000000000000000000000000000000000000' },
        { status: '0x1', returnData: '0x0' },
        { status: '0x1', returnData: '0x0000000000000000000000000000000000000000000000000000000000000000' },
        { status: '0x1', returnData: '0x0000000000000000000000000000000000000000000000000000000000000000' },
        { status: '0x1', returnData: '0x0000000000000000000000000000000000000000000000000000000000000000' }
      ]
    };
  };

  BlockchainClient.prototype.fetchMarketParams = async (id) => {
    if (id === 'old') return mockMarketParams;
    if (id === 'new') return {
      ...mockMarketParams,
      loanToken: '0x98A878b1Cd98131B271883B390f68D2c90674665', // apxUSD (diff loan)
      loanDecimals: 18,
      loanSymbol: 'apxUSD',
      oracle: '0x0000000000000000000000000000000000000004'
    };
    throw new Error('Unknown market id ' + id);
  };
  BlockchainClient.prototype.fetchMorphoPosition = async () => ({
    collateral: 100n * 10n ** 18n, // 100 PT (cap borrow to trigger shortfall)
    debt: 5000n * 10n ** 6n, // 5000 USDC
    borrowShares: 5000n * 10n ** 6n
  });
  BlockchainClient.prototype.checkCollateralMaturity = async () => ({ expiryDate: '11/05/2026', isExpired: false });

  BlockchainClient.prototype.checkAllowance = async (token, owner, spender) => {
    checkAllowanceCalled++;
    return 1000000n; // 1 USDC (which is less than the 6000 USDC debt/shortfall)
  };

  BlockchainClient.prototype.approveToken = async (token, spender, amount) => {
    approveTokenCalled++;
    return '0xmock-approve-tx-hash';
  };

  BlockchainClient.prototype.executeTransaction = async () => {
    return '0xmock-execute-tx-hash';
  };

  const runner = new CliRunner();

  // Redirect console logs to capture output
  const originalLog = console.log;
  let logs = [];
  console.log = (...args) => logs.push(args.join(' '));

  try {
    await runner.run([
      'node',
      'cli.js',
      'rollover',
      '--old-market-id', 'old',
      '--new-market-id', 'new',
      '--user', '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      '--private-key', '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      '--rpc', 'http://mock-rpc-url',
      '--type', 'partial',
      '--debt', '100',
      '--cap-borrow'
    ]);
  } finally {
    // Restore originals
    console.log = originalLog;
    delete BlockchainClient.prototype.publicClient;
    BlockchainClient.prototype.checkAllowance = originalCheckAllowance;
    BlockchainClient.prototype.approveToken = originalApproveToken;
    BlockchainClient.prototype.executeTransaction = originalExecuteTransaction;
    BlockchainClient.prototype.fetchMarketParams = originalFetchMarketParams;
    BlockchainClient.prototype.fetchMorphoPosition = originalFetchMorphoPosition;
    BlockchainClient.prototype.checkCollateralMaturity = originalCheckCollateralMaturity;
    SwapRouterClient.prototype.fetchSwapRoute = originalFetchSwapRoute;
    SimulationEngine.prototype.simulateTransaction = originalSimulateTransaction;
  }

  assert.strictEqual(checkAllowanceCalled, 1, 'checkAllowance should be called exactly once');
  assert.strictEqual(approveTokenCalled, 1, 'approveToken should be called exactly once since allowance is insufficient');

  console.log('✅ CliRunner allowance checking and auto-approval tests passed!');
}

// 7. Test CliRunner env loading and RPC fallback behavior
async function testCliRunnerEnvAndRpcFallback() {
  console.log('Testing CliRunner env loading and RPC fallback...');
  const { CliRunner } = await import('../cli/cli-runner.js');
  
  const runner = new CliRunner();
  
  // 1. Test loadEnv loads process.env
  runner.loadEnv();
  assert.ok(process.env.ALCHEMY_API_KEY, 'process.env.ALCHEMY_API_KEY should be loaded from .env');

  // 2. Test fallback resolution with Alchemy key
  const backupKey = process.env.ALCHEMY_API_KEY;
  const backupRpc = process.env.RPC_URL;
  
  delete process.env.RPC_URL;
  process.env.ALCHEMY_API_KEY = 'mock_alchemy_key';
  
  const resolved = runner.resolveRpcUrl({ simulation: true });
  assert.strictEqual(resolved, 'https://eth-mainnet.g.alchemy.com/v2/mock_alchemy_key', 'Should fallback to Alchemy endpoint for simulation');

  const resolvedLive = runner.resolveRpcUrl({});
  assert.strictEqual(resolvedLive, 'https://rpc.mevblocker.io', 'Should fallback to MEV-Blocker for live transactions');
  
  // Restore
  if (backupKey) process.env.ALCHEMY_API_KEY = backupKey;
  if (backupRpc) process.env.RPC_URL = backupRpc;
  
  console.log('✅ CliRunner env loading and RPC fallback tests passed!');
}

// 8. Test end-to-end shell command execution of node cli.js
async function testCliShellExecutionSimulation() {
  if (!apiKey) {
    console.log('⚠️ Skipping End-to-End Shell Execution tests because ALCHEMY_API_KEY is not set.');
    return;
  }
  console.log('Testing end-to-end shell execution of node cli.js...');

  const cliPath = path.resolve(__dirname, '../cli.js');
  const user = '0xE14f5DAab7E7fF2527F3B3cE582033e4A1Df8D0a';
  const oldMarket = '0xa75bb490ecfee90c86a9d22ebc2dde42fb83478b3f18722b9fc6f5f668cab124';
  const newMarket = '0xb37c30f34bff11c81ee8400133965f450a5f7c5d81ba2cf5740076f49eabc95c';

  const env = {
    ...process.env,
    FORK_BLOCK_NUMBER: '25340000'
  };

  // 1. Test: Full Rollover Simulation Shell Command
  const cmd1 = `node ${cliPath} rollover --old-market-id ${oldMarket} --new-market-id ${newMarket} --user ${user} --simulation --cap-borrow`;
  console.log(`  Spawning: ${cmd1}`);
  const stdout1 = execSync(cmd1, { encoding: 'utf8', env }).toLowerCase();
  
  assert.ok(stdout1.includes('morpho position rollover'), 'Output should contain dashboard header');
  assert.ok(stdout1.includes('transaction simulation successful') || stdout1.includes('transaction simulation reverted'), 'Output should verify simulation execution');
  assert.ok(stdout1.includes('morpho bundler v3'), 'Output should resolve contract label in call trace');

  // 2. Test: Partial Rollover Simulation Shell Command
  const cmd2 = `node ${cliPath} rollover --old-market-id ${oldMarket} --new-market-id ${newMarket} --user ${user} --type partial --debt 2 --simulation --cap-borrow`;
  console.log(`  Spawning: ${cmd2}`);
  const stdout2 = execSync(cmd2, { encoding: 'utf8', env }).toLowerCase();
  
  assert.ok(stdout2.includes('migration plan (partial rollover)'), 'Output should indicate partial rollover');
  assert.ok(stdout2.includes('debt repayment') && stdout2.includes('2.00 usdc'), 'Output should format repayment amount');
  assert.ok(stdout2.includes('transaction simulation successful') || stdout2.includes('transaction simulation reverted'), 'Output should verify simulation execution');

  // 3. Test: Leverage Adjustment Simulation Shell Command (Deleveraging)
  const cmd3 = `node ${cliPath} adjust-leverage --market-id ${oldMarket} --user ${user} --target-leverage 2.0 --simulation`;
  console.log(`  Spawning: ${cmd3}`);
  const stdout3 = execSync(cmd3, { encoding: 'utf8', env }).toLowerCase();
  
  try {
    assert.ok(stdout3.includes('deleverage position'), 'Output should indicate Deleverage');
    assert.ok(stdout3.includes('transaction simulation successful') || stdout3.includes('transaction simulation reverted'), 'Output should verify simulation execution');
  } catch (err) {
    console.error('DEBUG: stdout3 output was:', stdout3);
    throw err;
  }

  // 4. Test: Validation constraint check (expected failure)
  const cmd4 = `node ${cliPath} rollover --private-key 0x123`;
  console.log(`  Spawning: ${cmd4} (Expecting error exit)`);
  assert.throws(() => {
    execSync(cmd4, { stdio: 'pipe' });
  }, /--private-key requires --rpc/, 'Should exit with code 1 and output constraint error');

  // 5. Test: simulate-raw shell execution
  const tempJsonPath = './tests/temp_shell_raw_tx.json';
  fs.writeFileSync(tempJsonPath, JSON.stringify({
    from: "0xdC382CDF2a25790F535a518EC26958c227e9DCF2",
    to: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    data: "0x70a08231000000000000000000000000dc382cdf2a25790f535a518ec26958c227e9dcf2",
    value: "0x0"
  }));

  try {
    const cmd5 = `node ${cliPath} simulate-raw --file ${tempJsonPath}`;
    console.log(`  Spawning: ${cmd5}`);
    const stdout5 = execSync(cmd5, { encoding: 'utf8' }).toLowerCase();
    
    assert.ok(stdout5.includes('raw transaction simulation'), 'Output should contain raw simulation header');
    assert.ok(stdout5.includes('transaction simulation successful'), 'Output should verify simulation success');
  } finally {
    if (fs.existsSync(tempJsonPath)) fs.unlinkSync(tempJsonPath);
  }

  console.log('✅ End-to-end CLI shell execution tests passed!');
}

// 9. Test WalletConnector QR Code Generation and Connection Flow
async function testWalletConnectorQrCodeGeneration() {
  console.log('Testing WalletConnector QR code generation...');
  const { WalletConnector } = await import('../cli/wallet-connector.js');

  class MockSignClient {
    static async init(config) {
      assert.strictEqual(config.projectId, 'test-project-id');
      assert.strictEqual(config.metadata.name, 'Morpho Blue PT Position Migrator');
      return new MockSignClientInstance();
    }
  }

  class MockSignClientInstance {
    async connect(options) {
      assert.ok(options.requiredNamespaces.eip155);
      return {
        uri: 'wc:mock-connection-uri-12345',
        approval: async () => {
          return {
            topic: 'mock-session-topic',
            namespaces: {
              eip155: {
                accounts: ['eip155:1:0x1111111111111111111111111111111111111111']
              }
            }
          };
        }
      };
    }
  }

  let qrCodeGeneratedUri = null;
  let qrCodeGeneratedOptions = null;
  const mockQrcode = {
    generate(uri, options) {
      qrCodeGeneratedUri = uri;
      qrCodeGeneratedOptions = options;
    }
  };

  const connector = new WalletConnector('test-project-id', {
    SignClient: MockSignClient,
    qrcode: mockQrcode
  });

  await connector.initialize();
  await connector.connect();

  assert.strictEqual(qrCodeGeneratedUri, 'wc:mock-connection-uri-12345', 'QR code should be generated with correct URI');
  assert.deepStrictEqual(qrCodeGeneratedOptions, { small: true }, 'QR code should be generated with correct options');
  
  const walletClient = connector.getWalletClient();
  assert.ok(walletClient, 'Should return viem walletClient');

  const addresses = await walletClient.getAddresses();
  assert.deepStrictEqual(addresses, ['0x1111111111111111111111111111111111111111'], 'walletClient should expose mock session accounts');

  const chainId = await walletClient.request({ method: 'eth_chainId' });
  assert.strictEqual(chainId, '0x1', 'Should return hex chainId for mainnet');

  console.log('✅ WalletConnector QR code generation tests passed!');
}

async function testCliHelpExecution() {
  console.log('Testing CliRunner help printing execution...');
  const { CliRunner } = await import('../cli/cli-runner.js');
  const runner = new CliRunner();

  let logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.join(' '));
  };

  try {
    // 1. Test General Help
    logs = [];
    await runner.run(['node', 'cli.js', '--help']);
    const generalHelpOutput = logs.join('\n').toLowerCase();
    assert.ok(generalHelpOutput.includes('morpho position migrator cli'), 'General help should contain title');
    assert.ok(generalHelpOutput.includes('available commands'), 'General help should contain commands section');
    assert.ok(generalHelpOutput.includes('rollover'), 'General help should list rollover');
    assert.ok(generalHelpOutput.includes('adjust-leverage'), 'General help should list adjust-leverage');
    assert.ok(generalHelpOutput.includes('simulate-raw'), 'General help should list simulate-raw');

    // 2. Test Rollover Help
    logs = [];
    await runner.run(['node', 'cli.js', 'rollover', '-h']);
    const rolloverHelpOutput = logs.join('\n').toLowerCase();
    assert.ok(rolloverHelpOutput.includes('rollover command help'), 'Rollover help should contain title');
    assert.ok(rolloverHelpOutput.includes('--old-market-id'), 'Rollover help should document --old-market-id');
    assert.ok(rolloverHelpOutput.includes('--new-market-id'), 'Rollover help should document --new-market-id');
    assert.ok(rolloverHelpOutput.includes('--cap-borrow'), 'Rollover help should document --cap-borrow');

    // 3. Test Leverage Help
    logs = [];
    await runner.run(['node', 'cli.js', 'adjust-leverage', '--help']);
    const leverageHelpOutput = logs.join('\n').toLowerCase();
    assert.ok(leverageHelpOutput.includes('adjust-leverage command help'), 'Leverage help should contain title');
    assert.ok(leverageHelpOutput.includes('--market-id'), 'Leverage help should document --market-id');
    assert.ok(leverageHelpOutput.includes('--target-leverage'), 'Leverage help should document --target-leverage');

    // 4. Test Simulate-Raw Help
    logs = [];
    await runner.run(['node', 'cli.js', 'simulate-raw', '--help']);
    const rawHelpOutput = logs.join('\n').toLowerCase();
    assert.ok(rawHelpOutput.includes('simulate-raw command help'), 'Simulate-raw help should contain title');
    assert.ok(rawHelpOutput.includes('--file'), 'Simulate-raw help should document --file');
  } finally {
    console.log = originalLog;
  }
  console.log('✅ CliRunner help printing execution tests passed!');
}

async function testCliRunnerSignerMismatchValidation() {
  console.log('Testing CliRunner signer mismatch validation...');
  const { CliRunner } = await import('../cli/cli-runner.js');
  const runner = new CliRunner();

  const originalExit = process.exit;
  const originalError = console.error;
  
  let exitCode = null;
  let errorMsg = '';
  
  process.exit = (code) => {
    exitCode = code;
  };
  console.error = (...args) => {
    errorMsg += args.join(' ');
  };

  try {
    await runner.run([
      'node', 'cli.js', 'rollover',
      '--old-market-id', '0x123',
      '--new-market-id', '0x456',
      '--user', '0xE14f5DAab7E7fF2527F3B3cE582033e4A1Df8D0a',
      '--rpc', 'https://eth-mainnet.g.alchemy.com/v2/test',
      '--private-key', '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
    ]);
    
    assert.strictEqual(exitCode, 1, 'Process should exit with code 1 on mismatch error');
    assert.ok(errorMsg.includes('does not match specified position user address'), 'Should log mismatch validation message');
  } finally {
    process.exit = originalExit;
    console.error = originalError;
  }

  console.log('✅ CliRunner signer mismatch validation test passed!');
}


async function testZeroDebtRollover() {
  console.log('Testing Zero Debt Rollover command (TDD)...');
  const { BlockchainClient } = await import('../cli/blockchain-client.js');
  const { SwapRouterClient } = await import('../cli/swap-router-client.js');
  const { RolloverCommand } = await import('../cli/rollover-command.js');
  const { SimulationEngine } = await import('../cli/simulation-engine.js');

  // Backup original prototypes
  const originalFetchMarketParams = BlockchainClient.prototype.fetchMarketParams;
  const originalFetchMorphoPosition = BlockchainClient.prototype.fetchMorphoPosition;
  const originalCheckCollateralMaturity = BlockchainClient.prototype.checkCollateralMaturity;
  const originalFetchSwapRoute = SwapRouterClient.prototype.fetchSwapRoute;

  // Stubs
  BlockchainClient.prototype.fetchMarketParams = async (id) => {
    return {
      loanToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      collateralToken: '0x3365554a61CeFF74A76528f9e86C1E87946d16a5',
      loanSymbol: 'USDC',
      collateralSymbol: 'PT-token',
      loanDecimals: 6,
      collateralDecimals: 18,
      oracle: '0x0000000000000000000000000000000000000002',
      irm: '0x0000000000000000000000000000000000000003',
      lltv: 860000000000000000n
    };
  };

  BlockchainClient.prototype.fetchMorphoPosition = async () => ({
    collateral: 8000000000000000000n, // 8 PT
    debt: 0n, // 0 USDC
    borrowShares: 0n
  });

  BlockchainClient.prototype.checkCollateralMaturity = async () => ({
    isExpired: true,
    maturityDate: new Date('2026-06-18T00:00:00Z')
  });

  SwapRouterClient.prototype.fetchSwapRoute = async () => ({
    routeData: null,
    expectedNewCollateral: 8000000000000000000n,
    isSameCollateral: true,
    isSameLoan: true
  });

  try {
    const blockchainClient = new BlockchainClient();
    blockchainClient.publicClient = {
      readContract: async ({ functionName }) => {
        if (functionName === 'price') return 950000n * 10n ** 18n;
        return 0n;
      }
    };
    const routerClient = new SwapRouterClient();
    const simulationEngine = new SimulationEngine(blockchainClient, 'key');
    const cmd = new RolloverCommand(blockchainClient, routerClient, simulationEngine, null);

    const assessment = await cmd.assessPosition({
      user: '0xE14f5DAab7E7fF2527F3B3cE582033e4A1Df8D0a',
      oldMarketId: '0x1',
      newMarketId: '0x2',
      type: 'full'
    });

    const swap = await cmd.fetchSwapRoute(assessment, {});
    const calldataResult = await cmd.compileCalldata(assessment, swap, {});

    // Assert that debt is 0, steps do not contain flashloan/repay/borrow
    assert.strictEqual(calldataResult.debtAmount, 0n, 'Debt amount should be 0n');
    assert.strictEqual(calldataResult.simulatedNewDebt, 0n, 'Simulated new debt should be 0n');
    assert.strictEqual(calldataResult.flashLoanAmount, 0n, 'Flash loan amount should be 0n');

    const hasFlashloanStep = calldataResult.steps.some(s => s.toLowerCase().includes('flashloan'));
    const hasRepayStep = calldataResult.steps.some(s => s.toLowerCase().includes('repay'));
    const hasBorrowStep = calldataResult.steps.some(s => s.toLowerCase().includes('borrow'));

    assert.ok(!hasFlashloanStep, 'Steps should not contain flashloan operations');
    assert.ok(!hasRepayStep, 'Steps should not contain repay operations');
    assert.ok(!hasBorrowStep, 'Steps should not contain borrow operations');

    console.log('✅ Zero Debt Rollover command unit tests passed!');
  } finally {
    BlockchainClient.prototype.fetchMarketParams = originalFetchMarketParams;
    BlockchainClient.prototype.fetchMorphoPosition = originalFetchMorphoPosition;
    BlockchainClient.prototype.checkCollateralMaturity = originalCheckCollateralMaturity;
    SwapRouterClient.prototype.fetchSwapRoute = originalFetchSwapRoute;
  }
}


async function testSaveSimulationFeature() {
  console.log('Testing Save Simulation feature (TDD)...');
  const { CliRunner } = await import('../cli/cli-runner.js');
  const { BlockchainClient } = await import('../cli/blockchain-client.js');
  const { SwapRouterClient } = await import('../cli/swap-router-client.js');
  const { SimulationEngine } = await import('../cli/simulation-engine.js');

  const tempSimFile = path.resolve(__dirname, '../temp_test_simulation.json');
  if (fs.existsSync(tempSimFile)) {
    fs.unlinkSync(tempSimFile);
  }

  // Backup original prototypes
  const originalFetchMarketParams = BlockchainClient.prototype.fetchMarketParams;
  const originalFetchMorphoPosition = BlockchainClient.prototype.fetchMorphoPosition;
  const originalCheckCollateralMaturity = BlockchainClient.prototype.checkCollateralMaturity;
  const originalFetchSwapRoute = SwapRouterClient.prototype.fetchSwapRoute;
  const originalSimulateTransaction = SimulationEngine.prototype.simulateTransaction;

  // Stubs
  BlockchainClient.prototype.fetchMarketParams = async (id) => {
    return {
      loanToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      collateralToken: '0x3365554a61CeFF74A76528f9e86C1E87946d16a5',
      loanSymbol: 'USDC',
      collateralSymbol: 'PT-token',
      loanDecimals: 6,
      collateralDecimals: 18,
      oracle: '0x0000000000000000000000000000000000000002',
      irm: '0x0000000000000000000000000000000000000003',
      lltv: 860000000000000000n
    };
  };

  BlockchainClient.prototype.fetchMorphoPosition = async () => ({
    collateral: 8000000000000000000n, // 8 PT
    debt: 6000000000n, // 6000 USDC
    borrowShares: 6000000000n
  });

  BlockchainClient.prototype.checkCollateralMaturity = async () => ({
    expiryDate: '11/05/2026',
    isExpired: false
  });

  SwapRouterClient.prototype.fetchSwapRoute = async () => ({
    outputs: [{ amount: '7800000000000000000' }], // 7.8 PT
    tx: { to: '0x0000000000000000000000000000000000000004', data: '0x00' }
  });

  let simulateTransactionCalled = 0;
  SimulationEngine.prototype.simulateTransaction = async (from, to, data, value, prependCalls) => {
    simulateTransactionCalled++;
    return {
      success: true,
      gasUsed: 120000n,
      logs: [],
      traceTree: { to: to || '0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245', status: '0x1', gasUsed: '0x1d4c0' }
    };
  };

  // Prevent console output pollution
  const originalLog = console.log;
  let logs = [];
  console.log = (...args) => logs.push(args.join(' '));

  try {
    const runner = new CliRunner();

    // 1. Run rollover and save simulation
    await runner.run([
      'node',
      'cli.js',
      'rollover',
      '--old-market-id', '0xa75bb490ecfee90c86a9d22ebc2dde42fb83478b3f18722b9fc6f5f668cab124',
      '--new-market-id', '0xb37c30f34bff11c81ee8400133965f450a5f7c5d81ba2cf5740076f49eabc95c',
      '--user', '0xE14f5DAab7E7fF2527F3B3cE582033e4A1Df8D0a',
      '--save-simulation', tempSimFile
    ]);

    assert.ok(fs.existsSync(tempSimFile), 'Simulation JSON file should be created');

    const fileContent = fs.readFileSync(tempSimFile, 'utf8');
    const simData = JSON.parse(fileContent);

    assert.strictEqual(simData.from, '0xE14f5DAab7E7fF2527F3B3cE582033e4A1Df8D0a');
    assert.strictEqual(simData.to, '0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245');
    assert.ok(simData.data.startsWith('0x'), 'Calldata data should be a hex string');
    assert.strictEqual(simData.value, '0');

    // 2. Run simulate-raw roundtrip
    const initialSimCount = simulateTransactionCalled;
    await runner.run([
      'node',
      'cli.js',
      'simulate-raw',
      '--file', tempSimFile
    ]);

    assert.strictEqual(simulateTransactionCalled, initialSimCount + 1, 'simulate-raw should trigger simulateTransaction');

  } finally {
    // Restore
    console.log = originalLog;
    BlockchainClient.prototype.fetchMarketParams = originalFetchMarketParams;
    BlockchainClient.prototype.fetchMorphoPosition = originalFetchMorphoPosition;
    BlockchainClient.prototype.checkCollateralMaturity = originalCheckCollateralMaturity;
    SwapRouterClient.prototype.fetchSwapRoute = originalFetchSwapRoute;
    SimulationEngine.prototype.simulateTransaction = originalSimulateTransaction;

    if (fs.existsSync(tempSimFile)) {
      fs.unlinkSync(tempSimFile);
    }
  }

  console.log('✅ Save Simulation feature tests passed!');
}


async function testCliDebugModeFeature() {
  console.log('Testing CLI Debug Mode feature (TDD)...');
  const { CliRunner } = await import('../cli/cli-runner.js');
  const { BlockchainClient } = await import('../cli/blockchain-client.js');
  const { SwapRouterClient } = await import('../cli/swap-router-client.js');
  const { SimulationEngine } = await import('../cli/simulation-engine.js');

  const tempSimFile = path.resolve(__dirname, '../temp_test_debug_simulation.json');
  if (fs.existsSync(tempSimFile)) {
    fs.unlinkSync(tempSimFile);
  }

  const originalFetchMarketParams = BlockchainClient.prototype.fetchMarketParams;
  const originalFetchMorphoPosition = BlockchainClient.prototype.fetchMorphoPosition;
  const originalCheckCollateralMaturity = BlockchainClient.prototype.checkCollateralMaturity;
  const originalFetchSwapRoute = SwapRouterClient.prototype.fetchSwapRoute;
  const originalSimulateTransaction = SimulationEngine.prototype.simulateTransaction;

  BlockchainClient.prototype.fetchMarketParams = async (id) => ({
    loanToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    collateralToken: id === '0xa75bb490ecfee90c86a9d22ebc2dde42fb83478b3f18722b9fc6f5f668cab124' ? '0x3365554a61CeFF74A76528f9e86C1E87946d16a5' : '0x1111111111111111111111111111111111111111',
    loanSymbol: 'USDC',
    collateralSymbol: id === '0xa75bb490ecfee90c86a9d22ebc2dde42fb83478b3f18722b9fc6f5f668cab124' ? 'PT-token-1' : 'PT-token-2',
    loanDecimals: 6,
    collateralDecimals: 18,
    oracle: '0x0000000000000000000000000000000000000002',
    irm: '0x0000000000000000000000000000000000000003',
    lltv: 860000000000000000n
  });

  BlockchainClient.prototype.fetchMorphoPosition = async () => ({
    collateral: 8000000000000000000n,
    debt: 6000000000n,
    borrowShares: 6000000000n
  });

  BlockchainClient.prototype.checkCollateralMaturity = async () => ({
    expiryDate: '11/05/2026',
    isExpired: false
  });

  SwapRouterClient.prototype.fetchSwapRoute = async function(inputToken, inputAmount, outputToken, slippage, receiver, sender) {
    const mockRoute = {
      outputs: [{ amount: '7800000000000000000' }],
      tx: { to: '0x0000000000000000000000000000000000000004', data: '0x00' }
    };
    this.requests.push({
      url: 'mock-url',
      request: { inputToken, inputAmount: inputAmount.toString(), outputToken },
      response: mockRoute
    });
    return mockRoute;
  };

  SimulationEngine.prototype.simulateTransaction = async (from, to, data, value, prependCalls) => {
    return {
      success: true,
      gasUsed: 120000n,
      logs: [],
      traceTree: { to, status: '0x1', gasUsed: '0x1d4c0' },
      rawResponse: { jsonrpc: '2.0', result: [{ calls: [] }] }
    };
  };

  const originalLog = console.log;
  let logs = [];
  console.log = (...args) => logs.push(args.join(' '));

  try {
    const runner = new CliRunner();

    await runner.run([
      'node',
      'cli.js',
      'rollover',
      '--old-market-id', '0xa75bb490ecfee90c86a9d22ebc2dde42fb83478b3f18722b9fc6f5f668cab124',
      '--new-market-id', '0xb37c30f34bff11c81ee8400133965f450a5f7c5d81ba2cf5740076f49eabc95c',
      '--user', '0xE14f5DAab7E7fF2527F3B3cE582033e4A1Df8D0a',
      '--save-simulation', tempSimFile,
      '--debug'
    ]);

    const outputText = logs.join('\n').toUpperCase();
    assert.ok(outputText.includes('DEBUG INFORMATION'), 'Should print DEBUG INFORMATION header');
    assert.ok(outputText.includes('SWAP ROUTER REQUESTS & RESPONSES'), 'Should print Swap Router debug subheader');
    assert.ok(outputText.includes('RAW MULTICALL CALLDATA PAYLOAD'), 'Should print Raw Multicall Calldata debug subheader');
    assert.ok(outputText.includes('FULL ALCHEMY RESPONSE'), 'Should print Full Alchemy response debug subheader');


    // Check that JSON file has the debug payload saved
    assert.ok(fs.existsSync(tempSimFile), 'Simulation JSON file should be created');
    const simData = JSON.parse(fs.readFileSync(tempSimFile, 'utf8'));
    assert.strictEqual(simData.from, '0xE14f5DAab7E7fF2527F3B3cE582033e4A1Df8D0a');
    assert.ok(simData.debug, 'Saved JSON must contain the debug object');
    assert.ok(Array.isArray(simData.debug.swapRequests), 'debug.swapRequests must be an array');
    assert.strictEqual(simData.debug.swapRequests[0].url, 'mock-url');
    assert.ok(simData.debug.rawCalldata.startsWith('0x'), 'debug.rawCalldata must contain calldata payload');
    assert.ok(simData.debug.alchemyResponse, 'debug.alchemyResponse must contain alchemy simulator response');

    // Check compatibility by executing simulate-raw roundtrip against the file containing the "debug" field
    logs = [];
    await runner.run([
      'node',
      'cli.js',
      'simulate-raw',
      '--file', tempSimFile,
      '--debug'
    ]);
    const simulateRawOutput = logs.join('\n');
    assert.ok(simulateRawOutput.includes('DEBUG INFORMATION'), 'simulate-raw should show debug info with --debug active');

  } finally {
    console.log = originalLog;
    BlockchainClient.prototype.fetchMarketParams = originalFetchMarketParams;
    BlockchainClient.prototype.fetchMorphoPosition = originalFetchMorphoPosition;
    BlockchainClient.prototype.checkCollateralMaturity = originalCheckCollateralMaturity;
    SwapRouterClient.prototype.fetchSwapRoute = originalFetchSwapRoute;
    SimulationEngine.prototype.simulateTransaction = originalSimulateTransaction;

    if (fs.existsSync(tempSimFile)) {
      fs.unlinkSync(tempSimFile);
    }
  }

  console.log('✅ CLI Debug Mode feature tests passed!');
}

async function testTransactionAuditorSameCollateral() {
  console.log('Testing TransactionAuditor same collateral direct rollover bypass...');
  const { TransactionAuditor } = await import('../cli/transaction-auditor.js');

  const mockPublicClient = {
    waitForTransactionReceipt: async ({ hash }) => {
      return { logs: [], status: '0x1' };
    }
  };

  const auditor = new TransactionAuditor(mockPublicClient);
  const result = await auditor.auditRealizedPrice(
    '0x123',
    'rollover',
    {
      spentToken: '0x38EEb52F0771140d10c4E9A9a72349A329Fe8a6A',
      receivedToken: '0x38EEb52F0771140d10c4E9A9a72349A329Fe8a6A',
      spentSymbol: 'apyUSD',
      receivedSymbol: 'apyUSD',
      spentDecimals: 18,
      receivedDecimals: 18
    }
  );

  assert.ok(result.isSameCollateral, 'Should identify same collateral rollover');
  assert.strictEqual(result.spentSymbol, 'apyUSD');
  assert.strictEqual(result.receivedSymbol, 'apyUSD');
  console.log('✅ TransactionAuditor same collateral direct rollover bypass test passed!');
}

async function testTransactionAuditorCrossCollateral() {
  console.log('Testing TransactionAuditor cross-collateral rollover normal auditing...');
  const { TransactionAuditor } = await import('../cli/transaction-auditor.js');

  const spentToken = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const receivedToken = '0x98A878b1Cd98131B271883B390f68D2c90674665';

  const mockPublicClient = {
    waitForTransactionReceipt: async ({ hash }) => {
      return {
        status: '0x1',
        logs: [
          {
            address: spentToken,
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '0x0000000000000000000000006566194141eefa99af43bb5aa71460ca2dc90245',
              '0x0000000000000000000000001111111111111111111111111111111111111111'
            ],
            data: '0x00000000000000000000000000000000000000000000000000000000000f4240'
          },
          {
            address: receivedToken,
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '0x0000000000000000000000002222222222222222222222222222222222222222',
              '0x0000000000000000000000004a6c312ec70e8747a587ee860a0353cd42be0ae0'
            ],
            data: '0x0000000000000000000000000000000000000000000000000de0b6b3a7640000'
          }
        ]
      };
    }
  };

  const auditor = new TransactionAuditor(mockPublicClient);
  const result = await auditor.auditRealizedPrice(
    '0x123',
    'rollover',
    {
      spentToken,
      receivedToken,
      spentSymbol: 'USDC',
      receivedSymbol: 'apxUSD',
      spentDecimals: 6,
      receivedDecimals: 18,
      oracleRate: 1.0,
      estimatedRate: 1.0,
      estimatedPriceImpact: 0.0
    }
  );

  assert.ok(!result.isSameCollateral, 'Should not be same collateral');
  assert.strictEqual(result.spentAmount, 1000000n);
  assert.strictEqual(result.receivedAmount, 1000000000000000000n);
  assert.strictEqual(result.realizedRate, 1.0);
  console.log('✅ TransactionAuditor cross-collateral rollover normal auditing test passed!');
}

async function runAllTests() {
  try {
    await testImports();
    await testCliRunnerArgParsingOptions();
    await testCliRunnerSignerMismatchValidation();
    await testCliHelpExecution();
    await testCliRunnerEnvAndRpcFallback();
    await testFormattingAndResolver();
    await testBlockchainClientAllowanceAndApprove();
    await testCliRunnerAllowanceCheckAndApproval();
    await testWalletConnectorQrCodeGeneration();
    await testRolloverCommandMock();
    await testLeverageCommandMock();
    await testSimulateRawCommandMock();
    await testSaveSimulationFeature();
    await testCliDebugModeFeature();
    await testZeroDebtRollover();
    await testCliShellExecutionSimulation();
    await testTransactionAuditorSameCollateral();
    await testTransactionAuditorCrossCollateral();
    await runLiveForkSimulationTests();
    console.log('\n🎉 All CLI tests completed successfully!');
  } catch (err) {
    console.error('💥 Test suite execution failed:', err.stack);
    process.exit(1);
  }
}

runAllTests();
