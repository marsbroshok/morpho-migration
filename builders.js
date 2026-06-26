export const ERC20_ABI = [{ "inputs": [{ "name": "spender", "type": "address" }, { "name": "amount", "type": "uint256" }], "name": "approve", "outputs": [{ "name": "", "type": "bool" }], "stateMutability": "nonpayable", "type": "function" }];

export const BUNDLER_ABI = [
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

function getSpendersToApprove(routeData) {
  if (!routeData) return [];
  const spenders = [routeData.tx.to];
  try {
    const params = routeData.contractParamInfo?.contractCallParams;
    if (params && Array.isArray(params)) {
      for (const param of params) {
        if (Array.isArray(param)) {
          for (const swap of param) {
            if (swap.swapData?.extRouter) {
              spenders.push(swap.swapData.extRouter);
            }
          }
        }
      }
    }
  } catch (e) {
    // Ignore parsing errors
  }
  return spenders;
}

export const ADAPTER_ABI = [
  {
    "inputs": [
      { "name": "token", "type": "address" },
      { "name": "assets", "type": "uint256" },
      { "name": "data", "type": "bytes" }
    ],
    "name": "morphoFlashLoan",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
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
      { "name": "maxSharePriceE27", "type": "uint256" },
      { "name": "onBehalf", "type": "address" },
      { "name": "data", "type": "bytes" }
    ],
    "name": "morphoRepay",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
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
      { "name": "receiver", "type": "address" }
    ],
    "name": "morphoWithdrawCollateral",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
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
      { "name": "onBehalf", "type": "address" },
      { "name": "data", "type": "bytes" }
    ],
    "name": "morphoSupplyCollateral",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
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
      { "name": "minSharePriceE27", "type": "uint256" },
      { "name": "receiver", "type": "address" }
    ],
    "name": "morphoBorrow",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "name": "token", "type": "address" },
      { "name": "receiver", "type": "address" },
      { "name": "amount", "type": "uint256" }
    ],
    "name": "erc20Transfer",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];

export function buildDeleveragingBundle({
  encodeFunctionData,
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
  const repayAmount = is1x ? 0n : debtAmount;
  const repayShares = is1x ? 2n ** 256n - 1n : 0n;

  const bundle = [];

  // Call A: Repay the Morpho Blue debt
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

  // Call B: Withdraw collateral PT from Morpho (withdrawing to Bundler3 so Bundler3 can approve and swap)
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

  // Call C: Approve the Swap Router and aggregators to spend collateral from Bundler3
  const spenders = getSpendersToApprove(routeData);
  for (const spender of spenders) {
    bundle.push({
      to: collateralAddress,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [spender, 2n ** 256n - 1n]
      }),
      value: 0n,
      skipRevert: false,
      callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
    });
  }

  // Call D: Execute Swap (collateral -> loan) via direct Router call
  bundle.push({
    to: routeData.tx.to,
    data: routeData.tx.data,
    value: 0n,
    skipRevert: false,
    callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
  });

  // Call E: Transfer swapped USDC from Bundler to Adapter
  bundle.push({
    to: loanAddress,
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
      args: [ETHER_GENERAL_ADAPTER_1, flashLoanAmount]
    }),
    value: 0n,
    skipRevert: false,
    callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
  });

  return bundle;
}

export function buildLeveragingUpBundle({
  encodeFunctionData,
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
  const bundle = [];

  // Call A: Transfer USDC from Adapter to Bundler3
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

  // Call B: Approve Swap Router and aggregators to spend loan tokens from Bundler3
  const spenders = getSpendersToApprove(routeData);
  for (const spender of spenders) {
    bundle.push({
      to: loanAddress,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [spender, 2n ** 256n - 1n]
      }),
      value: 0n,
      skipRevert: false,
      callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
    });
  }

  // Call C: Execute Swap (loan -> collateral) via direct Router call
  bundle.push({
    to: routeData.tx.to,
    data: routeData.tx.data,
    value: 0n,
    skipRevert: false,
    callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
  });

  // Call D: Supply collateral to Morpho Blue (uses type(uint256).max to automatically supply full balance)
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

  // Call E: Borrow USDC from Morpho back to the Adapter to repay the flashloan
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

