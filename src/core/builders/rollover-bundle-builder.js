/**
 * @fileoverview Transaction bundle builder for cross-market and same-market collateral rollover operations.
 */

import { encodeFunctionData as defaultEncodeFunctionData, encodeAbiParameters as defaultEncodeAbiParameters, keccak256 as defaultKeccak256 } from 'viem';
import { ApprovalBuilder, ERC20_ABI } from './approval-builder.js';
import { LiquidityPoolService } from '../services/liquidity-pool-service.js';
import { SlippageService } from '../math/slippage-service.js';
import { BUNDLER_ABI, ADAPTER_ABI, getCurvePoolExchangeAbi } from '../contracts/abis.js';

const ZERO_CALLBACK_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Creates a standard bundle step object.
 */
function createBundleStep(to, data, callbackHash = ZERO_CALLBACK_HASH) {
  return {
    to,
    data,
    value: 0n,
    skipRevert: false,
    callbackHash
  };
}

/**
 * Builds multicall bundles for Morpho Blue position rollovers (full and partial).
 */
export class RolloverBundleBuilder {
  /**
   * @param {ApprovalBuilder} [approvalBuilder] Spender and approval resolver
   * @param {LiquidityPoolService} [poolService] On-chain liquidity pool finder
   * @param {SlippageService} [slippageService] Slippage tolerance and impact calculator
   */
  constructor(
    approvalBuilder = new ApprovalBuilder(),
    poolService = new LiquidityPoolService(),
    slippageService = new SlippageService()
  ) {
    this.approvalBuilder = approvalBuilder;
    this.poolService = poolService;
    this.slippageService = slippageService;
  }

  /**
   * Finds Curve pool and indices for token pair.
   */
  async findCurvePoolAndIndices(publicClient, fromToken, toToken, amount, getAddress) {
    return this.poolService.findCurvePoolAndIndices(publicClient, fromToken, toToken, amount, getAddress);
  }

  /**
   * Finds Uniswap V3 pool for token paired with WETH.
   */
  async findUniswapV3Pool(publicClient, tokenAddress, getAddress) {
    return this.poolService.findUniswapV3Pool(publicClient, tokenAddress, getAddress);
  }

