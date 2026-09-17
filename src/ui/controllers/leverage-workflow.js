/**
 * @fileoverview Workflow controller for leverage adjustment operations.
 */

import { encodeFunctionData, encodeAbiParameters, keccak256, getAddress } from 'viem';
import { calculateLeverageAdjustmentParams, calculateCollateralValue, calculateLtv, calculateLeverage } from '../../../math.js';
import { buildDeleveragingBundle, buildLeveragingUpBundle } from '../../../builders.js';
import config from '../../../config.js';
import { ADAPTER_ABI, BUNDLER_ABI } from '../../core/contracts/abis.js';

export class LeverageWorkflow {
  /**
   * @param {object} dependencies
   * @param {object} dependencies.marketService
   * @param {object} dependencies.swapQuoterService
   */
  constructor({ marketService, swapQuoterService }) {
    this.marketService = marketService;
    this.swapQuoterService = swapQuoterService;
  }

  async loadPosition({ publicClient, marketId, userAddress }) {
    const position = await this.marketService.fetchPosition(publicClient, marketId, userAddress);
    const marketParams = await this.marketService.fetchMarketParams(marketId);
    const oraclePrice = await this.marketService.fetchOraclePrice(publicClient, marketParams.oracle);
    const collateralValue = calculateCollateralValue(position.collateral, oraclePrice);
    const ltv = calculateLtv(position.debt, collateralValue);
    const leverageVal = calculateLeverage(collateralValue, position.debt);

    let currentLeverageNum = 1.0;
    if (collateralValue > position.debt && (collateralValue - position.debt) > 0n) {
      currentLeverageNum = Number(collateralValue * 100n / (collateralValue - position.debt)) / 100;
    }

    return {
      liveDebt: position.debt,
      liveCollateral: position.collateral,
      currentLeverageNum,
      info: {
        collateralFormatted: (Number(position.collateral) / 10 ** (marketParams.collateralDecimals || 18)).toFixed(4),
        debtFormatted: (Number(position.debt) / 10 ** (marketParams.loanDecimals || 6)).toFixed(2),
        collateralSymbol: marketParams.collateralSymbol || 'PT',
        loanSymbol: marketParams.loanSymbol || 'USDC',
        ltvFormatted: `${ltv.toFixed(2)}%`,
        leverageVal
      }
    };
  }

