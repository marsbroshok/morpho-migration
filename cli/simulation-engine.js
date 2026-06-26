import { getAddress, encodeFunctionData } from 'viem';

const MORPHO_BLUE = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";
const BUNDLER_ADDRESS = '0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245';
const ADAPTER_ADDRESS = '0x4A6c312ec70E8747a587EE860a0353cd42Be0aE0';

export class SimulationEngine {
  /**
   * @param {BlockchainClient} blockchainClient 
   * @param {string|null} alchemyKey 
   */
  constructor(blockchainClient, alchemyKey) {
    this.blockchainClient = blockchainClient;
    this.alchemyKey = alchemyKey;
  }

  /**
   * Run a mainnet-fork transaction simulation using eth_simulateV1.
   * @param {string} fromAddress 
   * @param {string} toAddress 
   * @param {string} calldata 
   * @param {bigint} value 
   */
  async simulateTransaction(fromAddress, toAddress, calldata, value, prependCalls = []) {
    const apiKey = this.alchemyKey || process.env.ALCHEMY_API_KEY;
    if (!apiKey) {
      throw new Error("Alchemy API Key is required for running on-chain simulations. Please set ALCHEMY_API_KEY.");
    }
    const rpcUrl = `https://eth-mainnet.g.alchemy.com/v2/${apiKey}`;

    // 1. Verify authorization states
    const [isAdapterAuth, isBundlerAuth] = await Promise.all([
      this.blockchainClient.isAuthorized(fromAddress, ADAPTER_ADDRESS),
      this.blockchainClient.isAuthorized(fromAddress, BUNDLER_ADDRESS)
    ]);

    const setAuthAdapterData = encodeFunctionData({
      abi: [{"inputs":[{"name":"authorized","type":"address"},{"name":"newIsAuthorized","type":"bool"}],"name":"setAuthorization","outputs":[],"stateMutability":"nonpayable","type":"function"}],
      functionName: 'setAuthorization',
      args: [ADAPTER_ADDRESS, true]
    });

    const setAuthBundlerData = encodeFunctionData({
      abi: [{"inputs":[{"name":"authorized","type":"address"},{"name":"newIsAuthorized","type":"bool"}],"name":"setAuthorization","outputs":[],"stateMutability":"nonpayable","type":"function"}],
      functionName: 'setAuthorization',
      args: [BUNDLER_ADDRESS, true]
    });

    const calls = [];
    if (prependCalls && prependCalls.length > 0) {
      calls.push(...prependCalls);
    }
    if (!isAdapterAuth) {
      calls.push({
        from: fromAddress,
        to: MORPHO_BLUE,
        value: '0x0',
        data: setAuthAdapterData
      });
    }
    if (!isBundlerAuth) {
      calls.push({
        from: fromAddress,
        to: MORPHO_BLUE,
        value: '0x0',
        data: setAuthBundlerData
      });
    }

    // Main execution call
    calls.push({
      from: fromAddress,
      to: toAddress,
      value: value ? `0x${value.toString(16)}` : '0x0',
      data: calldata
    });

    const payload = {
      id: 1,
      jsonrpc: "2.0",
      method: "eth_simulateV1",
      params: [
        {
          blockStateCalls: [
            {
              calls
            }
          ]
        },
        "latest"
      ]
    };

    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const data = await response.json();
    if (data.error) {
      throw new Error(`Simulation API request failed: ${data.error.message || JSON.stringify(data.error)}`);
    }

    const results = data.result[0].calls;
    const mainCallResult = results[results.length - 1];
    mainCallResult.to = toAddress;

    const logs = this.collectAllLogs(mainCallResult);
    return {
      success: mainCallResult.status === '0x1',
      gasUsed: BigInt(mainCallResult.gasUsed),
      traceTree: mainCallResult,
      error: mainCallResult.error,
      prependedAdapterAuth: !isAdapterAuth,
      prependedBundlerAuth: !isBundlerAuth,
      logs
    };
  }

  collectAllLogs(simResult) {
    let logs = [];
    if (simResult.calls && Array.isArray(simResult.calls)) {
      for (const call of simResult.calls) {
        if (call.logs && Array.isArray(call.logs)) {
          logs = logs.concat(call.logs);
        }
        if (call.calls && Array.isArray(call.calls)) {
          logs = logs.concat(this.collectAllLogs(call));
        }
      }
    }
    if (simResult.logs && Array.isArray(simResult.logs)) {
      logs = logs.concat(simResult.logs);
    }
    return logs;
  }
}

