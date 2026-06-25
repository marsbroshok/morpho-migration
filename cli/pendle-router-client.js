const ETHER_GENERAL_ADAPTER_1 = "0x4A6c312ec70E8747a587EE860a0353cd42Be0aE0";

export class PendleRouterClient {
  /**
   * Fetch converted route details from Pendle SDK.
   * @param {string} inputToken 
   * @param {bigint} inputAmount 
   * @param {string} outputToken 
   * @param {number} slippage 
   */
  async fetchPendleRoute(inputToken, inputAmount, outputToken, slippage) {
    const chainId = 1;
    const pendleApiUrl = `https://api-v2.pendle.finance/core/v3/sdk/${chainId}/convert`;
    const response = await fetch(pendleApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        receiver: ETHER_GENERAL_ADAPTER_1,
        slippage: slippage,
        inputs: [
          {
            token: inputToken,
            amount: inputAmount.toString()
          }
        ],
        outputs: [
          outputToken
        ],
        enableAggregator: true
      })
    });

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.message || "Failed to fetch routing data from Pendle.");
    }
    const data = await response.json();
    if (!data.routes || data.routes.length === 0) {
      throw new Error("No swap routes found on Pendle Convert API.");
    }
    return data.routes[0];
  }
}
