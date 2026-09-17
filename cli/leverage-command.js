/**
 * @fileoverview Leverage CLI command controller for adjusting Morpho Blue positions.
 */

import { getAddress } from 'viem';
import { LtvCalculator } from '../src/core/math/ltv-calculator.js';
import { LeverageBundleBuilder } from '../src/core/builders/leverage-bundle-builder.js';
import { ApprovalBuilder } from '../src/core/builders/approval-builder.js';
import { LeverageHelper } from './leverage-helper.js';
import config from '../config.js';

const MORPHO_BUNDLER_V3 = config.MORPHO_BUNDLER_V3;
const ETHER_GENERAL_ADAPTER_1 = config.ETHER_GENERAL_ADAPTER_1;
const MORPHO_BLUE = config.MORPHO_BLUE;

export class LeverageCommand {
  /**
   * @param {BlockchainClient} blockchainClient
   * @param {SwapRouterClient} routerClient
   * @param {SimulationEngine} simulationEngine
   * @param {TransactionAuditor} auditor
   */
  constructor(blockchainClient, routerClient, simulationEngine, auditor) {
    this.blockchainClient = blockchainClient;
    this.routerClient = routerClient;
    this.simulationEngine = simulationEngine;
    this.auditor = auditor;

    this.approvalBuilder = new ApprovalBuilder();
    this.leverageBuilder = new LeverageBundleBuilder(this.approvalBuilder);
    this.ltvCalculator = new LtvCalculator();
  }

