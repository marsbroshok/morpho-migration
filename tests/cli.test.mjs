import assert from 'assert';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

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
  async checkPtMaturity() {
    return { expiryDate: '11/05/2026', isExpired: false };
  }
  async isAuthorized() {
    return true;
  }
}

class MockPendleRouterClient {
  async fetchPendleRoute() {
    return {
      outputs: [{ amount: '7800000000000000000' }], // 7.8 PT
      tx: { to: '0x0000000000000000000000000000000000000004', data: '0x00' }
    };
  }
}

class MockSimulationEngine {
  async simulateTransaction() {
    console.log('[Mock Simulation] Executed successfully.');
    return {
      success: true,
      gasUsed: 120000n,
      logs: [],
      traceTree: { to: '0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245', status: '0x1', gasUsed: '0x1d4c0' }
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
  const { PendleRouterClient } = await import('../cli/pendle-router-client.js');
  const { RolloverCommand } = await import('../cli/rollover-command.js');
  const { LeverageCommand } = await import('../cli/leverage-command.js');
  const { TransactionAuditor } = await import('../cli/transaction-auditor.js');

  assert.ok(CliRunner, 'CliRunner should be exported');
  assert.ok(BlockchainClient, 'BlockchainClient should be exported');
  assert.ok(WalletConnector, 'WalletConnector should be exported');
  assert.ok(SimulationEngine, 'SimulationEngine should be exported');
  assert.ok(PendleRouterClient, 'PendleRouterClient should be exported');
  assert.ok(RolloverCommand, 'RolloverCommand should be exported');
  assert.ok(LeverageCommand, 'LeverageCommand should be exported');
  assert.ok(TransactionAuditor, 'TransactionAuditor should be exported');
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

  console.log('✅ CliRunner argument parsing options tests passed!');
}

// 3. Test Rollover Command Mock Execution
async function testRolloverCommandMock() {
  console.log('Testing RolloverCommand with mock clients...');
  const { RolloverCommand } = await import('../cli/rollover-command.js');
  
  const blockchain = new MockBlockchainClient();
  const router = new MockPendleRouterClient();
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
  const router = new MockPendleRouterClient();
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

// 5. Live Simulation integration tests (Only run if Alchemy API Key is available)
async function runLiveForkSimulationTests() {
  if (!apiKey) {
    console.log('⚠️ Skipping Live Mainnet Fork Simulation tests because ALCHEMY_API_KEY is not set.');
    return;
  }

  console.log('\n--- Running Live Mainnet Fork Simulation tests ---');
  const { BlockchainClient } = await import('../cli/blockchain-client.js');
  const { PendleRouterClient } = await import('../cli/pendle-router-client.js');
  const { SimulationEngine } = await import('../cli/simulation-engine.js');
  const { TransactionAuditor } = await import('../cli/transaction-auditor.js');
  const { RolloverCommand } = await import('../cli/rollover-command.js');
  const { LeverageCommand } = await import('../cli/leverage-command.js');

  const rpcUrl = `https://eth-mainnet.g.alchemy.com/v2/${apiKey}`;
  const blockchain = new BlockchainClient(rpcUrl, null);
  const router = new PendleRouterClient();
  const simulation = new SimulationEngine(blockchain, apiKey);
  const auditor = new TransactionAuditor(blockchain.publicClient);

  // Rollover simulation using old position holder (Full Rollover)
  const rolloverCmd = new RolloverCommand(blockchain, router, simulation, auditor);
  console.log('Simulating live full rollover collateral on Alchemy fork...');
  const fullRolloverResult = await rolloverCmd.execute({
    user: '0xE14f5DAab7E7fF2527F3B3cE582033e4A1Df8D0a',
    oldMarketId: '0xa75bb490ecfee90c86a9d22ebc2dde42fb83478b3f18722b9fc6f5f668cab124',
    newMarketId: '0xb37c30f34bff11c81ee8400133965f450a5f7c5d81ba2cf5740076f49eabc95c',
    type: 'full',
    slippage: 1.0,
    simulation: true
  });
  assert.strictEqual(fullRolloverResult.simulationResult.success, true, 'Full rollover simulation should succeed');

  // Rollover simulation using old position holder (Partial Rollover)
  console.log('Simulating live partial rollover collateral on Alchemy fork...');
  const partialRolloverResult = await rolloverCmd.execute({
    user: '0xE14f5DAab7E7fF2527F3B3cE582033e4A1Df8D0a',
    oldMarketId: '0xa75bb490ecfee90c86a9d22ebc2dde42fb83478b3f18722b9fc6f5f668cab124',
    newMarketId: '0xb37c30f34bff11c81ee8400133965f450a5f7c5d81ba2cf5740076f49eabc95c',
    type: 'partial',
    debt: 2,
    slippage: 1.0,
    simulation: true
  });
  assert.strictEqual(partialRolloverResult.simulationResult.success, true, 'Partial rollover simulation should succeed');

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
  assert.strictEqual(deleverageResult.simulationResult.success, true, 'Deleveraging simulation should succeed');

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
  assert.strictEqual(leverageUpResult.simulationResult.success, true, 'Leveraging up simulation should succeed');

  console.log('✅ Live Mainnet Fork Simulation tests passed successfully!');
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
  assert.strictEqual(collateralLabel, 'Collateral PT (PT-token)', 'Should resolve collateral token with market params');

  // Test dynamic symbol query
  const dynamicLabel = await resolver.resolveLabel('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
  assert.strictEqual(dynamicLabel, 'USDC', 'Should resolve USDC symbol dynamically from public client contract read');

  console.log('✅ CliFormatter and AddressLabelResolver tests passed!');
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
  
  const resolved = runner.resolveRpcUrl({});
  assert.strictEqual(resolved, 'https://eth-mainnet.g.alchemy.com/v2/mock_alchemy_key', 'Should fallback to Alchemy endpoint');
  
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

  // 1. Test: Full Rollover Simulation Shell Command
  const cmd1 = `node ${cliPath} rollover --old-market-id ${oldMarket} --new-market-id ${newMarket} --user ${user} --simulation`;
  console.log(`  Spawning: ${cmd1}`);
  const stdout1 = execSync(cmd1, { encoding: 'utf8' }).toLowerCase();
  
  assert.ok(stdout1.includes('morpho position rollover collateral'), 'Output should contain dashboard header');
  assert.ok(stdout1.includes('transaction simulation successful'), 'Output should verify simulation success');
  assert.ok(stdout1.includes('morpho bundler v3'), 'Output should resolve contract label in call trace');

  // 2. Test: Partial Rollover Simulation Shell Command
  const cmd2 = `node ${cliPath} rollover --old-market-id ${oldMarket} --new-market-id ${newMarket} --user ${user} --type partial --debt 2 --simulation`;
  console.log(`  Spawning: ${cmd2}`);
  const stdout2 = execSync(cmd2, { encoding: 'utf8' }).toLowerCase();
  
  assert.ok(stdout2.includes('migration plan (partial rollover)'), 'Output should indicate partial rollover');
  assert.ok(stdout2.includes('usdc repayment') && stdout2.includes('2.00 usdc'), 'Output should format repayment amount');
  assert.ok(stdout2.includes('transaction simulation successful'), 'Output should verify simulation success');

  // 3. Test: Leverage Adjustment Simulation Shell Command (Deleveraging)
  const cmd3 = `node ${cliPath} adjust-leverage --market-id ${oldMarket} --user ${user} --target-leverage 2.0 --simulation`;
  console.log(`  Spawning: ${cmd3}`);
  const stdout3 = execSync(cmd3, { encoding: 'utf8' }).toLowerCase();
  
  assert.ok(stdout3.includes('deleverage position'), 'Output should indicate Deleverage');
  assert.ok(stdout3.includes('transaction simulation successful'), 'Output should verify simulation success');

  // 4. Test: Validation constraint check (expected failure)
  const cmd4 = `node ${cliPath} rollover --private-key 0x123`;
  console.log(`  Spawning: ${cmd4} (Expecting error exit)`);
  assert.throws(() => {
    execSync(cmd4, { stdio: 'pipe' });
  }, /--private-key requires --rpc/, 'Should exit with code 1 and output constraint error');

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

    // 2. Test Rollover Help
    logs = [];
    await runner.run(['node', 'cli.js', 'rollover', '-h']);
    const rolloverHelpOutput = logs.join('\n').toLowerCase();
    assert.ok(rolloverHelpOutput.includes('rollover command help'), 'Rollover help should contain title');
    assert.ok(rolloverHelpOutput.includes('--old-market-id'), 'Rollover help should document --old-market-id');
    assert.ok(rolloverHelpOutput.includes('--new-market-id'), 'Rollover help should document --new-market-id');

    // 3. Test Leverage Help
    logs = [];
    await runner.run(['node', 'cli.js', 'adjust-leverage', '--help']);
    const leverageHelpOutput = logs.join('\n').toLowerCase();
    assert.ok(leverageHelpOutput.includes('adjust-leverage command help'), 'Leverage help should contain title');
    assert.ok(leverageHelpOutput.includes('--market-id'), 'Leverage help should document --market-id');
    assert.ok(leverageHelpOutput.includes('--target-leverage'), 'Leverage help should document --target-leverage');
  } finally {
    console.log = originalLog;
  }
  console.log('✅ CliRunner help printing execution tests passed!');
}

async function runAllTests() {
  try {
    await testImports();
    await testCliRunnerArgParsingOptions();
    await testCliHelpExecution();
    await testCliRunnerEnvAndRpcFallback();
    await testFormattingAndResolver();
    await testWalletConnectorQrCodeGeneration();
    await testRolloverCommandMock();
    await testLeverageCommandMock();
    await testCliShellExecutionSimulation();
    await runLiveForkSimulationTests();
    console.log('\n🎉 All CLI tests completed successfully!');
  } catch (err) {
    console.error('💥 Test suite execution failed:', err.message);
    process.exit(1);
  }
}

runAllTests();
