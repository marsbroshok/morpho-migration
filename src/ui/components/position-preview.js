/**
 * @fileoverview Position preview and simulation results presentation component.
 */

/**
 * Component rendering position statistics, simulation trace trees, and leak warnings.
 */
export class PositionPreview {
  /**
   * @param {Document} doc - DOM document reference.
   */
  constructor(doc) {
    this.doc = doc;
  }

  /**
   * Renders the position details table.
   *
   * @param {string} containerId
   * @param {object} details
   */
  renderPositionDetails(containerId, details) {
    if (!this.doc) return;
    const container = this.doc.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `
      <table class="preview-table">
        <tbody>
          <tr><td><strong>Debt:</strong></td><td>${details.debtFormatted || '0.00'}</td></tr>
          <tr><td><strong>Collateral:</strong></td><td>${details.collateralFormatted || '0.00'}</td></tr>
          <tr><td><strong>Current LTV:</strong></td><td>${details.ltvFormatted || '0.00%'}</td></tr>
          <tr><td><strong>Current Leverage:</strong></td><td>${details.leverageFormatted || '1.00x'}</td></tr>
          <tr><td><strong>Health Factor:</strong></td><td>${details.healthFactorFormatted || '∞'}</td></tr>
        </tbody>
      </table>
    `;
    container.style.display = 'block';
  }

  /**
   * Renders the loaded position summary on the Adjust Leverage tab.
   */
  renderLeveragePositionInfo({
    collateralFormatted,
    debtFormatted,
    collateralSymbol = 'PT',
    loanSymbol = 'USDC',
    ltvFormatted,
    leverageVal
  }) {
    if (!this.doc) return;
    const infoEl = this.doc.getElementById('levPositionInfo');
    if (infoEl) {
      infoEl.innerHTML = `
        <strong>Active Position Found:</strong><br>
        Collateral: <span style="color: #38bdf8;">${collateralFormatted} ${collateralSymbol}</span><br>
        Current Debt: <span style="color: #f43f5e;">${debtFormatted} ${loanSymbol}</span><br>
        LTV & Leverage: <span style="color: #34d399;">${ltvFormatted} (${leverageVal} Leverage)</span>
      `;
      infoEl.style.display = 'block';
    }
    const controlsEl = this.doc.getElementById('levAdjustmentControls');
    if (controlsEl) controlsEl.style.display = 'block';
  }

  /**
   * Renders simulated target leverage metrics when the slider moves.
   */
  renderLeverageSliderMetrics(targetLeverage, levCollateral, levDebt) {
    if (!this.doc) return;
    const metricsEl = this.doc.getElementById('levTargetMetrics');
    if (!metricsEl) return;
    if (levCollateral === 0n) {
      metricsEl.innerHTML = '<em>No active position loaded. Please connect wallet first.</em>';
      return;
    }
    const targetLtv = 1.0 - (1.0 / targetLeverage);
    const targetLtvPct = (targetLtv * 100).toFixed(2);
    let actionText = '';
    if (targetLeverage === 1.0) {
      actionText = `<span style="color: #f43f5e; font-weight: bold;">Action: Unleveraging.</span> Will withdraw & sell PT collateral to completely clear your <span style="color: #f43f5e;">${(Number(levDebt) / 1e6).toFixed(2)} USDC</span> borrow debt. Position LTV will go to 0%.`;
    } else {
      const targetLtvBig = BigInt(Math.floor(targetLtv * 1e18));
      const currentLtvBig = levCollateral > 0n ? (levDebt * 10n ** 18n) / ((levCollateral * 95n * 10n ** 22n) / 10n ** 36n) : 0n;
      if (targetLtvBig < currentLtvBig) {
        actionText = `<span style="color: #38bdf8; font-weight: bold;">Action: Deleveraging.</span> Will withdraw and sell a portion of PT collateral for USDC to pay down borrow debt. Target LTV: <span style="color: #34d399;">${targetLtvPct}%</span>.`;
      } else if (Math.abs(Number(targetLtvBig - currentLtvBig)) < 1e15) {
        actionText = 'Target leverage matches current position leverage. No action required.';
      } else {
        actionText = `<span style="color: #34d399; font-weight: bold;">Action: Leveraging up.</span> Will borrow additional USDC via flashloan to buy and supply more PT collateral. Target LTV: <span style="color: #34d399;">${targetLtvPct}%</span>.`;
      }
    }
    metricsEl.innerHTML = `
      <strong>Simulated Target Metrics:</strong><br>
      Target Leverage: ${targetLeverage.toFixed(2)}x (LTV: ${targetLtvPct}%)<br>
      Liquidation Buffer: ${(86.0 - targetLtvPct).toFixed(2)}% margin to liquidation (86% LLTV)<br>
      <div style="margin-top: 8px; border-top: 1px dashed #475569; padding-top: 8px;">
        ${actionText}
      </div>
    `;
  }

