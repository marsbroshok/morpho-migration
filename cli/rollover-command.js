import { getAddress, encodeFunctionData, encodeAbiParameters, keccak256 } from 'viem';
import { calculateCollateralValue, calculateLtv, calculateLeverage } from '../math.js';
import { formatMarketLabel } from '../labels.js';
import { ERC20_ABI, ADAPTER_ABI } from '../builders.js';

const MORPHO_BUNDLER_V3 = "0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245";
const ETHER_GENERAL_ADAPTER_1 = "0x4A6c312ec70E8747a587EE860a0353cd42Be0aE0";

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

export class RolloverCommand {
  /**
   * @param {BlockchainClient} blockchainClient 
   * @param {PendleRouterClient} routerClient 
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
    const oldMarketId = options.oldMarketId;
    const newMarketId = options.newMarketId;
    const usdcAddress = getAddress(options.usdc || "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
    const slippage = options.slippage;

    // Fetch Market Params
    const oldMarketParams = await this.blockchainClient.fetchMarketParams(oldMarketId);
    const newMarketParams = await this.blockchainClient.fetchMarketParams(newMarketId);

    const oldPtAddress = getAddress(options.oldPt || oldMarketParams.collateralToken);
    const newPtAddress = getAddress(options.newPt || newMarketParams.collateralToken);

    // Fetch User position on source market
    const position = await this.blockchainClient.fetchMorphoPosition(oldMarketId, userAddress);
    const liveCollateral = position.collateral;
    const liveDebt = position.debt;
    const liveBorrowShares = position.borrowShares;

    if (liveCollateral === 0n) {
      throw new Error(`User does not have an active collateral position in market ${oldMarketId}`);
    }

    const isFull = (options.type === 'full');
    let debtAmount = liveDebt;
    let collateralAmount = liveCollateral;

    if (!isFull) {
      if (!options.debt) {
        throw new Error('Debt amount is required for partial rollover');
      }
      debtAmount = BigInt(Math.floor(options.debt * 1e6));
      if (debtAmount > liveDebt) {
        throw new Error(`Requested debt amount ${options.debt} USDC exceeds user debt of ${Number(liveDebt)/1e6} USDC`);
      }
      // Calculate proportional collateral withdrawn
      collateralAmount = (liveCollateral * debtAmount) / liveDebt;
    }

    const oldCollateralSymbol = options.oldCollateralSymbol || "PT-old";
    const oldLoanSymbol = options.oldLoanSymbol || "USDC";
    const newCollateralSymbol = options.newCollateralSymbol || "PT-new";
    const newLoanSymbol = options.newLoanSymbol || "USDC";
    const maturity = await this.blockchainClient.checkPtMaturity(oldPtAddress);

    return {
      userAddress,
      oldMarketId,
      newMarketId,
      usdcAddress,
      slippage,
      oldMarketParams,
      newMarketParams,
      oldPtAddress,
      newPtAddress,
      oldMarket: {
        collateralToken: oldMarketParams.collateralToken,
        collateralSymbol: oldCollateralSymbol,
        loanToken: oldMarketParams.loanToken,
        loanSymbol: oldLoanSymbol
      },
      newMarket: {
        collateralToken: newMarketParams.collateralToken,
        collateralSymbol: newCollateralSymbol,
        loanToken: newMarketParams.loanToken,
        loanSymbol: newLoanSymbol
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
   * Phase 2: Fetch swap route quote from Pendle API.
   */
  async fetchSwapRoute(assessment, options) {
    const slippageFrac = assessment.slippage / 100;
    const routeData = await this.routerClient.fetchPendleRoute(
      assessment.oldPtAddress,
      assessment.collateralAmount,
      assessment.newPtAddress,
      slippageFrac
    );
    const expectedNewCollateral = BigInt(routeData.outputs[0].amount);

    const [oldOraclePrice, newOraclePrice] = await Promise.all([
      this.blockchainClient.publicClient.readContract({
        address: assessment.oldMarketParams.oracle,
        abi: [{"inputs":[],"name":"price","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"}],
        functionName: 'price'
      }),
      this.blockchainClient.publicClient.readContract({
        address: assessment.newMarketParams.oracle,
        abi: [{"inputs":[],"name":"price","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"}],
        functionName: 'price'
      })
    ]);

    const oracleRatio = (oldOraclePrice * 10n ** 18n) / newOraclePrice;
    const quotedRate = (expectedNewCollateral * 10n ** 18n) / assessment.collateralAmount;
    const slippagePct = oracleRatio > 0n ? Number((oracleRatio - quotedRate) * 10000n / oracleRatio) / 100 : 0.0;

    return {
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
      expectedOutput: expectedNewCollateral
    };
  }

