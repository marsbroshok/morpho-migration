import { CliFormatter } from './formatter.js';

export class CliView {
  /**
   * @param {AddressLabelResolver} labelResolver
   */
  constructor(labelResolver) {
    this.labelResolver = labelResolver;
  }

  /**
   * Prints the Rollover command pre-execution dashboard.
   * @param {object} data
   */
  /**
   * Prints the Rollover command pre-execution dashboard.
   * @param {object} data
   */
  printRolloverDashboard(data) {
    this.printRolloverAssessment(data);
    this.printSwapRouting(data.swap);
    this.printProjectedMetricsAndCalldata(data);
  }

  /**
   * Prints the Rollover configuration and position assessment (Immediate).
   */
  printRolloverAssessment(data) {
    CliFormatter.printHeader('Morpho Position Rollover Collateral');
    CliFormatter.printItem('User Address', data.userAddress, 'cyan');
    CliFormatter.printItem('Execution Mode', data.simulation ? 'Simulation (Fork Dry-Run)' : 'Live Submission', 'cyan');
    CliFormatter.printItem('Slippage Tolerance', `${data.slippage}%`);

    CliFormatter.printSubHeader('1. Market Configurations');
    console.log(`  Source Market : ${data.oldMarketId}`);
    console.log(`  ├── Collateral : ${data.oldMarket.collateralSymbol} (${data.oldMarket.collateralToken})`);
    console.log(`  └── Loan Asset : ${data.oldMarket.loanSymbol} (${data.oldMarket.loanToken})`);

    console.log(`\n  Target Market : ${data.newMarketId}`);
    console.log(`  ├── Collateral : ${data.newMarket.collateralSymbol} (${data.newMarket.collateralToken})`);
    console.log(`  └── Loan Asset : ${data.newMarket.loanSymbol} (${data.newMarket.loanToken})`);

    CliFormatter.printSubHeader('2. Position Assessment');
    const oldMaturityStr = `Expired: ${data.maturity.isExpired} (Maturity Date: ${data.maturity.expiryDate})`;
    CliFormatter.printItem('Old PT Maturity', oldMaturityStr, data.maturity.isExpired ? 'yellow' : 'reset');
    CliFormatter.printItem('Collateral Balance', `${CliFormatter.formatAmount(data.position.collateral)} PT-old`);
    CliFormatter.printItem('Borrowed Debt', `${CliFormatter.formatAmount(data.position.debt, 6, 2)} USDC`);
    
    console.log(`\n  Migration Plan (${data.type.toUpperCase()} ROLLOVER):`);
    CliFormatter.printItem('USDC Repayment', `${CliFormatter.formatAmount(data.debtAmount, 6, 2)} USDC`);
    CliFormatter.printItem('PT-old Migrated', `${CliFormatter.formatAmount(data.collateralAmount)} PT-old`);
  }

  /**
   * Prints the Swap Routing details from Pendle.
   */
  printSwapRouting(swap) {
    CliFormatter.printSubHeader('3. Swap Routing (Pendle)');
    CliFormatter.printItem('Swap Path', 'PT-old ➔ USDC ➔ PT-new');
    CliFormatter.printItem('Expected Rate', `1 PT-old = ${swap.expectedRate.toFixed(4)} PT-new`);
    CliFormatter.printItem('Oracle Rate', `1 PT-old = ${swap.oracleRate.toFixed(4)} PT-new`);
    CliFormatter.printItem('Price Impact', `${swap.priceImpact.toFixed(2)}%`, swap.priceImpact > 2.0 ? 'yellow' : 'green');
    CliFormatter.printItem('Expected Output', `${CliFormatter.formatAmount(swap.expectedOutput)} PT-new`);
  }

  /**
   * Prints the projected metrics and decoded bundle steps.
   */
  printProjectedMetricsAndCalldata(data) {
    CliFormatter.printSubHeader('4. Projected Target Metrics');
    CliFormatter.printItem('Simulated Collateral', `${CliFormatter.formatAmount(data.swap.expectedOutput)} PT-new`);
    CliFormatter.printItem('Simulated New Debt', `${CliFormatter.formatAmount(data.simulatedNewDebt, 6, 2)} USDC`);
    CliFormatter.printItem('Projected LTV', `${data.newLtv.toFixed(2)}% (Leverage: ${data.newLeverage})`);

    CliFormatter.printSubHeader('5. Decoded Callback Bundle Steps');
    data.steps.forEach((step, idx) => {
      console.log(`  ├── ${idx + 1}. ${step}`);
    });
    
    if (data.finalCalldata) {
      console.log(`\n  ${CliFormatter.color('Raw Multicall Calldata Payload:', 'gray')}`);
      console.log(data.finalCalldata);
    }
  }

