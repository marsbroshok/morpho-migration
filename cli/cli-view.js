import { CliFormatter } from './formatter.js';
import { CliHelpView } from './cli-help-view.js';
import { CliTraceView } from './cli-trace-view.js';

export class CliView {
  /**
   * @param {AddressLabelResolver} labelResolver
   */
  constructor(labelResolver) {
    this.labelResolver = labelResolver;
    this.traceView = new CliTraceView(labelResolver);
  }

  /**
   * Prints the Raw Transaction Simulation pre-execution assessment dashboard.
   * @param {object} data
   */
  printRawSimulationAssessment(data) {
    CliFormatter.printHeader('Raw Transaction Simulation');
    CliFormatter.printItem('From Address', data.from, 'cyan');
    CliFormatter.printItem('To Address', data.to, 'cyan');
    CliFormatter.printItem('Value', `${data.value.toString()} wei`);
    CliFormatter.printItem('Calldata Length', `${(data.data.length - 2) / 2} bytes`);
  }

  /**
   * Prints the Rollover command pre-execution dashboard.
   * @param {object} data
   */
  /**
   * Prints the Rollover command pre-execution dashboard.
   * @param {object} data
   */
  printRolloverDashboard(data) {
    this.printRolloverAssessment(data);
    this.printSwapRouting(data.swap, data.oldMarket, data.newMarket, data.sourceMarketParams, data.destMarketParams);
    this.printProjectedMetricsAndCalldata(data);
  }

  /**
   * Prints the Rollover configuration and position assessment (Immediate).
   */
  printRolloverAssessment(data) {
    CliFormatter.printHeader('Morpho Position Rollover');
    CliFormatter.printItem('User Address', data.userAddress, 'cyan');
    CliFormatter.printItem('Execution Mode', data.simulation ? 'Simulation (Fork Dry-Run)' : 'Live Submission', 'cyan');
    CliFormatter.printItem('Slippage Tolerance', `${data.slippage}%`);

    CliFormatter.printSubHeader('1. Market Configurations');
    console.log(`  Source Market : ${data.sourceMarketId}`);
    console.log(`  ├── Collateral : ${data.oldMarket.collateralSymbol} (${data.oldMarket.collateralToken})`);
    console.log(`  └── Loan Asset : ${data.oldMarket.loanSymbol} (${data.oldMarket.loanToken})`);

    console.log(`\n  Target Market : ${data.destMarketId}`);
    console.log(`  ├── Collateral : ${data.newMarket.collateralSymbol} (${data.newMarket.collateralToken})`);
    console.log(`  └── Loan Asset : ${data.newMarket.loanSymbol} (${data.newMarket.loanToken})`);

    CliFormatter.printSubHeader('2. Position Assessment');
    if (data.maturity.expiryDate !== 'Unknown') {
      const oldMaturityStr = `Expired: ${data.maturity.isExpired} (Maturity Date: ${data.maturity.expiryDate})`;
      CliFormatter.printItem('Old Maturity', oldMaturityStr, data.maturity.isExpired ? 'yellow' : 'reset');
    }
    CliFormatter.printItem('Collateral Balance', `${CliFormatter.formatAmount(data.position.collateral, data.sourceMarketParams.collateralDecimals)} ${data.oldMarket.collateralSymbol}`);
    CliFormatter.printItem('Borrowed Debt', `${CliFormatter.formatAmount(data.position.debt, data.sourceMarketParams.loanDecimals, 2)} ${data.oldMarket.loanSymbol}`);
    
    console.log(`\n  Migration Plan (${data.type.toUpperCase()} ROLLOVER):`);
    CliFormatter.printItem('Debt Repayment', `${CliFormatter.formatAmount(data.debtAmount, data.sourceMarketParams.loanDecimals, 2)} ${data.oldMarket.loanSymbol}`);
    CliFormatter.printItem('Collateral Migrated', `${CliFormatter.formatAmount(data.collateralAmount, data.sourceMarketParams.collateralDecimals)} ${data.oldMarket.collateralSymbol}`);
  }

