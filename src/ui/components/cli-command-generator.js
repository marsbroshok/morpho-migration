/**
 * @fileoverview CLI command generator component and interactive UI preview card.
 */

/**
 * Component that renders interactive CLI equivalents of the active web form parameters.
 */
export class CliCommandGenerator {
  /**
   * @param {Document} doc - DOM document reference.
   * @param {object} [stateStore] - Application state store.
   */
  constructor(doc = typeof document !== 'undefined' ? document : null, stateStore = null) {
    this.doc = doc;
    this.stateStore = stateStore;
    this.sourceMarketParams = null;
    this.destMarketParams = null;
    this.levMarketParams = null;
  }

  /**
   * Updates cached market params for CLI command minimization.
   *
   * @param {'source'|'dest'|'leverage'|string} type
   * @param {object|null} params
   */
  setMarketParams(type, params) {
    if (type === 'oldMarketId' || type === 'source') this.sourceMarketParams = params;
    if (type === 'newMarketId' || type === 'dest') this.destMarketParams = params;
    if (type === 'levMarketId' || type === 'leverage') this.levMarketParams = params;
  }

  /**
   * Generates CLI command string for rollover operations.
   *
   * @returns {string}
   */
  generateRolloverCommand() {
    if (!this.doc) return '';
    const oldMarketEl = this.doc.getElementById('oldMarketId');
    const newMarketEl = this.doc.getElementById('newMarketId');
    const userEl = this.doc.getElementById('userAddress');
    const debtEl = this.doc.getElementById('debtAmount');
    const oldCollateralEl = this.doc.getElementById('oldCollateralAddress');
    const newCollateralEl = this.doc.getElementById('newCollateralAddress');
    const slippageEl = this.doc.getElementById('slippage');
    const oldLoanEl = this.doc.getElementById('sourceLoanAddress');
    const newLoanEl = this.doc.getElementById('newLoanAddress');

    const sourceMarketId = oldMarketEl?.value?.trim() || '<old-market-id>';
    const destMarketId = newMarketEl?.value?.trim() || '<new-market-id>';
    const user = userEl?.value?.trim() || '<user-address>';
    const isPartial = this.doc.getElementById('togglePartial')?.classList?.contains('active') ?? false;
    const debt = debtEl?.value?.trim() || '0';
    const sourceCollateral = oldCollateralEl?.value?.trim() || '';
    const destCollateral = newCollateralEl?.value?.trim() || '';
    const slippage = slippageEl?.value?.trim() || '1.0';
    const sourceLoan = oldLoanEl?.value?.trim() || '';
    const destLoan = newLoanEl?.value?.trim() || '';

    let cmd = `node cli.js rollover \\\n  --old-market-id ${sourceMarketId} \\\n  --new-market-id ${destMarketId} \\\n  --user ${user}`;

    if (isPartial) {
      cmd += ` \\\n  --type partial \\\n  --debt ${debt}`;
    } else {
      cmd += ` \\\n  --type full`;
    }

    let includeSourceCollateral = true;
    if (this.sourceMarketParams && this.sourceMarketParams.collateralToken.toLowerCase() === sourceCollateral.toLowerCase()) {
      includeSourceCollateral = false;
    }
    if (sourceCollateral && includeSourceCollateral) {
      cmd += ` \\\n  --old-collateral ${sourceCollateral}`;
    }

    let includeDestCollateral = true;
    if (this.destMarketParams && this.destMarketParams.collateralToken.toLowerCase() === destCollateral.toLowerCase()) {
      includeDestCollateral = false;
    }
    if (destCollateral && includeDestCollateral) {
      cmd += ` \\\n  --new-collateral ${destCollateral}`;
    }

    if (slippage !== '1.0') {
      cmd += ` \\\n  --slippage ${slippage}`;
    }
    if (sourceLoan && sourceLoan.toLowerCase() !== '0xA0b86991c6218b36c1d19D4a2e9Eb0CE3606eB48'.toLowerCase()) {
      cmd += ` \\\n  --old-loan ${sourceLoan}`;
    }
    let includeDestLoan = true;
    if (this.destMarketParams && this.destMarketParams.loanToken.toLowerCase() === destLoan.toLowerCase()) {
      includeDestLoan = false;
    } else if (destLoan.toLowerCase() === '0xA0b86991c6218b36c1d19D4a2e9Eb0CE3606eB48'.toLowerCase()) {
      includeDestLoan = false;
    }
    if (destLoan && includeDestLoan) {
      cmd += ` \\\n  --new-loan ${destLoan}`;
    }

    cmd += ` \\\n  --simulation`;
    return cmd;
  }