  /**
   * Prints the Leverage command pre-execution dashboard.
   * @param {object} data
   */
  printLeverageDashboard(data) {
    this.printLeverageAssessment(data);
    this.printLeverageSwapRouting(data.swap, data.mode === 'leverage-up');
    this.printLeverageCalldataSteps(data);
  }

  /**
   * Prints the leverage position assessment details (Immediate).
   */
  printLeverageAssessment(data) {
    const isLeverageUp = data.mode === 'leverage-up';
    CliFormatter.printHeader(isLeverageUp ? 'Increase Leverage Position' : 'Deleverage Position');
    CliFormatter.printItem('User Address', data.userAddress, 'cyan');
    CliFormatter.printItem('Execution Mode', data.simulation ? 'Simulation (Fork Dry-Run)' : 'Live Submission', 'cyan');
    CliFormatter.printItem('Slippage Tolerance', `${data.slippage}%`);

    CliFormatter.printSubHeader('1. Market Configuration');
    console.log(`  Market ID    : ${data.marketId}`);
    console.log(`  ├── Collateral : ${data.market.collateralSymbol} (${data.market.collateralToken})`);
    console.log(`  └── Loan Asset : ${data.market.loanSymbol} (${data.market.loanToken})`);

    CliFormatter.printSubHeader('2. Position Assessment');
    const maturityStr = `Expired: ${data.maturity.isExpired} (Maturity Date: ${data.maturity.expiryDate})`;
    CliFormatter.printItem('PT Maturity', maturityStr, data.maturity.isExpired ? 'yellow' : 'reset');
    CliFormatter.printItem('Collateral Balance', `${CliFormatter.formatAmount(data.position.collateral)} PT`);
    CliFormatter.printItem('Borrowed Debt', `${CliFormatter.formatAmount(data.position.debt, 6, 2)} USDC`);

    console.log(`\n  Leverage Target Solver:`);
    CliFormatter.printItem('Adjustment Mode', data.mode.toUpperCase(), 'magenta');
    CliFormatter.printItem('Collateral Adjustment', `${CliFormatter.formatAmount(data.collateralAdjustment)} PT`);
    CliFormatter.printItem('Debt Adjustment', `${CliFormatter.formatAmount(data.debtAdjustment, 6, 2)} USDC`);
  }

  /**
   * Prints swap routing for leverage command.
   */
  printLeverageSwapRouting(swap, isLeverageUp) {
    CliFormatter.printSubHeader('3. Swap Routing (Pendle)');
    const pathStr = isLeverageUp ? 'USDC ➔ PT' : 'PT ➔ USDC';
    CliFormatter.printItem('Swap Path', pathStr);
    CliFormatter.printItem('Expected Swap Price', `1 PT = ${swap.expectedRate.toFixed(4)} USDC`);
    CliFormatter.printItem('Oracle Price', `1 PT = ${swap.oracleRate.toFixed(4)} USDC`);
    CliFormatter.printItem('Price Impact', `${swap.priceImpact.toFixed(2)}%`, swap.priceImpact > 2.0 ? 'yellow' : 'green');
    CliFormatter.printItem('Expected Output', isLeverageUp ? `${CliFormatter.formatAmount(swap.expectedOutput)} PT` : `${CliFormatter.formatAmount(swap.expectedOutput, 6, 2)} USDC`);
  }

  /**
   * Prints calldata steps and projected leverage target metrics.
   */
  printLeverageCalldataSteps(data) {
    CliFormatter.printSubHeader('4. Projected Target Metrics');
    CliFormatter.printItem('Target Leverage', `${data.targetLeverage.toFixed(2)}x (LTV: ${(1.0 - 1.0/data.targetLeverage)*100}%)`);

    CliFormatter.printSubHeader('5. Decoded Callback Bundle Steps');
    data.steps.forEach((step, idx) => {
      console.log(`  ├── ${idx + 1}. ${step}`);
    });

    if (data.finalCalldata) {
      console.log(`\n  ${CliFormatter.color('Raw Multicall Calldata Payload:', 'gray')}`);
      console.log(data.finalCalldata);
    }
  }