  /**
   * Renders preview metrics and summary cards for rollover transactions.
   */
  renderRolloverPreview({
    sourceMarketParams,
    destMarketParams,
    expectedRate,
    impliedOldPriceUsdc,
    oracleRatio,
    oldOraclePriceUsdc,
    newOraclePriceUsdc,
    slippagePct,
    loanNotice = '',
    expectedOutput,
    borrowAmount,
    newLtv,
    newLeverage,
    finalCalldata,
    userAddress,
    maturity
  }) {
    if (!this.doc) return;
    const badgeEl = this.doc.getElementById('previewSlippageBadge');
    if (badgeEl) {
      badgeEl.innerText = `Price Impact: ${slippagePct.toFixed(2)}%`;
      badgeEl.style.display = 'inline-block';
      if (slippagePct < 0.5) {
        badgeEl.style.backgroundColor = '#10b981';
      } else if (slippagePct <= 1.5) {
        badgeEl.style.backgroundColor = '#f59e0b';
      } else {
        badgeEl.style.backgroundColor = '#ef4444';
      }
    }

    const maturityEl = this.doc.getElementById('maturityNotice');
    if (maturityEl) {
      maturityEl.style.display = maturity?.isExpired ? 'block' : 'none';
    }

    const metricsEl = this.doc.getElementById('previewMetrics');
    if (metricsEl) {
      metricsEl.innerHTML = `
      <div style="margin-bottom: 12px;">
        <strong style="color: #94a3b8; font-size: 12px; display: block; text-transform: uppercase; letter-spacing: 0.05em;">Token Swap Exchange Rates</strong>
        Expected Swap Rate: <span style="font-family: monospace; color: #f8fafc;">1 ${sourceMarketParams.collateralSymbol} = ${expectedRate.toFixed(4)} ${destMarketParams.collateralSymbol}</span> <span style="color: #94a3b8; font-size: 12px;">(Implied: 1 PT-old = $${impliedOldPriceUsdc.toFixed(4)})</span><br>
        Oracle Fair Value Rate: <span style="font-family: monospace; color: #f8fafc;">1 ${sourceMarketParams.collateralSymbol} = ${(Number(oracleRatio)/1e18).toFixed(4)} ${destMarketParams.collateralSymbol}</span> <span style="color: #94a3b8; font-size: 12px;">(Oracles: PT-old = $${oldOraclePriceUsdc.toFixed(4)}, PT-new = $${newOraclePriceUsdc.toFixed(4)})</span><br>
        Price Impact (vs. Oracle): <span style="font-weight: 600; color: ${slippagePct > 1.0 ? '#f87171' : '#34d399'}">${slippagePct.toFixed(2)}%</span>
        ${loanNotice}
      </div>
      
      <div style="margin-bottom: 12px;">
        <strong style="color: #94a3b8; font-size: 12px; display: block; text-transform: uppercase; letter-spacing: 0.05em;">Simulated Target Position</strong>
        Migrated Collateral: <span style="font-family: monospace; color: #38bdf8;">${expectedOutput} ${destMarketParams.collateralSymbol}</span><br>
        New Borrow Debt: <span style="font-family: monospace; color: #f43f5e;">${(Number(borrowAmount)/(10 ** destMarketParams.loanDecimals)).toFixed(2)} ${destMarketParams.loanSymbol}</span><br>
        New LTV & Leverage: <span style="color: #34d399;">${newLtv.toFixed(2)}% (${newLeverage})</span>
      </div>
      `;
    }

    const fromEl = this.doc.getElementById('rawFromAddress');
    if (fromEl) fromEl.innerText = userAddress;
    const calldataEl = this.doc.getElementById('rawCalldataTextarea');
    if (calldataEl) calldataEl.value = finalCalldata;
    const payloadContainer = this.doc.getElementById('payloadContainer');
    if (payloadContainer) payloadContainer.style.display = 'block';
    const previewContainer = this.doc.getElementById('previewContainer');
    if (previewContainer) previewContainer.style.display = 'block';
    const statusEl = this.doc.getElementById('status');
    if (statusEl) statusEl.style.display = 'none';
  }

