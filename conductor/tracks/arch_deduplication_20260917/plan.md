# Implementation Plan: Track 4 — Architecture Simplification & Deduplication

**Track ID:** `arch_deduplication_20260917`  
**Track Type:** Refactor  
**Spec Reference:** [spec.md](./spec.md)  
**Methodology:** Modular Object-Oriented Architecture, TDD, and phase checkpoints per `conductor/workflow.md`.

---

## Phase 1: Shared Cross-Loan Routing Service (TDD)

- [ ] Task: Author Unit Tests for `CrossLoanRoutingService` (Red Phase)
  - [ ] Create `tests/cross_loan_routing_service.test.mjs` verifying unified pool probing, swap route fetching, and error handling.
  - [ ] Confirm tests fail before service implementation (Red Phase).
- [ ] Task: Implement `CrossLoanRoutingService` and Delegate from CLI & UI (Green Phase)
  - [ ] Create `src/core/services/cross-loan-routing-service.js` (< 400 lines).
  - [ ] Refactor `cli/rollover-routing-helper.js` to delegate route solving to `CrossLoanRoutingService`.
  - [ ] Refactor `src/ui/controllers/rollover-workflow.js` to delegate route solving to `CrossLoanRoutingService`.
  - [ ] Run test suite to verify CLI and UI rollover tests pass (Green Phase).
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

---

## Phase 2: Import Path Modernization & Facade Streamlining

- [ ] Task: Streamline Internal Import Boundaries
  - [ ] Update CLI commands and UI controllers to import core services directly from `src/core/`.
  - [ ] Ensure root files (`builders.js`, `math.js`, `labels.js`) remain minimal, clean wrappers.
  - [ ] Run `npm test --prefix tests && node tests/cli.test.mjs` to ensure zero regressions.
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

---

## Phase 3: Modernize Test Runner & Retire Shadow File Generation

- [ ] Task: Configure Module Loader / Import Map for Browser ESM in Tests
  - [ ] Implement Node.js ESM loader or alias mapping `https://esm.sh/viem` to local `viem`.
  - [ ] Update `tests/feature_parity.test.mjs` and `tests/leverage_simulation.test.mjs` to import `app.js` directly.
  - [ ] Remove regex-based `*.shadow.mjs` code generation and clean up disk artifacts.
  - [ ] Execute full automated test suite to confirm 100% pass rate.
  - [ ] Verify file length compliance (< 400 lines) across all modified modules.
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)
