/**
 * @fileoverview Command line arguments parser for the Morpho CLI runner.
 */

export class CliArgParser {
  /**
   * Parses CLI argument vector into structured options object.
   *
   * @param {string[]} args
   * @param {string[]} [commands=['rollover', 'adjust-leverage', 'leverage', 'simulate-raw']]
   * @returns {object}
   */
  static parse(args, commands = ['rollover', 'adjust-leverage', 'leverage', 'simulate-raw']) {
    if (args.includes('--help') || args.includes('-h')) {
      const helpCommand = args.find(arg => commands.includes(arg));
      return {
        help: true,
        helpCommand: helpCommand || null
      };
    }

    if (args.length === 0) {
      throw new Error('No command specified. Available commands: rollover, adjust-leverage. Use --help for usage.');
    }

    const command = args[0];
    if (!commands.includes(command)) {
      throw new Error(`Unknown command "${command}". Available commands: rollover, adjust-leverage, simulate-raw. Use --help for usage.`);
    }

    const options = {
      command,
      simulation: false,
      walletconnect: false,
      slippage: 1.0,
      type: 'full',
      debug: false
    };

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

    if (options.command === 'simulate-raw') {
      if (!options.file) {
        throw new Error('--file <path> is required for simulate-raw command');
      }
      options.simulation = true;
    }

    if (options.privateKey && !options.rpc) {
      throw new Error('--private-key requires --rpc');
    }

    if (options.saveSimulation) {
      if (options.explicitNoSimulation) {
        throw new Error('Cannot use --save-simulation when simulation is disabled (--no-simulation)');
      }
      options.simulation = true;
    }

    if (!options.privateKey && !options.walletconnect) {
      options.simulation = true;
    }

    return options;
  }
}
