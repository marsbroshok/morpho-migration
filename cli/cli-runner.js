import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAddress } from 'viem';
import config from '../config.js';
import { RolloverCommand } from './rollover-command.js';
import { LeverageCommand } from './leverage-command.js';
import { SimulateRawCommand } from './simulate-raw-command.js';
import { BlockchainClient } from './blockchain-client.js';
import { WalletConnector } from './wallet-connector.js';
import { SimulationEngine } from './simulation-engine.js';
import { TransactionAuditor } from './transaction-auditor.js';
import { SwapRouterClient } from './swap-router-client.js';
import { AddressLabelResolver } from './address-label-resolver.js';
import { CliView } from './cli-view.js';


/**
 * Main orchestrator class for CLI execution.
 */
export class CliRunner {
  constructor() {
    this.commands = ['rollover', 'adjust-leverage', 'leverage', 'simulate-raw'];
  }

  /**
   * Run the CLI tool.
   * @param {string[]} argv 
   */
  async run(argv) {
    try {
      this.loadEnv();
      const options = this.parseArgs(argv.slice(2));
      
      if (options.help) {
        CliView.printHelp(options.helpCommand);
        return;
      }
      
      // Determine wallet connection details
      let walletClient = null;
      const rpcUrl = this.resolveRpcUrl(options);
      
      // 1. Fetch current block number using a temporary lightweight provider first (only in simulation mode and if not already pinned)
      if (options.simulation && !process.env.FORK_BLOCK_NUMBER) {
        const tempClient = new BlockchainClient(rpcUrl, null);
        const currentBlockNumber = await tempClient.publicClient.getBlockNumber();
        process.env.FORK_BLOCK_NUMBER = currentBlockNumber.toString();
        console.log(`Pinning simulation and queries to block: ${currentBlockNumber}`);
      } else if (options.simulation && process.env.FORK_BLOCK_NUMBER) {
        console.log(`Using pre-defined pinned simulation block: ${process.env.FORK_BLOCK_NUMBER}`);
      }

      const alchemyKey = process.env.ALCHEMY_API_KEY || null;
      
      if (options.walletconnect) {
        console.log('Initializing WalletConnect connection...');
        // WalletConnect projectId from environment or a default public one
        const wcProjectId = process.env.WC_PROJECT_ID || '3fcc6b1f238b7d9c9a2c1f0b00000000'; // placeholder
        const connector = new WalletConnector(wcProjectId);
        await connector.initialize();
        await connector.connect();
        walletClient = connector.getWalletClient();
        console.log('WalletConnect connection established.');
      }

      // 2. Safely instantiate primary execution client with block environment pinned
      const blockchainClient = new BlockchainClient(rpcUrl, walletClient || options.privateKey);

      // Resolve signer address if signer is available
      if (blockchainClient.walletClient && !blockchainClient.userAddress) {
        const addresses = await blockchainClient.walletClient.getAddresses();
        if (addresses && addresses.length > 0) {
          blockchainClient.userAddress = getAddress(addresses[0]);
        }
      }

      if (blockchainClient.userAddress && options.user) {
        const signerAddr = blockchainClient.userAddress.toLowerCase();
        const userAddr = getAddress(options.user).toLowerCase();
        if (signerAddr !== userAddr) {
          throw new Error(`Signer address (${blockchainClient.userAddress}) does not match specified position user address (${options.user}). Transactions must be signed by the position owner due to address context requirements in the Morpho Blue Bundler multicall.`);
        }
      }
      const routerClient = new SwapRouterClient();
      const auditor = new TransactionAuditor(blockchainClient.publicClient);
      
      const simulationEngine = new SimulationEngine(blockchainClient, alchemyKey);

      // Initialize Label Resolver and View
      const labelResolver = new AddressLabelResolver(blockchainClient.publicClient);
      const view = new CliView(labelResolver);

      const MORPHO_BUNDLER_V3 = config.MORPHO_BUNDLER_V3;
      const ETHER_GENERAL_ADAPTER_1 = config.ETHER_GENERAL_ADAPTER_1;
      let commandResult = {
        simulationResult: null,
        txHash: null,
        auditDetails: null
      };
      let txType;
      let marketParams;
      let txData = null;

      if (options.command === 'rollover') {
        const cmd = new RolloverCommand(blockchainClient, routerClient, simulationEngine, auditor);
        txType = 'rollover';

        // Phase 1: Assessment
        const assessment = await cmd.assessPosition(options);
        marketParams = assessment.newMarket;
        await view.printRolloverAssessment(assessment);

        // Phase 2: Swap Routing Quote
        const swap = await cmd.fetchSwapRoute(assessment, options);
        view.printSwapRouting(swap, assessment.oldMarket, assessment.newMarket, assessment.sourceMarketParams, assessment.destMarketParams);

        // Phase 3: Calldata Generation
        const calldataResult = await cmd.compileCalldata(assessment, swap, options);
        view.printProjectedMetricsAndCalldata(calldataResult);

        commandResult = { ...calldataResult };

        // Phase 4: Execute/Simulate
        if (options.simulation) {
          commandResult.simulationResult = await cmd.runSimulation(calldataResult, options);
          if (options.saveSimulation) {
            const rawTx = {
              from: calldataResult.userAddress,
              to: MORPHO_BUNDLER_V3,
              data: calldataResult.finalCalldata,
              value: "0"
            };
            if (options.debug) {
              rawTx.debug = {
                swapRequests: routerClient.requests || [],
                rawCalldata: calldataResult.finalCalldata,
                alchemyResponse: commandResult.simulationResult?.rawResponse || null
              };
            }
            fs.writeFileSync(options.saveSimulation, JSON.stringify(rawTx, (key, val) => typeof val === 'bigint' ? `0x${val.toString(16)}` : val, 2), 'utf8');
            console.log(`Saved raw simulation payload to ${options.saveSimulation}`);
          }
        } else {
          // Check shortfall and approve if needed
          const shortfall = calldataResult.loanWalletShortfall || 0n;
          if (shortfall > 0n) {
            const token = assessment.sourceMarketParams.loanToken;
            const owner = blockchainClient.userAddress || (await blockchainClient.walletClient.getAddresses())[0];
            const spender = ETHER_GENERAL_ADAPTER_1;
            const PERMIT2_ADDRESS = config.PERMIT2_ADDRESS;
            
            const decimals = assessment.sourceMarketParams.loanDecimals;
            const shortfallDisplay = Number(shortfall) / (10 ** decimals);
            const symbol = assessment.oldMarket.loanSymbol;

            // 1. Check standard ERC20 allowance of the Permit2 contract
            const erc20Allowance = await blockchainClient.checkAllowance(token, owner, PERMIT2_ADDRESS);
            if (erc20Allowance < shortfall) {
              console.log(`\n⚠️  USDC allowance for Permit2 is insufficient (Current: ${Number(erc20Allowance) / (10 ** decimals)} ${symbol}, Needed: ${shortfallDisplay} ${symbol}).`);
              console.log(`🔑 Triggering standard ERC20 approval to Permit2 contract...`);
              const approveTxHash = await blockchainClient.approveToken(token, PERMIT2_ADDRESS, 2n ** 256n - 1n);
              console.log(`✅ Approved Permit2. Transaction Hash: ${approveTxHash}`);
            }

            // 2. Check Permit2 internal allowance for the Adapter
            const permit2Allowance = await blockchainClient.checkPermit2Allowance(token, owner, spender);
            if (permit2Allowance < shortfall) {
              console.log(`\n⚠️  Permit2 allowance for Morpho General Adapter is insufficient (Current: ${Number(permit2Allowance) / (10 ** decimals)} ${symbol}, Needed: ${shortfallDisplay} ${symbol}).`);
              console.log(`🔑 Triggering Permit2 approval to authorize the Adapter contract...`);
              const approveTxHash = await blockchainClient.approvePermit2(token, spender, 2n ** 160n - 1n);
              console.log(`✅ Authorized General Adapter inside Permit2. Transaction Hash: ${approveTxHash}`);
            }
          }


          commandResult.txHash = await blockchainClient.executeTransaction({
            to: MORPHO_BUNDLER_V3,
            data: calldataResult.finalCalldata,
            value: 0n
          });
          commandResult.auditDetails = {
            spentToken: assessment.sourceCollateralAddress,
            receivedToken: assessment.destCollateralAddress,
            oracleRate: swap.oracleRate,
            estimatedRate: swap.expectedRate,
            estimatedPriceImpact: swap.priceImpact
          };
        }

      } else if (options.command === 'adjust-leverage' || options.command === 'leverage') {
        const cmd = new LeverageCommand(blockchainClient, routerClient, simulationEngine, auditor);
        txType = 'leverage';

        // Phase 1: Assessment
        const assessment = await cmd.assessPosition(options);
        marketParams = assessment.market;

        // Phase 2: Swap Routing Quote (updates assessment params in-place with final values)
        const swap = await cmd.fetchSwapRoute(assessment, options);
        
        await view.printLeverageAssessment(assessment);
        view.printLeverageSwapRouting(swap, assessment.mode === 'leverage-up', assessment.market, assessment.marketParams);

        // Phase 3: Calldata Generation
        const calldataResult = await cmd.compileCalldata(assessment, swap, options);
        view.printLeverageCalldataSteps(calldataResult);

        commandResult = { ...calldataResult };

        // Phase 4: Execute/Simulate
        if (options.simulation) {
          commandResult.simulationResult = await cmd.runSimulation(calldataResult, options);
          if (options.saveSimulation) {
            const rawTx = {
              from: calldataResult.userAddress,
              to: MORPHO_BUNDLER_V3,
              data: calldataResult.finalCalldata,
              value: "0"
            };
            if (options.debug) {
              rawTx.debug = {
                swapRequests: routerClient.requests || [],
                rawCalldata: calldataResult.finalCalldata,
                alchemyResponse: commandResult.simulationResult?.rawResponse || null
              };
            }
            fs.writeFileSync(options.saveSimulation, JSON.stringify(rawTx, (key, val) => typeof val === 'bigint' ? `0x${val.toString(16)}` : val, 2), 'utf8');
            console.log(`Saved raw simulation payload to ${options.saveSimulation}`);
          }
        } else {
          // Check allowances if there is shortfall
          const shortfall = calldataResult.walletShortfall || 0n;
          if (shortfall > 0n) {
            const token = assessment.loanAddress;
            const owner = blockchainClient.userAddress || (await blockchainClient.walletClient.getAddresses())[0];
            const spender = ETHER_GENERAL_ADAPTER_1;
            const PERMIT2_ADDRESS = config.PERMIT2_ADDRESS;
            
            const decimals = assessment.market.loanDecimals;
            const shortfallDisplay = Number(shortfall) / (10 ** decimals);
            const symbol = assessment.market.loanSymbol;

            // 1. Check standard ERC20 allowance of the Permit2 contract
            const erc20Allowance = await blockchainClient.checkAllowance(token, owner, PERMIT2_ADDRESS);
            if (erc20Allowance < shortfall) {
              console.log(`\n⚠️  ${symbol} allowance for Permit2 is insufficient (Current: ${Number(erc20Allowance) / (10 ** decimals)} ${symbol}, Needed: ${shortfallDisplay} ${symbol}).`);
              console.log(`🔑 Triggering standard ERC20 approval to Permit2 contract...`);
              const approveTxHash = await blockchainClient.approveToken(token, PERMIT2_ADDRESS, 2n ** 256n - 1n);
              console.log(`✅ Approved Permit2. Transaction Hash: ${approveTxHash}`);
            }

            // 2. Check Permit2 internal allowance for the Adapter
            const permit2Allowance = await blockchainClient.checkPermit2Allowance(token, owner, spender);
            if (permit2Allowance < shortfall) {
              console.log(`\n⚠️  Permit2 allowance for Morpho General Adapter is insufficient (Current: ${Number(permit2Allowance) / (10 ** decimals)} ${symbol}, Needed: ${shortfallDisplay} ${symbol}).`);
              console.log(`🔑 Triggering Permit2 approval to authorize the Adapter contract...`);
              const approveTxHash = await blockchainClient.approvePermit2(token, spender, 2n ** 160n - 1n);
              console.log(`✅ Authorized General Adapter inside Permit2. Transaction Hash: ${approveTxHash}`);
            }
          }

          commandResult.txHash = await blockchainClient.executeTransaction({
            to: MORPHO_BUNDLER_V3,
            data: calldataResult.finalCalldata,
            value: 0n
          });
          const isLeverageUp = (assessment.params.mode === 'leverage-up');
          commandResult.auditDetails = {
            spentToken: isLeverageUp ? assessment.loanAddress : assessment.collateralAddress,
            receivedToken: isLeverageUp ? assessment.collateralAddress : assessment.loanAddress,
            spentDecimals: isLeverageUp ? assessment.marketParams.loanDecimals : assessment.marketParams.collateralDecimals,
            receivedDecimals: isLeverageUp ? assessment.marketParams.collateralDecimals : assessment.marketParams.loanDecimals,
            spentSymbol: isLeverageUp ? assessment.market.loanSymbol : assessment.market.collateralSymbol,
            receivedSymbol: isLeverageUp ? assessment.market.collateralSymbol : assessment.market.loanSymbol,
            oracleRate: swap.oracleRate,
            estimatedRate: swap.expectedRate,
            estimatedPriceImpact: swap.priceImpact,
            isLeverageUp
          };
        }
      } else if (options.command === 'simulate-raw') {
        const cmd = new SimulateRawCommand(blockchainClient, simulationEngine);
        txType = 'simulate-raw';

        txData = cmd.loadTransactionData(options.file);
        view.printRawSimulationAssessment(txData);

        commandResult.simulationResult = await cmd.runSimulation(txData);
      }

      // Render Simulation Result if simulated
      if (commandResult.simulationResult) {
        await view.printSimulationSummary(commandResult.simulationResult, marketParams);
      }

      // Render Real Transaction Details and Audit
      if (commandResult.txHash) {
        view.printTransactionSubmitted(commandResult.txHash);
        const auditResult = await auditor.auditRealizedPrice(commandResult.txHash, txType, commandResult.auditDetails);
        view.printPostExecutionAudit(txType, auditResult);
      }

      // Render Debug Info if flag is active
      if (options.debug) {
        const debugInfo = {
          swapRequests: routerClient.requests || [],
          rawCalldata: commandResult.finalCalldata || txData?.data || null,
          alchemyResponse: commandResult.simulationResult?.rawResponse || null
        };
        view.printDebugData(debugInfo);
      }
      process.exit(0);
    } catch (err) {
      if (process.argv.includes('--debug')) {
        console.error(err);
      } else {
        console.error(`Error: ${err.message}`);
      }
      process.exit(1);
    }
  }