  /**
   * Prints the Swap Routing details.
   */
  printSwapRouting(swap, oldMarket, newMarket, sourceMarketParams, destMarketParams) {
    CliFormatter.printSubHeader('3. Swap Routing');
    if (swap.isSameCollateral) {
      CliFormatter.printItem('Collateral Swap', 'None (Same collateral asset)');
    } else {
      CliFormatter.printItem('Collateral Swap Path', `${oldMarket.collateralSymbol} ➔ ${newMarket.collateralSymbol}`);
      CliFormatter.printItem('Expected Collateral Rate', `1 ${oldMarket.collateralSymbol} = ${swap.expectedRate.toFixed(4)} ${newMarket.collateralSymbol}`);
      CliFormatter.printItem('Oracle Collateral Rate', `1 ${oldMarket.collateralSymbol} = ${swap.oracleRate.toFixed(4)} ${newMarket.collateralSymbol}`);
      CliFormatter.printItem('Collateral Price Impact', `${swap.priceImpact.toFixed(2)}%`, swap.priceImpact > 2.0 ? 'yellow' : 'green');
      CliFormatter.printItem('Expected Collateral Output', `${CliFormatter.formatAmount(swap.expectedOutput, destMarketParams.collateralDecimals)} ${newMarket.collateralSymbol}`);
    }

    if (!swap.isSameLoan) {
      CliFormatter.printSubHeader('3b. Cross-Loan-Asset Swap');
      CliFormatter.printItem('Loan Swap Path', `${newMarket.loanSymbol} ➔ ${oldMarket.loanSymbol}`);
      const scaleExp = 18n + BigInt(destMarketParams.loanDecimals) - BigInt(sourceMarketParams.loanDecimals);
      const rate = swap.loanExpectedInput > 0n ? Number(swap.loanExpectedOutput * 10n ** scaleExp / swap.loanExpectedInput) / 1e18 : 0.0;
      CliFormatter.printItem('Expected Loan Rate', `1 ${newMarket.loanSymbol} = ${rate.toFixed(4)} ${oldMarket.loanSymbol}`);
      CliFormatter.printItem('Oracle Loan Rate', `1 ${newMarket.loanSymbol} = ${(Number(swap.loanOracleRate) / 1e18).toFixed(4)} ${oldMarket.loanSymbol}`);
      CliFormatter.printItem('Loan Price Impact', `${swap.loanPriceImpact.toFixed(2)}%`, swap.loanPriceImpact > 2.0 ? 'yellow' : 'green');
      CliFormatter.printItem('Expected Loan Output', `${CliFormatter.formatAmount(swap.loanExpectedOutput, sourceMarketParams.loanDecimals, 2)} ${oldMarket.loanSymbol}`);
    }
  }

