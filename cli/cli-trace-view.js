/**
 * @fileoverview Formatter and printer for transaction call traces, simulation summaries, and post-execution audits.
 */

import { CliFormatter } from './formatter.js';

export class CliTraceView {
  /**
   * @param {AddressLabelResolver} labelResolver
   */
  constructor(labelResolver) {
    this.labelResolver = labelResolver;
  }

  /**
   * Recursively print call traces in the console with resolved address labels.
   *
   * @param {object} call
   * @param {number} [depth=0]
   * @param {object} [marketParams=null]
   */
  async printCallTrace(call, depth = 0, marketParams = null) {
    const indent = '  '.repeat(depth);
    const toAddress = call.to || 'Unknown';
    const label = await this.labelResolver.resolveLabel(toAddress, marketParams);

    const targetDisplay = label
      ? `${CliFormatter.color(label, 'cyan')} [${CliFormatter.color(toAddress, 'gray')}]`
      : CliFormatter.color(toAddress, 'gray');

    const status = call.status === '0x1'
      ? CliFormatter.color('SUCCESS', 'green')
      : CliFormatter.color('REVERT', 'red');

    const valueStr = call.value ? BigInt(call.value).toString() : '0';
    const gas = parseInt(call.gasUsed, 16);
    console.log(`${indent}└── [CALL] To: ${targetDisplay} | Value: ${valueStr} | Status: ${status} | Gas: ${gas.toLocaleString()}`);

    if (call.error) {
      console.log(`${indent}    ${CliFormatter.color('⚠ Error: ' + call.error.message, 'red')}`);
    }

    if (call.calls && Array.isArray(call.calls)) {
      for (const subcall of call.calls) {
        await this.printCallTrace(subcall, depth + 1, marketParams);
      }
    }
  }

  /**
   * Render simulated execution summary block.
   *
   * @param {object} simResult
   * @param {object} [marketParams=null]
   */
  async printSimulationSummary(simResult, marketParams = null) {
    CliFormatter.printSubHeader('6. Mainnet Fork Simulation Result');
    if (!simResult.success) {
      console.log(`  ${CliFormatter.color('❌ TRANSACTION SIMULATION REVERTED!', 'red')}`);
      if (simResult.error) {
        console.log(`  ${CliFormatter.color('Revert Reason: ' + (simResult.error.message || JSON.stringify(simResult.error)), 'red')}`);
      }
    } else {
      console.log(`  ${CliFormatter.color('✅ TRANSACTION SIMULATION SUCCESSFUL!', 'green')}`);
      CliFormatter.printItem('Gas Used', simResult.gasUsed.toLocaleString());
      const ethCost = Number(simResult.gasUsed) * 15 / 1e9;
      CliFormatter.printItem('Est. Net Cost', `${ethCost.toFixed(6)} ETH`);
    }

    if (simResult.traceTree) {
      console.log(`\n  ${CliFormatter.color('Simulation Call Trace:', 'bold')}`);
      await this.printCallTrace(simResult.traceTree, 1, marketParams);
    }
  }

  /**
   * Render real transaction submission confirmation.
   *
   * @param {string} txHash
   */
  printTransactionSubmitted(txHash) {
    CliFormatter.printSubHeader('6. Transaction Submission');
    console.log(`  ${CliFormatter.color('🚀 Transaction submitted successfully!', 'green')}`);
    CliFormatter.printItem('Transaction Hash', txHash, 'cyan');
    console.log('  Waiting for block confirmations...');
  }

  /**
   * Print post-execution audit results.
   *
   * @param {string} txType
   * @param {object} audit
   */
  printPostExecutionAudit(txType, audit) {
    CliFormatter.printSubHeader('Post-Execution Audit');
    if (audit.error) {
      console.log(`  ${CliFormatter.color('⚠ Audit Warning: ' + audit.error, 'yellow')}`);
      return;
    }

    if (txType === 'rollover') {
      if (audit.isSameCollateral) {
        console.log(`  ${CliFormatter.color('Direct Rollover: Same collateral asset used for both markets (No swap required).', 'green')}`);
        return;
      }
      const spentSym = audit.spentSymbol || 'PT-old';
      const receivedSym = audit.receivedSymbol || 'PT-new';
      CliFormatter.printItem('Realized Swap Rate', `1 ${spentSym} = ${audit.realizedRate.toFixed(4)} ${receivedSym}`);
      CliFormatter.printItem('Estimated Swap Rate', `${audit.estimatedRate.toFixed(4)} ${receivedSym}`, 'gray');
      if (audit.realizedPriceImpact !== undefined) {
        CliFormatter.printItem('Realized Price Impact', `${audit.realizedPriceImpact.toFixed(2)}% (vs. Oracle)`);
        CliFormatter.printItem('Estimated Price Impact', `${audit.estimatedPriceImpact.toFixed(2)}%`, 'gray');
      }
      console.log(`  ${CliFormatter.color(`(Verified: spent ${CliFormatter.formatAmount(audit.spentAmount, audit.spentDecimals || 18)} ${spentSym}, received ${CliFormatter.formatAmount(audit.receivedAmount, audit.receivedDecimals || 18)} ${receivedSym})`, 'gray')}`);
    } else {
      const spentSym = audit.spentSymbol || (audit.isLeverageUp ? 'USDC' : 'PT');
      const receivedSym = audit.receivedSymbol || (audit.isLeverageUp ? 'PT' : 'USDC');
      const spentDec = audit.spentDecimals || (audit.isLeverageUp ? 6 : 18);
      const receivedDec = audit.receivedDecimals || (audit.isLeverageUp ? 18 : 6);

      CliFormatter.printItem('Realized Exchange Rate', `1 ${audit.isLeverageUp ? receivedSym : spentSym} = ${audit.realizedRate.toFixed(4)} ${audit.isLeverageUp ? spentSym : receivedSym}`);
      CliFormatter.printItem('Estimated Rate', `${audit.estimatedRate.toFixed(4)} ${audit.isLeverageUp ? spentSym : receivedSym}`, 'gray');
      if (audit.realizedPriceImpact !== undefined) {
        CliFormatter.printItem('Realized Price Impact', `${audit.realizedPriceImpact.toFixed(2)}% (vs. Oracle)`);
        CliFormatter.printItem('Estimated Price Impact', `${audit.estimatedPriceImpact.toFixed(2)}%`, 'gray');
      }
      console.log(`  ${CliFormatter.color(`(Verified: spent ${CliFormatter.formatAmount(audit.spentAmount, spentDec, spentDec === 6 ? 2 : 8)} ${spentSym}, received ${CliFormatter.formatAmount(audit.receivedAmount, receivedDec, receivedDec === 6 ? 2 : 8)} ${receivedSym})`, 'gray')}`);
    }
  }
}
