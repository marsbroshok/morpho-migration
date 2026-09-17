/**
 * @fileoverview Transaction bundle builder for leverage adjustment operations (deleveraging and leveraging up).
 */

import { encodeFunctionData as defaultEncodeFunctionData } from 'viem';
import { ApprovalBuilder, ERC20_ABI } from './approval-builder.js';
import { ADAPTER_ABI } from '../contracts/abis.js';

/**
 * Builds multicall bundles for Morpho Blue leverage adjustments.
 */
export class LeverageBundleBuilder {
  /**
   * @param {ApprovalBuilder} [approvalBuilder] Spender and approval resolver
   */
  constructor(approvalBuilder = new ApprovalBuilder()) {
    this.approvalBuilder = approvalBuilder;
  }

  /**
   * Constructs the deleveraging bundle for repaying debt and withdrawing collateral.
   *
   * @param {object} params
   * @param {Function} [params.encodeFunctionData] viem function encoder
   * @param {object} params.marketParams Morpho Blue market parameters
   * @param {bigint} params.collateralAmount Collateral amount to withdraw and sell
   * @param {bigint} params.debtAmount Debt amount to repay
   * @param {boolean} params.is1x Whether position is being completely deleveraged to 1.0x
   * @param {string} params.collateralAddress Address of collateral asset
   * @param {string} params.loanAddress Address of loan asset
   * @param {object} params.routeData Swap quote and transaction payload
   * @param {string} params.userAddress Position owner address
   * @param {string} params.ETHER_GENERAL_ADAPTER_1 Morpho adapter address
   * @param {string} params.MORPHO_BUNDLER_V3 Morpho bundler address
   * @param {bigint} params.flashLoanAmount Flashloan principal amount
   * @returns {Array<object>} Deleveraging subcall bundle
   */
  buildDeleveragingBundle({
    encodeFunctionData: passedEncFn,
    marketParams,
    collateralAmount,
    debtAmount,
    is1x,
    collateralAddress,
    loanAddress,
    routeData,
    userAddress,
    ETHER_GENERAL_ADAPTER_1,
    MORPHO_BUNDLER_V3,
    flashLoanAmount
  }) {
    const encodeFunctionData = passedEncFn || defaultEncodeFunctionData;
    const repayAmount = is1x ? 0n : debtAmount;
    const repayShares = is1x ? 2n ** 256n - 1n : 0n;

    const bundle = [];

    // Call A: Repay Morpho Blue debt on behalf of user
    bundle.push({
      to: ETHER_GENERAL_ADAPTER_1,
      data: encodeFunctionData({
        abi: ADAPTER_ABI,
        functionName: 'morphoRepay',
        args: [marketParams, repayAmount, repayShares, 2n ** 256n - 1n, userAddress, '0x']
      }),
      value: 0n,
      skipRevert: false,
      callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
    });

    // Call B: Withdraw collateral PT from Morpho to Bundler3 for swapping
    bundle.push({
      to: ETHER_GENERAL_ADAPTER_1,
      data: encodeFunctionData({
        abi: ADAPTER_ABI,
        functionName: 'morphoWithdrawCollateral',
        args: [marketParams, collateralAmount, MORPHO_BUNDLER_V3]
      }),
      value: 0n,
      skipRevert: false,
      callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
    });

    // Approvals for swap spenders
    const spenders = this.approvalBuilder.getSpendersToApprove(routeData);
    for (const spender of spenders) {
      this.approvalBuilder.appendApprovals(bundle, collateralAddress, spender, encodeFunctionData);
    }

    // Call D: Execute swap (collateral -> loan)
    bundle.push({
      to: routeData.tx.to,
      data: routeData.tx.data,
      value: 0n,
      skipRevert: false,
      callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
    });

    // Call E: Transfer swap output from Bundler to Adapter (if not directly sent to Adapter)
    const receiverIsAdapter = routeData.contractParamInfo &&
      routeData.contractParamInfo.contractCallParamsName &&
      routeData.contractParamInfo.contractCallParamsName.includes('receiver') &&
      routeData.contractParamInfo.contractCallParams[routeData.contractParamInfo.contractCallParamsName.indexOf('receiver')].toLowerCase() === ETHER_GENERAL_ADAPTER_1.toLowerCase();

    const txOutput = routeData.tx && routeData.tx.outputs && routeData.tx.outputs[0] ? BigInt(routeData.tx.outputs[0].amount) : null;
    const expectedOutput = txOutput !== null ? txOutput : BigInt(routeData.outputs[0].amount);

    if (!receiverIsAdapter) {
      bundle.push({
        to: loanAddress,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'transfer',
          args: [ETHER_GENERAL_ADAPTER_1, expectedOutput]
        }),
        value: 0n,
        skipRevert: false,
        callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
      });
    }

    // Call F: Pull deficit/shortfall if flashloan amount exceeds swap output
    const shortfall = flashLoanAmount > expectedOutput ? flashLoanAmount - expectedOutput : 0n;
    if (shortfall > 0n) {
      bundle.push({
        to: ETHER_GENERAL_ADAPTER_1,
        data: encodeFunctionData({
          abi: ADAPTER_ABI,
          functionName: 'permit2TransferFrom',
          args: [loanAddress, ETHER_GENERAL_ADAPTER_1, shortfall]
        }),
        value: 0n,
        skipRevert: false,
        callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
      });
    }

    return bundle;
  }

  /**
   * Constructs the leveraging up bundle for borrowing loan assets and buying collateral.
   *
   * @param {object} params
   * @param {Function} [params.encodeFunctionData] viem function encoder
   * @param {object} params.marketParams Morpho Blue market parameters
   * @param {bigint} params.collateralAmount Collateral amount bought from swap
   * @param {bigint} params.debtAmount Debt amount borrowed from flashloan
   * @param {string} params.collateralAddress Address of collateral asset
   * @param {string} params.loanAddress Address of loan asset
   * @param {object} params.routeData Swap quote and transaction payload
   * @param {string} params.userAddress Position owner address
   * @param {string} params.ETHER_GENERAL_ADAPTER_1 Morpho adapter address
   * @param {string} params.MORPHO_BUNDLER_V3 Morpho bundler address
   * @returns {Array<object>} Leveraging up subcall bundle
   */
  buildLeveragingUpBundle({
    encodeFunctionData: passedEncFn,
    marketParams,
    collateralAmount,
    debtAmount,
    collateralAddress,
    loanAddress,
    routeData,
    userAddress,
    ETHER_GENERAL_ADAPTER_1,
    MORPHO_BUNDLER_V3
  }) {
    const encodeFunctionData = passedEncFn || defaultEncodeFunctionData;
    const bundle = [];

    // Call A: Transfer loan token from Adapter to Bundler3 for swap execution
    bundle.push({
      to: ETHER_GENERAL_ADAPTER_1,
      data: encodeFunctionData({
        abi: ADAPTER_ABI,
        functionName: 'erc20Transfer',
        args: [loanAddress, MORPHO_BUNDLER_V3, debtAmount]
      }),
      value: 0n,
      skipRevert: false,
      callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
    });

    // Approvals for swap spenders
    const spenders = this.approvalBuilder.getSpendersToApprove(routeData);
    for (const spender of spenders) {
      this.approvalBuilder.appendApprovals(bundle, loanAddress, spender, encodeFunctionData);
    }

    // Call C: Execute swap (loan -> collateral)
    bundle.push({
      to: routeData.tx.to,
      data: routeData.tx.data,
      value: 0n,
      skipRevert: false,
      callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
    });

    // Call D: Transfer collateral from Bundler to Adapter (if not directly sent to Adapter)
    const receiverIsAdapter = routeData.contractParamInfo &&
      routeData.contractParamInfo.contractCallParamsName &&
      routeData.contractParamInfo.contractCallParamsName.includes('receiver') &&
      routeData.contractParamInfo.contractCallParams[routeData.contractParamInfo.contractCallParamsName.indexOf('receiver')].toLowerCase() === ETHER_GENERAL_ADAPTER_1.toLowerCase();

    if (!receiverIsAdapter) {
      bundle.push({
        to: collateralAddress,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'transfer',
          args: [ETHER_GENERAL_ADAPTER_1, collateralAmount]
        }),
        value: 0n,
        skipRevert: false,
        callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
      });
    }

    // Call E: Supply purchased collateral to Morpho on behalf of user (supplying adapter's full balance)
    bundle.push({
      to: ETHER_GENERAL_ADAPTER_1,
      data: encodeFunctionData({
        abi: ADAPTER_ABI,
        functionName: 'morphoSupplyCollateral',
        args: [marketParams, 2n ** 256n - 1n, userAddress, '0x']
      }),
      value: 0n,
      skipRevert: false,
      callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
    });

    // Call F: Borrow loan asset from Morpho to Adapter (repaying flashloan)
    bundle.push({
      to: ETHER_GENERAL_ADAPTER_1,
      data: encodeFunctionData({
        abi: ADAPTER_ABI,
        functionName: 'morphoBorrow',
        args: [marketParams, debtAmount, 0n, 0n, ETHER_GENERAL_ADAPTER_1]
      }),
      value: 0n,
      skipRevert: false,
      callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
    });

    return bundle;
  }
}
