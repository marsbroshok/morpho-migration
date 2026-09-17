# Implementation Plan: Track 2 — DeFi Math & ADR-0003 Realignment

**Track ID:** `defi_math_realignment_20260917`  
**Track Type:** Bug  
**Spec Reference:** [spec.md](./spec.md)  
**Methodology:** Test-Driven Development (TDD), BigInt decimal safety, and phase checkpoints per `conductor/workflow.md`.

---

## Phase 1: Rational BigInt Leverage Calculations & Dynamic LLTV (TDD) [checkpoint: 6304ed4]

- [x] Task: Write Failing Tests for Pure BigInt Leverage Math and Dynamic LLTV Bounds (Red Phase) 0f38cab
  - [x] Update `tests/leverage_adjust.test.mjs` with exact analytical expected values for 3.0x leverage target (3200 PT, 3040 USDC) and assert no IEEE-754 float drift.
  - [x] Add unit tests for dynamic maximum leverage calculation across different LLTV tiers (77.0%, 86.0%, 94.5%, 96.5%).
  - [x] Run test suite to verify tests fail as expected (Red Phase).
- [x] Task: Implement Rational BigInt Sizing and Dynamic LLTV in `LtvCalculator` (Green Phase) 6304ed4
  - [x] Refactor `src/core/math/ltv-calculator.js` to compute target LTV purely in BigInt rational math without IEEE-754 conversions.
  - [x] Implement `calculateMaxSafeLeverage(lltv, bufferBps)` and enforce dynamic ceilings instead of fixed 6.0x limit.
  - [x] Run test suite to confirm leverage adjust tests pass (Green Phase).
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) 6304ed4

---

## Phase 2: Slippage Unit Standardization & SlippageService Delegation (TDD)

- [ ] Task: Write Failing Tests for Slippage Tolerance in Builders (Red Phase)
  - [ ] Add unit tests asserting that default 0.5% (50 bps) slippage translates to 9950 multiplier (not 9999) in `RolloverBundleBuilder`.
  - [ ] Add tests verifying builder calls with explicit `slippageBps`.
  - [ ] Run test suite to verify tests fail as expected (Red Phase).
- [ ] Task: Standardize Slippage to `slippageBps` in Builders (Green Phase)
  - [ ] Refactor `src/core/builders/rollover-bundle-builder.js` line 269 to delegate minimum output calculation to `SlippageService.applySlippageTolerance`.
  - [ ] Standardize slippage parameters to `slippageBps` across builder function signatures with backwards compatibility.
  - [ ] Run builder unit tests to confirm tests pass (Green Phase).
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

---

## Phase 3: ADR-0003 Two-Step Iterative Swap Solver Enforcement (TDD)

- [ ] Task: Write Failing Tests for Cross-Loan Debt Quoting (Red Phase)
  - [ ] Add unit tests in `tests/` asserting that cross-loan debt solver uses the 2-step iterative swap quoter even when collateral oracle prices are readable.
  - [ ] Add tests verifying `ScalingService.parseUnits` string parsing in CLI rollover command.
  - [ ] Run test suite to verify tests fail as expected (Red Phase).
- [ ] Task: Remove Oracle Ratio Shortcut and Enforce 2-Step Iterative Quoter (Green Phase)
  - [ ] Purge collateral oracle price ratio shortcut from `cli/rollover-routing-helper.js:47-52`.
  - [ ] Purge collateral oracle price ratio shortcut from `src/ui/controllers/rollover-workflow.js:102-107`.
  - [ ] Update `cli/rollover-command.js` to parse debt string using `ScalingService.parseUnits`.
  - [ ] Run cross-loan tests and CLI test suites to confirm green status (Green Phase).
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)