  /**
   * Constructs the rollover bundle for unwinding, swapping, and re-supplying positions.
   *
   * @param {object} params Rollover parameters
   * @returns {{ outerBundle?: Array<object>, reenterBundle?: Array<object>, flashLoanAmount: bigint, repayAmount: bigint, repayShares?: bigint, borrowAmount: bigint, finalCalldata: string }}
   */
  buildRolloverBundle({
    encodeFunctionData: passedEncFn,
    encodeAbiParameters: passedEncAbi,
    keccak256: passedKeccak,
    sourceMarketParams,
    destMarketParams,
    collateralAmount,
    debtAmount,
    isFull,
    sourceCollateralAddress,
    destCollateralAddress,
    routeData,
    userAddress,
    ETHER_GENERAL_ADAPTER_1,
    MORPHO_BUNDLER_V3,
    isSameCollateral = false,
    isSameLoan = true,
    loanRouteData = null,
    loanExpectedInput = 0n,
    loanExpectedOutput = 0n,
    slippage = 0.005,
    slippageBps = null,
    borrowShares = 0n,
    actualLoanOutput = null,
    actualCollateralOutput = null,
    capBorrow = true,
    maxSafeBorrowAmount = null
  }) {
    const encodeFunctionData = passedEncFn || defaultEncodeFunctionData;
    const encodeAbiParameters = passedEncAbi || defaultEncodeAbiParameters;
    const keccak256 = passedKeccak || defaultKeccak256;

    let effectiveSlippageBps = 50n;
    if (slippageBps !== null && slippageBps !== undefined) {
      effectiveSlippageBps = BigInt(slippageBps);
    } else if (slippage !== null && slippage !== undefined) {
      if (typeof slippage === 'bigint') {
        effectiveSlippageBps = slippage;
      } else {
        const s = Number(slippage);
        if (s <= 0.05 && s > 0) {
          effectiveSlippageBps = BigInt(Math.round(s * 10000));
        } else {
          effectiveSlippageBps = BigInt(Math.round(s * 100));
        }
      }
    }

    // 1. Zero debt rollover path (Unleveraged rollover)
    if (debtAmount === 0n) {
      const bundle = [];

      // Call 1: Withdraw collateral
      bundle.push(createBundleStep(
        ETHER_GENERAL_ADAPTER_1,
        encodeFunctionData({
          abi: ADAPTER_ABI,
          functionName: 'morphoWithdrawCollateral',
          args: [sourceMarketParams, collateralAmount, isSameCollateral ? ETHER_GENERAL_ADAPTER_1 : MORPHO_BUNDLER_V3]
        })
      ));

      // Call 2 & 3: Swap if needed
      if (!isSameCollateral) {
        const spenders = this.approvalBuilder.getSpendersToApprove(routeData);
        for (const spender of spenders) {
          this.approvalBuilder.appendApprovals(bundle, sourceCollateralAddress, spender, encodeFunctionData);
        }

        bundle.push(createBundleStep(routeData.tx.to, routeData.tx.data));

        // Transfer swap output from Bundler to Adapter
        const resolvedCollateralOutput = actualCollateralOutput !== null ? actualCollateralOutput : BigInt(routeData.outputs[0].amount);
        bundle.push(createBundleStep(
          destMarketParams.collateralToken,
          encodeFunctionData({
            abi: ERC20_ABI,
            functionName: 'transfer',
            args: [ETHER_GENERAL_ADAPTER_1, resolvedCollateralOutput]
          })
        ));
      }

      // Call 4: Supply collateral
      bundle.push(createBundleStep(
        ETHER_GENERAL_ADAPTER_1,
        encodeFunctionData({
          abi: ADAPTER_ABI,
          functionName: 'morphoSupplyCollateral',
          args: [destMarketParams, 2n ** 256n - 1n, userAddress, '0x']
        })
      ));

      const finalCalldata = encodeFunctionData({
        abi: BUNDLER_ABI,
        functionName: 'multicall',
        args: [bundle]
      });

      return {
        borrowAmount: 0n,
        flashLoanAmount: 0n,
        repayAmount: 0n,
        finalCalldata
      };
    }

    // 2. Flashloan rollover path (Leveraged rollover)
    const oldLoanDecimals = sourceMarketParams.loanDecimals;
    const bufferAmount = debtAmount > 100n * 10n ** BigInt(oldLoanDecimals) ? 2n * 10n ** BigInt(oldLoanDecimals) : (debtAmount * 2n / 1000n);
    const flashLoanAmount = isFull ? (debtAmount + bufferAmount) : debtAmount;
    const repayAmount = isFull ? 0n : debtAmount;
    const repayShares = isFull ? borrowShares : 0n;
    const supplyAmount = 2n ** 256n - 1n; // Auto supply full balance

    let borrowAmount = isSameLoan ? flashLoanAmount : loanExpectedInput;
    if (capBorrow && maxSafeBorrowAmount && borrowAmount > maxSafeBorrowAmount) {
      borrowAmount = maxSafeBorrowAmount;
    }

    const reenterBundle = [];

    // Call A: Repay debt
    reenterBundle.push(createBundleStep(
      ETHER_GENERAL_ADAPTER_1,
      encodeFunctionData({
        abi: ADAPTER_ABI,
        functionName: 'morphoRepay',
        args: [sourceMarketParams, repayAmount, repayShares, 2n ** 256n - 1n, userAddress, '0x']
      })
    ));

    // Call B: Withdraw collateral
    reenterBundle.push(createBundleStep(
      ETHER_GENERAL_ADAPTER_1,
      encodeFunctionData({
        abi: ADAPTER_ABI,
        functionName: 'morphoWithdrawCollateral',
        args: [sourceMarketParams, collateralAmount, isSameCollateral ? ETHER_GENERAL_ADAPTER_1 : MORPHO_BUNDLER_V3]
      })
    ));

    // Call C & Call D: Only if collateral tokens are different
    if (!isSameCollateral) {
      const spenders = this.approvalBuilder.getSpendersToApprove(routeData);
      for (const spender of spenders) {
        this.approvalBuilder.appendApprovals(reenterBundle, sourceCollateralAddress, spender, encodeFunctionData);
      }

      reenterBundle.push(createBundleStep(routeData.tx.to, routeData.tx.data));

      // Transfer swap output from Bundler to Adapter
      const resolvedCollateralOutput = actualCollateralOutput !== null ? actualCollateralOutput : BigInt(routeData.outputs[0].amount);
      reenterBundle.push(createBundleStep(
        destMarketParams.collateralToken,
        encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'transfer',
          args: [ETHER_GENERAL_ADAPTER_1, resolvedCollateralOutput]
        })
      ));
    }

    // Call E: Supply collateral
    reenterBundle.push(createBundleStep(
      ETHER_GENERAL_ADAPTER_1,
      encodeFunctionData({
        abi: ADAPTER_ABI,
        functionName: 'morphoSupplyCollateral',
        args: [destMarketParams, supplyAmount, userAddress, '0x']
      })
    ));

    // Call F: Borrow back
    reenterBundle.push(createBundleStep(
      ETHER_GENERAL_ADAPTER_1,
      encodeFunctionData({
        abi: ADAPTER_ABI,
        functionName: 'morphoBorrow',
        args: [
          destMarketParams,
          borrowAmount,
          0n,
          0n,
          isSameLoan ? ETHER_GENERAL_ADAPTER_1 : MORPHO_BUNDLER_V3
        ]
      })
    ));

    // Call G & H: Only if loan assets are different
    if (!isSameLoan) {
      let resolvedOutput = 0n;

      if (loanRouteData?.isCurveDirect) {
        const CurvePool = loanRouteData.poolAddress;
        reenterBundle.push(createBundleStep(
          destMarketParams.loanToken,
          encodeFunctionData({
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [CurvePool, 2n ** 256n - 1n]
          })
        ));

        const minSwapOutput = this.slippageService.applySlippageTolerance(loanExpectedOutput, effectiveSlippageBps);
        resolvedOutput = actualLoanOutput !== null ? actualLoanOutput : loanExpectedOutput;

        reenterBundle.push(createBundleStep(
          CurvePool,
          encodeFunctionData({
            abi: getCurvePoolExchangeAbi(loanRouteData.indexType),
            functionName: 'exchange',
            args: [loanRouteData.i, loanRouteData.j, loanExpectedInput, minSwapOutput]
          })
        ));
      } else {
        const spenders = this.approvalBuilder.getSpendersToApprove(loanRouteData);
        for (const spender of spenders) {
          this.approvalBuilder.appendApprovals(reenterBundle, destMarketParams.loanToken, spender, encodeFunctionData);
        }

        // Execute swap (settles directly to Bundler)
        reenterBundle.push(createBundleStep(loanRouteData.tx.to, loanRouteData.tx.data));

        resolvedOutput = actualLoanOutput !== null ? actualLoanOutput : (loanExpectedOutput !== undefined ? BigInt(loanExpectedOutput) : BigInt(loanRouteData.outputs[0].amount));
      }

      // Transfer swap output from Bundler to Adapter
      reenterBundle.push(createBundleStep(
        sourceMarketParams.loanToken,
        encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'transfer',
          args: [ETHER_GENERAL_ADAPTER_1, resolvedOutput]
        })
      ));

      const shortfall = flashLoanAmount > resolvedOutput ? flashLoanAmount - resolvedOutput : 0n;
      if (shortfall > 0n) {
        reenterBundle.push(createBundleStep(
          ETHER_GENERAL_ADAPTER_1,
          encodeFunctionData({
            abi: ADAPTER_ABI,
            functionName: 'permit2TransferFrom',
            args: [sourceMarketParams.loanToken, ETHER_GENERAL_ADAPTER_1, shortfall]
          })
        ));
      }
    }

    // Encode Callback Bundle
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

    // Outer Bundle
    const outerBundle = [
      createBundleStep(
        ETHER_GENERAL_ADAPTER_1,
        encodeFunctionData({
          abi: ADAPTER_ABI,
          functionName: 'morphoFlashLoan',
          args: [sourceMarketParams.loanToken, flashLoanAmount, encodedReenterBundle]
        }),
        callbackHash
      ),
      createBundleStep(
        ETHER_GENERAL_ADAPTER_1,
        encodeFunctionData({
          abi: ADAPTER_ABI,
          functionName: 'erc20Transfer',
          args: [sourceMarketParams.loanToken, userAddress, 2n ** 256n - 1n]
        })
      )
    ];

    const finalCalldata = encodeFunctionData({
      abi: BUNDLER_ABI,
      functionName: 'multicall',
      args: [outerBundle]
    });

    return {
      outerBundle,
      reenterBundle,
      flashLoanAmount,
      repayAmount,
      repayShares,
      borrowAmount,
      finalCalldata
    };
  }
}
