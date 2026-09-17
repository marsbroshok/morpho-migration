/**
 * @fileoverview Service for executing mainnet-fork transaction simulations via eth_simulateV1.
 */

import { getAddress, encodeFunctionData } from 'viem';
import config from '../../../config.js';
import { ERC20_ABI, MORPHO_BLUE_ABI } from '../contracts/abis.js';

/**
 * Service managing on-chain transaction simulations, trace auditing, and leak detection.
 */
export class SimulationService {
  /**
   * @param {object} [contractAddresses]
   * @param {string} [contractAddresses.morphoBlue]
   * @param {string} [contractAddresses.bundler]
   * @param {string} [contractAddresses.adapter]
   */
  constructor(contractAddresses = {}) {
    this.morphoBlue = contractAddresses.morphoBlue || config.MORPHO_BLUE;
    this.bundler = contractAddresses.bundler || config.MORPHO_BUNDLER_V3;
    this.adapter = contractAddresses.adapter || config.ETHER_GENERAL_ADAPTER_1;
  }

  /**
   * Executes an eth_simulateV1 call with automatic authorization injection and balance leak checks.
   *
   * @param {object} params
   * @param {string} params.rpcUrl - Full JSON-RPC provider URL (e.g. Alchemy).
   * @param {string} [params.forkBlockNumber] - Block number or hex tag to pin the simulation state.
   * @param {string} params.fromAddress - Target user wallet simulating the transaction.
   * @param {string} params.toAddress - Target recipient contract address (usually Bundler).
   * @param {string} params.calldata - Hex-encoded multicall data.
   * @param {bigint} [params.value=0n] - Ether value to forward.
   * @param {Array<object>} [params.prependCalls=[]] - Optional preparatory calls (e.g. state overrides).
   * @param {Array<string>} [params.tokensToCheck=[]] - List of token addresses to audit for balance leaks.
   * @param {boolean} [params.isAdapterAuth=true] - Whether user has authorized Adapter on Morpho Blue.
   * @param {boolean} [params.isBundlerAuth=true] - Whether user has authorized Bundler on Morpho Blue.
   * @returns {Promise<{ success: boolean, gasUsed: bigint, traceTree: object, error?: object, prependedAdapterAuth: boolean, prependedBundlerAuth: boolean, logs: Array<object>, leaks: Array<{ token: string, contract: string, balance: bigint }>, calls: Array<object>, rawResponse: object }>}
   */
  async simulateTransaction({
    rpcUrl,
    forkBlockNumber,
    fromAddress,
    toAddress,
    calldata,
    value = 0n,
    prependCalls = [],
    tokensToCheck = [],
    isAdapterAuth = true,
    isBundlerAuth = true
  }) {
    if (!rpcUrl) {
      throw new Error('RPC URL is required for executing transaction simulations.');
    }

    const calls = [];

    // Prepend optional preparatory state calls
    if (prependCalls && prependCalls.length > 0) {
      calls.push(...prependCalls);
    }

    // Inject missing authorizations if required
    if (!isAdapterAuth && this.adapter && this.morphoBlue) {
      calls.push({
        from: fromAddress,
        to: this.morphoBlue,
        value: '0x0',
        data: encodeFunctionData({
          abi: MORPHO_BLUE_ABI,
          functionName: 'setAuthorization',
          args: [this.adapter, true]
        })
      });
    }

    if (!isBundlerAuth && this.bundler && this.morphoBlue) {
      calls.push({
        from: fromAddress,
        to: this.morphoBlue,
        value: '0x0',
        data: encodeFunctionData({
          abi: MORPHO_BLUE_ABI,
          functionName: 'setAuthorization',
          args: [this.bundler, true]
        })
      });
    }

    // Main transaction execution call
    calls.push({
      from: fromAddress,
      to: toAddress,
      value: value ? `0x${value.toString(16)}` : '0x0',
      data: calldata
    });

    // Append post-execution balance checks for transient contract leak detection
    const leakCheckCallsCount = tokensToCheck.length * 3;
    for (const token of tokensToCheck) {
      const normalizedToken = getAddress(token);

      // Check Adapter balance
      calls.push({
        from: fromAddress,
        to: normalizedToken,
        value: '0x0',
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [this.adapter]
        })
      });

