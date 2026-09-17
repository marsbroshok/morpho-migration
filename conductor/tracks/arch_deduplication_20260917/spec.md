# Specification: Track 4 — Architecture Simplification & Deduplication

**Track ID:** `arch_deduplication_20260917`  
**Type:** Refactor (Architecture & Code Quality)  
**Priority:** P3 (Medium — Maintainability & Parity)  
**Related Audit Findings:** ARCH-01, ARCH-02, ARCH-03  
**Target Invariant:** Rule 1 & Rule 5 (Modular Architecture & Parity between CLI and UI)

---

## 1. Overview & Problem Statement

The platform features excessive logic duplication and artificial preprocessing overhead between the CLI and Browser Web UI:

1. **Verbatim Code Duplication (ARCH-01):** Over 100 lines of complex cross-loan routing, Curve pool probing, decimal exponent scaling, LLTV validation, and swap route assembly are duplicated verbatim between `cli/rollover-routing-helper.js:40-140` and `src/ui/controllers/rollover-workflow.js:97-190`. This leads to divergent bug fixes between interfaces.
2. **Façade Layer Redundancy (ARCH-02):** Root wrapper files (`builders.js`, `math.js`, `labels.js`, `cli/simulation-engine.js`) introduce redundant layers of indirection over `src/core/`.
3. **Dynamic ESM Regex Preprocessing in JSDOM Tests (ARCH-03):** To run browser-side ESM files importing Viem via CDN (`https://esm.sh/viem`) under Node.js JSDOM, test runners modify `app.js` using regex replacement at runtime and generate ephemeral `*.shadow.mjs` files on disk, creating fragile file system artifacts.

---

## 2. Functional Requirements

### 2.1 Extract Shared Cross-Loan Routing Service (ARCH-01)
- Create `src/core/services/cross-loan-routing-service.js` (< 400 lines).
- Consolidate Curve pool probing, 2-step iterative swap solver execution, and route formatting logic into this unified service.
- Refactor `cli/rollover-routing-helper.js` and `src/ui/controllers/rollover-workflow.js` to delegate directly to `CrossLoanRoutingService`, ensuring 100% logic and bugfix parity between CLI and Web UI.

### 2.2 Streamline Internal Imports & Facade Boundaries (ARCH-02)
- Update CLI and UI internal imports to reference `src/core/` modules directly.
- Maintain root facade files (`builders.js`, `math.js`, `labels.js`) strictly as thin backwards-compatible entrypoints for external scripts.

### 2.3 Modernize Browser ESM Resolution in Test Runners (ARCH-03)
- Configure Node.js ESM import map or module loader resolution for `tests/` so that `https://esm.sh/viem` resolves seamlessly to the local `node_modules/viem` dependency without generating dynamic `.shadow.mjs` files on disk.
- Clean up test scripts to run directly against source files.

---

## 3. Non-Functional Requirements & Governance

1. **Zero UI/CLI Regressions:** Both browser interface and CLI must execute rollovers identically.
2. **Modularity Gate:** Every created and modified module must remain strictly under 400 lines of code.
3. **Clean Workspace:** No ephemeral `.shadow.mjs` files left in the repository.

---

## 4. Acceptance Criteria

- [ ] `src/core/services/cross-loan-routing-service.js` handles cross-loan routing for both CLI and UI.
- [ ] Logic duplication between `cli/rollover-routing-helper.js` and `src/ui/controllers/rollover-workflow.js` is reduced by >80%.
- [ ] JSDOM tests execute cleanly without generating `*.shadow.mjs` disk files.
- [ ] Full regression test suite (`npm test --prefix tests && node tests/cli.test.mjs`) passes with 0 errors.

---

## 5. Out of Scope

- Modifying core financial formulas (handled in Track 2).
- Adding new lending protocol adapters.