  /**
   * Parses raw command line arguments.
   * @param {string[]} args 
   * @returns {object} options
   */
  parseArgs(args) {
    if (args.includes('--help') || args.includes('-h')) {
      const helpCommand = args.find(arg => this.commands.includes(arg));
      return {
        help: true,
        helpCommand: helpCommand || null
      };
    }

    if (args.length === 0) {
      throw new Error('No command specified. Available commands: rollover, adjust-leverage. Use --help for usage.');
    }

    const command = args[0];
    if (!this.commands.includes(command)) {
      throw new Error(`Unknown command "${command}". Available commands: rollover, adjust-leverage, simulate-raw. Use --help for usage.`);
    }

    const options = {
      command,
      simulation: false, // Default is execute immediately
      walletconnect: false,
      slippage: 1.0,
      type: 'full',
      debug: false
    };

    // Manual arguments parser loop
    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--old-market-id') {
        options.oldMarketId = args[++i];
      } else if (arg === '--new-market-id') {
        options.newMarketId = args[++i];
      } else if (arg === '--market-id') {
        options.marketId = args[++i];
      } else if (arg === '--user' || arg === '-u') {
        options.user = args[++i];
      } else if (arg === '--rpc' || arg === '-r') {
        options.rpc = args[++i];
      } else if (arg === '--private-key' || arg === '-k') {
        options.privateKey = args[++i];
      } else if (arg === '--walletconnect' || arg === '-w') {
        options.walletconnect = true;
      } else if (arg === '--simulation' || arg === '-s') {
        options.simulation = true;
      } else if (arg === '--no-simulation') {
        options.simulation = false;
        options.explicitNoSimulation = true;
      } else if (arg === '--type') {
        options.type = args[++i];
      } else if (arg === '--debt') {
        options.debt = parseFloat(args[++i]);
      } else if (arg === '--slippage') {
        options.slippage = parseFloat(args[++i]);
      } else if (arg === '--cap-borrow') {
        options.capBorrow = true;
      } else if (arg === '--target-leverage' || arg === '-l') {
        options.targetLeverage = parseFloat(args[++i]);
      } else if (arg === '--save-simulation' || arg === '-o') {
        options.saveSimulation = args[++i];
      } else if (arg === '--file' || arg === '-f') {
        options.file = args[++i];
      } else if (arg === '--debug') {
        options.debug = true;
      } else {
        throw new Error(`Unknown option "${arg}"`);
      }
    }


    // Command specific validation
    if (options.command === 'simulate-raw') {
      if (!options.file) {
        throw new Error('--file <path> is required for simulate-raw command');
      }
      options.simulation = true;
    }

    // Linked flags validation: --private-key requires --rpc.
    if (options.privateKey && !options.rpc) {
      throw new Error('--private-key requires --rpc');
    }

    // Safety check for simulation saving
    if (options.saveSimulation) {
      if (options.explicitNoSimulation) {
        throw new Error('Cannot use --save-simulation when simulation is disabled (--no-simulation)');
      }
      options.simulation = true; // Auto-enable simulation if save option is present
    }

    // If neither execution mode is selected, default to simulation = true
    if (!options.privateKey && !options.walletconnect) {
      options.simulation = true;
    }

    return options;
  }

  /**
   * Resolve RPC URL from options or environment, falling back to Alchemy if key is present.
   */
  resolveRpcUrl(options) {
    let rpcUrl = options.rpc || process.env.RPC_URL || null;
    const alchemyKey = process.env.ALCHEMY_API_KEY || null;

    if (!rpcUrl) {
      if (options.simulation) {
        if (alchemyKey) {
          rpcUrl = `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`;
        }
      } else {
        // MEV-Blocker for mainnet (default/empty or CHAIN_ID=1), fallback otherwise
        const chainId = process.env.CHAIN_ID || '1';
        rpcUrl = chainId === '1' ? 'https://rpc.mevblocker.io' : (process.env.RPC_URL || 'https://cloudflare-eth.com');
      }
    }
    return rpcUrl;
  }

  /**
   * Load environment variables from .env file at repository root.
   */
  loadEnv() {
    try {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const envPath = path.resolve(__dirname, '../.env');
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const lines = envContent.split('\n');
        for (const line of lines) {
          const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
          if (match) {
            const key = match[1];
            let val = match[2] || '';
            if (val.startsWith('"') && val.endsWith('"')) {
              val = val.slice(1, -1);
            } else if (val.startsWith("'") && val.endsWith("'")) {
              val = val.slice(1, -1);
            }
            if (!process.env[key]) {
              process.env[key] = val.trim();
            }
          }
        }
      }
    } catch (err) {
      // Ignore env read failures
    }
  }
}