      // Check Bundler balance
      calls.push({
        from: fromAddress,
        to: normalizedToken,
        value: '0x0',
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [this.bundler]
        })
      });

      // Check User balance
      calls.push({
        from: fromAddress,
        to: normalizedToken,
        value: '0x0',
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [fromAddress]
        })
      });
    }

    // Format block parameter
    let blockTag = 'latest';
    if (forkBlockNumber) {
      blockTag = forkBlockNumber.toString().startsWith('0x')
        ? forkBlockNumber.toString()
        : `0x${BigInt(forkBlockNumber).toString(16)}`;
    }

    const payload = {
      id: 1,
      jsonrpc: '2.0',
      method: 'eth_simulateV1',
      params: [
        {
          blockStateCalls: [
            {
              calls
            }
          ]
        },
        blockTag
      ]
    };

    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload, (key, val) => (typeof val === 'bigint' ? `0x${val.toString(16)}` : val))
    });

    const data = await response.json();
    if (data.error) {
      throw new Error(`Simulation API request failed: ${data.error.message || JSON.stringify(data.error)}`);
    }

    const results = data.result?.[0]?.calls || [];
    if (results.length === 0) {
      throw new Error('Simulation returned an empty execution trace.');
    }

    const mainCallIndex = results.length - 1 - leakCheckCallsCount;
    const mainCallResult = results[mainCallIndex];
    if (mainCallResult) {
      mainCallResult.to = toAddress;
    }

    // Audit for balance leaks across intermediate transient contracts
    const leaks = [];
    for (let i = 0; i < tokensToCheck.length; i++) {
      const token = tokensToCheck[i];
      const adapterResult = results[mainCallIndex + 1 + i * 3];
      const bundlerResult = results[mainCallIndex + 1 + i * 3 + 1];

      const adapterBalance = adapterResult?.status === '0x1'
        ? BigInt(adapterResult.returnData || adapterResult.output || '0x0')
        : 0n;

      const bundlerBalance = bundlerResult?.status === '0x1'
        ? BigInt(bundlerResult.returnData || bundlerResult.output || '0x0')
        : 0n;

      if (adapterBalance > 0n) {
        leaks.push({ token, contract: 'Adapter', balance: adapterBalance });
      }

      if (bundlerBalance > 0n) {
        leaks.push({ token, contract: 'Bundler', balance: bundlerBalance });
      }
    }

    const logs = this.collectAllLogs(mainCallResult);

    return {
      success: mainCallResult?.status === '0x1',
      gasUsed: mainCallResult?.gasUsed ? BigInt(mainCallResult.gasUsed) : 0n,
      traceTree: mainCallResult,
      error: mainCallResult?.error,
      prependedAdapterAuth: !isAdapterAuth,
      prependedBundlerAuth: !isBundlerAuth,
      logs,
      leaks,
      calls: results,
      rawResponse: data
    };
  }

  /**
   * Traverses execution trace trees recursively to aggregate event logs.
   *
   * @param {object} simResult - Call result trace node.
   * @returns {Array<object>} Flat array of logs.
   */
  collectAllLogs(simResult) {
    if (!simResult) return [];
    let logs = [];
    if (simResult.calls && Array.isArray(simResult.calls)) {
      for (const subcall of simResult.calls) {
        if (subcall.logs && Array.isArray(subcall.logs)) {
          logs = logs.concat(subcall.logs);
        }
        if (subcall.calls && Array.isArray(subcall.calls)) {
          logs = logs.concat(this.collectAllLogs(subcall));
        }
      }
    }
    if (simResult.logs && Array.isArray(simResult.logs)) {
      logs = logs.concat(simResult.logs);
    }
    return logs;
  }
}
