/**
 * @fileoverview Service for fetching dynamic swap quotes and solving exact input amounts.
 */

/**
 * Service managing dynamic swap quotes via Pendle Convert API / DEX aggregators.
 */
export class SwapQuoterService {
  /**
   * @param {string} [apiUrlTemplate] - Endpoint template for swap routing quotes.
   */
  constructor(
    apiUrlTemplate = 'https://api-v2.pendle.finance/core/v3/sdk/{chainId}/convert'
  ) {
    this.apiUrlTemplate = apiUrlTemplate;
    this.history = [];
  }

  /**
   * Resolves endpoint URL for a given chain ID.
   *
   * @param {number} chainId
   * @returns {string}
   */
  getApiUrl(chainId) {
    return this.apiUrlTemplate.replace('{chainId}', chainId.toString());
  }

  /**
   * Fetches swap route from the Convert API with automatic rate-limit retry.
   *
   * @param {object} params
   * @param {string} params.inputToken - Input token address.
   * @param {bigint} params.inputAmount - Input token amount in base units.
   * @param {string} params.outputToken - Target output token address.
   * @param {number|bigint} params.slippageBps - Slippage tolerance in basis points (e.g. 50 = 0.5%).
   * @param {string} params.receiver - Address that will receive output assets (usually Bundler).
   * @param {string} [params.sender] - Address initiating or approving input assets.
   * @param {number} [params.chainId=1] - Target network chain ID.
   * @param {number} [params.maxRetries=3] - Maximum retry attempts on 429 rate limit.
   * @param {number} [params.baseRetryDelayMs=1000] - Base delay before retrying.
   * @returns {Promise<object>} The best swap route payload.
   */
  async fetchSwapRoute({
    inputToken,
    inputAmount,
    outputToken,
    slippageBps,
    receiver,
    sender = null,
    chainId = 1,
    maxRetries = 3,
    baseRetryDelayMs = 1000
  }) {
    const apiUrl = this.getApiUrl(chainId);
    const slippageDecimal = typeof slippageBps === 'bigint' ? Number(slippageBps) / 10000 : slippageBps / 10000;

    const requestBody = {
      receiver,
      slippage: slippageDecimal,
      inputs: [
        {
          token: inputToken,
          amount: inputAmount.toString()
        }
      ],
      outputs: [outputToken],
      enableAggregator: true
    };

    if (sender) {
      requestBody.sender = sender;
    }

    let response;
    let delay = baseRetryDelayMs;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (response.status === 429 && attempt < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
        continue;
      }
      break;
    }

    if (!response.ok) {
      let errMessage = response.statusText;
      try {
        const errJson = await response.json();
        errMessage = errJson.message || JSON.stringify(errJson);
      } catch {
        // use statusText fallback
      }
      this.history.push({ url: apiUrl, request: requestBody, error: errMessage });
      throw new Error(`Failed to fetch routing data from Swap Router: ${errMessage}`);
    }

    const data = await response.json();
    this.history.push({ url: apiUrl, request: requestBody, response: data });

    if (!data.routes || !Array.isArray(data.routes) || data.routes.length === 0) {
      throw new Error('No swap routes found on Swap Router Convert API.');
    }

    return data.routes[0];
  }

  /**
   * Implements the 2-step iterative solver to estimate exact input amount needed to yield targetOutputAmount.
   * Step 1: Nominal query using 1 standard unit of input asset.
   * Step 2: Scale input based on effective exchange rate and fetch final execution route.
   *
   * @param {object} params
   * @param {string} params.inputToken - Input token address.
   * @param {bigint} params.targetOutputAmount - Required output amount in target token base units.
   * @param {string} params.outputToken - Output token address.
   * @param {number|bigint} params.slippageBps - Slippage tolerance in basis points.
   * @param {string} params.receiver - Receiver address for outputs.
   * @param {string} [params.sender] - Sender address.
   * @param {number} [params.chainId=1] - Chain ID.
   * @param {number} [params.inputDecimals=18] - Decimals of input token.
   * @param {number} [params.outputDecimals=18] - Decimals of output token.
   * @returns {Promise<{ requiredInput: bigint, route: object }>}
   */
  async estimateRequiredInputAmount({
    inputToken,
    targetOutputAmount,
    outputToken,
    slippageBps,
    receiver,
    sender = null,
    chainId = 1,
    inputDecimals = 18,
    outputDecimals = 18
  }) {
    // Step 1: Nominal guess (1.0 unit of input token scaled to its decimals)
    const nominalInput = 10n ** BigInt(inputDecimals);

    const nominalRoute = await this.fetchSwapRoute({
      inputToken,
      inputAmount: nominalInput,
      outputToken,
      slippageBps,
      receiver,
      sender,
      chainId
    });

    const nominalOutput = BigInt(nominalRoute.outputs[0].amount);
    if (nominalOutput === 0n) {
      throw new Error('Nominal swap route produced zero output amount.');
    }

    // Step 2: Solve exact required input amount
    // requiredInput = (targetOutputAmount * nominalInput) / nominalOutput
    const requiredInput = (targetOutputAmount * nominalInput) / nominalOutput;

    // Fetch final execution route with the solved input amount
    const solvedRoute = await this.fetchSwapRoute({
      inputToken,
      inputAmount: requiredInput,
      outputToken,
      slippageBps,
      receiver,
      sender,
      chainId
    });

    return {
      requiredInput,
      route: solvedRoute
    };
  }
}
