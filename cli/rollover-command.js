import { getAddress, encodeFunctionData, encodeAbiParameters, keccak256 } from 'viem';
import { calculateCollateralValue, calculateLtv, calculateLeverage } from '../math.js';
import { formatMarketLabel } from '../labels.js';
import { ERC20_ABI, ADAPTER_ABI, BUNDLER_ABI, buildRolloverBundle, findCurvePoolAndIndices, findUniswapV3Pool } from '../builders.js';

const MORPHO_BUNDLER_V3 = "0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245";
const ETHER_GENERAL_ADAPTER_1 = "0x4A6c312ec70E8747a587EE860a0353cd42Be0aE0";
const MORPHO_BLUE = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";

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
  }

  async findCurvePoolAndIndices(fromToken, toToken, amount) {
    return findCurvePoolAndIndices(this.blockchainClient.publicClient, fromToken, toToken, amount, getAddress);
  }

  async findUniswapV3Pool(tokenAddress) {
    return findUniswapV3Pool(this.blockchainClient.publicClient, tokenAddress, getAddress);
  }


  /**
   * Phase 1: Fetch details and assess user position.
   */
  async assessPosition(options) {
    const userAddress = getAddress(options.user);
    const sourceMarketId = options.oldMarketId;
    const destMarketId = options.newMarketId;

    // Fetch Market Params
    const sourceMarketParams = await this.blockchainClient.fetchMarketParams(sourceMarketId);
    const destMarketParams = await this.blockchainClient.fetchMarketParams(destMarketId);

    const sourceLoanAddress = getAddress(sourceMarketParams.loanToken);
    const destLoanAddress = getAddress(destMarketParams.loanToken);

    const sourceCollateralAddress = getAddress(sourceMarketParams.collateralToken);
    const destCollateralAddress = getAddress(destMarketParams.collateralToken);

    // Fetch User position on source market
    const position = await this.blockchainClient.fetchMorphoPosition(sourceMarketId, userAddress);
    const liveCollateral = position.collateral;
    const liveDebt = position.debt;
    const liveBorrowShares = position.borrowShares;

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
      debtAmount = BigInt(Math.floor(options.debt * 10 ** sourceMarketParams.loanDecimals));
      if (debtAmount > liveDebt) {
        const formattedLiveDebt = Number(liveDebt) / (10 ** sourceMarketParams.loanDecimals);
        throw new Error(`Requested debt amount ${options.debt} ${sourceMarketParams.loanSymbol} exceeds user debt of ${formattedLiveDebt.toFixed(2)} ${sourceMarketParams.loanSymbol}`);
      }
      // Calculate proportional collateral withdrawn
      collateralAmount = (liveCollateral * debtAmount) / liveDebt;
    }

    const sourceCollateralSymbol = options.oldCollateralSymbol || sourceMarketParams.collateralSymbol || "PT-old";
    const sourceLoanSymbol = options.oldLoanSymbol || sourceMarketParams.loanSymbol || "USDC";
    const destCollateralSymbol = options.newCollateralSymbol || destMarketParams.collateralSymbol || "PT-new";
    const destLoanSymbol = options.newLoanSymbol || destMarketParams.loanSymbol || "USDC";
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
        collateralSymbol: sourceCollateralSymbol,
        loanToken: sourceMarketParams.loanToken,
        loanSymbol: sourceLoanSymbol
      },
      newMarket: {
        collateralToken: destMarketParams.collateralToken,
        collateralSymbol: destCollateralSymbol,
        loanToken: destMarketParams.loanToken,
        loanSymbol: destLoanSymbol
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
    const slippageFrac = assessment.slippage / 100;

    let routeData = null;
    let expectedNewCollateral = assessment.collateralAmount;

    if (!isSameCollateral) {
       routeData = await this.routerClient.fetchSwapRoute(
         assessment.sourceCollateralAddress,
         assessment.collateralAmount,
         assessment.destCollateralAddress,
         slippageFrac,
         ETHER_GENERAL_ADAPTER_1,
         MORPHO_BUNDLER_V3
       );
      expectedNewCollateral = BigInt(routeData.outputs[0].amount);
    }

    const [oldOraclePrice, newOraclePrice] = await Promise.all([
      this.blockchainClient.publicClient.readContract({
        address: assessment.sourceMarketParams.oracle,
        abi: [{"inputs":[],"name":"price","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"}],
        functionName: 'price'
      }),
      this.blockchainClient.publicClient.readContract({
        address: assessment.destMarketParams.oracle,
        abi: [{"inputs":[],"name":"price","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"}],
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

    // Handle cross-loan-asset routing
    let loanRouteData = null;
    let loanExpectedInput = 0n;
    let loanExpectedOutput = 0n;
    let loanOracleRate = 0n;
    let loanSlippagePct = 0.0;

    if (!isSameLoan) {
      const exp = 18n + BigInt(newScale) - BigInt(oldScale);
      loanOracleRate = (oldOraclePrice * 10n ** exp) / newOraclePrice;

      // Estimate target borrow (which is in loanDecimals of the new market)
      const decDiff = BigInt(assessment.destMarketParams.loanDecimals) - BigInt(assessment.sourceMarketParams.loanDecimals);
      const estimatedInput = (assessment.debtAmount * 10n ** 18n * 10n ** decDiff) / loanOracleRate;
      
      const slippageBuffer = BigInt(Math.max(50, Math.ceil(assessment.slippage * 100)));
      loanExpectedInput = (estimatedInput * (10000n + slippageBuffer)) / 10000n;

      // Validate/cap borrow amount based on Target Market LLTV safety threshold
      const targetLltv = assessment.destMarketParams.lltv;
      const safeLtv = targetLltv - 5000000000000000n; // 0.5% safety margin
      const newCollateralValue = calculateCollateralValue(expectedNewCollateral, newOraclePrice);
      const maxSafeBorrowAmount = (newCollateralValue * safeLtv) / 10n ** 18n;

      if (loanExpectedInput > maxSafeBorrowAmount) {
        if (options.capBorrow) {
          console.warn(`\n⚠️  Warning: Projected borrow amount exceeds Target Market LLTV limit. Capping borrow amount at safe threshold (${(Number(safeLtv) / 1e16).toFixed(2)}% LTV) to prevent reversion. Shortfall will be funded by user wallet.`);
          loanExpectedInput = maxSafeBorrowAmount;
        } else {
          const projectedLtv = calculateLtv(loanExpectedInput, newCollateralValue);
          throw new Error(`Projected Target LTV (${projectedLtv.toFixed(2)}%) exceeds Target Market LLTV (${(Number(targetLltv) / 1e16).toFixed(2)}%). Rollover would revert on-chain. Try again with --cap-borrow flag to automatically cap target leverage.`);
        }
      }

      // Try to find a direct Curve pool for dynamic exchange
      const curvePool = await this.findCurvePoolAndIndices(
        assessment.destLoanAddress,
        assessment.sourceLoanAddress,
        loanExpectedInput
      );

      if (curvePool) {
        loanRouteData = {
          isCurveDirect: true,
          poolAddress: curvePool.poolAddress,
          i: curvePool.i,
          j: curvePool.j,
          indexType: curvePool.indexType
        };
        loanExpectedOutput = curvePool.expectedOutput;
      } else {
        // Fetch route for swapping the borrowed new loan asset back to the old loan asset
        loanRouteData = await this.routerClient.fetchSwapRoute(
          assessment.destLoanAddress,
          loanExpectedInput,
          assessment.sourceLoanAddress,
          slippageFrac,
          MORPHO_BUNDLER_V3,
          MORPHO_BUNDLER_V3
        );
        loanExpectedOutput = BigInt(loanRouteData.outputs[0].amount);
      }

      const loanQuotedRate = (loanExpectedOutput * 10n ** (18n + decDiff)) / loanExpectedInput;
      loanSlippagePct = loanOracleRate > 0n ? Number((loanOracleRate - loanQuotedRate) * 10000n / loanOracleRate) / 100 : 0.0;
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
      loanRouteData,
      loanExpectedInput,
      loanExpectedOutput,
      loanOracleRate,
      loanPriceImpact: loanSlippagePct
    };
  }

  /**
   * Phase 3: Compile calldata multicall payload and steps.
   */
  async compileCalldata(assessment, swap, options) {
    const isFull = (assessment.type === 'full');
    
    // Calculate safe borrow threshold
    const targetLltv = assessment.destMarketParams.lltv;
    const safeLtv = targetLltv - 5000000000000000n; // 0.5% safety margin
    const newCollateralValue = calculateCollateralValue(swap.expectedNewCollateral, swap.newOraclePrice);
    const maxSafeBorrowAmount = (newCollateralValue * safeLtv) / 10n ** 18n;

    // Call the shared buildRolloverBundle
    const bundleResult = buildRolloverBundle({
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
      loanExpectedOutput: swap.loanExpectedOutput,
      slippage: assessment.slippage,
      borrowShares: assessment.position.borrowShares,
      maxSafeBorrowAmount,
      capBorrow: options.capBorrow
    });

    const borrowAmount = bundleResult.borrowAmount;
    const flashLoanAmount = bundleResult.flashLoanAmount;
    const finalCalldata = bundleResult.finalCalldata;

    const newLtv = calculateLtv(borrowAmount, newCollateralValue);
    const newLeverage = calculateLeverage(newCollateralValue, borrowAmount);

    const oldLoanDec = 10 ** assessment.sourceMarketParams.loanDecimals;
    const oldCollDec = 10 ** assessment.sourceMarketParams.collateralDecimals;
    const newLoanDec = 10 ** assessment.destMarketParams.loanDecimals;
    const newCollDec = 10 ** assessment.destMarketParams.collateralDecimals;

    const steps = [];
    if (assessment.debtAmount > 0n) {
      steps.push(`Flashloan: Borrow ${Number(flashLoanAmount)/oldLoanDec} ${assessment.oldMarket.loanSymbol} from Adapter`);
      steps.push(`Repay Debt: Repay ${Number(bundleResult.repayAmount)/oldLoanDec} ${assessment.oldMarket.loanSymbol} on old market`);
    }
    steps.push(`Withdraw: Withdraw ${Number(assessment.collateralAmount)/oldCollDec} ${assessment.oldMarket.collateralSymbol} from old market`);

    if (!swap.isSameCollateral) {
      steps.push(`Approve: Approve Swap Router for ${Number(assessment.collateralAmount)/oldCollDec} ${assessment.oldMarket.collateralSymbol}`);
      steps.push(`Swap: Swap ${assessment.oldMarket.collateralSymbol} for ${Number(swap.expectedNewCollateral)/newCollDec} ${assessment.newMarket.collateralSymbol}`);
    }

    steps.push(`Supply: Supply ${assessment.newMarket.collateralSymbol} to new market`);
    
    if (assessment.debtAmount > 0n) {
      steps.push(`Borrow: Borrow ${Number(borrowAmount)/newLoanDec} ${assessment.newMarket.loanSymbol} from new market`);
    }

    if (!swap.isSameLoan) {
      if (swap.loanRouteData?.isCurveDirect) {
        steps.push(`Approve Curve Swap: Approve Curve Pool for ${Number(swap.loanExpectedInput)/newLoanDec} ${assessment.newMarket.loanSymbol}`);
        steps.push(`Swap Loan Asset: Swap ${assessment.newMarket.loanSymbol} for USDC on Curve Pool`);
      } else {
        steps.push(`Approve Loan Swap: Approve Router for ${Number(swap.loanExpectedInput)/newLoanDec} ${assessment.newMarket.loanSymbol}`);
        steps.push(`Swap Loan Asset: Swap ${assessment.newMarket.loanSymbol} for ${Number(swap.loanExpectedOutput)/oldLoanDec} ${assessment.oldMarket.loanSymbol}`);
      }
    }

    let loanFairMarketValue = 0n;
    let loanFairValueLoss = 0n;
    let loanWalletShortfall = 0n;

    if (!swap.isSameLoan) {
      const exp = 18n + BigInt(assessment.destMarketParams.loanDecimals) - BigInt(assessment.sourceMarketParams.loanDecimals);
      loanFairMarketValue = (swap.loanExpectedInput * swap.loanOracleRate) / 10n ** exp;
      loanFairValueLoss = loanFairMarketValue - swap.loanExpectedOutput;
      
      if (swap.loanRouteData?.isCurveDirect) {
        const minSwapOutput = (swap.loanExpectedOutput * BigInt(Math.floor((100 - assessment.slippage) * 100))) / 10000n;
        loanWalletShortfall = flashLoanAmount - minSwapOutput;
      } else {
        loanWalletShortfall = flashLoanAmount - swap.loanExpectedOutput;
      }
    } else {
      loanWalletShortfall = flashLoanAmount - borrowAmount;
    }

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
    const prependCalls = [];

    try {
      const loanToken = calldataResult.sourceMarketParams.loanToken;
      const loanDecimals = calldataResult.sourceMarketParams.loanDecimals;
      
      const poolWhale = await this.findUniswapV3Pool(loanToken);
      if (poolWhale) {
        prependCalls.push({
          from: poolWhale,
          to: loanToken,
          value: '0x0',
          data: encodeFunctionData({
            abi: [{
              "inputs": [
                { "name": "recipient", "type": "address" },
                { "name": "amount", "type": "uint256" }
              ],
              "name": "transfer",
              "outputs": [{ "name": "", "type": "bool" }],
              "stateMutability": "nonpayable",
              "type": "function"
            }],
            functionName: 'transfer',
            args: [ETHER_GENERAL_ADAPTER_1, 1000n * 10n ** BigInt(loanDecimals)]
          })
        });
      }

      const tokensToApprove = [
        calldataResult.sourceMarketParams.collateralToken,
        calldataResult.destMarketParams.collateralToken,
        calldataResult.sourceMarketParams.loanToken,
        calldataResult.destMarketParams.loanToken,
        '0x38eeb52f0771140d10c4e9a9a72349a329fe8a6a', // apyUSD
        '0x04F8DCa7bcCD8997ac57ca6feF7c705E17d6bcB6', // SY-5NOV
        '0xa166323f03cd0dae70487d551d3b457c3151bee4'  // SY-18JUN
      ];

      const spendersToApprove = [
        '0x888888888889758F76e7103c6CbF23ABbF58F946', // PENDLE_ROUTER
        '0x30544e00cf296b34a9ee59e5540ae2f9cccd55dd', // Reflector
        '0xc5F938A8ef5F3Bf9e72F5Aa094bAf5e03F4727d3', // Pendle Market
        ETHER_GENERAL_ADAPTER_1,
        MORPHO_BUNDLER_V3,
        MORPHO_BLUE
      ];

      for (const token of tokensToApprove) {
        for (const spender of spendersToApprove) {
          // Approve from BUNDLER
          prependCalls.push({
            from: MORPHO_BUNDLER_V3,
            to: getAddress(token),
            value: '0x0',
            data: encodeFunctionData({
              abi: [{
                "inputs": [
                  { "name": "spender", "type": "address" },
                  { "name": "amount", "type": "uint256" }
                ],
                "name": "approve",
                "outputs": [{ "name": "", "type": "bool" }],
                "stateMutability": "nonpayable",
                "type": "function"
              }],
              functionName: 'approve',
              args: [getAddress(spender), 2n ** 256n - 1n]
            })
          });
          
          // Approve from user
          prependCalls.push({
            from: calldataResult.userAddress,
            to: getAddress(token),
            value: '0x0',
            data: encodeFunctionData({
              abi: [{
                "inputs": [
                  { "name": "spender", "type": "address" },
                  { "name": "amount", "type": "uint256" }
                ],
                "name": "approve",
                "outputs": [{ "name": "", "type": "bool" }],
                "stateMutability": "nonpayable",
                "type": "function"
              }],
              functionName: 'approve',
              args: [getAddress(spender), 2n ** 256n - 1n]
            })
          });
        }
      }

      // Check user's live position and borrow debt if they have less on-chain than we want to simulate
      const livePosition = await this.blockchainClient.fetchMorphoPosition(calldataResult.sourceMarketId, calldataResult.userAddress, true);
      const liveDebt = livePosition.debt;
      if (liveDebt < calldataResult.debtAmount) {
        const borrowDiff = calldataResult.debtAmount - liveDebt;
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
            args: [calldataResult.sourceMarketParams, borrowDiff, 0n, calldataResult.userAddress, calldataResult.userAddress]
          })
        });
      }

      // Fetch target market position of user and pre-repay existing target market debt to prevent target LTV reverts
      const destLoanToken = calldataResult.destMarketParams.loanToken;
      const destLoanDecimals = calldataResult.destMarketParams.loanDecimals;
      
      const targetPosition = await this.blockchainClient.fetchMorphoPosition(calldataResult.destMarketId, calldataResult.userAddress);
      if (targetPosition.debt > 0n) {
        const targetRepayWhale = await this.findUniswapV3Pool(destLoanToken);
        if (targetRepayWhale) {
          prependCalls.push({
            from: targetRepayWhale,
            to: destLoanToken,
            value: '0x0',
            data: encodeFunctionData({
              abi: ERC20_ABI,
              functionName: 'approve',
              args: [MORPHO_BLUE, targetPosition.debt]
            })
          });

          prependCalls.push({
            from: targetRepayWhale,
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
                    { "name": "data", "type": "bytes" }
                  ],
                  "name": "repay",
                  "outputs": [
                    { "name": "assetsRepaid", "type": "uint256" },
                    { "name": "sharesRepaid", "type": "uint256" }
                  ],
                  "stateMutability": "nonpayable",
                  "type": "function"
                }
              ],
              functionName: 'repay',
              args: [calldataResult.destMarketParams, targetPosition.debt, 0n, calldataResult.userAddress, '0x']
            })
          });
        }
      }
    } catch (e) {
      // Ignore funding error and attempt simulation anyway
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
