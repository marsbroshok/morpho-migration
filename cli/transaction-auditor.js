import { getAddress } from 'viem';
import config from '../config.js';

const MORPHO_BUNDLER_V3 = config.MORPHO_BUNDLER_V3;
const ETHER_GENERAL_ADAPTER_1 = config.ETHER_GENERAL_ADAPTER_1;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export class TransactionAuditor {
  /**
   * @param {object} publicClient 
   */
  constructor(publicClient) {
    this.publicClient = publicClient;
  }

  /**
   * Parses the transaction receipt logs to audit realized prices and price impact.
   * @param {string} txHash 
   * @param {string} txType 'rollover' | 'leverage'
   * @param {object} details 
   */
  async auditRealizedPrice(txHash, txType, details) {
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });

    if (txType === 'rollover' && details.spentToken.toLowerCase() === details.receivedToken.toLowerCase()) {
      return {
        isSameCollateral: true,
        spentSymbol: details.spentSymbol || 'Collateral',
        receivedSymbol: details.receivedSymbol || 'Collateral',
        spentDecimals: details.spentDecimals,
        receivedDecimals: details.receivedDecimals
      };
    }

    let spentToken = getAddress(details.spentToken);
    let receivedToken = getAddress(details.receivedToken);
    let realizedRate = 0;
    let spentAmount = 0n;
    let receivedAmount = 0n;

    for (const log of receipt.logs) {
      if (log.topics[0] === TRANSFER_TOPIC && log.topics.length >= 3) {
        const value = BigInt(log.data === '0x' ? '0' : log.data);
        const tokenAddr = getAddress(log.address);
        const fromAddr = getAddress('0x' + log.topics[1].slice(26));
        const toAddr = getAddress('0x' + log.topics[2].slice(26));

        if (tokenAddr === spentToken && fromAddr === getAddress(MORPHO_BUNDLER_V3)) {
          spentAmount += value;
        }
        if (tokenAddr === receivedToken && toAddr === getAddress(ETHER_GENERAL_ADAPTER_1)) {
          receivedAmount += value;
        }
      }
    }

    if (spentAmount > 0n && receivedAmount > 0n) {
      const spentDecimals = BigInt(details.spentDecimals || 18);
      const receivedDecimals = BigInt(details.receivedDecimals || 18);

      if (txType === 'rollover') {
        const exponent = 18n + spentDecimals - receivedDecimals;
        realizedRate = Number(receivedAmount * 10n ** exponent / spentAmount) / 1e18;
        let realizedPriceImpact;
        if (details.oracleRate) {
          realizedPriceImpact = ((details.oracleRate - realizedRate) / details.oracleRate) * 100;
        }
        return {
          spentAmount,
          receivedAmount,
          realizedRate,
          estimatedRate: details.estimatedRate,
          realizedPriceImpact,
          estimatedPriceImpact: details.estimatedPriceImpact,
          spentDecimals: Number(spentDecimals),
          receivedDecimals: Number(receivedDecimals),
          spentSymbol: details.spentSymbol,
          receivedSymbol: details.receivedSymbol
        };
      } else if (txType === 'leverage') {
        if (details.isLeverageUp) {
          const exponent = 18n + receivedDecimals - spentDecimals;
          realizedRate = Number(spentAmount * 10n ** exponent / receivedAmount) / 1e18; // Price of 1 PT in USDC
        } else {
          const exponent = 18n + spentDecimals - receivedDecimals;
          realizedRate = Number(receivedAmount * 10n ** exponent / spentAmount) / 1e18; // Price of 1 PT in USDC
        }
        let realizedPriceImpact;
        if (details.oracleRate) {
          realizedPriceImpact = ((details.oracleRate - realizedRate) / details.oracleRate) * 100;
        }
        return {
          spentAmount,
          receivedAmount,
          realizedRate,
          estimatedRate: details.estimatedRate,
          realizedPriceImpact,
          estimatedPriceImpact: details.estimatedPriceImpact,
          isLeverageUp: details.isLeverageUp,
          spentDecimals: Number(spentDecimals),
          receivedDecimals: Number(receivedDecimals),
          spentSymbol: details.spentSymbol,
          receivedSymbol: details.receivedSymbol
        };
      }
    } else {
      return {
        error: "Could not find relevant transfer logs for spent/received tokens."
      };
    }
  }
}