export async function findCurvePoolAndIndices(publicClient, fromToken, toToken, amount, getAddress) {
  const ADDRESS_PROVIDER = '0x0000000022D53366457F9d5E68Ec105046FC4383';
  const fromAddr = getAddress(fromToken);
  const toAddr = getAddress(toToken);
  
  try {
    const metaRegistryAddress = await publicClient.readContract({
      address: ADDRESS_PROVIDER,
      abi: [{
        "inputs": [{ "name": "id", "type": "uint256" }],
        "name": "get_address",
        "outputs": [{ "name": "", "type": "address" }],
        "stateMutability": "view",
        "type": "function"
      }],
      functionName: 'get_address',
      args: [7n]
    });

    let index = 0n;
    while (index < 10n) {
      const poolAddress = await publicClient.readContract({
        address: metaRegistryAddress,
        abi: [{
          "inputs": [
            { "name": "_from", "type": "address" },
            { "name": "_to", "type": "address" },
            { "name": "i", "type": "uint256" }
          ],
          "name": "find_pool_for_coins",
          "outputs": [{ "name": "", "type": "address" }],
          "stateMutability": "view",
          "type": "function"
        }],
        functionName: 'find_pool_for_coins',
        args: [fromAddr, toAddr, index]
      });

      if (poolAddress === '0x0000000000000000000000000000000000000000') {
        break;
      }

      index++;

      // Find token indices in the pool
      let i = -1;
      let j = -1;
      for (let k = 0n; k < 8n; k++) {
        try {
          const coin = await publicClient.readContract({
            address: poolAddress,
            abi: [{
              "inputs": [{ "name": "i", "type": "uint256" }],
              "name": "coins",
              "outputs": [{ "name": "", "type": "address" }],
              "stateMutability": "view",
              "type": "function"
            }],
            functionName: 'coins',
            args: [k]
          });
          if (getAddress(coin) === fromAddr) i = Number(k);
          if (getAddress(coin) === toAddr) j = Number(k);
        } catch (e) {
          break;
        }
      }

      if (i === -1 || j === -1) {
        continue;
      }

      // Try int128 type for get_dy
      try {
        const dy = await publicClient.readContract({
          address: poolAddress,
          abi: [{
            "inputs": [
              { "name": "i", "type": "int128" },
              { "name": "j", "type": "int128" },
              { "name": "dx", "type": "uint256" }
            ],
            "name": "get_dy",
            "outputs": [{ "name": "", "type": "uint256" }],
            "stateMutability": "view",
            "type": "function"
          }],
          functionName: 'get_dy',
          args: [i, j, amount]
        });
        if (dy > 0n) {
          return {
            poolAddress,
            i,
            j,
            indexType: 'int128',
            expectedOutput: dy
          };
        }
      } catch (e) {}

      // Try uint256 type for get_dy
      try {
        const dy = await publicClient.readContract({
          address: poolAddress,
          abi: [{
            "inputs": [
              { "name": "i", "type": "uint256" },
              { "name": "j", "type": "uint256" },
              { "name": "dx", "type": "uint256" }
            ],
            "name": "get_dy",
            "outputs": [{ "name": "", "type": "uint256" }],
            "stateMutability": "view",
            "type": "function"
          }],
          functionName: 'get_dy',
          args: [i, j, amount]
        });
        if (dy > 0n) {
          return {
            poolAddress,
            i,
            j,
            indexType: 'uint256',
            expectedOutput: dy
          };
        }
      } catch (e) {}
    }
  } catch (e) {
    // Registry or Pool not found/supported, fallback
  }

  return null;
}

export async function findUniswapV3Pool(publicClient, tokenAddress, getAddress) {
  const UNISWAP_V3_FACTORY = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
  const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
  const tokenAddr = getAddress(tokenAddress);
  
  if (tokenAddr === getAddress(WETH)) {
    return '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640'; 
  }

  const fees = [3000, 500, 10000];
  for (const fee of fees) {
    try {
      const pool = await publicClient.readContract({
        address: UNISWAP_V3_FACTORY,
        abi: [{
          "inputs": [
            { "name": "tokenA", "type": "address" },
            { "name": "tokenB", "type": "address" },
            { "name": "fee", "type": "uint24" }
          ],
          "name": "getPool",
          "outputs": [{ "name": "", "type": "address" }],
          "stateMutability": "view",
          "type": "function"
        }],
        functionName: 'getPool',
        args: [tokenAddr, WETH, fee]
      });
      if (pool && pool !== '0x0000000000000000000000000000000000000000') {
        return pool;
      }
    } catch (e) {}
  }
  return null;
}