  /**
   * Phase 1: Fetch details and assess user position.
   */
  async assessPosition(options) {
    const userAddress = getAddress(options.user);
    const marketId = options.marketId;
    const targetLeverage = options.targetLeverage;
    const slippage = options.slippage;

    if (!targetLeverage || targetLeverage < 1.0 || targetLeverage > 6.0) {
      throw new Error('Leverage target is required and must be between 1.0 and 6.0');
    }

    const marketParams = await this.blockchainClient.fetchMarketParams(marketId);
    const loanAddress = getAddress(marketParams.loanToken);
    const collateralAddress = getAddress(marketParams.collateralToken);

    const position = await this.blockchainClient.fetchMorphoPosition(marketId, userAddress);
    const liveCollateral = position.collateral;
    const liveDebt = position.debt;

    if (liveCollateral === 0n) {
      throw new Error('Cannot adjust leverage of a position with zero collateral.');
    }

    const oraclePrice = await this.blockchainClient.publicClient.readContract({
      address: marketParams.oracle,
      abi: [{ inputs: [], name: 'price', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' }],
      functionName: 'price'
    });

    const swapPrice = oraclePrice;
    const params = this.ltvCalculator.calculateLeverageAdjustmentParams(liveDebt, liveCollateral, oraclePrice, swapPrice, targetLeverage);

    const collateralSymbol = options.collateralSymbol || marketParams.collateralSymbol || 'PT';
    const loanSymbol = options.loanSymbol || marketParams.loanSymbol || 'USDC';
    const maturity = await this.blockchainClient.checkCollateralMaturity(collateralAddress);

    return {
      userAddress,
      marketId,
      loanAddress,
      slippage,
      targetLeverage,
      marketParams,
      collateralAddress,
      position: {
        collateral: liveCollateral,
        debt: liveDebt
      },
      oraclePrice,
      params,
      market: {
        collateralToken: marketParams.collateralToken,
        collateralSymbol,
        loanToken: marketParams.loanToken,
        loanSymbol
      },
      maturity,
      mode: params.mode,
      collateralAdjustment: params.collateralAmount,
      debtAdjustment: params.debtAmount
    };
  }

  /**
   * Helper to fetch swap route from Pendle SDK.
   */
  async _fetchRawRoute(assessment, params, options) {
    const slippageFrac = assessment.slippage / 100;
    if (params.mode === 'deleverage' || params.mode === 'deleverage-to-1x') {
      return this.routerClient.fetchSwapRoute(
        assessment.collateralAddress,
        params.collateralAmount,
        assessment.loanAddress,
        slippageFrac,
        ETHER_GENERAL_ADAPTER_1,
        MORPHO_BUNDLER_V3
      );
    }
    return this.routerClient.fetchSwapRoute(
      assessment.loanAddress,
      params.debtAmount,
      assessment.collateralAddress,
      slippageFrac,
      ETHER_GENERAL_ADAPTER_1,
      MORPHO_BUNDLER_V3
    );
  }

  /**
   * Phase 2: Fetch swap route quote from Pendle API.
   * Performs iterative scaling under the hood to align swap prices.
   */
  async fetchSwapRoute(assessment, options) {
    const nominalRouteData = await this._fetchRawRoute(assessment, assessment.params, options);
    const nominalExpectedOutput = BigInt(nominalRouteData.outputs[0].amount);

    const liveDebt = assessment.position.debt;
    const liveCollateral = assessment.position.collateral;
    const oraclePrice = assessment.oraclePrice;

    let actualSwapPrice = oraclePrice;
    if (assessment.params.mode === 'deleverage' || assessment.params.mode === 'deleverage-to-1x') {
      if (assessment.params.collateralAmount > 0n) {
        actualSwapPrice = (nominalExpectedOutput * 10n ** 36n) / assessment.params.collateralAmount;
      }
    } else if (nominalExpectedOutput > 0n) {
      actualSwapPrice = (assessment.params.debtAmount * 10n ** 36n) / nominalExpectedOutput;
    }

    const finalParams = this.ltvCalculator.calculateLeverageAdjustmentParams(
      liveDebt,
      liveCollateral,
      oraclePrice,
      actualSwapPrice,
      assessment.targetLeverage
    );

    assessment.params = finalParams;
    assessment.mode = finalParams.mode;
    assessment.collateralAdjustment = finalParams.collateralAmount;
    assessment.debtAdjustment = finalParams.debtAmount;

    const routeData = await this._fetchRawRoute(assessment, finalParams, options);
    const expectedOutputAmount = BigInt(routeData.outputs[0].amount);

    if (finalParams.mode === 'deleverage' || finalParams.mode === 'deleverage-to-1x') {
      finalParams.debtAmount = expectedOutputAmount;
      assessment.debtAdjustment = expectedOutputAmount;
    }

    const collateralDecimals = BigInt(assessment.marketParams.collateralDecimals);
    const loanDecimals = BigInt(assessment.marketParams.loanDecimals);

    const quotedRateExponent = 18n + collateralDecimals - loanDecimals;
    const oracleRateDenominator = 10n ** (18n + loanDecimals - collateralDecimals);

    const oracleRate = assessment.oraclePrice / oracleRateDenominator;
    let quotedRate = 0n;

    if (finalParams.mode === 'deleverage' || finalParams.mode === 'deleverage-to-1x') {
      if (finalParams.collateralAmount > 0n) {
        quotedRate = (expectedOutputAmount * 10n ** quotedRateExponent) / finalParams.collateralAmount;
      }
    } else {
      const expectedPtOutput = BigInt(routeData.outputs[0].amount);
      if (expectedPtOutput > 0n) {
        quotedRate = (finalParams.debtAmount * 10n ** quotedRateExponent) / expectedPtOutput;
      }
    }

    const slippagePct = oracleRate > 0n ? Number((oracleRate - quotedRate) * 10000n / oracleRate) / 100 : 0.0;

    return {
      routeData,
      rawOracleRate: oracleRate,
      rawQuotedRate: quotedRate,
      oracleRate: Number(oracleRate) / 1e18,
      expectedRate: Number(quotedRate) / 1e18,
      priceImpact: slippagePct,
      expectedOutput: BigInt(routeData.outputs[0].amount)
    };
  }

  /**
   * Phase 3: Compile calldata multicall payload and steps.
   */
  async compileCalldata(assessment, swap, options) {
    const isLeverageUp = (assessment.params.mode === 'leverage-up');
    let finalCalldata;

    if (assessment.params.mode === 'deleverage' || assessment.params.mode === 'deleverage-to-1x') {
      finalCalldata = LeverageHelper.encodeDeleveragingCalldata({
        assessment,
        swap,
        leverageBuilder: this.leverageBuilder,
        ETHER_GENERAL_ADAPTER_1,
        MORPHO_BUNDLER_V3
      });
    } else {
      finalCalldata = LeverageHelper.encodeLeveragingUpCalldata({
        assessment,
        swap,
        leverageBuilder: this.leverageBuilder,
        ETHER_GENERAL_ADAPTER_1,
        MORPHO_BUNDLER_V3
      });
    }

    const { steps, fairMarketValue, fairValueLoss, walletShortfall } = LeverageHelper.formatStepsAndMetrics({
      assessment,
      swap,
      isLeverageUp
    });

    return {
      ...assessment,
      swap,
      steps,
      finalCalldata,
      fairMarketValue,
      fairValueLoss,
      walletShortfall
    };
  }

  /**
   * Phase 4: Run transaction simulation on fork.
   */
  async runSimulation(calldataResult, options) {
    const prependCalls = await LeverageHelper.preparePrependCalls({
      calldataResult,
      blockchainClient: this.blockchainClient,
      morphoBlueAddress: MORPHO_BLUE
    });

    return this.simulationEngine.simulateTransaction(
      calldataResult.userAddress,
      MORPHO_BUNDLER_V3,
      calldataResult.finalCalldata,
      0n,
      prependCalls
    );
  }

  /**
   * Execute leverage command wrapper.
   */
  async execute(options) {
    const assessment = await this.assessPosition(options);
    const swap = await this.fetchSwapRoute(assessment, options);
    const calldataResult = await this.compileCalldata(assessment, swap, options);

    let simulationResult = null;
    let txHash = null;
    let auditDetails = null;
    const isLeverageUp = (assessment.params.mode === 'leverage-up');

    if (options.simulation) {
      simulationResult = await this.runSimulation(calldataResult, options);
    } else {
      txHash = await this.blockchainClient.executeTransaction({
        to: MORPHO_BUNDLER_V3,
        data: calldataResult.finalCalldata,
        value: 0n
      });
      auditDetails = {
        spentToken: isLeverageUp ? assessment.loanAddress : assessment.collateralAddress,
        receivedToken: isLeverageUp ? assessment.collateralAddress : assessment.loanAddress,
        spentDecimals: isLeverageUp ? assessment.marketParams.loanDecimals : assessment.marketParams.collateralDecimals,
        receivedDecimals: isLeverageUp ? assessment.marketParams.collateralDecimals : assessment.marketParams.loanDecimals,
        spentSymbol: isLeverageUp ? assessment.market.loanSymbol : assessment.market.collateralSymbol,
        receivedSymbol: isLeverageUp ? assessment.market.collateralSymbol : assessment.market.loanSymbol,
        oracleRate: swap.oracleRate,
        estimatedRate: swap.expectedRate,
        estimatedPriceImpact: swap.priceImpact,
        isLeverageUp
      };
    }

    return {
      ...calldataResult,
      simulationResult,
      txHash,
      auditDetails
    };
  }
}
