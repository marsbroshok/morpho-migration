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
  async simulateTransaction(fromAddress, toAddress, calldata, value, prependCalls = [], tokensToCheck = []) {
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

    const ERC20_BALANCE_OF_ABI = [{
      "inputs": [{ "name": "account", "type": "address" }],
      "name": "balanceOf",
      "outputs": [{ "name": "", "type": "uint256" }],
      "stateMutability": "view",
      "type": "function"
    }];

    const leakCheckCallsCount = tokensToCheck.length * 2;
    for (const token of tokensToCheck) {
      // Check Adapter balance
      calls.push({
        from: fromAddress,
        to: getAddress(token),
        value: '0x0',
        data: encodeFunctionData({
          abi: ERC20_BALANCE_OF_ABI,
          functionName: 'balanceOf',
          args: [ADAPTER_ADDRESS]
        })
      });
      // Check Bundler balance
      calls.push({
        from: fromAddress,
        to: getAddress(token),
        value: '0x0',
        data: encodeFunctionData({
          abi: ERC20_BALANCE_OF_ABI,
          functionName: 'balanceOf',
          args: [BUNDLER_ADDRESS]
        })
      });
    }

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
        process.env.FORK_BLOCK_NUMBER ? (process.env.FORK_BLOCK_NUMBER.startsWith('0x') ? process.env.FORK_BLOCK_NUMBER : `0x${BigInt(process.env.FORK_BLOCK_NUMBER).toString(16)}`) : "latest"
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
    const mainCallIndex = results.length - 1 - leakCheckCallsCount;
    const mainCallResult = results[mainCallIndex];
    if (mainCallResult.status !== '0x1') {
      console.error("DEBUG SIMULATION FAILED. Full Alchemy response:", JSON.stringify(data, null, 2));
    }
    mainCallResult.to = toAddress;

    // Check for balance leaks
    const leaks = [];
    for (let i = 0; i < tokensToCheck.length; i++) {
      const token = tokensToCheck[i];
      const adapterResult = results[mainCallIndex + 1 + i * 2];
      const bundlerResult = results[mainCallIndex + 1 + i * 2 + 1];

      const adapterBalance = adapterResult.status === '0x1' ? BigInt(adapterResult.returnData || adapterResult.output || '0x0') : 0n;
      const bundlerBalance = bundlerResult.status === '0x1' ? BigInt(bundlerResult.returnData || bundlerResult.output || '0x0') : 0n;

      if (adapterBalance > 0n) {
        leaks.push({ token, contract: 'Adapter', balance: adapterBalance });
        console.warn(`\x1b[33m[Leak Warning]\x1b[0m Contract ETHER_GENERAL_ADAPTER_1 holds residual balance of token ${token}: ${adapterBalance.toString()}`);
      }
      if (bundlerBalance > 0n) {
        leaks.push({ token, contract: 'Bundler', balance: bundlerBalance });
        console.warn(`\x1b[33m[Leak Warning]\x1b[0m Contract MORPHO_BUNDLER_V3 holds residual balance of token ${token}: ${bundlerBalance.toString()}`);
      }
    }

    const logs = this.collectAllLogs(mainCallResult);
    return {
      success: mainCallResult.status === '0x1',
      gasUsed: BigInt(mainCallResult.gasUsed),
      traceTree: mainCallResult,
      error: mainCallResult.error,
      prependedAdapterAuth: !isAdapterAuth,
      prependedBundlerAuth: !isBundlerAuth,
      logs,
      leaks
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

