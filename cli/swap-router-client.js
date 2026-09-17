import { SwapQuoterService } from '../src/core/services/swap-quoter-service.js';

export class SwapRouterClient {
  constructor() {
    this.service = new SwapQuoterService();
    this.requests = this.service.history;
  }

  /**
   * Fetch converted route details from Swap Router SDK.
   * @param {string} inputToken 
   * @param {bigint} inputAmount 
   * @param {string} outputToken 
   * @param {number} slippage 
   * @param {string} receiver 
   * @param {string|null} [sender=null] 
   */
  async fetchSwapRoute(inputToken, inputAmount, outputToken, slippage, receiver, sender = null) {
    const slippageBps = slippage <= 1 ? Math.round(slippage * 10000) : slippage;
    return await this.service.fetchSwapRoute({
      inputToken,
      inputAmount,
      outputToken,
      slippageBps,
      receiver,
      sender
    });
  }
}
