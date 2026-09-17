# Specification: Track 3 — Anti-Specification Gaming & Test Fortification

**Track ID:** `test_anti_gaming_20260917`  
**Type:** Chore (Testing & Verification Integrity)  
**Priority:** P2 (Medium-High — Anti-Gaming & Reliability)  
**Related Audit Findings:** TEST-01, TEST-03, TEST-04, TEST-06  
**Target Invariant:** Anti-Specification Gaming & Rule 10 (Hermetic Testing & Anti-Specification Gaming Invariants)

---

## 1. Overview & Problem Statement

The test suite and runtime codebase contain practices that violate the project's Anti-Specification Gaming standards and introduce flakiness into automated verification:

1. **Production Runtime Mock Bypass (TEST-01):** `cli/blockchain-client.js:91-97` contains an active production backdoor checking `process.env.MOCK_POSITION_DEBT` and `process.env.MOCK_POSITION_COLLATERAL` to return fabricated position objects instead of querying on-chain data. Mocks must exist strictly inside test harnesses, never in production runtime classes.
2. **Unpinned Live Network Queries (TEST-03):** `tests/leverage_simulation.test.mjs` logs `Mainnet fork block number: latest` when `process.env.FORK_BLOCK_NUMBER` is not explicitly exported, executing against sliding live states. `tests/integration.test.mjs` executes an unpinned call to a public RPC, exposing CI to rate limits and external state changes.
3. **Non-Assertive Smoke Tests (TEST-04):** `tests/integration.test.mjs` performs queries against Morpho Blue contracts and exits 0 without asserting output validity.
4. **Absence of Property-Based Invariant Verification (TEST-06):** Math and sizing functions are only tested against individual static fixtures (e.g. 6-decimal USDC and 18-decimal PT), leaving untested combinations of mixed decimal tokens (8-decimal WBTC, 27-decimal Ray, 18-decimal WETH) and boundary conditions.

---

## 2. Functional Requirements

### 2.1 Purge Runtime Mock Environment Bypasses (TEST-01)
- Remove `process.env.MOCK_POSITION_DEBT` and `process.env.MOCK_POSITION_COLLATERAL` branching from `cli/blockchain-client.js`.
- Refactor test files requiring mocked position data (such as CLI dry-run unit tests) to use explicit test stubs or inject a `MockBlockchainClient` directly inside test files.

### 2.2 Enforce Hermetic Pinned Block Execution (TEST-03)
- Ensure all test entry points that instantiate Viem clients or Anvil mainnet forks (`tests/leverage_simulation.test.mjs`, `tests/integration.test.mjs`, `tests/simulation.test.mjs`, `tests/simulation_cross_loan.test.mjs`) set and enforce a pinned block (`25411200`) before client initialization.
- Respect pre-existing `process.env.FORK_BLOCK_NUMBER` values if passed from the shell.

### 2.3 Assertive Integration Verification (TEST-04)
- Add explicit assertions in `tests/integration.test.mjs` verifying contract query responses (e.g. `isAuthorized`, market parameters, and token balances) rather than only checking that commands don't throw.

### 2.4 Property-Based Invariant Verification (TEST-06)
- Add `tests/properties/math_properties.test.mjs` utilizing `fast-check` to test mathematical invariants across randomized inputs:
  1. Multi-decimal combinations ($d_{\text{loan}}, d_{\text{coll}} \in [6, 18, 24, 27]$).
  2. Post-adjustment LTV never exceeds the target LTV by more than 1 basis point.
  3. Safe borrow calculations guarantee health factor strictly $\ge 1.0$.
  4. Token conversion and scaling operations preserve conservation of value within round-down tolerances.

---

## 3. Non-Functional Requirements & Governance

1. **Zero Runtime Cheats:** No occurrences of `process.env.MOCK_*` in production application code (`src/` or `cli/`).
2. **Deterministic CI:** All tests must pass offline against local mocks or against the pinned Anvil block without live network drift.
3. **File Length Compliance:** All modified and new files must remain under 400 lines of code.

---

## 4. Acceptance Criteria

- [ ] Zero occurrences of `process.env.MOCK_POSITION_DEBT` or `process.env.MOCK_POSITION_COLLATERAL` in `cli/blockchain-client.js`.
- [ ] Pinned fork block `25411200` enforced as the default across all simulation and integration suites.
- [ ] Integration smoke tests contain strict assertion checks.
- [ ] `tests/properties/math_properties.test.mjs` runs at least 100 iterations of randomized property tests with 0 failures.
- [ ] Full test suite (`npm test --prefix tests && node tests/cli.test.mjs`) exits cleanly with code 0.

---

## 5. Out of Scope

- Fixing terminal sweeps in transaction builders (Track 1).
- Fixing DeFi math and cross-loan debt solvers (Track 2).
- Extracting shared `CrossLoanRoutingService` between CLI and UI (Track 4).
