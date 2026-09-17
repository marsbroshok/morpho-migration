/**
 * @fileoverview Transaction receipt audit workflow for analyzing realized exchange rates and price impacts.
 */

import { getAddress } from 'viem';
import config from '../../../config.js';

export class AuditWorkflow {
  /**
   * @param {object} [options]
   * @param {string} [options.bundlerAddress]
   * @param {string} [options.adapterAddress]
   */
  constructor(options = {}) {
    this.bundlerAddress = options.bundlerAddress || config.MORPHO_BUNDLER_V3;
    this.adapterAddress = options.adapterAddress || config.ETHER_GENERAL_ADAPTER_1;
  }

  /**
   * Audits realized swap rates and price impact from mined transaction receipt logs.
   *
   * @param {object} params
   * @param {string} params.txHash
   * @param {object} params.publicClient
   * @param {object} params.pendingTx
   * @param {HTMLElement} [params.statusEl]
   * @param {string} [params.oldPt]
   * @param {string} [params.newPt]
   * @param {string} [params.usdc]
   * @returns {Promise<object>}
   */
  async auditRealizedPrice({ txHash, publicClient, pendingTx, statusEl, oldPt, newPt, usdc }) {
    if (!publicClient) return null;
    try {
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
      let spentToken = null;
      let receivedToken = null;
      let isLeverageUp = false;

      if (pendingTx) {
        if (pendingTx.type === 'rollover') {
          spentToken = oldPt ? getAddress(oldPt) : null;
          receivedToken = newPt ? getAddress(newPt) : null;
        } else if (pendingTx.type === 'leverage') {
          if (pendingTx.subType === 'deleverage') {
            spentToken = oldPt ? getAddress(oldPt) : null;
            receivedToken = usdc ? getAddress(usdc) : null;
          } else if (pendingTx.subType === 'leverage_up') {
            spentToken = usdc ? getAddress(usdc) : null;
            receivedToken = oldPt ? getAddress(oldPt) : null;
            isLeverageUp = true;
          }
        }
      }

      let spentAmount = 0n;
      let receivedAmount = 0n;

      for (const log of (receipt.logs || [])) {
        if (log.topics && log.topics[0] === TRANSFER_TOPIC && log.topics.length >= 3) {
          const value = BigInt(log.data === '0x' || !log.data ? '0' : log.data);
          const tokenAddr = getAddress(log.address);
          const fromAddr = getAddress('0x' + log.topics[1].slice(26));
          const toAddr = getAddress('0x' + log.topics[2].slice(26));

          if (spentToken && tokenAddr === spentToken && fromAddr === getAddress(this.bundlerAddress)) {
            spentAmount += value;
          }
          if (receivedToken && tokenAddr === receivedToken && toAddr === getAddress(this.adapterAddress)) {
            receivedAmount += value;
          }
        }
      }

      let auditMessage = '';
      if (spentAmount > 0n && receivedAmount > 0n) {
        let realizedRate = 0;
        if (pendingTx && pendingTx.type === 'rollover') {
          realizedRate = Number(receivedAmount * 10n ** 18n / spentAmount) / 1e18;
          const rateCompare = ` (Estimated: ${pendingTx.estimatedRate.toFixed(4)} PT-new)`;
          let priceImpactMessage = '';
          if (pendingTx.oracleRate) {
            const realizedPriceImpact = ((pendingTx.oracleRate - realizedRate) / pendingTx.oracleRate) * 100;
            priceImpactMessage = `\nRealized Price Impact: ${realizedPriceImpact.toFixed(2)}% (Estimated: ${pendingTx.estimatedPriceImpact.toFixed(2)}%, vs. Oracle).`;
          }
          auditMessage = `\n[Post-Execution Audit]\nRealized Swap Rate: 1 PT-old = ${realizedRate.toFixed(4)} PT-new${rateCompare}.${priceImpactMessage}\n(Checked via transfer events: spent ${spentAmount / 10n ** 18n} PT, received ${receivedAmount / 10n ** 18n} PT).`;
        } else if (pendingTx && pendingTx.type === 'leverage') {
          if (isLeverageUp) {
            realizedRate = Number(spentAmount * 10n ** 30n / receivedAmount) / 1e18;
            const rateCompare = ` (Estimated: ${pendingTx.estimatedRate.toFixed(4)} USDC)`;
            let priceImpactMessage = '';
            if (pendingTx.oracleRate) {
              const realizedPriceImpact = ((pendingTx.oracleRate - realizedRate) / pendingTx.oracleRate) * 100;
              priceImpactMessage = `\nRealized Price Impact: ${realizedPriceImpact.toFixed(2)}% (Estimated: ${pendingTx.estimatedPriceImpact.toFixed(2)}%, vs. Oracle).`;
            }
            auditMessage = `\n[Post-Execution Audit]\nRealized Exchange Rate: 1 PT = ${realizedRate.toFixed(4)} USDC${rateCompare}.${priceImpactMessage}\n(Checked via transfer events: spent ${spentAmount / 10n ** 6n} USDC, received ${receivedAmount / 10n ** 18n} PT).`;
          } else {
            realizedRate = Number(receivedAmount * 10n ** 30n / spentAmount) / 1e18;
            const rateCompare = ` (Estimated: ${pendingTx.estimatedRate.toFixed(4)} USDC)`;
            let priceImpactMessage = '';
            if (pendingTx.oracleRate) {
              const realizedPriceImpact = ((pendingTx.oracleRate - realizedRate) / pendingTx.oracleRate) * 100;
              priceImpactMessage = `\nRealized Price Impact: ${realizedPriceImpact.toFixed(2)}% (Estimated: ${pendingTx.estimatedPriceImpact.toFixed(2)}%, vs. Oracle).`;
            }
            auditMessage = `\n[Post-Execution Audit]\nRealized Exchange Rate: 1 PT = ${realizedRate.toFixed(4)} USDC${rateCompare}.${priceImpactMessage}\n(Checked via transfer events: spent ${spentAmount / 10n ** 18n} PT, received ${receivedAmount / 10n ** 6n} USDC).`;
          }
        }
      }

      if (statusEl) {
        statusEl.className = 'success';
        statusEl.innerText = `Migration Transaction Confirmed Successfully!\n\nTx Hash: ${txHash}\n${auditMessage}`;
      }

      return {
        spentAmount,
        receivedAmount,
        auditMessage,
        success: true
      };
    } catch (err) {
      if (statusEl) {
        statusEl.className = 'success';
        statusEl.innerText = `Migration Transaction Confirmed!\n\nTx Hash: ${txHash}\n\nNote: Transaction confirmed, but realized price audit failed: ${err.message}`;
      }
      return { success: false, error: err.message };
    }
  }
}
