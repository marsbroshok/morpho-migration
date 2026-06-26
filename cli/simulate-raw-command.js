import fs from 'fs';
import path from 'path';
import { getAddress, decodeFunctionData, decodeAbiParameters } from 'viem';
import { BUNDLER_ABI, ADAPTER_ABI } from '../builders.js';

export class SimulateRawCommand {
  /**
   * @param {BlockchainClient} blockchainClient
   * @param {SimulationEngine} simulationEngine
   */
  constructor(blockchainClient, simulationEngine) {
    this.blockchainClient = blockchainClient;
    this.simulationEngine = simulationEngine;
  }

  /**
   * Loads and validates transaction data from a JSON file.
   * @param {string} filePath
   * @returns {object} The parsed and validated transaction data.
   */
  loadTransactionData(filePath) {
    if (!filePath) {
      throw new Error('A JSON file path must be specified using --file or -f.');
    }
    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    let rawContent;
    try {
      rawContent = fs.readFileSync(resolvedPath, 'utf8');
    } catch (err) {
      throw new Error(`Failed to read file ${filePath}: ${err.message}`);
    }

    let json;
    try {
      json = JSON.parse(rawContent);
    } catch (err) {
      throw new Error(`Failed to parse JSON from file ${filePath}: ${err.message}`);
    }

    if (!json.from) {
      throw new Error('Missing "from" address in transaction JSON.');
    }
    if (!json.to) {
      throw new Error('Missing "to" address in transaction JSON.');
    }
    if (!json.data) {
      throw new Error('Missing "data" calldata in transaction JSON.');
    }

    let fromAddress, toAddress;
    try {
      fromAddress = getAddress(json.from);
    } catch (err) {
      throw new Error(`Invalid "from" address: ${json.from}`);
    }

    try {
      toAddress = getAddress(json.to);
    } catch (err) {
      throw new Error(`Invalid "to" address: ${json.to}`);
    }

    if (typeof json.data !== 'string' || !/^0x[0-9a-fA-F]*$/.test(json.data)) {
      throw new Error('Invalid "data" hex string in transaction JSON.');
    }

    let value = 0n;
    if (json.value !== undefined && json.value !== null) {
      try {
        value = BigInt(json.value);
      } catch (err) {
        throw new Error(`Invalid "value" specified: ${json.value}`);
      }
    }

    return {
      from: fromAddress,
      to: toAddress,
      data: json.data,
      value
    };
  }

  /**
   * Run transaction simulation on fork.
   * @param {object} txData
   */
  async runSimulation(txData) {
    this.warnOnAddressMismatches(txData.from, txData.data);
    return this.simulationEngine.simulateTransaction(
      txData.from,
      txData.to,
      txData.data,
      txData.value
    );
  }

  /**
   * Decodes multicall calldata to identify if target position user matches signer address.
   * @param {string} fromAddress
   * @param {string} data
   */
  warnOnAddressMismatches(fromAddress, data) {
    try {
      const decodedOuter = decodeFunctionData({
        abi: BUNDLER_ABI,
        data
      });

      const bundle = decodedOuter.args[0];
      const mismatches = [];

      const checkReenterBundle = (reenterItems) => {
        for (const item of reenterItems) {
          try {
            const decodedSub = decodeFunctionData({
              abi: ADAPTER_ABI,
              data: item.data
            });
            
            let onBehalf;
            if (decodedSub.functionName === 'morphoRepay') {
              onBehalf = getAddress(decodedSub.args[4]);
            } else if (decodedSub.functionName === 'morphoSupplyCollateral') {
              onBehalf = getAddress(decodedSub.args[2]);
            }

            if (onBehalf && onBehalf.toLowerCase() !== fromAddress.toLowerCase()) {
              mismatches.push({
                functionName: decodedSub.functionName,
                onBehalf,
                expected: fromAddress
              });
            }
          } catch (e) {
            // Ignore if we can't decode
          }
        }
      };

      for (const item of bundle) {
        try {
          const decoded = decodeFunctionData({
            abi: ADAPTER_ABI,
            data: item.data
          });

          let onBehalf;
          if (decoded.functionName === 'morphoRepay') {
            onBehalf = getAddress(decoded.args[4]);
          } else if (decoded.functionName === 'morphoSupplyCollateral') {
            onBehalf = getAddress(decoded.args[2]);
          }

          if (onBehalf && onBehalf.toLowerCase() !== fromAddress.toLowerCase()) {
            mismatches.push({
              functionName: decoded.functionName,
              onBehalf,
              expected: fromAddress
            });
          } else if (decoded.functionName === 'morphoFlashLoan') {
            const callbackData = decoded.args[2];
            const decodedReenter = decodeAbiParameters(
              [
                {
                  name: 'bundle',
                  type: 'tuple[]',
                  components: [
                    { name: 'to', type: 'address' },
                    { name: 'data', type: 'bytes' },
                    { name: 'value', type: 'uint256' },
                    { name: 'skipRevert', type: 'bool' },
                    { name: 'callbackHash', type: 'bytes32' }
                  ]
                }
              ],
              callbackData
            );
            checkReenterBundle(decodedReenter[0]);
          }
        } catch (e) {
          // Ignore if we can't decode
        }
      }

      if (mismatches.length > 0) {
        console.warn('\n⚠️  WARNING: Address Context Mismatch Detected in Calldata!');
        console.warn(`  Transaction Sender (from): ${fromAddress}`);
        for (const m of mismatches) {
          console.warn(`  ├── Function: ${m.functionName}`);
          console.warn(`  └── Encod. onBehalf: ${m.onBehalf} (does NOT match transaction sender)`);
        }
        console.warn('  Withdrawal/borrow steps in General Adapter always act on the transaction sender (msg.sender).');
        console.warn('  This transaction will likely revert on-chain with "insufficient collateral" or similar error.');
        console.warn('  Ensure the calldata was compiled for the correct user address and matches the signing wallet.\n');
      }
    } catch (e) {
      // Ignore outer decode failure (not a standard bundler multicall)
    }
  }
}
