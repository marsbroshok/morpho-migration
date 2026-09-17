# Implementation Plan: Track 3 — Anti-Specification Gaming & Test Fortification

**Track ID:** `test_anti_gaming_20260917`  
**Track Type:** Chore  
**Spec Reference:** [spec.md](./spec.md)  
**Methodology:** Anti-Specification Gaming, Hermetic Testing, Property-Based Verification, and phase checkpoints per `conductor/workflow.md`.

---

## Phase 1: Purge Runtime Test Cheats & Inject Test Stubs (TDD)

- [ ] Task: Create Clean Test Stubs for Position Queries (Red Phase)
  - [ ] Identify all tests currently relying on `process.env.MOCK_POSITION_DEBT` (e.g. CLI tests).
  - [ ] Write dedicated `MockBlockchainClient` or harness stubs inside `tests/` that inject mocked positions explicitly without relying on runtime process environment checks.
  - [ ] Confirm tests fail when environment variable bypass is absent (Red Phase).
- [ ] Task: Remove Runtime Mock Cheats from Application Code (Green Phase)
  - [ ] Purge lines 91-97 from `cli/blockchain-client.js`.
  - [ ] Update CLI test harnesses to pass injected mock clients.
  - [ ] Run test suite to verify all unit and CLI tests pass cleanly without `MOCK_POSITION_*` env vars (Green Phase).
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

---

## Phase 2: Hermetic Block Pinning & Assertive Smoke Verification

- [ ] Task: Enforce Fallback Pinned Fork Block across Simulation Entrypoints
  - [ ] Update `tests/leverage_simulation.test.mjs` to default to block `25411200` before Viem client instantiation.
  - [ ] Update `tests/integration.test.mjs` to use pinned block and add explicit assertions verifying returned contract state (e.g. `assert.strictEqual(isAuthorized, true)`).
  - [ ] Verify deterministic execution without sliding live network state.
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

---

## Phase 3: Property-Based Invariant Verification with `fast-check`

- [ ] Task: Implement Randomized Invariant Testing Suite
  - [ ] Install or verify `fast-check` availability in `tests/package.json`.
  - [ ] Author `tests/properties/math_properties.test.mjs` asserting multi-decimal token conversions ($d_1, d_2 \in [6, 18, 24, 27]$).
  - [ ] Add property tests asserting post-adjustment LTV solvency bounds and safe health factors under arbitrary valid inputs.
  - [ ] Execute `node tests/properties/math_properties.test.mjs` and confirm 100% pass across >= 100 runs.
  - [ ] Audit all files for modularity (< 400 lines).
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)
