# Implementation Plan: Engineering Remediation — Context Hygiene, Hermetic Testing, Modular Architecture & Governance

**Track Type:** Refactor / Chore  
**Spec Reference:** [spec.md](./spec.md)  
**Methodology:** Test-Driven Development (TDD) where applicable, modular object-oriented architecture, strict context hygiene, and phase verification checkpoints per `conductor/workflow.md`.

---

## Phase 1: Context De-Poisoning & Scratch Knowledge Distillation

- [x] Task: Distill `WORK_LOG.md` into Architecture Decision Records (ADRs) [5466501]
  - [x] Create `docs/adr/` directory with standard ADR template structure
  - [x] Author `docs/adr/0001-permit2-two-layer-allowances.md` (token allowance to Permit2 + Permit2 allowance to Morpho Bundler/Adapter)
  - [x] Author `docs/adr/0002-pendle-swap-routing-and-intermediate-wrappers.md` (base asset target routing vs intermediate SY/LP wrappers)
  - [x] Author `docs/adr/0003-iterative-scaling-for-cross-loan-debt.md` (2-step iterative swap quoter solver vs static oracle pricing)
  - [x] Author `docs/adr/0004-transient-contract-leak-detection.md` (zero-balance assertions on intermediate bundlers during simulation)
- [x] Task: Triage, Distill & Promote Scratch Files ("Triage, Distill, Promote, Evict") [4c68cbf]
  - [x] Category A (Contracts): Create `docs/contracts/reference/`, move `Bundler3.sol`, `CoreAdapter.sol`, `GeneralAdapter1.sol`, `EthereumGeneralAdapter1.sol`, and append provenance headers
  - [x] Category B (Diagnostics): Audit `check_*.js` and `calculate_*.js` against `cli/blockchain-client.js`; promote unique diagnostic tools to `scripts/diagnostics/` and retire duplicates
  - [x] Category C & D (Logs & Redundancies): Inspect `cli_debug_run_*.log`, `trace.log`, and `simulation_comparison_report.md` for PII and unrecorded revert patterns; purge raw log files and obsolete scratch items
- [x] Task: Compile Milestone `CHANGELOG.md` [bfb6a03]
  - [x] Create `CHANGELOG.md` in repository root adhering to Keep a Changelog and SemVer
  - [x] Document version `[1.0.0]` capturing Morpho Blue Rollover, Pendle Swap Integration, Leverage Adjustment, Permit2 double-layer approvals, and MEV protection across `### Added`, `### Changed`, `### Fixed`, and `### Security`
- [x] Task: Evict Ephemeral Artifacts and Update `.gitignore` [de45b89]
  - [x] Delete tracked `WORK_LOG.md`, `HISTORY_LOG.md`, `trace.log`, and remove `scratch/` directory
  - [x] Update `.gitignore` with entries for `scratch/`, `*.log`, `.DS_Store`, `user-wallet-raw-hex.json`, `.worktrees/`, `agy-worktrees/`, `.env`, and `.env.local`
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) [4a03762]

---

## Phase 2: Hermetic Test Suite & Scratch Script Purge [checkpoint: 1a63248]

- [x] Task: Purge Ad-Hoc Scratch Scripts from `tests/` [69fecd5]
  - [x] Triage ad-hoc files in `tests/`: `check_decimals.mjs`, `check_market_details.mjs`, `check_market_hash.mjs`, `check_morpho_params.mjs`, `check_token_name.mjs`, `debug_allowance.js`, `debug_allowance.mjs`, `test_borrow_balance.mjs`, `test_pendle_swap_direct.mjs`, `test_permit2_transfer.mjs`, `trace_simulation.mjs`, `simulation_payload.json`
  - [x] Extract any unique diagnostic checks or assertions into formal `tests/*.test.mjs` test suites
  - [x] Delete remaining ad-hoc scripts from `tests/`
  - [x] Verify clean test discovery in `tests/package.json`
- [x] Task: Pin Historical Fork Block for Deterministic Simulation Tests [caf6e41]
  - [x] Identify the historical block number where target wallet `0xF0A6e66B4396a70eE0620064da847821BeE70731` held an active position (live debt > 0)
  - [x] Reproduce the failure in `tests/simulation.test.mjs:356` under unpinned conditions
  - [x] Update `tests/simulation.test.mjs` and `tests/simulation_cross_loan.test.mjs` to set and use pinned `FORK_BLOCK_NUMBER` before viem client instantiation while respecting pre-defined environment variables
  - [x] Run full test suite (`npm test --prefix tests && node tests/cli.test.mjs`) to verify deterministic exit code 0
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) [1a63248]

