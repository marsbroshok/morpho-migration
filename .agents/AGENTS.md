# Project Rules for Morpho Migration & Leverage Adjustment

These rules apply to all development, styling, calculations, simulations, testing, and deployment of the Morpho Blue markets rollover and leverage adjustment codebase.

---

## 1. Frontend ESM Architecture & Diagnostics
- **Architectural Separation:** All JavaScript logic and configuration must reside in `app.js` (or imported sub-modules). No inline scripts are allowed in `index.html`, except for the head error hook.
- **No Inline Event Listeners:** All DOM event handlers (e.g., button clicks, tab selections, input fields) must be programmatically bound using `addEventListener()` inside the `app.js` module.
- **Relative Path Extensions:** Native browser ESM imports of local files must always include explicit file extensions (e.g. `import { ... } from './math.js'` instead of `./math`).
- **Visual HTML Error Boundary:** A global error listener block must be maintained in `<head>` of `index.html` to register `'error'` and `'unhandledrejection'` handlers, rendering errors in a prominent `#globalErrorBanner` UI element at the top of the body.

---

## 2. DeFi Mathematics, Decimal Safety & UI Scaling
- **Multi-Decimal Scaling:** All mathematical functions handling token amounts, prices, LTV, or leverage must be tested with combinations of mixed decimal tokens (e.g., 6-decimal USDC, 18-decimal WETH, 24-decimal oracles, etc.) to ensure scaling factors are applied correctly.
- **Formulas Documentation:** Any core mathematical formula implemented in code (e.g., LTV, collateral value, leverage ratio) must include a docstring or comment showing the mathematical equation and the expected scaling factors (e.g. division by $10^{36}$).
- **No Hardcoded Scaling in UI/Display:** Display preview and rate formatting logic in the frontend (`app.js` or CLI console outputs) must dynamically scale values based on the loan asset and collateral asset decimals retrieved from the Morpho API, rather than assuming USDC/18-decimal defaults (e.g., avoid hardcoding `10n ** 6n` or `/ 1e6`).
- **Immediate BigInt Slippage Parsing:** User slippage inputs must be parsed directly into BigInt basis points (bps) immediately at CLI/UI boundaries. Keep all downstream math, sizing, and threshold logic natively in BigInt to avoid float-to-BigInt precision drift.

---

## 3. Dynamic Asset Resolution & Exchange Rate Estimation
- **No Hardcoded Asset Addresses or Wrapper Tokens:** Do not hardcode specific token contract addresses, market IDs, or intermediate token wrapper assets (e.g., Pendle's `SY` wrappers or specific AMM pool addresses) in production calculations or routing functions. All parameters must be resolved dynamically from the Morpho GraphQL API, user inputs, or swap route parameters.
- **Minimal/Base Asset Routing:** Swap queries and operations must target the base underlying assets (e.g. `apyUSD` or `USDC`), allowing the swap router client or external API (e.g., Pendle Convert API) to resolve intermediate wrapper tokens (like `SY` tokens or LP tokens) under the hood rather than manually hardcoding wrappers in the transaction builder.
- **Dynamic Swap Quotes:** Never estimate swap rates, exchange rates, or input amounts for cross-asset swaps based on collateral oracle prices or static assumptions. Always utilize official router clients or quoter APIs (e.g., Uniswap Quoter, Pendle Convert API) to fetch actual execution quotes.
- **Iterative Scaling for Swap Inputs:** When estimating exact input amounts needed to yield a target output amount under slippage:
  1. Fetch a nominal swap quote using a 1:1 guess (scaled by decimals).
  2. Use the returned rate to calculate the exact required input amount.
  3. Re-query the swap router with the solved input amount to obtain the final route.
- **MEV Routing Dynamic Fallbacks:** Default execution RPCs to private MEV-blocker endpoints (e.g., MEV-Blocker) for Mainnet transactions, but verify `CHAIN_ID` first. Fall back to standard configured providers for other chain IDs to support L2 and testnet testing.

---

## 4. DeFi Approvals & Signer Validations
- **Permit2 Two-Layer Approvals:** When dealing with protocols/tokens that utilize Permit2 (such as Morpho Bundlers or dynamic adapters), token checks must perform a double-layered check:
  1. Check token allowance of the Permit2 contract.
  2. Check Permit2's internal allowance of the target spender contract.
  Prompt and execute approvals for both layers if they fall short of the required transfer amount.
- **Signer Context Matching:** Any execution script or controller must validate that the connected/signing wallet address matches the target position owner address (`--user`). If they differ, abort execution early or log warning messages, and decode the compiled calldata to ensure that `onBehalfOf` arguments match the signer's address.

---

## 5. Simulation & Transaction Calldata
- **Dynamic Spender Resolution:** To prevent simulation reverts due to allowance limits, extract active spenders and tokens dynamically from the generated swap routes (`routeData.tx.to`, `limitRouter`, etc.) rather than relying on statically hardcoded lists.
- **CLI & UI Parity:** Ensure that mathematical estimation, route fetching, and calldata generation logic remain perfectly synchronized between CLI modules (e.g., `cli/rollover-command.js`) and UI controllers (e.g., `app.js`).

---

## 6. Integration Testing & Mock Integrity
- **Mock Authenticity:** Mocked oracle prices and contract returns in tests must always align with actual on-chain parameters and scaling factors. Do not change mock data directions (e.g., inverting price values) to fit incorrect code math; fix the code math instead.
- **Assertive Assertions:** Tests must not merely verify that execution doesn't throw. They must assert that calculated values (e.g., LTV, borrow amounts, swap shortfalls, margins) match expected analytical values within acceptable rounding tolerances.
- **Import Simplicity for Shadow Tests:** Browser-side imports inside `app.js` must be kept as simple, single-line imports (`import { ... } from '...';`) to ensure regex-based Node.js shadow testing compatibility is preserved.
- **ESM Cache Isolation:** Tests utilizing dynamically generated shadow files must be run in isolated child processes to avoid stale module states resulting from Node.js ESM import caching.
- **Mainnet Fork Block Pinning:** All mainnet fork simulation tests must run against a pinned block number to prevent flakiness due to sliding live states, accrued interest, or market fluctuations.
- **Block Pinning Sequence:** Set the `process.env.FORK_BLOCK_NUMBER` environment variable *before* instantiating any viem or custom blockchain client that relies on it. Respect and preserve pre-defined environment values without overwriting them.
- **Mainnet Fork Test Resilience:** If a fork simulation test relies on a live mainnet position, the test setup must dynamically check the position state and, if needed, programmatically modify the state (e.g., prepending debt repayments or collateral deposits) before executing the simulation, preventing LLTV or margin-based flakiness.

---

## 7. Fork Simulation State Integrity & Leak Detection
- **Zero-Funding Intermediate Contracts**: During mainnet-fork simulations (in both integration tests and CLI dry-runs), state-altering cheat codes (such as `anvil_setBalance` or whale transfers) must only be applied to the target end-user address to simulate wallet depth. Do not pre-fund intermediate contracts, adapters, or bundlers. They must start the transaction cycle with exactly a 0 balance to ensure routing, parameter alignment, and balance checks are accurately validated.
- **Transient Contract Leak Detection**: Simulation assertions should verify that all transient intermediate contracts are swept clean (0 balance) of all transaction tokens (collateral and loan assets) upon successful completion. Any residual balance must be reported as a routing leak.

