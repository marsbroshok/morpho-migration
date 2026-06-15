export const ERC20_ABI = [{ "inputs": [{ "name": "spender", "type": "address" }, { "name": "amount", "type": "uint256" }], "name": "approve", "outputs": [{ "name": "", "type": "bool" }], "stateMutability": "nonpayable", "type": "function" }];

export const ADAPTER_ABI = [
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
  ptAddress,
  usdcAddress,
  routeData,
  userAddress,
  ETHER_GENERAL_ADAPTER_1,
  MORPHO_BUNDLER_V3
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

  // Call C: Approve the Pendle Swap Router to spend PT from Bundler3
  bundle.push({
    to: ptAddress,
    data: encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [routeData.tx.to, collateralAmount]
    }),
    value: 0n,
    skipRevert: false,
    callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
  });

  // Call D: Execute Pendle Swap (PT -> USDC) via direct Router call (sends output directly to Adapter receiver)
  bundle.push({
    to: routeData.tx.to,
    data: routeData.tx.data,
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
  ptAddress,
  usdcAddress,
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
      args: [usdcAddress, MORPHO_BUNDLER_V3, debtAmount]
    }),
    value: 0n,
    skipRevert: false,
    callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
  });

  // Call B: Approve Pendle Swap Router to spend USDC from Bundler3
  bundle.push({
    to: usdcAddress,
    data: encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [routeData.tx.to, debtAmount]
    }),
    value: 0n,
    skipRevert: false,
    callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
  });

  // Call C: Execute Pendle Swap (USDC -> PT) via direct Router call (sends output directly to Adapter receiver)
  bundle.push({
    to: routeData.tx.to,
    data: routeData.tx.data,
    value: 0n,
    skipRevert: false,
    callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
  });

  // Call D: Supply PT collateral to Morpho Blue (uses type(uint256).max to automatically supply full balance)
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