  /**
   * Renders preview metrics for leverage adjustments.
   */
  renderLeveragePreview({
    quotedRate,
    oracleRate,
    slippagePct,
    detailsText,
    slippageLimit,
    userAddress,
    finalCalldata,
    maturity
  }) {
    if (!this.doc) return;
    const badgeEl = this.doc.getElementById('previewSlippageBadge');
    if (badgeEl) {
      badgeEl.innerText = `Price Impact: ${slippagePct.toFixed(2)}%`;
      badgeEl.style.display = 'inline-block';
      if (slippagePct < 0.5) {
        badgeEl.style.backgroundColor = '#10b981';
      } else if (slippagePct <= 1.5) {
        badgeEl.style.backgroundColor = '#f59e0b';
      } else {
        badgeEl.style.backgroundColor = '#ef4444';
      }
    }

    const maturityEl = this.doc.getElementById('maturityNotice');
    if (maturityEl) {
      maturityEl.style.display = maturity?.isExpired ? 'block' : 'none';
    }

    const metricsEl = this.doc.getElementById('previewMetrics');
    if (metricsEl) {
      metricsEl.innerHTML = `
      <div style="margin-bottom: 12px;">
        <strong style="color: #94a3b8; font-size: 12px; display: block; text-transform: uppercase; letter-spacing: 0.05em;">Execution Exchange Rates</strong>
        Expected Price: <span style="font-family: monospace; color: #f8fafc;">1 PT = ${(Number(quotedRate)/1e18).toFixed(4)} USDC</span><br>
        Oracle Price: <span style="font-family: monospace; color: #f8fafc;">1 PT = ${(Number(oracleRate)/1e18).toFixed(4)} USDC</span><br>
        Price Impact (vs. Oracle): <span style="font-weight: 600; color: ${slippagePct > 1.0 ? '#f87171' : '#34d399'}">${slippagePct.toFixed(2)}%</span>
      </div>
      
      <div style="margin-bottom: 12px;">
        <strong style="color: #94a3b8; font-size: 12px; display: block; text-transform: uppercase; letter-spacing: 0.05em;">Simulated Outputs</strong>
        ${detailsText}
        Slippage Tolerance Limit: <span style="font-family: monospace; color: #cbd5e1;">${slippageLimit.toFixed(1)}%</span>
      </div>
      `;
    }

    const fromEl = this.doc.getElementById('rawFromAddress');
    if (fromEl) fromEl.innerText = userAddress;
    const calldataEl = this.doc.getElementById('rawCalldataTextarea');
    if (calldataEl) calldataEl.value = finalCalldata;
    const payloadContainer = this.doc.getElementById('payloadContainer');
    if (payloadContainer) payloadContainer.style.display = 'block';
    const previewContainer = this.doc.getElementById('previewContainer');
    if (previewContainer) previewContainer.style.display = 'block';
    const statusEl = this.doc.getElementById('status');
    if (statusEl) statusEl.style.display = 'none';
  }

