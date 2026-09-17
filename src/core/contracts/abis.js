/**
 * @fileoverview Contract ABIs for Morpho Blue, Bundler, Adapter, and ERC20 tokens.
 */

export const ERC20_ABI = [
  { "inputs": [{ "name": "spender", "type": "address" }, { "name": "amount", "type": "uint256" }], "name": "approve", "outputs": [{ "name": "", "type": "bool" }], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "name": "recipient", "type": "address" }, { "name": "amount", "type": "uint256" }], "name": "transfer", "outputs": [{ "name": "", "type": "bool" }], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "name": "account", "type": "address" }], "name": "balanceOf", "outputs": [{ "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" }
];

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

export const PERMIT2_ABI = [
  {
    "inputs": [
      { "name": "token", "type": "address" },
      { "name": "spender", "type": "address" },
      { "name": "amount", "type": "uint160" },
      { "name": "expiration", "type": "uint48" }
    ],
    "name": "approve",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];

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
  },
  {
    "inputs": [
      { "name": "token", "type": "address" },
      { "name": "receiver", "type": "address" },
      { "name": "amount", "type": "uint256" }
    ],
    "name": "permit2TransferFrom",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];
