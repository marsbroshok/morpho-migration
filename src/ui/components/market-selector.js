/**
 * @fileoverview Market and token input selector component.
 */

/**
 * Component managing market ID inputs, token contract bindings, and maturity inspection.
 */
export class MarketSelector {
  /**
   * @param {Document} doc - DOM document reference.
   * @param {object} marketService - MorphoMarketService instance.
   */
  constructor(doc, marketService) {
    this.doc = doc;
    this.marketService = marketService;
  }

  /**
   * Processes input on a Market ID field, querying metadata and populating UI.
   *
   * @param {object} params
   * @param {string} params.marketId - 32-byte hex market ID.
   * @param {string} params.collateralInputId - DOM ID for the collateral token address input.
   * @param {string} [params.symbolLabelId] - DOM ID for the collateral symbol label.
   * @param {string} [params.expiryLabelId] - DOM ID for PT expiry date display.
   * @param {function(object): void} [params.onResolved] - Callback receiving resolved MarketParams.
   */
  async handleMarketIdInput({
    marketId,
    collateralInputId,
    symbolLabelId,
    expiryLabelId,
    onResolved
  }) {
    if (!this.doc) return;
    const cleanMarketId = marketId ? marketId.trim() : '';
    if (!cleanMarketId || cleanMarketId.length !== 66 || !cleanMarketId.startsWith('0x')) {
      return;
    }

    try {
      const params = await this.marketService.fetchMarketParams(cleanMarketId);

      const collatInput = this.doc.getElementById(collateralInputId);
      if (collatInput) {
        collatInput.value = params.collateralToken;
      }

      if (symbolLabelId) {
        const symbolLabel = this.doc.getElementById(symbolLabelId);
        if (symbolLabel) {
          symbolLabel.textContent = params.collateralSymbol;
        }
      }

      if (expiryLabelId) {
        const expiryLabel = this.doc.getElementById(expiryLabelId);
        if (expiryLabel) {
          try {
            const maturity = await this.marketService.checkCollateralMaturity(
              null,
              params.collateralToken
            );
            if (maturity && maturity.expiryDate !== 'Unknown') {
              expiryLabel.textContent = `Maturity: ${maturity.expiryDate}${maturity.isExpired ? ' (Expired)' : ''}`;
              expiryLabel.style.color = maturity.isExpired ? '#ff4d4d' : '#888888';
            } else {
              expiryLabel.textContent = '';
            }
          } catch {
            expiryLabel.textContent = '';
          }
        }
      }

      if (typeof onResolved === 'function') {
        onResolved(params);
      }
      return params;
    } catch (err) {
      console.warn(`[MarketSelector] Failed to resolve market parameters for ${cleanMarketId}:`, err);
    }
  }

  /**
   * Updates collateral address input and fetches ERC20 symbol.
   *
   * @param {string} tokenAddress - 42-character token address.
   * @param {string} symbolLabelId - DOM ID for symbol label.
   * @param {object} publicClient - Viem public client.
   */
  async handleTokenAddressInput(tokenAddress, symbolLabelId, publicClient) {
    if (!this.doc) return;
    const cleanAddr = tokenAddress ? tokenAddress.trim() : '';
    if (!cleanAddr || cleanAddr.length !== 42 || !cleanAddr.startsWith('0x')) {
      return;
    }

    const symbolLabel = this.doc.getElementById(symbolLabelId);
    if (!symbolLabel) return;

    if (!publicClient) {
      symbolLabel.textContent = '';
      return;
    }

    try {
      const symbol = await publicClient.readContract({
        address: cleanAddr,
        abi: [
          {
            inputs: [],
            name: 'symbol',
            outputs: [{ name: '', type: 'string' }],
            stateMutability: 'view',
            type: 'function'
          }
        ],
        functionName: 'symbol'
      });
      symbolLabel.textContent = symbol;
    } catch {
      symbolLabel.textContent = '';
    }
  }
}