  /**
   * Phase 3: Compile calldata multicall payload and steps.
   */
  async compileCalldata(assessment, swap, options) {
    const isFull = (assessment.type === 'full');
    const bufferAmount = assessment.debtAmount > 100n * 10n ** 6n ? 2n * 10n ** 6n : (assessment.debtAmount * 2n / 1000n);
    const flashLoanAmount = isFull ? (assessment.debtAmount + bufferAmount) : assessment.debtAmount;
    const repayAmount = isFull ? 0n : assessment.debtAmount;
    const repayShares = isFull ? assessment.position.borrowShares : 0n;
    const supplyAmount = 2n ** 256n - 1n; // Auto supply full balance
    const borrowAmount = flashLoanAmount;

    const newCollateralValue = calculateCollateralValue(swap.expectedNewCollateral, swap.newOraclePrice);
    const newLtv = calculateLtv(borrowAmount, newCollateralValue);
    const newLeverage = calculateLeverage(newCollateralValue, borrowAmount);

    const reenterBundle = [];

    // Call A: Repay debt
    reenterBundle.push({
      to: ETHER_GENERAL_ADAPTER_1,
      data: encodeFunctionData({
        abi: ADAPTER_ABI,
        functionName: 'morphoRepay',
        args: [assessment.oldMarketParams, repayAmount, repayShares, 2n ** 256n - 1n, assessment.userAddress, '0x']
      }),
      value: 0n,
      skipRevert: false,
      callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
    });

    // Call B: Withdraw collateral
    reenterBundle.push({
      to: ETHER_GENERAL_ADAPTER_1,
      data: encodeFunctionData({
        abi: ADAPTER_ABI,
        functionName: 'morphoWithdrawCollateral',
        args: [assessment.oldMarketParams, assessment.collateralAmount, MORPHO_BUNDLER_V3]
      }),
      value: 0n,
      skipRevert: false,
      callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
    });

    // Call C: Approve Pendle
    reenterBundle.push({
      to: assessment.oldPtAddress,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [swap.routeData.tx.to, assessment.collateralAmount]
      }),
      value: 0n,
      skipRevert: false,
      callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
    });

    // Call D: Swap Pendle
    reenterBundle.push({
      to: swap.routeData.tx.to,
      data: swap.routeData.tx.data,
      value: 0n,
      skipRevert: false,
      callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
    });

    // Call E: Supply collateral
    reenterBundle.push({
      to: ETHER_GENERAL_ADAPTER_1,
      data: encodeFunctionData({
        abi: ADAPTER_ABI,
        functionName: 'morphoSupplyCollateral',
        args: [assessment.newMarketParams, supplyAmount, assessment.userAddress, '0x']
      }),
      value: 0n,
      skipRevert: false,
      callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
    });

    // Call F: Borrow back
    reenterBundle.push({
      to: ETHER_GENERAL_ADAPTER_1,
      data: encodeFunctionData({
        abi: ADAPTER_ABI,
        functionName: 'morphoBorrow',
        args: [assessment.newMarketParams, borrowAmount, 0n, 0n, ETHER_GENERAL_ADAPTER_1]
      }),
      value: 0n,
      skipRevert: false,
      callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
    });

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
      {
        to: ETHER_GENERAL_ADAPTER_1,
        data: encodeFunctionData({
          abi: ADAPTER_ABI,
          functionName: 'morphoFlashLoan',
          args: [assessment.usdcAddress, flashLoanAmount, encodedReenterBundle]
        }),
        value: 0n,
        skipRevert: false,
        callbackHash: callbackHash
      }
    ];

    if (isFull) {
      outerBundle.push({
        to: ETHER_GENERAL_ADAPTER_1,
        data: encodeFunctionData({
          abi: ADAPTER_ABI,
          functionName: 'erc20Transfer',
          args: [assessment.usdcAddress, assessment.userAddress, 2n ** 256n - 1n]
        }),
        value: 0n,
        skipRevert: false,
        callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
      });
    }

    const finalCalldata = encodeFunctionData({
      abi: BUNDLER_ABI,
      functionName: 'multicall',
      args: [outerBundle]
    });

    return {
      ...assessment,
      swap,
      simulatedNewDebt: borrowAmount,
      newLtv,
      newLeverage,
      steps: [
        `Flashloan: Borrow ${Number(flashLoanAmount)/1e6} USDC from Adapter`,
        `Repay Debt: Repay ${Number(repayAmount)/1e6} USDC on old market`,
        `Withdraw: Withdraw ${Number(assessment.collateralAmount)/1e18} PT-old from old market`,
        `Approve: Approve Swap Router for ${Number(assessment.collateralAmount)/1e18} PT-old`,
        `Swap: Swap PT-old for ${Number(swap.expectedNewCollateral)/1e18} PT-new`,
        `Supply: Supply PT-new to new market`,
        `Borrow: Borrow ${Number(borrowAmount)/1e6} USDC from new market`
      ],
      finalCalldata
    };
  }

  /**
   * Phase 4: Run transaction simulation on fork.
   */
  async runSimulation(calldataResult, options) {
    return this.simulationEngine.simulateTransaction(
      calldataResult.userAddress,
      MORPHO_BUNDLER_V3,
      calldataResult.finalCalldata,
      0n
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
        spentToken: assessment.oldPtAddress,
        receivedToken: assessment.newPtAddress,
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
