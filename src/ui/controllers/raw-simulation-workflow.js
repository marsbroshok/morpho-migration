/**
 * @fileoverview Workflow controller for raw transaction payload simulations.
 */

import { decodeFunctionData, decodeAbiParameters, getAddress } from 'viem';
import { BUNDLER_ABI, ADAPTER_ABI } from '../../core/contracts/abis.js';

export class RawSimulationWorkflow {
  /**
   * @param {object} dependencies
   * @param {object} dependencies.simulationService
   */
  constructor({ simulationService }) {
    this.simulationService = simulationService;
  }

  /**
   * Detects address context mismatches where onBehalf is not the transaction sender.
   *
   * @param {string} fromAddress
   * @param {string} data
   * @returns {Array<{ functionName: string, onBehalf: string, expected: string }>}
   */
  findAddressMismatches(fromAddress, data) {
    const mismatches = [];
    try {
      const decodedOuter = decodeFunctionData({
        abi: BUNDLER_ABI,
        data
      });

      const bundle = decodedOuter.args[0];

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
          } catch {
            // Ignore decode error
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
        } catch {
          // Ignore decode error
        }
      }
    } catch {
      // Ignore outer decode failure
    }
    return mismatches;
  }

  async executeRawSimulation({
    rpcUrl,
    forkBlockNumber,
    rawTxPayload,
    tokensToCheck = []
  }) {
    let parsed;
    try {
      parsed = typeof rawTxPayload === 'string' ? JSON.parse(rawTxPayload) : rawTxPayload;
    } catch {
      throw new Error('Invalid JSON transaction payload. Please provide valid transaction JSON.');
    }

    if (!parsed.from || !parsed.to || !parsed.data) {
      throw new Error('Raw transaction payload must include "from", "to", and "data" properties.');
    }

    const value = parsed.value ? BigInt(parsed.value) : 0n;
    const mismatches = this.findAddressMismatches(parsed.from, parsed.data);

    const simResult = await this.simulationService.simulateTransaction({
      rpcUrl,
      forkBlockNumber,
      fromAddress: parsed.from,
      toAddress: parsed.to,
      calldata: parsed.data,
      value,
      tokensToCheck
    });

    return {
      simResult,
      mismatches,
      fromAddress: parsed.from,
      data: parsed.data
    };
  }
}
