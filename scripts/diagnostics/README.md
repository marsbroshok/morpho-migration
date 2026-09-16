# Diagnostic Scripts

Structured diagnostic and debugging utilities for on-chain Morpho Blue investigation and calldata analysis.

## Available Utilities

### 1. `calculate-selectors.mjs`
Outputs 4-byte function and error selectors for Morpho Blue Core, Bundler V3, and General Adapter errors. Use when decoding hex error signatures from failed transactions or simulation traces.
```bash
node scripts/diagnostics/calculate-selectors.mjs
```

### 2. `calculate-market-id.mjs`
Computes the canonical `bytes32` Morpho Blue market ID using `keccak256(abi.encode(MarketParams))` from loan token, collateral token, oracle, IRM, and LLTV parameters.
```bash
node scripts/diagnostics/calculate-market-id.mjs <loanToken> <collateralToken> <oracle> <irm> <lltv>
```

### 3. `inspect-market-liquidity.mjs`
Directly queries the Morpho Blue contract for market state, computing available borrow liquidity (`totalSupplyAssets - totalBorrowAssets`) and utilization percentage.
```bash
node scripts/diagnostics/inspect-market-liquidity.mjs <marketId> [rpcUrl]
```
