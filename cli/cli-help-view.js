/**
 * @fileoverview Formatter for CLI command help information.
 */

import { CliFormatter } from './formatter.js';

export class CliHelpView {
  /**
   * Prints detailed help documentation for the CLI tool or a specific command.
   *
   * @param {string|null} command
   */
  static printHelp(command) {
    if (command === 'rollover') {
      CliFormatter.printHeader('Morpho CLI: Rollover Command Help');
      console.log('  Migrates user collateral and loan debt from a source Morpho Blue market to a destination market.');

      CliFormatter.printSubHeader('Usage');
      console.log('  node cli.js rollover --old-market-id <id> --new-market-id <id> --user <address> [options]');

      CliFormatter.printSubHeader('Required Options');
      CliFormatter.printItem('--old-market-id <id>', 'Source Morpho Blue market hex ID.', 'cyan');
      CliFormatter.printItem('--new-market-id <id>', 'Destination Morpho Blue market hex ID.', 'cyan');
      CliFormatter.printItem('-u, --user <address>', 'Wallet address to fetch position for (Required in simulation mode).', 'cyan');

      CliFormatter.printSubHeader('Additional Options');
      CliFormatter.printItem('--type <full|partial>', "Migration type: 'full' or 'partial' (default: full).");
      CliFormatter.printItem('--debt <amount>', "Debt amount to repay (Required if type is 'partial').");
      CliFormatter.printItem('--slippage <pct>', 'Slippage limit percentage (default: 1.0).');
      CliFormatter.printItem('--cap-borrow', 'Caps new market borrow amount dynamically to keep Projected LTV below LLTV safety threshold.');

      CliFormatter.printSubHeader('Execution/Signing Flags');
      CliFormatter.printItem('-r, --rpc <url>', 'RPC provider URL (Required if using --private-key).');
      CliFormatter.printItem('-k, --private-key <hex>', 'Private key hex string to sign transactions locally (Requires --rpc).');
      CliFormatter.printItem('-w, --walletconnect', 'Initiates secure WalletConnect pairing session.');
      CliFormatter.printItem('-s, --simulation', 'Simulates transaction on a mainnet fork instead of submitting (Default if no signer).');
      CliFormatter.printItem('--no-simulation', 'Bypasses simulation and immediately submits transaction.');
      CliFormatter.printItem('-o, --save-simulation <path>', 'Saves the raw transaction data payload to a JSON file (Only with simulation).');
      CliFormatter.printItem('--debug', 'Enables verbose debug output including swap routing details, calldata, and full simulator responses.');

      CliFormatter.printSubHeader('Examples');
      console.log('  # Read-Only Mainnet Simulation (Default mode)');
      console.log('  node cli.js rollover \\');
      console.log('    --old-market-id 0xa75bb490ecfee90c86a9d22ebc2dde42fb83478b3f18722b9fc6f5f668cab124 \\');
      console.log('    --new-market-id 0xb37c30f34bff11c81ee8400133965f450a5f7c5d81ba2cf5740076f49eabc95c \\');
      console.log('    --user 0xdC382CDF2a25790F535a518EC26958c227e9DCF2 \\');
      console.log('    --simulation');
      console.log('\n  # Live Execution via WalletConnect');
      console.log('  node cli.js rollover \\');
      console.log('    --old-market-id 0xa75bb490ecfee90c86a9d22ebc2dde42fb83478b3f18722b9fc6f5f668cab124 \\');
      console.log('    --new-market-id 0xb37c30f34bff11c81ee8400133965f450a5f7c5d81ba2cf5740076f49eabc95c \\');
      console.log('    --walletconnect');
    } else if (command === 'adjust-leverage' || command === 'leverage') {
      CliFormatter.printHeader('Morpho CLI: Adjust-Leverage Command Help');
      console.log('  Adjusts leverage ratio on an active Morpho Blue market.');

      CliFormatter.printSubHeader('Usage');
      console.log('  node cli.js adjust-leverage --market-id <id> --target-leverage <num> --user <address> [options]');
      console.log('  (alias: node cli.js leverage ...)');

      CliFormatter.printSubHeader('Required Options');
      CliFormatter.printItem('--market-id <id>', 'Morpho Blue market hex ID.', 'cyan');
      CliFormatter.printItem('-l, --target-leverage <num>', 'Target leverage level between 1.0 (debt-free) and 6.0.', 'cyan');
      CliFormatter.printItem('-u, --user <address>', 'Wallet address to fetch position for (Required in simulation mode).', 'cyan');

      CliFormatter.printSubHeader('Additional Options');
      CliFormatter.printItem('--slippage <pct>', 'Slippage limit percentage (default: 1.0).');

      CliFormatter.printSubHeader('Execution/Signing Flags');
      CliFormatter.printItem('-r, --rpc <url>', 'RPC provider URL (Required if using --private-key).');
      CliFormatter.printItem('-k, --private-key <hex>', 'Private key hex string to sign transactions locally (Requires --rpc).');
      CliFormatter.printItem('-w, --walletconnect', 'Initiates secure WalletConnect pairing session.');
      CliFormatter.printItem('-s, --simulation', 'Simulates transaction on a mainnet fork instead of submitting (Default if no signer).');
      CliFormatter.printItem('--no-simulation', 'Bypasses simulation and immediately submits transaction.');
      CliFormatter.printItem('-o, --save-simulation <path>', 'Saves the raw transaction data payload to a JSON file (Only with simulation).');
      CliFormatter.printItem('--debug', 'Enables verbose debug output including swap routing details, calldata, and full simulator responses.');

      CliFormatter.printSubHeader('Examples');
      console.log('  # Deleverage Position via Mainnet Simulation');
      console.log('  node cli.js adjust-leverage \\');
      console.log('    --market-id 0xb37c30f34bff11c81ee8400133965f450a5f7c5d81ba2cf5740076f49eabc95c \\');
      console.log('    --target-leverage 2.0 \\');
      console.log('    --user 0xdC382CDF2a25790F535a518EC26958c227e9DCF2 \\');
      console.log('    --simulation');
      console.log('\n  # Increase Leverage via WalletConnect');
      console.log('  node cli.js adjust-leverage \\');
      console.log('    --market-id 0xb37c30f34bff11c81ee8400133965f450a5f7c5d81ba2cf5740076f49eabc95c \\');
      console.log('    --target-leverage 4.5 \\');
      console.log('    --walletconnect');
    } else if (command === 'simulate-raw') {
      CliFormatter.printHeader('Morpho CLI: Simulate-Raw Command Help');
      console.log('  Simulates a raw transaction from a JSON file on a mainnet fork using eth_simulateV1.');

      CliFormatter.printSubHeader('Usage');
      console.log('  node cli.js simulate-raw --file <path> [options]');

      CliFormatter.printSubHeader('Required Options');
      CliFormatter.printItem('-f, --file <path>', 'Path to the JSON file containing transaction details.', 'cyan');

      CliFormatter.printSubHeader('Additional Options');
      CliFormatter.printItem('-r, --rpc <url>', 'RPC provider URL (Falls back to Alchemy if key is present).');
      CliFormatter.printItem('--debug', 'Enables verbose debug output including swap routing details, calldata, and full simulator responses.');

      CliFormatter.printSubHeader('Examples');
      console.log('  # Simulate transaction from a JSON file');
      console.log('  node cli.js simulate-raw --file sample_tx.json');
    } else {
      CliFormatter.printHeader('Morpho Position Migrator CLI');
      console.log('  A modular, secure command-line interface tool for executing cross-market rollovers');
      console.log('  and adjusting leverage ratios for Principal Token (PT) positions on Morpho Blue.');

      CliFormatter.printSubHeader('Usage');
      console.log('  node cli.js <command> [options]');

      CliFormatter.printSubHeader('Available Commands');
      CliFormatter.printItem('rollover', 'Migrate user PT collateral and USDC debt from a source Morpho Blue market to a destination market.');
      CliFormatter.printItem('adjust-leverage', 'Adjust leverage ratio on an active Morpho Blue market (alias: leverage).');
      CliFormatter.printItem('simulate-raw', 'Simulate a raw transaction from a JSON file on a mainnet fork.');

      CliFormatter.printSubHeader('Global Options/Flags');
      CliFormatter.printItem('-r, --rpc <url>', 'RPC provider URL (Required if using --private-key).');
      CliFormatter.printItem('-k, --private-key <hex>', 'Private key hex string to sign transactions locally (Requires --rpc).');
      CliFormatter.printItem('-w, --walletconnect', 'Initiates secure WalletConnect pairing session.');
      CliFormatter.printItem('-s, --simulation', 'Simulates transaction on a mainnet fork instead of submitting (Default if no signer).');
      CliFormatter.printItem('--no-simulation', 'Bypasses simulation and immediately submits transaction.');
      CliFormatter.printItem('-o, --save-simulation <path>', 'Saves the raw transaction data payload to a JSON file (Only with simulation).');
      CliFormatter.printItem('--slippage <pct>', 'Slippage limit percentage (default: 1.0).');
      CliFormatter.printItem('--debug', 'Enables verbose debug output including swap routing details, calldata, and full simulator responses.');
      CliFormatter.printItem('-h, --help', 'Display help information for any command or general CLI usage.');

      CliFormatter.printSubHeader('Command Specific Help');
      console.log('  To view detailed options and examples for a specific command, run:');
      console.log('    node cli.js <command> --help');
      console.log('  For example:');
      console.log('    node cli.js rollover --help');
    }
    console.log();
  }
}