  /**
   * Prints the projected metrics and decoded bundle steps.
   */
  printProjectedMetricsAndCalldata(data) {
    CliFormatter.printSubHeader('4. Projected Target Metrics');
    CliFormatter.printItem('Simulated Collateral', `${CliFormatter.formatAmount(data.swap.expectedOutput, data.destMarketParams.collateralDecimals)} ${data.newMarket.collateralSymbol}`);
    CliFormatter.printItem('Simulated New Debt', `${CliFormatter.formatAmount(data.simulatedNewDebt, data.destMarketParams.loanDecimals, 2)} ${data.newMarket.loanSymbol}`);
    CliFormatter.printItem('Projected LTV', `${data.newLtv.toFixed(2)}% (Leverage: ${data.newLeverage})`);

    if (!data.swap.isSameLoan) {
      CliFormatter.printSubHeader('4b. Loan Asset Swap Slippage & Out-of-pocket Costs');
      
      const oldLoanDec = data.sourceMarketParams.loanDecimals;
      const priceImpact = data.swap.loanPriceImpact;
      const fmvLossDisplay = CliFormatter.formatAmount(data.loanFairValueLoss, oldLoanDec, 2);
      
      CliFormatter.printItem('Loan Swap Slippage Loss', `${fmvLossDisplay} ${data.oldMarket.loanSymbol} (${priceImpact.toFixed(2)}% haircut)`);
      
      if (data.loanWalletShortfall > 0n) {
        const shortfallDisplay = CliFormatter.formatAmount(data.loanWalletShortfall, oldLoanDec, 2);
        console.log(`\n  ${CliFormatter.color('⚠️  Out-of-Pocket Funding Required:', 'yellow')}`);
        console.log(`  You must have at least ${CliFormatter.color(shortfallDisplay, 'yellow')} ${data.oldMarket.loanSymbol} in your wallet to cover the swap deficit,`);
        console.log(`  otherwise the transaction will revert at the flashloan repayment step.`);
      } else {
        const surplus = -data.loanWalletShortfall;
        const surplusDisplay = CliFormatter.formatAmount(surplus, oldLoanDec, 2);
        console.log(`\n  ${CliFormatter.color('🎉 Expected Swap Surplus:', 'green')}`);
        console.log(`  Swap returned an extra ${CliFormatter.color(surplusDisplay, 'green')} ${data.oldMarket.loanSymbol} which will be transferred back to your wallet.`);
      }
      
      if (priceImpact > 2.0) {
        console.log(`\n  ${CliFormatter.color('⚠️  High Price Impact Warning:', 'yellow')}`);
        console.log(`  Selling ${data.newMarket.loanSymbol} directly results in a high slippage haircut (${priceImpact.toFixed(2)}%).`);
        console.log(`  Consider executing this rollover in smaller tranches to minimize pool impact.`);
      }
    }

    CliFormatter.printSubHeader('5. Decoded Callback Bundle Steps');
    data.steps.forEach((step, idx) => {
      console.log(`  ├── ${idx + 1}. ${step}`);
    });
  }

  /**
   * Prints the Leverage command pre-execution dashboard.
   * @param {object} data
   */
  printLeverageDashboard(data) {
    this.printLeverageAssessment(data);
    this.printLeverageSwapRouting(data.swap, data.mode === 'leverage-up', data.market, data.marketParams);
    this.printLeverageCalldataSteps(data);
  }

  /**
   * Prints the leverage position assessment details (Immediate).
   */
  printLeverageAssessment(data) {
    const isLeverageUp = data.mode === 'leverage-up';
    CliFormatter.printHeader(isLeverageUp ? 'Increase Leverage Position' : 'Deleverage Position');
    CliFormatter.printItem('User Address', data.userAddress, 'cyan');
    CliFormatter.printItem('Execution Mode', data.simulation ? 'Simulation (Fork Dry-Run)' : 'Live Submission', 'cyan');
    CliFormatter.printItem('Slippage Tolerance', `${data.slippage}%`);

    CliFormatter.printSubHeader('1. Market Configuration');
    console.log(`  Market ID    : ${data.marketId}`);
    console.log(`  ├── Collateral : ${data.market.collateralSymbol} (${data.market.collateralToken})`);
    console.log(`  └── Loan Asset : ${data.market.loanSymbol} (${data.market.loanToken})`);

    CliFormatter.printSubHeader('2. Position Assessment');
    if (data.maturity.expiryDate !== 'Unknown') {
      const maturityStr = `Expired: ${data.maturity.isExpired} (Maturity Date: ${data.maturity.expiryDate})`;
      CliFormatter.printItem('Collateral Maturity', maturityStr, data.maturity.isExpired ? 'yellow' : 'reset');
    }
    CliFormatter.printItem('Collateral Balance', `${CliFormatter.formatAmount(data.position.collateral, data.marketParams.collateralDecimals)} ${data.market.collateralSymbol}`);
    CliFormatter.printItem('Borrowed Debt', `${CliFormatter.formatAmount(data.position.debt, data.marketParams.loanDecimals, 2)} ${data.market.loanSymbol}`);

    console.log(`\n  Leverage Target Solver:`);
    CliFormatter.printItem('Adjustment Mode', data.mode.toUpperCase(), 'magenta');
    CliFormatter.printItem('Collateral Adjustment', `${CliFormatter.formatAmount(data.collateralAdjustment, data.marketParams.collateralDecimals)} ${data.market.collateralSymbol}`);
    CliFormatter.printItem('Debt Adjustment', `${CliFormatter.formatAmount(data.debtAdjustment, data.marketParams.loanDecimals, 2)} ${data.market.loanSymbol}`);
  }