  /**
   * Recursively print call traces in the console with resolved address labels.
   * @param {object} call
   * @param {number} depth
   * @param {object} [marketParams]
   */
  async printCallTrace(call, depth = 0, marketParams = null) {
    const indent = '  '.repeat(depth);
    const toAddress = call.to || 'Unknown';
    const label = await this.labelResolver.resolveLabel(toAddress, marketParams);
    
    const targetDisplay = label 
      ? `${CliFormatter.color(label, 'cyan')} [${CliFormatter.color(toAddress, 'gray')}]`
      : CliFormatter.color(toAddress, 'gray');

    const status = call.status === '0x1' 
      ? CliFormatter.color('SUCCESS', 'green') 
      : CliFormatter.color('REVERT', 'red');

    const valueStr = call.value ? BigInt(call.value).toString() : '0';
    const gas = parseInt(call.gasUsed, 16);
    console.log(`${indent}└── [CALL] To: ${targetDisplay} | Value: ${valueStr} | Status: ${status} | Gas: ${gas.toLocaleString()}`);

    if (call.error) {
      console.log(`${indent}    ${CliFormatter.color('⚠ Error: ' + call.error.message, 'red')}`);
    }

    if (call.calls && Array.isArray(call.calls)) {
      for (const subcall of call.calls) {
        await this.printCallTrace(subcall, depth + 1, marketParams);
      }
    }
  }

  /**
   * Render simulated execution summary block.
   * @param {object} simResult
   * @param {object} [marketParams]
   */
  async printSimulationSummary(simResult, marketParams = null) {
    CliFormatter.printSubHeader('6. Mainnet Fork Simulation Result');
    if (!simResult.success) {
      console.log(`  ${CliFormatter.color('❌ TRANSACTION SIMULATION REVERTED!', 'red')}`);
      if (simResult.error) {
        console.log(`  ${CliFormatter.color('Revert Reason: ' + (simResult.error.message || JSON.stringify(simResult.error)), 'red')}`);
      }
    } else {
      console.log(`  ${CliFormatter.color('✅ TRANSACTION SIMULATION SUCCESSFUL!', 'green')}`);
      CliFormatter.printItem('Gas Used', simResult.gasUsed.toLocaleString());
      // Estimate cost at 15 gwei base fee
      const ethCost = Number(simResult.gasUsed) * 15 / 1e9;
      CliFormatter.printItem('Est. Net Cost', `${ethCost.toFixed(6)} ETH`);
    }

    if (simResult.traceTree) {
      console.log(`\n  ${CliFormatter.color('Simulation Call Trace:', 'bold')}`);
      await this.printCallTrace(simResult.traceTree, 1, marketParams);
    }
  }

  /**
   * Render real transaction submission confirmation.
   * @param {string} txHash
   */
  printTransactionSubmitted(txHash) {
    CliFormatter.printSubHeader('6. Transaction Submission');
    console.log(`  ${CliFormatter.color('🚀 Transaction submitted successfully!', 'green')}`);
    CliFormatter.printItem('Transaction Hash', txHash, 'cyan');
    console.log(`  Waiting for block confirmations...`);
  }

  /**
   * Print post-execution audit results.
   * @param {string} txType
   * @param {object} audit
   */
  printPostExecutionAudit(txType, audit) {
    CliFormatter.printSubHeader('Post-Execution Audit');
    if (audit.error) {
      console.log(`  ${CliFormatter.color('⚠ Audit Warning: ' + audit.error, 'yellow')}`);
      return;
    }

    if (txType === 'rollover') {
      CliFormatter.printItem('Realized Swap Rate', `1 PT-old = ${audit.realizedRate.toFixed(4)} PT-new`);
      CliFormatter.printItem('Estimated Swap Rate', `${audit.estimatedRate.toFixed(4)} PT-new`, 'gray');
      if (audit.realizedPriceImpact !== undefined) {
        CliFormatter.printItem('Realized Price Impact', `${audit.realizedPriceImpact.toFixed(2)}% (vs. Oracle)`);
        CliFormatter.printItem('Estimated Price Impact', `${audit.estimatedPriceImpact.toFixed(2)}%`, 'gray');
      }
      console.log(`  ${CliFormatter.color(`(Verified: spent ${CliFormatter.formatAmount(audit.spentAmount)} PT-old, received ${CliFormatter.formatAmount(audit.receivedAmount)} PT-new)`, 'gray')}`);
    } else {
      CliFormatter.printItem('Realized Exchange Rate', `1 PT = ${audit.realizedRate.toFixed(4)} USDC`);
      CliFormatter.printItem('Estimated Rate', `${audit.estimatedRate.toFixed(4)} USDC`, 'gray');
      if (audit.realizedPriceImpact !== undefined) {
        CliFormatter.printItem('Realized Price Impact', `${audit.realizedPriceImpact.toFixed(2)}% (vs. Oracle)`);
        CliFormatter.printItem('Estimated Price Impact', `${audit.estimatedPriceImpact.toFixed(2)}%`, 'gray');
      }
      if (audit.isLeverageUp) {
        console.log(`  ${CliFormatter.color(`(Verified: spent ${CliFormatter.formatAmount(audit.spentAmount, 6, 2)} USDC, received ${CliFormatter.formatAmount(audit.receivedAmount)} PT)`, 'gray')}`);
      } else {
        console.log(`  ${CliFormatter.color(`(Verified: spent ${CliFormatter.formatAmount(audit.spentAmount)} PT, received ${CliFormatter.formatAmount(audit.receivedAmount, 6, 2)} USDC)`, 'gray')}`);
      }
    }
  }

