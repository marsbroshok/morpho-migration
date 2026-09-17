# Specification: Track 1 — Zero-Leak Security Patch & Circuit Breakers

**Track ID:** `zero_leak_security_20260917`  
**Type:** Bug (Security Remediation)  
**Priority:** P0 (Critical — Capital Preservation)  
**Related Audit Findings:** SEC-01, SEC-02, SEC-03  
**Target Invariant:** ADR-0004 (Transient Contract Leak Detection & Zero-Balance Guarantees)

---

## 1. Overview & Problem Statement

The `MORPHO_BUNDLER_V3` and `ETHER_GENERAL_ADAPTER_1` peripheral contracts are shared, permissionless singletons. If any multicall bundle leaves positive swap slippage, excess borrowed funds, or unspent collateral on either contract, any external address or MEV bot can call `Bundler3.multicall()` in the same block to drain those funds.

Currently:
1. `LeverageBundleBuilder.buildDeleveragingBundle` and `buildLeveragingUpBundle` omit collateral sweeps and unspent loan sweeps to the position owner (`userAddress`).
2. `RolloverBundleBuilder.buildRolloverBundle` lacks collateral and destination loan sweeps in zero-debt and flashloan rollover paths.
3. Execution controllers (`cli/rollover-command.js`, `cli/leverage-command.js`, and Web UI controllers) run pre-flight simulations but do not block transaction creation or broadcast when `simResult.leaks` contains residual balances.

---

## 2. Functional Requirements

### 2.1 Transaction Builder Sweeps (SEC-01, SEC-02)
1. **Deleveraging Bundle (`src/core/builders/leverage-bundle-builder.js`):**
   - Ensure collateral withdrawn from Morpho only routes required swap inputs to the bundler, returning any unswapped collateral directly to `userAddress`.
   - Append terminal dynamic sweep calls:
     - `ETHER_GENERAL_ADAPTER_1.erc20Transfer(collateralAddress, userAddress, 2n ** 256n - 1n)`
     - `ETHER_GENERAL_ADAPTER_1.erc20Transfer(loanAddress, userAddress, 2n ** 256n - 1n)`
2. **Leveraging Up Bundle (`src/core/builders/leverage-bundle-builder.js` & helpers):**
   - Ensure the outer bundle / terminal calls sweep both loan and collateral tokens to `userAddress` using `2n ** 256n - 1n`.
3. **Rollover Bundle (`src/core/builders/rollover-bundle-builder.js`):**
   - In zero-debt rollover bundles, append terminal sweeps for `sourceCollateralAddress` and `destCollateralAddress`.
   - In flashloan rollover bundles, ensure outer bundle terminal sweeps include `sourceMarketParams.loanToken`, `destMarketParams.loanToken`, and `sourceCollateralAddress`.

### 2.2 Pre-Flight Simulation Hard Circuit Breakers (SEC-03)
1. In `cli/leverage-command.js`, pass `[loanAddress, collateralAddress]` as `tokensToCheck` to `simulationEngine.simulateTransaction`.
2. In `cli/rollover-command.js` and `cli/leverage-command.js`, inspect `simulationResult.leaks`. If `simulationResult.leaks.length > 0`, throw an explicit error (`[SECURITY ALERT] Transaction aborted: residual token leak detected ...`) to prevent broadcasting or presenting calldata.
3. In Web UI controllers (`src/ui/controllers/rollover-workflow.js`, `src/ui/controllers/leverage-workflow.js`, `src/ui/components/position-preview.js`), enforce the same hard abort: do not enable signing buttons or proceed to wallet submission if `simResult.leaks.length > 0`.

---

## 3. Non-Functional Requirements & Governance

1. **Rule Parity & File Length:** All modified files must remain strictly under 400 lines of code.
2. **Deterministic Simulation:** Tests must use the pinned block `25411200` to guarantee deterministic simulation states.
3. **No Breaking Interface Changes:** Function signatures in `src/core/builders/` must maintain backwards compatibility with existing callers.

---

## 4. Acceptance Criteria

- [ ] All builder unit tests in `tests/builders.test.mjs` and `tests/builder_services.test.mjs` assert the presence of terminal sweep calls with `2n ** 256n - 1n`.
- [ ] Simulation tests (`tests/simulation_cross_loan.test.mjs`, `tests/leverage_simulation.test.mjs`) verify that `simResult.leaks` is strictly empty (`simResult.leaks.length === 0`).
- [ ] CLI commands (`rollover`, `leverage`) fail-fast with a descriptive error when simulated transactions produce contract leaks.
- [ ] Web UI disables transaction execution and displays a security alert banner when leaks are detected.
- [ ] Full test suite (`npm test --prefix tests && node tests/cli.test.mjs`) exits cleanly with code 0.

---

## 5. Out of Scope

- Refactoring cross-loan collateral oracle math to the 2-step solver (Track 2).
- Converting IEEE-754 floats to rational BigInt in LTV calculations (Track 2).
- Removing `process.env.MOCK_POSITION_DEBT` runtime mock test cheats (Track 3).
- Architecture consolidation into `CrossLoanRoutingService` (Track 4).