  /**
   * Renders simulation status, gas metrics, and execution trace tree.
   *
   * @param {string} containerId
   * @param {object} simResult
   */
  renderSimulationResult(containerId, simResult, options = {}) {
    if (!this.doc) return;
    const container = this.doc.getElementById(containerId);
    if (!container) return;

    const warningsEl = this.doc.getElementById('simulationWarningsContainer');
    if (warningsEl) {
      const mismatches = options.mismatches || [];
      if (mismatches.length > 0) {
        warningsEl.style.display = 'block';
        let warningText = `⚠️ Address Context Mismatch Detected in Calldata!\n`;
        warningText += `Transaction Sender: ${options.fromAddress || ''}\n\n`;
        mismatches.forEach(m => {
          warningText += `├── Function: ${m.functionName}\n`;
          warningText += `└── Encoded onBehalf: ${m.onBehalf} (does NOT match transaction sender)\n`;
        });
        warningText += `\nWithdrawal/borrow steps in General Adapter always act on the transaction sender. This transaction will likely revert on-chain.`;
        warningsEl.textContent = warningText;
      } else {
        warningsEl.style.display = 'none';
        warningsEl.textContent = '';
      }
    }

    const isSuccess = simResult.success === true;
    const statusClass = isSuccess ? 'status-success' : 'status-reverted';
    const statusText = isSuccess ? 'SIMULATION SUCCESSFUL' : 'SIMULATION REVERTED';

    let leakWarningHtml = '';
    if (simResult.leaks && simResult.leaks.length > 0) {
      leakWarningHtml = `
        <div class="alert alert-danger" style="color: #d9534f; background: #fdf7f7; padding: 8px; border: 1px solid #d9534f; border-radius: 4px; margin-top: 8px;">
          <strong>⚠️ Transient Contract Balance Leak Detected:</strong>
          <ul>
            ${simResult.leaks.map(l => `<li>Contract ${l.contract} retained ${l.balance.toString()} base units of ${l.token}</li>`).join('')}
          </ul>
        </div>
      `;
    }

    const gasUsedFormatted = simResult.gasUsed ? simResult.gasUsed.toLocaleString() : '0';
    const traceHtml = this.renderTraceNode(simResult.traceTree || simResult);

    container.innerHTML = `
      <div class="simulation-banner ${statusClass}" style="padding: 10px; margin-bottom: 10px; border-radius: 4px; font-weight: bold; background: ${isSuccess ? '#e6fffa' : '#ffe6e6'}; color: ${isSuccess ? '#006644' : '#cc0000'};">
        ${statusText} (Gas Used: ${gasUsedFormatted})
      </div>
      ${leakWarningHtml}
      <div class="trace-tree-container" style="max-height: 300px; overflow-y: auto; font-family: monospace; font-size: 12px; background: #f8f9fa; padding: 8px; border-radius: 4px;">
        ${traceHtml}
      </div>
    `;
    container.style.display = 'block';
  }

  /**
   * Generates HTML for an execution trace tree node.
   *
   * @param {object} node
   * @returns {string}
   */
  renderTraceNode(node) {
    if (!node) return '';
    const to = node.to || 'Unknown';
    const gas = node.gasUsed ? (typeof node.gasUsed === 'bigint' ? node.gasUsed.toString() : parseInt(node.gasUsed, 16)) : '0';
    const status = node.status === '0x1' || node.status === 1 ? '✅' : '❌';

    let subcallsHtml = '';
    if (node.calls && Array.isArray(node.calls) && node.calls.length > 0) {
      subcallsHtml = `<div class="subcalls" style="padding-left: 16px; border-left: 2px solid #ddd;">
        ${node.calls.map(subcall => this.renderTraceNode(subcall)).join('')}
      </div>`;
    }

    return `
      <div class="trace-node" style="margin-bottom: 4px;">
        <span>${status} <strong>${to}</strong> [Gas: ${gas}]</span>
        ${subcallsHtml}
      </div>
    `;
  }

  /**
   * Updates collateral input field proportionally based on entered debt amount in partial migration mode.
   *
   * @param {bigint} liveDebt
   * @param {bigint} liveCollateral
   * @param {number} [loanDecimals=6]
   * @param {number} [collateralDecimals=18]
   */
  updateProportionalCollateral(liveDebt, liveCollateral, loanDecimals = 6, collateralDecimals = 18) {
    if (!this.doc) return;
    const debtInput = this.doc.getElementById('debtAmount');
    const collInput = this.doc.getElementById('collateralAmount');
    if (!debtInput || !collInput) return;

    const debtInputVal = parseFloat(debtInput.value);
    if (isNaN(debtInputVal) || debtInputVal <= 0 || liveDebt === 0n) {
      collInput.value = '0.0000';
      return;
    }

    const debtInputBig = BigInt(Math.floor(debtInputVal * (10 ** loanDecimals)));
    if (debtInputBig > liveDebt) {
      debtInput.value = (Number(liveDebt) / (10 ** loanDecimals)).toFixed(2);
      collInput.value = (Number(liveCollateral) / (10 ** collateralDecimals)).toFixed(4);
      return;
    }

    const collateralWithdrawnBig = (liveCollateral * debtInputBig) / liveDebt;
    collInput.value = (Number(collateralWithdrawnBig) / (10 ** collateralDecimals)).toFixed(4);
  }
}