  async compileLeveragePayload(params) {
    const {
      marketParams,
      oraclePrice,
      userCollateral,
      userDebt,
      targetLeverage,
      slippageBps,
      userAddress,
      publicClient
    } = params;

    const ptAddress = getAddress(marketParams.collateralToken);
    const loanAddress = getAddress(marketParams.loanToken);

    // 1. Solve parameters for nominal adjustment (assuming swap price is oracle price)
    const initialParams = calculateLeverageAdjustmentParams(userDebt, userCollateral, oraclePrice, oraclePrice, targetLeverage);

    // 2. Fetch nominal swap route
    let nominalRouteData;
    if (initialParams.mode === 'deleverage' || initialParams.mode === 'deleverage-to-1x') {
      nominalRouteData = await this.swapQuoterService.fetchSwapRoute({
        inputToken: ptAddress,
        inputAmount: initialParams.collateralAmount,
        outputToken: loanAddress,
        slippageBps: Number(slippageBps),
        receiver: config.ETHER_GENERAL_ADAPTER_1,
        sender: config.MORPHO_BUNDLER_V3
      });
    } else {
      nominalRouteData = await this.swapQuoterService.fetchSwapRoute({
        inputToken: loanAddress,
        inputAmount: initialParams.debtAmount,
        outputToken: ptAddress,
        slippageBps: Number(slippageBps),
        receiver: config.ETHER_GENERAL_ADAPTER_1,
        sender: config.MORPHO_BUNDLER_V3
      });
    }
    const nominalExpectedOutput = BigInt(nominalRouteData.outputs[0].amount);

    // 3. Recalculate parameters with actual swap price from nominal route
    let actualSwapPrice = oraclePrice;
    if (initialParams.mode === 'deleverage' || initialParams.mode === 'deleverage-to-1x') {
      if (initialParams.collateralAmount > 0n) {
        actualSwapPrice = (nominalExpectedOutput * 10n ** 36n) / initialParams.collateralAmount;
      }
    } else {
      if (nominalExpectedOutput > 0n) {
        actualSwapPrice = (initialParams.debtAmount * 10n ** 36n) / nominalExpectedOutput;
      }
    }

    const adjParams = calculateLeverageAdjustmentParams(userDebt, userCollateral, oraclePrice, actualSwapPrice, targetLeverage);

    let finalCalldata;
    let routeData;

    const collateralDecimals = BigInt(marketParams.collateralDecimals);
    const loanDecimals = BigInt(marketParams.loanDecimals);
    const quotedRateExponent = 18n + collateralDecimals - loanDecimals;
    let quotedRate = 0n;
    let detailsText = '';

    if (adjParams.mode === 'deleverage' || adjParams.mode === 'deleverage-to-1x') {
      routeData = await this.swapQuoterService.fetchSwapRoute({
        inputToken: ptAddress,
        inputAmount: adjParams.collateralAmount,
        outputToken: loanAddress,
        slippageBps: Number(slippageBps),
        receiver: config.ETHER_GENERAL_ADAPTER_1,
        sender: config.MORPHO_BUNDLER_V3
      });
      const expectedLoanOutput = BigInt(routeData.outputs[0].amount);

      const is1x = (adjParams.mode === 'deleverage-to-1x');
      const bufferAmount = adjParams.debtAmount > 100n * 10n ** loanDecimals
        ? 1n * 10n ** loanDecimals
        : (adjParams.debtAmount * 2n / 1000n);
      const flashLoanAmount = is1x ? (adjParams.debtAmount + bufferAmount) : (expectedLoanOutput - bufferAmount);

      const reenterBundle = buildDeleveragingBundle({
        marketParams,
        collateralAmount: adjParams.collateralAmount,
        debtAmount: is1x ? expectedLoanOutput : flashLoanAmount,
        is1x,
        collateralAddress: ptAddress,
        loanAddress,
        routeData,
        userAddress,
        ETHER_GENERAL_ADAPTER_1: config.ETHER_GENERAL_ADAPTER_1,
        MORPHO_BUNDLER_V3: config.MORPHO_BUNDLER_V3,
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
          to: config.ETHER_GENERAL_ADAPTER_1,
          data: encodeFunctionData({
            abi: ADAPTER_ABI,
            functionName: 'morphoFlashLoan',
            args: [loanAddress, flashLoanAmount, encodedReenterBundle]
          }),
          value: 0n,
          skipRevert: false,
          callbackHash
        },
        {
          to: config.ETHER_GENERAL_ADAPTER_1,
          data: encodeFunctionData({
            abi: ADAPTER_ABI,
            functionName: 'erc20Transfer',
            args: [loanAddress, userAddress, 2n ** 256n - 1n]
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

      if (adjParams.collateralAmount > 0n) {
        quotedRate = (expectedLoanOutput * 10n ** quotedRateExponent) / adjParams.collateralAmount;
      }

      detailsText = `
        Expected Output: <span style="font-family: monospace; color: #34d399;">${(Number(expectedLoanOutput) / 10 ** Number(loanDecimals)).toFixed(2)} ${marketParams.loanSymbol}</span><br>
        Collateral to Sell: <span style="font-family: monospace; color: #f8fafc;">${(Number(adjParams.collateralAmount) / 10 ** Number(collateralDecimals)).toFixed(4)} ${marketParams.collateralSymbol}</span>
      `;
    } else {
      routeData = await this.swapQuoterService.fetchSwapRoute({
        inputToken: loanAddress,
        inputAmount: adjParams.debtAmount,
        outputToken: ptAddress,
        slippageBps: Number(slippageBps),
        receiver: config.ETHER_GENERAL_ADAPTER_1,
        sender: config.MORPHO_BUNDLER_V3
      });
      const expectedPtOutput = BigInt(routeData.outputs[0].amount);

      const reenterBundle = buildLeveragingUpBundle({
        marketParams,
        collateralAmount: expectedPtOutput,
        debtAmount: adjParams.debtAmount,
        collateralAddress: ptAddress,
        loanAddress,
        routeData,
        userAddress,
        ETHER_GENERAL_ADAPTER_1: config.ETHER_GENERAL_ADAPTER_1,
        MORPHO_BUNDLER_V3: config.MORPHO_BUNDLER_V3
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
          to: config.ETHER_GENERAL_ADAPTER_1,
          data: encodeFunctionData({
            abi: ADAPTER_ABI,
            functionName: 'morphoFlashLoan',
            args: [loanAddress, adjParams.debtAmount, encodedReenterBundle]
          }),
          value: 0n,
          skipRevert: false,
          callbackHash
        }
      ];

      finalCalldata = encodeFunctionData({
        abi: BUNDLER_ABI,
        functionName: 'multicall',
        args: [outerBundle]
      });

      if (expectedPtOutput > 0n) {
        quotedRate = (adjParams.debtAmount * 10n ** quotedRateExponent) / expectedPtOutput;
      }

      detailsText = `
        Expected Output: <span style="font-family: monospace; color: #38bdf8;">${(Number(expectedPtOutput) / 10 ** Number(collateralDecimals)).toFixed(4)} ${marketParams.collateralSymbol}</span><br>
        ${marketParams.loanSymbol} to Spend: <span style="font-family: monospace; color: #f43f5e;">${(Number(adjParams.debtAmount) / 10 ** Number(loanDecimals)).toFixed(2)} ${marketParams.loanSymbol}</span>
      `;
    }

    const oracleRateDenominator = 10n ** (18n + loanDecimals - collateralDecimals);
    const oracleRate = oraclePrice / oracleRateDenominator;
    const slippagePct = oracleRate > 0n ? Number((oracleRate - quotedRate) * 10000n / oracleRate) / 100 : 0.0;
    const slippageLimit = Number(slippageBps) / 100;

    let maturity = null;
    if (publicClient) {
      maturity = await this.marketService.checkCollateralMaturity(publicClient, ptAddress);
    }

    const pendingTx = {
      to: config.MORPHO_BUNDLER_V3,
      data: finalCalldata,
      value: 0n,
      type: 'leverage',
      subType: adjParams.mode === 'leverage-up' ? 'leverage_up' : 'deleverage',
      oracleRate: Number(oracleRate) / 1e18,
      estimatedRate: Number(quotedRate) / 1e18,
      estimatedPriceImpact: slippagePct
    };

    return {
      quotedRate,
      oracleRate,
      slippagePct,
      detailsText,
      slippageLimit,
      userAddress,
      finalCalldata,
      maturity,
      pendingTx,
      routeData,
      adjParams
    };
  }
}
