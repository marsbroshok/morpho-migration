import { getAddress } from 'viem';

const MORPHO_BUNDLER_V3 = "0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245";
const ETHER_GENERAL_ADAPTER_1 = "0x4A6c312ec70E8747a587EE860a0353cd42Be0aE0";
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
      if (txType === 'rollover') {
        realizedRate = Number(receivedAmount * 10n ** 18n / spentAmount) / 1e18;
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
          estimatedPriceImpact: details.estimatedPriceImpact
        };
      } else if (txType === 'leverage') {
        if (details.isLeverageUp) {
          realizedRate = Number(spentAmount * 10n ** 30n / receivedAmount) / 1e18; // Price of 1 PT in USDC
        } else {
          realizedRate = Number(receivedAmount * 10n ** 30n / spentAmount) / 1e18; // Price of 1 PT in USDC
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
          isLeverageUp: details.isLeverageUp
        };
      }
    } else {
      return {
        error: "Could not find relevant transfer logs for spent/received tokens."
      };
    }
  }
}
