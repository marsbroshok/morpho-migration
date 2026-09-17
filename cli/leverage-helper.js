/**
 * @fileoverview Helper service for leverage adjustment bundle encoding, steps formatting, and simulation prep.
 */

import { encodeFunctionData, encodeAbiParameters, keccak256 } from 'viem';
import { ADAPTER_ABI, BUNDLER_ABI, MORPHO_BLUE_ABI } from '../src/core/contracts/abis.js';

export class LeverageHelper {
  /**
   * Constructs the multicall payload for deleveraging positions.
   *
   * @param {object} params
   * @returns {string} Encoded multicall calldata
   */
  static encodeDeleveragingCalldata({
    assessment,
    swap,
    leverageBuilder,
    ETHER_GENERAL_ADAPTER_1,
    MORPHO_BUNDLER_V3
  }) {
    const expectedUsdcOutput = BigInt(swap.routeData.outputs[0].amount);
    const is1x = (assessment.params.mode === 'deleverage-to-1x');
    const loanDecimals = BigInt(assessment.marketParams.loanDecimals);
    const bufferAmount = assessment.params.debtAmount > 100n * 10n ** loanDecimals ? 1n * 10n ** loanDecimals : (assessment.params.debtAmount * 2n / 1000n);
    const flashLoanAmount = is1x ? (assessment.params.debtAmount + bufferAmount) : (expectedUsdcOutput - bufferAmount);

    const reenterBundle = leverageBuilder.buildDeleveragingBundle({
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

    return encodeFunctionData({
      abi: BUNDLER_ABI,
      functionName: 'multicall',
      args: [outerBundle]
    });
  }

  /**
   * Constructs the multicall payload for leveraging up positions.
   *
   * @param {object} params
   * @returns {string} Encoded multicall calldata
   */
  static encodeLeveragingUpCalldata({
    assessment,
    swap,
    leverageBuilder,
    ETHER_GENERAL_ADAPTER_1,
    MORPHO_BUNDLER_V3
  }) {
    const expectedPtOutput = BigInt(swap.routeData.outputs[0].amount);

    const reenterBundle = leverageBuilder.buildLeveragingUpBundle({
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

    return encodeFunctionData({
      abi: BUNDLER_ABI,
      functionName: 'multicall',
      args: [outerBundle]
    });
  }

  /**
   * Formats human-readable steps and calculates fair market value and shortfall metrics.
   *
   * @param {object} params
   * @returns {{ steps: string[], fairMarketValue: bigint, fairValueLoss: bigint, walletShortfall: bigint }}
   */
  static formatStepsAndMetrics({ assessment, swap, isLeverageUp }) {
    const loanDec = 10 ** assessment.marketParams.loanDecimals;
    const collDec = 10 ** assessment.marketParams.collateralDecimals;

    const steps = isLeverageUp ? [
      `Flashloan: Borrow ${Number(assessment.params.debtAmount) / loanDec} ${assessment.market.loanSymbol} from Adapter`,
      `Swap: Swap ${assessment.market.loanSymbol} for ${Number(swap.routeData.outputs[0].amount) / collDec} ${assessment.market.collateralSymbol}`,
      `Supply: Supply ${assessment.market.collateralSymbol} to Morpho Blue Core`,
      `Borrow: Borrow ${Number(assessment.params.debtAmount) / loanDec} ${assessment.market.loanSymbol} from Morpho Blue Core to adapter`,
      `Repay Flashloan: Repay flashloan back to provider`
    ] : [
      `Flashloan: Borrow Flashloan from Adapter`,
      `Withdraw: Withdraw ${Number(assessment.params.collateralAmount) / collDec} ${assessment.market.collateralSymbol} from Morpho Blue Core`,
      `Approve Swap: Approve Swap Router for ${Number(assessment.params.collateralAmount) / collDec} ${assessment.market.collateralSymbol}`,
      `Swap: Swap ${assessment.market.collateralSymbol} for ${Number(swap.routeData.outputs[0].amount) / loanDec} ${assessment.market.loanSymbol}`,
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

    return { steps, fairMarketValue, fairValueLoss, walletShortfall };
  }

  /**
   * Prepares simulation prepend calls to ensure debt state exists for simulation.
   *
   * @param {object} params
   * @returns {Promise<Array<object>>}
   */
  static async preparePrependCalls({ calldataResult, blockchainClient, morphoBlueAddress }) {
    const prependCalls = [];
    try {
      const livePosition = await blockchainClient.fetchMorphoPosition(calldataResult.marketId, calldataResult.userAddress, true);
      const liveDebt = livePosition.debt;
      if (liveDebt < calldataResult.position.debt) {
        const borrowDiff = calldataResult.position.debt - liveDebt;
        prependCalls.push({
          from: calldataResult.userAddress,
          to: morphoBlueAddress,
          value: '0x0',
          data: encodeFunctionData({
            abi: MORPHO_BLUE_ABI,
            functionName: 'borrow',
            args: [calldataResult.marketParams, borrowDiff, 0n, calldataResult.userAddress, calldataResult.userAddress]
          })
        });
      }
    } catch (e) {
      // Ignore errors
    }
    return prependCalls;
  }
}
