/**
 * @fileoverview Rollover CLI command controller for assessing, routing, building, and executing market migrations.
 */

import { getAddress, encodeFunctionData, encodeAbiParameters, keccak256 } from 'viem';
import { LtvCalculator } from '../src/core/math/ltv-calculator.js';
import { ScalingService } from '../src/core/math/scaling-service.js';
import { SlippageService } from '../src/core/math/slippage-service.js';
import { RolloverBundleBuilder } from '../src/core/builders/rollover-bundle-builder.js';
import { ApprovalBuilder } from '../src/core/builders/approval-builder.js';
import { LiquidityPoolService } from '../src/core/services/liquidity-pool-service.js';
import { RolloverSimulationHelper } from './rollover-simulation-helper.js';
import { RolloverRoutingHelper } from './rollover-routing-helper.js';
import config from '../config.js';

const MORPHO_BUNDLER_V3 = config.MORPHO_BUNDLER_V3;
const ETHER_GENERAL_ADAPTER_1 = config.ETHER_GENERAL_ADAPTER_1;
const MORPHO_BLUE = config.MORPHO_BLUE;

export class RolloverCommand {
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

    this.poolService = new LiquidityPoolService();
    this.approvalBuilder = new ApprovalBuilder();
    this.rolloverBuilder = new RolloverBundleBuilder(this.approvalBuilder, this.poolService);
    this.ltvCalculator = new LtvCalculator();
    this.slippageService = new SlippageService();
  }

  findCurvePoolAndIndices(fromToken, toToken, amount) {
    return this.poolService.findCurvePoolAndIndices(this.blockchainClient.publicClient, fromToken, toToken, amount, getAddress);
  }

  findUniswapV3Pool(tokenAddress) {
    return this.poolService.findUniswapV3Pool(this.blockchainClient.publicClient, tokenAddress, getAddress);
  }

  /**
   * Phase 1: Fetch details and assess user position.
   */
  async assessPosition(options) {
    const userAddress = getAddress(options.user);
    const sourceMarketId = options.oldMarketId;
    const destMarketId = options.newMarketId;

    const [sourceMarketParams, destMarketParams] = await Promise.all([
      this.blockchainClient.fetchMarketParams(sourceMarketId),
      this.blockchainClient.fetchMarketParams(destMarketId)
    ]);

    const sourceLoanAddress = getAddress(sourceMarketParams.loanToken);
    const destLoanAddress = getAddress(destMarketParams.loanToken);
    const sourceCollateralAddress = getAddress(sourceMarketParams.collateralToken);
    const destCollateralAddress = getAddress(destMarketParams.collateralToken);

    const position = await this.blockchainClient.fetchMorphoPosition(sourceMarketId, userAddress);
    const { collateral: liveCollateral, debt: liveDebt, borrowShares: liveBorrowShares } = position;

    if (liveCollateral === 0n) {
      throw new Error(`User does not have an active collateral position in market ${sourceMarketId}`);
    }

    const isFull = (options.type === 'full');
    let debtAmount = liveDebt;
    let collateralAmount = liveCollateral;

    if (!isFull) {
      if (!options.debt) {
        throw new Error('Debt amount is required for partial rollover');
      }
      debtAmount = ScalingService.parseUnits(options.debt.toString(), sourceMarketParams.loanDecimals);
      if (debtAmount > liveDebt) {
        const formattedLiveDebt = Number(liveDebt) / (10 ** sourceMarketParams.loanDecimals);
        throw new Error(`Requested debt amount ${options.debt} ${sourceMarketParams.loanSymbol} exceeds user debt of ${formattedLiveDebt.toFixed(2)} ${sourceMarketParams.loanSymbol}`);
      }
      collateralAmount = (liveCollateral * debtAmount) / liveDebt;
    }

    const maturity = await this.blockchainClient.checkCollateralMaturity(sourceCollateralAddress);

    return {
      userAddress,
      sourceMarketId,
      destMarketId,
      sourceLoanAddress,
      destLoanAddress,
      slippage: options.slippage,
      sourceMarketParams,
      destMarketParams,
      sourceCollateralAddress,
      destCollateralAddress,
      oldMarket: {
        collateralToken: sourceMarketParams.collateralToken,
        collateralSymbol: options.oldCollateralSymbol || sourceMarketParams.collateralSymbol || 'PT-old',
        loanToken: sourceMarketParams.loanToken,
        loanSymbol: options.oldLoanSymbol || sourceMarketParams.loanSymbol || 'USDC'
      },
      newMarket: {
        collateralToken: destMarketParams.collateralToken,
        collateralSymbol: options.newCollateralSymbol || destMarketParams.collateralSymbol || 'PT-new',
        loanToken: destMarketParams.loanToken,
        loanSymbol: options.newLoanSymbol || destMarketParams.loanSymbol || 'USDC'
      },
      maturity,
      position: {
        collateral: liveCollateral,
        debt: liveDebt,
        borrowShares: liveBorrowShares
      },
      type: options.type || 'full',
      debtAmount,
      collateralAmount
    };
  }

  /**
   * Phase 2: Fetch swap route quote from Swap Router API.
   */
  async fetchSwapRoute(assessment, options) {
    const isSameCollateral = (assessment.sourceCollateralAddress === assessment.destCollateralAddress);
    const isSameLoan = (assessment.sourceLoanAddress.toLowerCase() === assessment.destLoanAddress.toLowerCase());

    const userSlippageBps = BigInt(Math.round((options.slippage || 3.0) * 100));
    const strictSlippageBps = userSlippageBps > 50n ? 50n : userSlippageBps;
    const slippageFrac = Number(strictSlippageBps) / 10000;

    console.log(`MEV Protection: Enforcing execution slippage tolerance of ${Number(strictSlippageBps) / 100}% (Requested: ${options.slippage || 3.0}%).`);

    let routeData = null;
    let expectedNewCollateral = assessment.collateralAmount;

    if (!isSameCollateral) {
      routeData = await this.routerClient.fetchSwapRoute(
        assessment.sourceCollateralAddress,
        assessment.collateralAmount,
        assessment.destCollateralAddress,
        slippageFrac,
        MORPHO_BUNDLER_V3,
        MORPHO_BUNDLER_V3
      );
      expectedNewCollateral = BigInt(routeData.outputs[0].amount);
    }

    const [oldOraclePrice, newOraclePrice] = await Promise.all([
      this.blockchainClient.publicClient.readContract({
        address: assessment.sourceMarketParams.oracle,
        abi: [{ inputs: [], name: 'price', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' }],
        functionName: 'price'
      }),
      this.blockchainClient.publicClient.readContract({
        address: assessment.destMarketParams.oracle,
        abi: [{ inputs: [], name: 'price', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' }],
        functionName: 'price'
      })
    ]);

    const oldScale = 36n + BigInt(assessment.sourceMarketParams.loanDecimals) - BigInt(assessment.sourceMarketParams.collateralDecimals);
    const newScale = 36n + BigInt(assessment.destMarketParams.loanDecimals) - BigInt(assessment.destMarketParams.collateralDecimals);

    const oldOracleUSD = (oldOraclePrice * 10n ** 18n) / 10n ** oldScale;
    const newOracleUSD = (newOraclePrice * 10n ** 18n) / 10n ** newScale;

    let oracleRatio;
    let quotedRate;
    let slippagePct = 0.0;

    if (isSameCollateral) {
      oracleRatio = 10n ** 18n;
      quotedRate = 10n ** 18n;
      slippagePct = 0.0;
    } else {
      oracleRatio = (oldOracleUSD * 10n ** 18n) / newOracleUSD;
      quotedRate = (expectedNewCollateral * 10n ** 18n) / assessment.collateralAmount;
      slippagePct = oracleRatio > 0n ? Number((oracleRatio - quotedRate) * 10000n / oracleRatio) / 100 : 0.0;
    }

    let crossLoan = {
      loanRouteData: null,
      loanExpectedInput: 0n,
      loanExpectedOutput: 0n,
      loanOracleRate: 0n,
      loanPriceImpact: 0.0
    };

    if (!isSameLoan) {
      crossLoan = await RolloverRoutingHelper.solveCrossLoanRoute({
        routerClient: this.routerClient,
        poolService: this.poolService,
        publicClient: this.blockchainClient.publicClient,
        assessment,
        strictSlippageBps,
        slippageFrac,
        expectedNewCollateral,
        newOraclePrice,
        oldOraclePrice,
        ltvCalculator: this.ltvCalculator,
        options,
        bundlerAddress: MORPHO_BUNDLER_V3,
        adapterAddress: ETHER_GENERAL_ADAPTER_1
      });
    }

    return {
      isSameCollateral,
      isSameLoan,
      routeData,
      expectedNewCollateral,
      oldOraclePrice,
      newOraclePrice,
      oracleRatio,
      quotedRate,
      slippagePct,
      expectedRate: Number(quotedRate) / 1e18,
      oracleRate: Number(oracleRatio) / 1e18,
      priceImpact: slippagePct,
      expectedOutput: expectedNewCollateral,
      loanRouteData: crossLoan.loanRouteData,
      loanExpectedInput: crossLoan.loanExpectedInput,
      loanExpectedOutput: crossLoan.loanExpectedOutput,
      loanOracleRate: crossLoan.loanOracleRate,
      loanPriceImpact: crossLoan.loanPriceImpact
    };
  }

  /**
   * Phase 3: Compile calldata multicall payload and steps.
   */
  async compileCalldata(assessment, swap, options) {
    const isFull = (assessment.type === 'full');
    const userSlippageBps = BigInt(Math.round((options.slippage || 3.0) * 100));
    const strictSlippageBps = userSlippageBps > 50n ? 50n : userSlippageBps;

    const targetLltv = assessment.destMarketParams.lltv;
    const safeLtv = targetLltv - 5000000000000000n;
    const newCollateralValue = ScalingService.calculateCollateralValue(swap.expectedNewCollateral, swap.newOraclePrice);
    const maxSafeBorrowAmount = (newCollateralValue * safeLtv) / 10n ** 18n;

    const buildArgs = {
      encodeFunctionData,
      encodeAbiParameters,
      keccak256,
      sourceMarketParams: assessment.sourceMarketParams,
      destMarketParams: assessment.destMarketParams,
      collateralAmount: assessment.collateralAmount,
      debtAmount: assessment.debtAmount,
      isFull,
      sourceCollateralAddress: assessment.sourceCollateralAddress,
      destCollateralAddress: assessment.destCollateralAddress,
      routeData: swap.routeData,
      userAddress: assessment.userAddress,
      ETHER_GENERAL_ADAPTER_1,
      MORPHO_BUNDLER_V3,
      isSameCollateral: swap.isSameCollateral,
      isSameLoan: swap.isSameLoan,
      loanRouteData: swap.loanRouteData,
      loanExpectedInput: swap.loanExpectedInput,
      loanExpectedOutput: swap.isSameLoan ? 0n : swap.loanExpectedOutput,
      slippage: Number(strictSlippageBps) / 100,
      borrowShares: assessment.position.borrowShares,
      maxSafeBorrowAmount,
      capBorrow: options.capBorrow
    };

    let bundleResult;
    const needsOutputSimulation = !swap.isSameCollateral || (!swap.isSameLoan && !swap.loanRouteData?.isCurveDirect);
    if (needsOutputSimulation) {
      const nominalResult = this.rolloverBuilder.buildRolloverBundle(buildArgs);
      const { actualCollateralOutput, actualLoanOutput } = await RolloverSimulationHelper.resolveActualOutputs({
        simulationEngine: this.simulationEngine,
        userAddress: assessment.userAddress,
        bundlerAddress: MORPHO_BUNDLER_V3,
        nominalResult,
        swap,
        assessment
      });

      bundleResult = this.rolloverBuilder.buildRolloverBundle({
        ...buildArgs,
        actualLoanOutput,
        actualCollateralOutput
      });
    } else {
      bundleResult = this.rolloverBuilder.buildRolloverBundle(buildArgs);
    }

    const borrowAmount = bundleResult.borrowAmount;
    const flashLoanAmount = bundleResult.flashLoanAmount;
    const finalCalldata = bundleResult.finalCalldata;

    const newLtv = this.ltvCalculator.calculateLtv(borrowAmount, newCollateralValue);
    const newLeverage = this.ltvCalculator.calculateLeverage(newCollateralValue, borrowAmount);

    const { steps, loanFairMarketValue, loanFairValueLoss, loanWalletShortfall } = RolloverRoutingHelper.formatStepsAndMetrics({
      assessment,
      swap,
      borrowAmount,
      flashLoanAmount,
      repayAmount: bundleResult.repayAmount,
      strictSlippageBps
    });

    return {
      ...assessment,
      swap,
      simulatedNewDebt: borrowAmount,
      newLtv,
      newLeverage,
      steps,
      finalCalldata,
      flashLoanAmount,
      loanFairMarketValue,
      loanFairValueLoss,
      loanWalletShortfall
    };
  }

  async runSimulation(calldataResult, options) {
    const prependCalls = await RolloverSimulationHelper.preparePrependCalls({
      calldataResult,
      blockchainClient: this.blockchainClient,
      poolService: this.poolService,
      bundlerAddress: MORPHO_BUNDLER_V3,
      adapterAddress: ETHER_GENERAL_ADAPTER_1,
      morphoBlueAddress: MORPHO_BLUE
    });

    const tokensToCheck = [
      calldataResult.sourceMarketParams.loanToken,
      calldataResult.destMarketParams.loanToken,
      calldataResult.sourceMarketParams.collateralToken,
      calldataResult.destMarketParams.collateralToken
    ];

    return this.simulationEngine.simulateTransaction(
      calldataResult.userAddress,
      MORPHO_BUNDLER_V3,
      calldataResult.finalCalldata,
      0n,
      prependCalls,
      tokensToCheck
    );
  }

  /**
   * Execute the rollover flow (Wrapper).
   */
  async execute(options) {
    const assessment = await this.assessPosition(options);
    const swap = await this.fetchSwapRoute(assessment, options);
    const calldataResult = await this.compileCalldata(assessment, swap, options);

    let simulationResult = null;
    let txHash = null;
    let auditDetails = null;

    if (options.simulation) {
      simulationResult = await this.runSimulation(calldataResult, options);
    } else {
      txHash = await this.blockchainClient.executeTransaction({
        to: MORPHO_BUNDLER_V3,
        data: calldataResult.finalCalldata,
        value: 0n
      });
      auditDetails = {
        spentToken: assessment.sourceCollateralAddress,
        receivedToken: assessment.destCollateralAddress,
        spentDecimals: assessment.sourceMarketParams.collateralDecimals,
        receivedDecimals: assessment.destMarketParams.collateralDecimals,
        spentSymbol: assessment.oldMarket.collateralSymbol,
        receivedSymbol: assessment.newMarket.collateralSymbol,
        oracleRate: swap.oracleRate,
        estimatedRate: swap.expectedRate,
        estimatedPriceImpact: swap.priceImpact
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