  /**
   * Prints detailed help documentation for the CLI tool or a specific command.
   * @param {string|null} command 
   */
  static printHelp(command) {
    if (command === 'rollover') {
      CliFormatter.printHeader('Morpho CLI: Rollover Command Help');
      console.log(`  Migrates user PT collateral and USDC debt from a source Morpho Blue market to a destination market.`);
      
      CliFormatter.printSubHeader('Usage');
      console.log(`  node cli.js rollover --old-market-id <id> --new-market-id <id> --user <address> [options]`);
      
      CliFormatter.printSubHeader('Required Options');
      CliFormatter.printItem('--old-market-id <id>', 'Source Morpho Blue market hex ID.', 'cyan');
      CliFormatter.printItem('--new-market-id <id>', 'Destination Morpho Blue market hex ID.', 'cyan');
      CliFormatter.printItem('-u, --user <address>', 'Wallet address to fetch position for (Required in simulation mode).', 'cyan');
      
      CliFormatter.printSubHeader('Additional Options');
      CliFormatter.printItem('--type <full|partial>', 'Migration type: \'full\' or \'partial\' (default: full).');
      CliFormatter.printItem('--debt <amount>', 'USDC debt amount to repay (Required if type is \'partial\').');
      CliFormatter.printItem('--old-pt <address>', 'Source PT Token address (fetched dynamically from market params if omitted).');
      CliFormatter.printItem('--new-pt <address>', 'Destination PT Token address (fetched dynamically from market params if omitted).');
      CliFormatter.printItem('--slippage <pct>', 'Slippage limit percentage (default: 1.0).');
      CliFormatter.printItem('--usdc <address>', 'Custom USDC address (default: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48).');
      
      CliFormatter.printSubHeader('Execution/Signing Flags');
      CliFormatter.printItem('-r, --rpc <url>', 'RPC provider URL (Required if using --private-key).');
      CliFormatter.printItem('-k, --private-key <hex>', 'Private key hex string to sign transactions locally (Requires --rpc).');
      CliFormatter.printItem('-w, --walletconnect', 'Initiates secure WalletConnect pairing session.');
      CliFormatter.printItem('-s, --simulation', 'Simulates transaction on a mainnet fork instead of submitting (Default if no signer).');
      CliFormatter.printItem('--no-simulation', 'Bypasses simulation and immediately submits transaction.');

      CliFormatter.printSubHeader('Examples');
      console.log(`  # Read-Only Mainnet Simulation (Default mode)`);
      console.log(`  node cli.js rollover \\`);
      console.log(`    --old-market-id 0xa75bb490ecfee90c86a9d22ebc2dde42fb83478b3f18722b9fc6f5f668cab124 \\`);
      console.log(`    --new-market-id 0xb37c30f34bff11c81ee8400133965f450a5f7c5d81ba2cf5740076f49eabc95c \\`);
      console.log(`    --user 0xdC382CDF2a25790F535a518EC26958c227e9DCF2 \\`);
      console.log(`    --simulation`);
      console.log(`\n  # Live Execution via WalletConnect`);
      console.log(`  node cli.js rollover \\`);
      console.log(`    --old-market-id 0xa75bb490ecfee90c86a9d22ebc2dde42fb83478b3f18722b9fc6f5f668cab124 \\`);
      console.log(`    --new-market-id 0xb37c30f34bff11c81ee8400133965f450a5f7c5d81ba2cf5740076f49eabc95c \\`);
      console.log(`    --walletconnect`);
    } else if (command === 'adjust-leverage' || command === 'leverage') {
      CliFormatter.printHeader('Morpho CLI: Adjust-Leverage Command Help');
      console.log(`  Adjusts leverage ratio on an active Morpho Blue market.`);
      
      CliFormatter.printSubHeader('Usage');
      console.log(`  node cli.js adjust-leverage --market-id <id> --target-leverage <num> --user <address> [options]`);
      console.log(`  (alias: node cli.js leverage ...)`);
      
      CliFormatter.printSubHeader('Required Options');
      CliFormatter.printItem('--market-id <id>', 'Morpho Blue market hex ID.', 'cyan');
      CliFormatter.printItem('-l, --target-leverage <num>', 'Target leverage level between 1.0 (debt-free) and 6.0.', 'cyan');
      CliFormatter.printItem('-u, --user <address>', 'Wallet address to fetch position for (Required in simulation mode).', 'cyan');
      
      CliFormatter.printSubHeader('Additional Options');
      CliFormatter.printItem('--pt <address>', 'PT Token address (fetched dynamically from market params if omitted).');
      CliFormatter.printItem('--slippage <pct>', 'Slippage limit percentage (default: 1.0).');
      CliFormatter.printItem('--usdc <address>', 'Custom USDC address (default: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48).');
      
      CliFormatter.printSubHeader('Execution/Signing Flags');
      CliFormatter.printItem('-r, --rpc <url>', 'RPC provider URL (Required if using --private-key).');
      CliFormatter.printItem('-k, --private-key <hex>', 'Private key hex string to sign transactions locally (Requires --rpc).');
      CliFormatter.printItem('-w, --walletconnect', 'Initiates secure WalletConnect pairing session.');
      CliFormatter.printItem('-s, --simulation', 'Simulates transaction on a mainnet fork instead of submitting (Default if no signer).');
      CliFormatter.printItem('--no-simulation', 'Bypasses simulation and immediately submits transaction.');

      CliFormatter.printSubHeader('Examples');
      console.log(`  # Deleverage Position via Mainnet Simulation`);
      console.log(`  node cli.js adjust-leverage \\`);
      console.log(`    --market-id 0xb37c30f34bff11c81ee8400133965f450a5f7c5d81ba2cf5740076f49eabc95c \\`);
      console.log(`    --target-leverage 2.0 \\`);
      console.log(`    --user 0xdC382CDF2a25790F535a518EC26958c227e9DCF2 \\`);
      console.log(`    --simulation`);
      console.log(`\n  # Increase Leverage via WalletConnect`);
      console.log(`  node cli.js adjust-leverage \\`);
      console.log(`    --market-id 0xb37c30f34bff11c81ee8400133965f450a5f7c5d81ba2cf5740076f49eabc95c \\`);
      console.log(`    --target-leverage 4.5 \\`);
      console.log(`    --walletconnect`);
    } else {
      CliFormatter.printHeader('Morpho Position Migrator CLI');
      console.log(`  A modular, secure command-line interface tool for executing cross-market rollovers`);
      console.log(`  and adjusting leverage ratios for Principal Token (PT) positions on Morpho Blue.`);
      
      CliFormatter.printSubHeader('Usage');
      console.log(`  node cli.js <command> [options]`);
      
      CliFormatter.printSubHeader('Available Commands');
      CliFormatter.printItem('rollover', 'Migrate user PT collateral and USDC debt from a source Morpho Blue market to a destination market.');
      CliFormatter.printItem('adjust-leverage', 'Adjust leverage ratio on an active Morpho Blue market (alias: leverage).');
      
      CliFormatter.printSubHeader('Global Options/Flags');
      CliFormatter.printItem('-r, --rpc <url>', 'RPC provider URL (Required if using --private-key).');
      CliFormatter.printItem('-k, --private-key <hex>', 'Private key hex string to sign transactions locally (Requires --rpc).');
      CliFormatter.printItem('-w, --walletconnect', 'Initiates secure WalletConnect pairing session.');
      CliFormatter.printItem('-s, --simulation', 'Simulates transaction on a mainnet fork instead of submitting (Default if no signer).');
      CliFormatter.printItem('--no-simulation', 'Bypasses simulation and immediately submits transaction.');
      CliFormatter.printItem('--slippage <pct>', 'Slippage limit percentage (default: 1.0).');
      CliFormatter.printItem('--usdc <address>', 'Custom USDC address (default: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48).');
      CliFormatter.printItem('-h, --help', 'Display help information for any command or general CLI usage.');

      CliFormatter.printSubHeader('Command Specific Help');
      console.log(`  To view detailed options and examples for a specific command, run:`);
      console.log(`    node cli.js <command> --help`);
      console.log(`  For example:`);
      console.log(`    node cli.js rollover --help`);
    }
    console.log();
  }
}
