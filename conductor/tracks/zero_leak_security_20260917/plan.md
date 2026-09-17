# Implementation Plan: Track 1 — Zero-Leak Security Patch & Circuit Breakers

**Track ID:** `zero_leak_security_20260917`  
**Track Type:** Bug  
**Spec Reference:** [spec.md](./spec.md)  
**Methodology:** Test-Driven Development (TDD), zero-leak invariant verification, and phase checkpoints per `conductor/workflow.md`.

---

## Phase 1: Transaction Builder Terminal Sweeps (TDD)

- [ ] Task: Write Failing Unit Tests for Terminal Sweeps (Red Phase)
  - [ ] Add test assertions in `tests/builders.test.mjs` and `tests/builder_services.test.mjs` asserting terminal sweep calls with `2n ** 256n - 1n` for `buildDeleveragingBundle` (collateral and loan assets).
  - [ ] Add test assertions in `tests/builders.test.mjs` and `tests/builder_services.test.mjs` asserting terminal sweep calls with `2n ** 256n - 1n` for `buildLeveragingUpBundle` (collateral and loan assets).
  - [ ] Add test assertions asserting terminal sweep calls in `buildRolloverBundle` across zero-debt and flashloan rollovers.
  - [ ] Run test suite to verify tests fail as expected (Red Phase).
- [ ] Task: Implement Terminal Sweeps in Leverage and Rollover Builders (Green Phase)
  - [ ] Update `src/core/builders/leverage-bundle-builder.js` and leverage helpers (`cli/leverage-helper.js`, `src/ui/controllers/leverage-workflow.js`) to append terminal sweeps for loan and collateral tokens using `2n ** 256n - 1n`.
  - [ ] Update `src/core/builders/rollover-bundle-builder.js` to append terminal sweeps for source collateral, destination collateral, and destination loan tokens using `2n ** 256n - 1n`.
  - [ ] Run builder unit tests to confirm all tests pass (Green Phase).
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

---

## Phase 2: Pre-Flight Simulation Circuit Breakers in CLI & UI (TDD)

- [ ] Task: Write Failing Tests for Simulation Leak Circuit Breakers (Red Phase)
  - [ ] Add test cases verifying that CLI execution aborts and throws a descriptive error when `simResult.leaks` contains residual contract balances.
  - [ ] Add test cases asserting that UI controllers block wallet submission and present an error banner when residual leaks are reported.
  - [ ] Run test suite to verify tests fail as expected (Red Phase).
- [ ] Task: Implement Hard Circuit Breakers in CLI and Web UI (Green Phase)
  - [ ] Update `cli/leverage-command.js` to pass `[loanAddress, collateralAddress]` in `tokensToCheck` and abort on residual leaks.
  - [ ] Update `cli/rollover-command.js` to inspect `simulationResult.leaks` and throw an abort error before broadcasting or presenting calldata.
  - [ ] Update Web UI controllers (`src/ui/controllers/rollover-workflow.js`, `src/ui/controllers/leverage-workflow.js`, `src/ui/components/position-preview.js`) to disable execution buttons and display a security alert when leaks are detected.
  - [ ] Run test suite to confirm circuit breaker tests pass (Green Phase).
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

---

## Phase 3: Mainnet Fork Simulation Verification & Zero-Leak Audit

- [ ] Task: Run Fork Simulation Suites and Assert Zero Token Leaks
  - [ ] Execute `tests/simulation_cross_loan.test.mjs` against pinned block `25411200` asserting `simResult.leaks.length === 0`.
  - [ ] Execute `tests/leverage_simulation.test.mjs` against pinned block `25411200` asserting `simResult.leaks.length === 0`.
  - [ ] Execute the full automated regression suite (`npm test --prefix tests && node tests/cli.test.mjs`).
  - [ ] Audit module length ensuring all modified files remain under the 400-line threshold.
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)
