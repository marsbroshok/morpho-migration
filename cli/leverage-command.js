import { getAddress, encodeFunctionData, encodeAbiParameters, keccak256 } from 'viem';
import { calculateCollateralValue, calculateLtv, calculateLeverage, calculateLeverageAdjustmentParams } from '../math.js';
import { formatMarketLabel } from '../labels.js';
import { buildDeleveragingBundle, buildLeveragingUpBundle, ADAPTER_ABI } from '../builders.js';
import config from '../config.js';

const MORPHO_BUNDLER_V3 = config.MORPHO_BUNDLER_V3;
const ETHER_GENERAL_ADAPTER_1 = config.ETHER_GENERAL_ADAPTER_1;
const MORPHO_BLUE = config.MORPHO_BLUE;

const BUNDLER_ABI = [
  {
    "inputs": [
      {
        "components": [
          { "name": "to", "type": "address" },
          { "name": "data", "type": "bytes" },
          { "name": "value", "type": "uint256" },
          { "name": "skipRevert", "type": "bool" },
          { "name": "callbackHash", "type": "bytes32" }
        ],
        "name": "bundle",
        "type": "tuple[]"
      }
    ],
    "name": "multicall",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  }
];

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
      throw new Error("Leverage target is required and must be between 1.0 and 6.0");
    }

    // Fetch Market Params
    const marketParams = await this.blockchainClient.fetchMarketParams(marketId);
    const loanAddress = getAddress(marketParams.loanToken);
    const collateralAddress = getAddress(marketParams.collateralToken);

    // Fetch User position
    const position = await this.blockchainClient.fetchMorphoPosition(marketId, userAddress);
    const liveCollateral = position.collateral;
    const liveDebt = position.debt;

    if (liveCollateral === 0n) {
      throw new Error("Cannot adjust leverage of a position with zero collateral.");
    }

    // Solve adjustment parameters
    const oraclePrice = await this.blockchainClient.publicClient.readContract({
      address: marketParams.oracle,
      abi: [{"inputs":[],"name":"price","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"}],
      functionName: 'price'
    });

    const swapPrice = oraclePrice;
    const params = calculateLeverageAdjustmentParams(liveDebt, liveCollateral, oraclePrice, swapPrice, targetLeverage);

    const collateralSymbol = options.collateralSymbol || marketParams.collateralSymbol || "PT";
    const loanSymbol = options.loanSymbol || marketParams.loanSymbol || "USDC";
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
   * Phase 2: Fetch swap route quote from Pendle API.
   */
  async fetchSwapRoute(assessment, options) {
    const slippageFrac = assessment.slippage / 100;
    let routeData;
    const isLeverageUp = (assessment.params.mode === 'leverage-up');


    if (assessment.params.mode === 'deleverage' || assessment.params.mode === 'deleverage-to-1x') {
      routeData = await this.routerClient.fetchSwapRoute(
        assessment.collateralAddress,
        assessment.params.collateralAmount,
        assessment.loanAddress,
        slippageFrac,
        ETHER_GENERAL_ADAPTER_1,
        MORPHO_BUNDLER_V3
      );
    } else {
      routeData = await this.routerClient.fetchSwapRoute(
        assessment.loanAddress,
        assessment.params.debtAmount,
        assessment.collateralAddress,
        slippageFrac,
        ETHER_GENERAL_ADAPTER_1,
        MORPHO_BUNDLER_V3
      );
    }

    const collateralDecimals = BigInt(assessment.marketParams.collateralDecimals);
    const loanDecimals = BigInt(assessment.marketParams.loanDecimals);

    const quotedRateExponent = 18n + collateralDecimals - loanDecimals;
    const oracleRateDenominator = 10n ** (18n + loanDecimals - collateralDecimals);

    const oracleRate = assessment.oraclePrice / oracleRateDenominator;
    let quotedRate = 0n;

    if (assessment.params.mode === 'deleverage' || assessment.params.mode === 'deleverage-to-1x') {
      const expectedUsdcOutput = BigInt(routeData.outputs[0].amount);
      if (assessment.params.collateralAmount > 0n) {
        quotedRate = (expectedUsdcOutput * 10n ** quotedRateExponent) / assessment.params.collateralAmount;
      }
    } else {
      const expectedPtOutput = BigInt(routeData.outputs[0].amount);
      if (expectedPtOutput > 0n) {
        quotedRate = (assessment.params.debtAmount * 10n ** quotedRateExponent) / expectedPtOutput;
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
    let finalCalldata;
    const isLeverageUp = (assessment.params.mode === 'leverage-up');

    if (assessment.params.mode === 'deleverage' || assessment.params.mode === 'deleverage-to-1x') {
      const expectedUsdcOutput = BigInt(swap.routeData.outputs[0].amount);
      const is1x = (assessment.params.mode === 'deleverage-to-1x');
      const loanDecimals = BigInt(assessment.marketParams.loanDecimals);
      const bufferAmount = assessment.params.debtAmount > 100n * 10n ** loanDecimals ? 1n * 10n ** loanDecimals : (assessment.params.debtAmount * 2n / 1000n);
      const flashLoanAmount = is1x ? (assessment.params.debtAmount + bufferAmount) : (expectedUsdcOutput - bufferAmount);

      const reenterBundle = buildDeleveragingBundle({
        encodeFunctionData,
        marketParams: assessment.marketParams,
        collateralAmount: assessment.params.collateralAmount,
        debtAmount: is1x ? expectedUsdcOutput : flashLoanAmount,
        is1x,
        collateralAddress: assessment.collateralAddress,
        loanAddress: assessment.loanAddress,
        routeData: swap.routeData,
        userAddress: assessment.userAddress,
        ETHER_GENERAL_ADAPTER_1,
        MORPHO_BUNDLER_V3,
        flashLoanAmount
      });

      const encodedReenterBundle = encodeAbiParameters(
        [
          {
            name: 'bundle',
            type: 'tuple[]',
            components: [
              { name: 'to', type: 'address' },
              { name: 'data', type: 'bytes' },
              { name: 'value', type: 'uint256' },
              { name: 'skipRevert', type: 'bool' },
              { name: 'callbackHash', type: 'bytes32' }
            ]
          }
        ],
        [reenterBundle]
      );

      const callbackHash = keccak256(encodedReenterBundle);

      const outerBundle = [
        {
          to: ETHER_GENERAL_ADAPTER_1,
          data: encodeFunctionData({
            abi: ADAPTER_ABI,
            functionName: 'morphoFlashLoan',
            args: [assessment.loanAddress, flashLoanAmount, encodedReenterBundle]
          }),
          value: 0n,
          skipRevert: false,
          callbackHash: callbackHash
        },
        {
          to: ETHER_GENERAL_ADAPTER_1,
          data: encodeFunctionData({
            abi: ADAPTER_ABI,
            functionName: 'erc20Transfer',
            args: [assessment.loanAddress, assessment.userAddress, 2n ** 256n - 1n]
          }),
          value: 0n,
          skipRevert: false,
          callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
        }
      ];

      finalCalldata = encodeFunctionData({
        abi: BUNDLER_ABI,
        functionName: 'multicall',
        args: [outerBundle]
      });

    } else {
      const expectedPtOutput = BigInt(swap.routeData.outputs[0].amount);

      const reenterBundle = buildLeveragingUpBundle({
        encodeFunctionData,
        marketParams: assessment.marketParams,
        collateralAmount: expectedPtOutput,
        debtAmount: assessment.params.debtAmount,
        collateralAddress: assessment.collateralAddress,
        loanAddress: assessment.loanAddress,
        routeData: swap.routeData,
        userAddress: assessment.userAddress,
        ETHER_GENERAL_ADAPTER_1,
        MORPHO_BUNDLER_V3
      });

      const encodedReenterBundle = encodeAbiParameters(
        [
          {
            name: 'bundle',
            type: 'tuple[]',
            components: [
              { name: 'to', type: 'address' },
              { name: 'data', type: 'bytes' },
              { name: 'value', type: 'uint256' },
              { name: 'skipRevert', type: 'bool' },
              { name: 'callbackHash', type: 'bytes32' }
            ]
          }
        ],
        [reenterBundle]
      );

      const callbackHash = keccak256(encodedReenterBundle);

      const outerBundle = [
        {
          to: ETHER_GENERAL_ADAPTER_1,
          data: encodeFunctionData({
            abi: ADAPTER_ABI,
            functionName: 'morphoFlashLoan',
            args: [assessment.loanAddress, assessment.params.debtAmount, encodedReenterBundle]
          }),
          value: 0n,
          skipRevert: false,
          callbackHash: callbackHash
        }
      ];

      finalCalldata = encodeFunctionData({
        abi: BUNDLER_ABI,
        functionName: 'multicall',
        args: [outerBundle]
      });
    }

    const loanDec = 10 ** assessment.marketParams.loanDecimals;
    const collDec = 10 ** assessment.marketParams.collateralDecimals;

    const steps = isLeverageUp ? [
      `Flashloan: Borrow ${Number(assessment.params.debtAmount)/loanDec} ${assessment.market.loanSymbol} from Adapter`,
      `Swap: Swap ${assessment.market.loanSymbol} for ${Number(swap.routeData.outputs[0].amount)/collDec} ${assessment.market.collateralSymbol}`,
      `Supply: Supply ${assessment.market.collateralSymbol} to Morpho Blue Core`,
      `Borrow: Borrow ${Number(assessment.params.debtAmount)/loanDec} ${assessment.market.loanSymbol} from Morpho Blue Core to adapter`,
      `Repay Flashloan: Repay flashloan back to provider`
    ] : [
      `Flashloan: Borrow Flashloan from Adapter`,
      `Withdraw: Withdraw ${Number(assessment.params.collateralAmount)/collDec} ${assessment.market.collateralSymbol} from Morpho Blue Core`,
      `Approve Swap: Approve Swap Router for ${Number(assessment.params.collateralAmount)/collDec} ${assessment.market.collateralSymbol}`,
      `Swap: Swap ${assessment.market.collateralSymbol} for ${Number(swap.routeData.outputs[0].amount)/loanDec} ${assessment.market.loanSymbol}`,
      `Repay Debt: Repay ${assessment.market.loanSymbol} debt on Morpho Blue Core`,
      `Repay Flashloan: Repay flashloan back to provider`
    ];

    const collateralDecimals = BigInt(assessment.marketParams.collateralDecimals);
    const loanDecimals = BigInt(assessment.marketParams.loanDecimals);
    const scaleExp = collateralDecimals + 18n - loanDecimals;

    let fairMarketValue = 0n;
    let fairValueLoss = 0n;
    let walletShortfall = 0n;

    if (assessment.params.mode === 'deleverage' || assessment.params.mode === 'deleverage-to-1x') {
      const expectedUsdcOutput = BigInt(swap.routeData.outputs[0].amount);
      fairMarketValue = (assessment.params.collateralAmount * swap.rawOracleRate) / 10n ** scaleExp;
      fairValueLoss = fairMarketValue - expectedUsdcOutput;
      walletShortfall = assessment.params.debtAmount - expectedUsdcOutput;
    } else {
      const expectedPtOutput = BigInt(swap.routeData.outputs[0].amount);
      fairMarketValue = (expectedPtOutput * swap.rawOracleRate) / 10n ** scaleExp;
      fairValueLoss = assessment.params.debtAmount - fairMarketValue;
      walletShortfall = 0n;
    }

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
    const prependCalls = [];
    try {
      const livePosition = await this.blockchainClient.fetchMorphoPosition(calldataResult.marketId, calldataResult.userAddress, true);
      const liveDebt = livePosition.debt;
      if (liveDebt < calldataResult.position.debt) {
        const borrowDiff = calldataResult.position.debt - liveDebt;
        prependCalls.push({
          from: calldataResult.userAddress,
          to: MORPHO_BLUE,
          value: '0x0',
          data: encodeFunctionData({
            abi: [
              {
                "inputs": [
                  {
                    "components": [
                      { "name": "loanToken", "type": "address" },
                      { "name": "collateralToken", "type": "address" },
                      { "name": "oracle", "type": "address" },
                      { "name": "irm", "type": "address" },
                      { "name": "lltv", "type": "uint256" }
                    ],
                    "name": "marketParams",
                    "type": "tuple"
                  },
                  { "name": "assets", "type": "uint256" },
                  { "name": "shares", "type": "uint256" },
                  { "name": "onBehalf", "type": "address" },
                  { "name": "receiver", "type": "address" }
                ],
                "name": "borrow",
                "outputs": [
                  { "name": "assetsBorrowed", "type": "uint256" },
                  { "name": "sharesBorrowed", "type": "uint256" }
                ],
                "stateMutability": "nonpayable",
                "type": "function"
              }
            ],
            functionName: 'borrow',
            args: [calldataResult.marketParams, borrowDiff, 0n, calldataResult.userAddress, calldataResult.userAddress]
          })
        });
      }
    } catch (e) {
      // Ignore errors
    }

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