---

## Phase 3: Modular Object-Oriented Architecture Refactoring

- [x] Task: Decompose Mathematical and Sizing Services (TDD) [01f87e3]
  - [x] Write unit tests for `LtvCalculator`, `ScalingService`, and `SlippageService` in `tests/`
  - [x] Implement `src/core/math/ltv-calculator.js` (< 400 lines) with multi-decimal scaling and health factor math
  - [x] Implement `src/core/math/scaling-service.js` (< 400 lines) with dynamic decimal resolution
  - [x] Implement `src/core/math/slippage-service.js` (< 400 lines) with native BigInt basis points calculations
  - [x] Execute tests to confirm all mathematical services pass
- [x] Task: Decompose Transaction Builders (TDD) [0574448]
  - [x] Write unit tests for decomposed transaction builders in `tests/`
  - [x] Implement `src/core/builders/approval-builder.js` (< 400 lines) handling ERC20 and Permit2 two-layer checks
  - [x] Implement `src/core/builders/rollover-bundle-builder.js` (< 400 lines) assembling flashloan + unwind + swap + supply
  - [x] Implement `src/core/builders/leverage-bundle-builder.js` (< 400 lines) assembling leverage up and deleverage calldata
  - [x] Refactor `builders.js` to delegate to `src/core/builders/` while preserving backward compatibility
  - [x] Execute tests to confirm builder tests pass
- [x] Task: Decompose Core Services: Market, Swap Quoter, and Simulation (TDD) [11f5553]
  - [x] Write unit tests for decomposed core services in `tests/`
  - [x] Implement `src/core/services/morpho-market-service.js` (< 400 lines) for market queries, params, and oracle rates
  - [x] Implement `src/core/services/swap-quoter-service.js` (< 400 lines) for Pendle and DEX quoter dynamic queries and 2-step debt solver
  - [x] Implement `src/core/services/simulation-service.js` (< 400 lines) for `eth_simulateV1`, trace decoding, and transient balance leak assertions
  - [x] Execute tests to confirm core services pass
- [x] Task: Decompose UI State and UI Components [e9a03ea]
  - [x] Implement `src/ui/state/ui-state-store.js` (< 400 lines) providing reactive state management without undeclared global state
  - [x] Implement `src/ui/components/error-banner.js` (< 400 lines) for visual HTML error boundary
  - [x] Implement `src/ui/components/market-selector.js` (< 400 lines) for market dropdowns and PT bindings
  - [x] Implement `src/ui/components/position-preview.js` (< 400 lines) for summary tables and audit metrics
  - [x] Implement `src/ui/components/wallet-modal.js` (< 400 lines) for WalletConnect modal and connection state
  - [x] Implement `src/ui/app-controller.js` (< 250 lines) coordinating UI components and core services
  - [x] Refactor `app.js` into a lightweight entrypoint (< 250 lines) exporting initialized controllers and preserving JSDOM import interfaces
- [x] Task: Synchronize CLI Commands with Core Services [af28d6a]
  - [x] Update `cli/rollover-command.js` to import and consume `src/core/` services
  - [x] Update `cli/leverage-command.js` to import and consume `src/core/` services
  - [x] Run `node tests/cli.test.mjs` and all CLI test suites to verify parity and 0 regressions
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md)

---

## Phase 4: Directives, Worktree & Governance Alignment

- [x] Task: Update Project Governance in `.agents/AGENTS.md` [a2073db]
  - [x] Add strict Memory & Context Hygiene Directives (ban on continuous work logs, conventional commits audit trail, milestone CHANGELOG, mandatory ADRs in `docs/adr/`)
  - [x] Add Isolated Worktree Standard (`.worktrees/` directory convention)
  - [x] Add Hermetic Testing Invariant (ban on unpinned live network queries in tests, property testing recommendations)
- [x] Task: Standardize Worktree Setup and Working Tree Hygiene [63c730a]
  - [x] Clean up obsolete `agy-worktrees/`
  - [x] Verify `.worktrees/` in `.gitignore`
  - [x] Validate clean working tree
- [x] Task: Execute Full Verification Suite and Pre-Commit Audit [7190ee4]
  - [x] Run complete automated test suite (`npm test --prefix tests && node tests/cli.test.mjs`)
  - [x] Run modularity check ensuring no JavaScript file exceeds 400 lines
  - [x] Verify ADRs, reference contracts, and CHANGELOG exist and conform to standards
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md)
