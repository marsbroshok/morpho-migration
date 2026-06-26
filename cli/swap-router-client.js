const ETHER_GENERAL_ADAPTER_1 = "0x4A6c312ec70E8747a587EE860a0353cd42Be0aE0";

export class SwapRouterClient {
  /**
   * Fetch converted route details from Swap Router SDK.
   * @param {string} inputToken 
   * @param {bigint} inputAmount 
   * @param {string} outputToken 
   * @param {number} slippage 
   */
  async fetchSwapRoute(inputToken, inputAmount, outputToken, slippage, receiver, sender = null) {
    const chainId = 1;
    const swapRouterApiUrl = `https://api-v2.pendle.finance/core/v3/sdk/${chainId}/convert`;
    const requestBody = {
      receiver: receiver,
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
    };

    if (sender) {
      requestBody.sender = sender;
    }

    let response;
    let delay = 1000;
    const attempts = 3;

    for (let i = 0; i < attempts; i++) {
      response = await fetch(swapRouterApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
      if (response.status === 429 && i < attempts - 1) {
        process.stderr.write(`⚠️ Swap Router API rate limited (429). Retrying in ${delay}ms...\n`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
        continue;
      }
      break;
    }

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.message || "Failed to fetch routing data from Swap Router.");
    }
    const data = await response.json();
    if (!data.routes || data.routes.length === 0) {
      throw new Error("No swap routes found on Swap Router Convert API.");
    }
    return data.routes[0];
  }
}

