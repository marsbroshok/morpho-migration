import { SimulationService } from '../src/core/services/simulation-service.js';
import config from '../config.js';

const BUNDLER_ADDRESS = config.MORPHO_BUNDLER_V3;
const ADAPTER_ADDRESS = config.ETHER_GENERAL_ADAPTER_1;

export class SimulationEngine {
  /**
   * @param {object} blockchainClient 
   * @param {string|null} alchemyKey 
   */
  constructor(blockchainClient, alchemyKey) {
    this.blockchainClient = blockchainClient;
    this.alchemyKey = alchemyKey;
    this.service = new SimulationService();
  }

  /**
   * Run a mainnet-fork transaction simulation using eth_simulateV1.
   * @param {string} fromAddress 
   * @param {string} toAddress 
   * @param {string} calldata 
   * @param {bigint} value 
   * @param {Array<object>} [prependCalls=[]]
   * @param {Array<string>} [tokensToCheck=[]]
   */
  async simulateTransaction(fromAddress, toAddress, calldata, value, prependCalls = [], tokensToCheck = []) {
    const apiKey = this.alchemyKey || process.env.ALCHEMY_API_KEY;
    if (!apiKey) {
      throw new Error("Alchemy API Key is required for running on-chain simulations. Please set ALCHEMY_API_KEY.");
    }
    const rpcUrl = `https://eth-mainnet.g.alchemy.com/v2/${apiKey}`;

    // Verify authorization states on Morpho Blue
    const [isAdapterAuth, isBundlerAuth] = await Promise.all([
      this.blockchainClient.isAuthorized(fromAddress, ADAPTER_ADDRESS),
      this.blockchainClient.isAuthorized(fromAddress, BUNDLER_ADDRESS)
    ]);

    return await this.service.simulateTransaction({
      rpcUrl,
      forkBlockNumber: process.env.FORK_BLOCK_NUMBER,
      fromAddress,
      toAddress,
      calldata,
      value: value || 0n,
      prependCalls,
      tokensToCheck,
      isAdapterAuth,
      isBundlerAuth
    });
  }

  collectAllLogs(simResult) {
    return this.service.collectAllLogs(simResult);
  }
}