export function buildRolloverBundle({
  encodeFunctionData,
  encodeAbiParameters,
  keccak256,
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
  isSameCollateral,
  isSameLoan,
  loanRouteData,
  loanExpectedInput,
  loanExpectedOutput,
  slippage,
  borrowShares,
  maxSafeBorrowAmount,
  capBorrow
}) {
  if (debtAmount === 0n) {
    const bundle = [];
    
    // Call 1: Withdraw collateral
    bundle.push({
      to: ETHER_GENERAL_ADAPTER_1,
      data: encodeFunctionData({
        abi: ADAPTER_ABI,
        functionName: 'morphoWithdrawCollateral',
        args: [sourceMarketParams, collateralAmount, isSameCollateral ? ETHER_GENERAL_ADAPTER_1 : MORPHO_BUNDLER_V3]
      }),
      value: 0n,
      skipRevert: false,
      callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
    });

    // Call 2 & 3: Swap if needed
    if (!isSameCollateral) {
      const spenders = getSpendersToApprove(routeData);
      for (const spender of spenders) {
        bundle.push({
          to: sourceCollateralAddress,
          data: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [spender, 2n ** 256n - 1n]
          }),
          value: 0n,
          skipRevert: false,
          callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
        });
      }

      bundle.push({
        to: routeData.tx.to,
        data: routeData.tx.data,
        value: 0n,
        skipRevert: false,
        callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
      });
    }

    // Call 4: Supply collateral
    bundle.push({
      to: ETHER_GENERAL_ADAPTER_1,
      data: encodeFunctionData({
        abi: ADAPTER_ABI,
        functionName: 'morphoSupplyCollateral',
        args: [destMarketParams, 2n ** 256n - 1n, userAddress, '0x']
      }),
      value: 0n,
      skipRevert: false,
      callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
    });

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
  reenterBundle.push({
    to: ETHER_GENERAL_ADAPTER_1,
    data: encodeFunctionData({
      abi: ADAPTER_ABI,
      functionName: 'morphoRepay',
      args: [sourceMarketParams, repayAmount, repayShares, 2n ** 256n - 1n, userAddress, '0x']
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
      args: [sourceMarketParams, collateralAmount, isSameCollateral ? ETHER_GENERAL_ADAPTER_1 : MORPHO_BUNDLER_V3]
    }),
    value: 0n,
    skipRevert: false,
    callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
  });

  // Call C & Call D: Only if collateral tokens are different
  if (!isSameCollateral) {
    const spenders = getSpendersToApprove(routeData);
    for (const spender of spenders) {
      reenterBundle.push({
        to: sourceCollateralAddress,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [spender, 2n ** 256n - 1n]
        }),
        value: 0n,
        skipRevert: false,
        callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
      });
    }

    reenterBundle.push({
      to: routeData.tx.to,
      data: routeData.tx.data,
      value: 0n,
      skipRevert: false,
      callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
    });
  }

  // Call E: Supply collateral
  reenterBundle.push({
    to: ETHER_GENERAL_ADAPTER_1,
    data: encodeFunctionData({
      abi: ADAPTER_ABI,
      functionName: 'morphoSupplyCollateral',
      args: [destMarketParams, supplyAmount, userAddress, '0x']
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
      args: [
        destMarketParams,
        borrowAmount,
        0n,
        0n,
        isSameLoan ? ETHER_GENERAL_ADAPTER_1 : MORPHO_BUNDLER_V3
      ]
    }),
    value: 0n,
    skipRevert: false,
    callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
  });

  // Call G & H: Only if loan assets are different
  if (!isSameLoan) {
    if (loanRouteData?.isCurveDirect) {
      const CurvePool = loanRouteData.poolAddress;
      
      // 1. Approve Curve Pool to spend the borrowed loan token from BUNDLER3
      reenterBundle.push({
        to: destMarketParams.loanToken,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [CurvePool, 2n ** 256n - 1n]
        }),
        value: 0n,
        skipRevert: false,
        callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
      });

      // 2. Call exchange on Curve Pool
      const CURVE_POOL_ABI = [
        {
          "inputs": [
            { "name": "i", "type": loanRouteData.indexType },
            { "name": "j", "type": loanRouteData.indexType },
            { "name": "dx", "type": "uint256" },
            { "name": "min_dy", "type": "uint256" }
          ],
          "name": "exchange",
          "outputs": [{ "name": "", "type": "uint256" }],
          "stateMutability": "nonpayable",
          "type": "function"
        }
      ];
      
      const minSwapOutput = (loanExpectedOutput * BigInt(Math.floor((100 - slippage) * 100))) / 10000n;

      reenterBundle.push({
        to: CurvePool,
        data: encodeFunctionData({
          abi: CURVE_POOL_ABI,
          functionName: 'exchange',
          args: [loanRouteData.i, loanRouteData.j, loanExpectedInput, minSwapOutput]
        }),
        value: 0n,
        skipRevert: false,
        callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
      });

      // 3. Transfer swapped old loan token from BUNDLER3 to Adapter
      reenterBundle.push({
        to: sourceMarketParams.loanToken,
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
          args: [ETHER_GENERAL_ADAPTER_1, minSwapOutput]
        }),
        value: 0n,
        skipRevert: false,
        callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
      });
    } else {
      const spenders = getSpendersToApprove(loanRouteData);
      for (const spender of spenders) {
        reenterBundle.push({
          to: destMarketParams.loanToken,
          data: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [spender, 2n ** 256n - 1n]
          }),
          value: 0n,
          skipRevert: false,
          callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
        });
      }

      reenterBundle.push({
        to: loanRouteData.tx.to,
        data: loanRouteData.tx.data,
        value: 0n,
        skipRevert: false,
        callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
      });

      reenterBundle.push({
        to: sourceMarketParams.loanToken,
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
          args: [ETHER_GENERAL_ADAPTER_1, loanExpectedOutput]
        }),
        value: 0n,
        skipRevert: false,
        callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
      });
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
    {
      to: ETHER_GENERAL_ADAPTER_1,
      data: encodeFunctionData({
        abi: ADAPTER_ABI,
        functionName: 'morphoFlashLoan',
        args: [sourceMarketParams.loanToken, flashLoanAmount, encodedReenterBundle]
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
        args: [sourceMarketParams.loanToken, userAddress, 2n ** 256n - 1n]
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
    outerBundle,
    reenterBundle,
    flashLoanAmount,
    repayAmount,
    repayShares,
    borrowAmount,
    finalCalldata
  };
}