  /**
   * Generates CLI command string for leverage adjustment operations.
   *
   * @returns {string}
   */
  generateLeverageCommand() {
    if (!this.doc) return '';
    const marketEl = this.doc.getElementById('levMarketId');
    const sliderEl = this.doc.getElementById('levSlider');
    const userEl = this.doc.getElementById('levUserAddress');
    const ptEl = this.doc.getElementById('levCollateralAddress');
    const slippageEl = this.doc.getElementById('levSlippage');
    const loanEl = this.doc.getElementById('levLoanAddress');

    const marketId = marketEl?.value?.trim() || '<market-id>';
    const targetLeverage = parseFloat(sliderEl?.value || '1.0').toFixed(2);
    const user = userEl?.value?.trim() || '<user-address>';
    const pt = ptEl?.value?.trim() || '';
    const slippage = slippageEl?.value?.trim() || '1.0';
    const usdc = loanEl?.value?.trim() || '';

    let cmd = `node cli.js adjust-leverage \\\n  --market-id ${marketId} \\\n  --target-leverage ${targetLeverage} \\\n  --user ${user}`;

    let includePt = true;
    if (this.levMarketParams && this.levMarketParams.collateralToken.toLowerCase() === pt.toLowerCase()) {
      includePt = false;
    }
    if (pt && includePt) {
      cmd += ` \\\n  --collateral ${pt}`;
    }

    if (slippage !== '1.0') {
      cmd += ` \\\n  --slippage ${slippage}`;
    }
    if (usdc && usdc.toLowerCase() !== '0xA0b86991c6218b36c1d19D4a2e9Eb0CE3606eB48'.toLowerCase()) {
      cmd += ` \\\n  --loan ${usdc}`;
    }

    cmd += ` \\\n  --simulation`;
    return cmd;
  }

  /**
   * Updates the CLI command output box in the UI.
   *
   * @param {'rollover'|'leverage'|string} [activeTab]
   */
  update(activeTab) {
    if (!this.doc) return;
    const codeEl = this.doc.getElementById('cliCommandCode');
    if (!codeEl) return;

    const currentTab = activeTab || this.stateStore?.get('activeTab') || 'rollover';
    if (currentTab === 'leverage') {
      codeEl.textContent = this.generateLeverageCommand();
    } else {
      codeEl.textContent = this.generateRolloverCommand();
    }
  }

  /**
   * Copies text string to clipboard with document fallback.
   *
   * @param {string} text
   */
  async copyToClipboard(text) {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    if (!this.doc) return;
    const textArea = this.doc.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.top = '0';
    textArea.style.left = '0';
    this.doc.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
      const ok = this.doc.execCommand('copy');
      if (!ok) throw new Error('Fallback copy execCommand failed');
    } finally {
      this.doc.body.removeChild(textArea);
    }
  }

  /**
   * Initializes DOM event listeners for the CLI card.
   */
  init() {
    if (!this.doc) return;
    const cliCard = this.doc.getElementById('cliCard');
    const cliHeader = this.doc.getElementById('cliHeader');
    const cliToggleText = this.doc.getElementById('cliToggleText');

    if (cliHeader && cliCard && cliToggleText) {
      cliHeader.addEventListener('click', () => {
        const isExpanded = cliCard.classList.toggle('expanded');
        cliToggleText.textContent = isExpanded ? 'Click to collapse' : 'Click to expand';
      });
    }

    const copyCliBtn = this.doc.getElementById('copyCliBtn');
    const cliCommandCode = this.doc.getElementById('cliCommandCode');

    if (copyCliBtn && cliCommandCode) {
      copyCliBtn.addEventListener('click', async () => {
        try {
          await this.copyToClipboard(cliCommandCode.textContent);
          const originalHtml = copyCliBtn.innerHTML;
          copyCliBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <span>Copied!</span>
          `;
          copyCliBtn.classList.add('copied');
          setTimeout(() => {
            copyCliBtn.innerHTML = originalHtml;
            copyCliBtn.classList.remove('copied');
          }, 2000);
        } catch (err) {
          console.error('Failed to copy to clipboard:', err);
        }
      });
    }

    this.update();
  }
}
