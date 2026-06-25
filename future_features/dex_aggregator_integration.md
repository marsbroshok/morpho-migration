# [IGNORE] Swap Provider Abstraction & DEX Aggregator Integration

> [!IMPORTANT]
> **AI Agent Notice**: Ignore this document and its contents for the moment. Do not implement this feature or modify the codebase based on it.

---

This document outlines the architecture and implementation steps to generalize the position rollover and leverage adjustment flows, enabling the application to support any arbitrary Morpho Blue market (not just Pendle PTs) sharing a common loan/borrowing token.

---

## 1. Goal Description

Currently, the application is limited to rolling over Pendle Principal Tokens (PT) collateral on Morpho Blue. This limitation exists because:
1. The swap routing logic is tightly coupled to the Pendle Convert API (`fetchPendleRoute`).
2. Token decimals are hardcoded to `1e18` for collateral and `1e6` for debt/USDC.
3. Oracle price scaling is hardcoded to `1e24` (assuming USDC debt and PT collateral).

The goal of this feature is to introduce a **Swap Provider Abstraction layer** and **dynamic decimal scaling** so that a user can roll over between *any* two Morpho Blue markets sharing the same loan token using Uniswap, 1inch, OpenOcean, or custom user-provided transaction calldata.

---

## 2. Key Concepts & Research

### On-Chain Swap Execution
In the Morpho Bundler V3 multicall sequence, the swap step is entirely generic. The Bundler contract executes:
```javascript
// Approve target router to spend old collateral from Bundler
{
  to: oldCollateralAddress,
  data: encodeApprove(routerAddress, collateralAmount)
}
// Execute the swap payload directly
{
  to: routerAddress,
  data: swapCalldata
}
```
The Bundler does not require the swap to use Pendle. Any smart contract call that takes the old collateral token from the Bundler and deposits the new collateral token into `ETHER_GENERAL_ADAPTER_1` will successfully execute.

### Swap Routing Options
To support arbitrary token pairs (e.g. wstETH -> rETH, sDAI -> USDe, or WBTC -> WETH):
1. **DEX Aggregator APIs**: Query APIs like 1inch, OpenOcean, or ParaSwap for optimal swap routes and transaction calldata.
2. **Custom Calldata Input**: Provide an advanced UI field allowing users to copy-paste custom swap execution calldata and a destination router address (e.g., from Uniswap UI or another aggregator).

### Dynamic Decimals and Oracle Scaling
Morpho Blue oracles return the price of 1 collateral token unit denominated in loan tokens, scaled by:
$$\text{Scale} = 10^{36 + \text{decimals}_{\text{loan}} - \text{decimals}_{\text{collateral}}}$$

To calculate correct LTV, Leverage, and Price Impact, the app must dynamically query:
- `decimals()` for the collateral token
- `decimals()` for the loan token
Using these values, we can dynamically scale inputs, outputs, and fair values.

---

## 3. Implementation Plan

### Step 1: Upgrade Market Parameter and Token Metadata Queries
Modify `fetchMarketParams` to also retrieve the decimals of both the loan asset and the collateral asset. We can do this either on-chain or via the Morpho Blue GraphQL API:
```graphql
query GetMarket($id: String!) {
  markets(where: { uniqueKey_in: [$id] }) {
    items {
      loanAsset { address symbol decimals }
      collateralAsset { address symbol decimals }
      oracleAddress
      irmAddress
      lltv
    }
  }
}
```

### Step 2: Implement Swap Routing Abstraction
Abstract the routing logic into a generic router helper:
```javascript
async function fetchSwapRoute(provider, inputToken, inputAmount, outputToken, slippage, customConfig = {}) {
  if (provider === 'pendle') {
    return fetchPendleRoute(inputToken, inputAmount, outputToken, slippage);
  } else if (provider === '1inch') {
    return fetch1inchRoute(inputToken, inputAmount, outputToken, slippage);
  } else if (provider === 'custom') {
    return {
      tx: {
        to: customConfig.routerAddress,
        data: customConfig.calldata
      },
      outputs: [{ amount: customConfig.expectedOutput }]
    };
  }
  throw new Error("Unsupported swap provider");
}
```

### Step 3: Refactor app.js Arithmetic for Dynamic Decimals
Replace all instances of hardcoded `1e6` and `1e18` with dynamic scaling constants based on the retrieved token decimals:
```javascript
const collateralDecimals = marketParams.collateralDecimals;
const loanDecimals = marketParams.loanDecimals;

const collateralAmountBig = BigInt(Math.floor(parseFloat(collateralInputVal) * (10 ** collateralDecimals)));
const debtAmountBig = BigInt(Math.floor(parseFloat(debtInputVal) * (10 ** loanDecimals)));
```

### Step 4: Refactor Oracle Calculations
Compute the oracle price scaling dynamically:
```javascript
const scalingDecimals = 36n + BigInt(loanDecimals) - BigInt(collateralDecimals);
const oraclePriceScaled = Number(oraclePrice) / (10 ** Number(scalingDecimals));
```

### Step 5: Update the UI
1. Add a dropdown/selector for the Swap Provider: `Pendle API`, `1inch API`, or `Custom Transaction Calldata`.
2. Add input fields for `Router Address`, `Calldata`, and `Expected Output` when `Custom` is selected.
3. Replace hardcoded `"PT"` and `"USDC"` text labels in form groups, badges, and previews with dynamic values fetched from the active markets.

---

## 4. Verification Plan

### Automated Verification
Update the integration test suite in `tests/` to:
1. Mock a non-18 decimal collateral asset (e.g., WBTC with 8 decimals) and a non-6 decimal loan asset (e.g., DAI with 18 decimals).
2. Validate that the builder functions correctly scale collateral and debt amounts according to the mock token decimals.
3. Validate that price impact and LTV math match expected values under diverse decimal configurations.