  /**
   * Prints swap routing for leverage command.
   */
  printLeverageSwapRouting(swap, isLeverageUp, market, marketParams) {
    CliFormatter.printSubHeader('3. Swap Routing');
    const pathStr = isLeverageUp ? `${market.loanSymbol} ➔ ${market.collateralSymbol}` : `${market.collateralSymbol} ➔ ${market.loanSymbol}`;
    CliFormatter.printItem('Swap Path', pathStr);
    CliFormatter.printItem('Expected Swap Price', `1 ${market.collateralSymbol} = ${swap.expectedRate.toFixed(4)} ${market.loanSymbol}`);
    CliFormatter.printItem('Oracle Price', `1 ${market.collateralSymbol} = ${swap.oracleRate.toFixed(4)} ${market.loanSymbol}`);
    CliFormatter.printItem('Price Impact', `${swap.priceImpact.toFixed(2)}%`, swap.priceImpact > 2.0 ? 'yellow' : 'green');
    CliFormatter.printItem('Expected Output', isLeverageUp ? `${CliFormatter.formatAmount(swap.expectedOutput, marketParams.collateralDecimals)} ${market.collateralSymbol}` : `${CliFormatter.formatAmount(swap.expectedOutput, marketParams.loanDecimals, 2)} ${market.loanSymbol}`);
  }

  /**
   * Prints calldata steps and projected leverage target metrics.
   */
  printLeverageCalldataSteps(data) {
    CliFormatter.printSubHeader('4. Projected Target Metrics');
    CliFormatter.printItem('Target Leverage', `${data.targetLeverage.toFixed(2)}x (LTV: ${(1.0 - 1.0/data.targetLeverage)*100}%)`);

    const isDeleveraging = (data.mode === 'deleverage' || data.mode === 'deleverage-to-1x');
    const loanDec = data.marketParams.loanDecimals;
    
    if (isDeleveraging) {
      CliFormatter.printSubHeader('4b. Swap Execution Costs & Deficit');
      
      const fmvDisplay = CliFormatter.formatAmount(data.fairMarketValue, loanDec, 2);
      const outputDisplay = CliFormatter.formatAmount(data.swap.expectedOutput, loanDec, 2);
      const lossDisplay = CliFormatter.formatAmount(data.fairValueLoss, loanDec, 2);
      const priceImpact = data.swap.priceImpact;
      
      CliFormatter.printItem('Collateral Fair Value', `${fmvDisplay} ${data.market.loanSymbol}`);
      CliFormatter.printItem('Expected Swap Output', `${outputDisplay} ${data.market.loanSymbol}`);
      CliFormatter.printItem('Execution Slippage Loss', `${lossDisplay} ${data.market.loanSymbol} (${priceImpact.toFixed(2)}% haircut)`);
      
      if (data.walletShortfall > 0n) {
        const shortfallDisplay = CliFormatter.formatAmount(data.walletShortfall, loanDec, 2);
        console.log(`\n  ${CliFormatter.color('⚠️  Out-of-Pocket Funding Required:', 'yellow')}`);
        console.log(`  You must have at least ${CliFormatter.color(shortfallDisplay, 'yellow')} ${data.market.loanSymbol} in your wallet to cover the swap deficit,`);
        console.log(`  otherwise the transaction will revert at the flashloan repayment step.`);
      } else {
        const surplus = -data.walletShortfall;
        const surplusDisplay = CliFormatter.formatAmount(surplus, loanDec, 2);
        console.log(`\n  ${CliFormatter.color('🎉 Expected Swap Surplus:', 'green')}`);
        console.log(`  Swap returned an extra ${CliFormatter.color(surplusDisplay, 'green')} ${data.market.loanSymbol} which will be transferred back to your wallet.`);
      }

      if (priceImpact > 2.0) {
        console.log(`\n  ${CliFormatter.color('⚠️  High Price Impact Warning:', 'yellow')}`);
        console.log(`  Selling ${data.market.collateralSymbol} directly results in a high slippage haircut (${priceImpact.toFixed(2)}%).`);
        console.log(`  Consider executing this leverage adjustment in smaller tranches over a few days`);
        console.log(`  or depositing ${data.market.loanSymbol} directly into the market to pay down debt without selling collateral.`);
      }
    } else {
      CliFormatter.printSubHeader('4b. Swap Execution Costs');
      const fmvDisplay = CliFormatter.formatAmount(data.fairMarketValue, loanDec, 2);
      const spentDisplay = CliFormatter.formatAmount(data.params.debtAmount, loanDec, 2);
      const lossDisplay = CliFormatter.formatAmount(data.fairValueLoss, loanDec, 2);
      const priceImpact = data.swap.priceImpact;

      CliFormatter.printItem('USDC Spent (Debt Added)', `${spentDisplay} ${data.market.loanSymbol}`);
      CliFormatter.printItem('Collateral Purchased (FMV)', `${fmvDisplay} ${data.market.loanSymbol}`);
      CliFormatter.printItem('Execution Slippage Loss', `${lossDisplay} ${data.market.loanSymbol} (${priceImpact.toFixed(2)}% haircut)`);
      
      if (priceImpact > 2.0) {
        console.log(`\n  ${CliFormatter.color('⚠️  High Price Impact Warning:', 'yellow')}`);
        console.log(`  Buying ${data.market.collateralSymbol} directly results in a high slippage haircut (${priceImpact.toFixed(2)}%).`);
        console.log(`  Consider leveraging up in smaller tranches to minimize pool impact.`);
      }
    }

    CliFormatter.printSubHeader('5. Decoded Callback Bundle Steps');
    data.steps.forEach((step, idx) => {
      console.log(`  ├── ${idx + 1}. ${step}`);
    });
  }

  async printCallTrace(call, depth = 0, marketParams = null) {
    return this.traceView.printCallTrace(call, depth, marketParams);
  }

  async printSimulationSummary(simResult, marketParams = null) {
    return this.traceView.printSimulationSummary(simResult, marketParams);
  }

  printTransactionSubmitted(txHash) {
    return this.traceView.printTransactionSubmitted(txHash);
  }

  printPostExecutionAudit(txType, audit) {
    return this.traceView.printPostExecutionAudit(txType, audit);
  }

  static printHelp(command) {
    return CliHelpView.printHelp(command);
  }

  /**
   * Prints the gathered debug information after the execution finishes.
   * @param {object} debugInfo
   */
  printDebugData(debugInfo) {
    CliFormatter.printHeader('DEBUG INFORMATION');
    
    if (debugInfo.swapRequests && debugInfo.swapRequests.length > 0) {
      CliFormatter.printSubHeader('Swap Router Requests & Responses');
      debugInfo.swapRequests.forEach((req, idx) => {
        console.log(`\n  --- Swap Request #${idx + 1} ---`);
        console.log(`  URL: ${req.url}`);
        console.log(`  Request Body:`);
        console.log(JSON.stringify(req.request, null, 2).split('\n').map(l => '    ' + l).join('\n'));
        console.log(`  Response:`);
        console.log(JSON.stringify(req.response, null, 2).split('\n').map(l => '    ' + l).join('\n'));
      });
    }

    if (debugInfo.rawCalldata) {
      CliFormatter.printSubHeader('Raw Multicall Calldata Payload');
      console.log(debugInfo.rawCalldata);
    }

    if (debugInfo.alchemyResponse) {
      CliFormatter.printSubHeader('Full Alchemy response');
      console.log(JSON.stringify(debugInfo.alchemyResponse, null, 2));
    }
    console.log();
  }
}

