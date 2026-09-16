# ADR 0004: Transient Contract Zero-Balance Assertions and Leak Detection in Fork Simulations

- **Status:** Accepted
- **Date:** 2026-06-27
- **Deciders:** Morpho Migration Engineering Team

---

## Context

Morpho Blue rollover and leverage operations involve atomic multicalls through intermediate contracts:
- **Morpho Bundler V3:** (`MORPHO_BUNDLER_V3`) orchestrates flashloans, re-entrancy callbacks, supply, and borrow actions.
- **Morpho General Adapter:** (`GENERAL_ADAPTER_1`) interacts with Permit2, executes token transfers, and handles slippage reconciliation.
- **Swap Routers / Adapters:** execute token swaps.

### The Risk of Masked Routing Defects via Pre-Funding
During early mainnet fork testing and CLI simulation debugging, test scripts frequently used test-node cheat codes (such as `deal` or transferring whale funds) directly into intermediate bundler and adapter contracts.

This created a severe testing anti-pattern:
- Pre-funding intermediate contracts hid critical transaction assembly defects where the bundle failed to return swap proceeds to the correct recipient.
- The transaction appeared to succeed in simulation because the intermediate contract already had a balance to repay the flashloan or finalize transfers, but would have failed catastrophically with real user funds on mainnet.

### The Risk of Residual Token Leaks
Furthermore, if a swap returns a surplus or routing logic miscalculates transfer amounts, dust or substantial token balances could be stranded inside the Bundler or General Adapter contracts, becoming vulnerable to MEV bot sweeping.

---

## Decision

We established two immutable simulation invariants:

1. **Zero-Funding Rule for Intermediate Contracts:**
   - State-altering cheat codes (e.g. setting token balances or whale transfers) may **only** be applied to the end-user wallet address (`--user`).
   - Intermediate contracts, adapters, and bundlers must begin execution with exactly zero balance for all transaction tokens.
   - Intermediate contracts must never be pre-funded under any circumstances during integration tests or CLI dry-runs.

2. **Automated Post-Simulation Leak Detection:**
   - The simulation engine (`cli/simulation-engine.js` / `src/core/services/simulation-service.js`) appends read-only `IERC20.balanceOf()` calls for both the General Adapter and Bundler V3 across all tokens involved in the trade (old loan, new loan, old collateral, new collateral) to the simulation execution payload.
   - After simulation execution, the engine decodes the return values. If any transient contract has a non-zero residual balance ($> 0$), the engine flags a **Balance Leak Warning / Assertion Failure**, specifying the exact token address and leaked balance amount.

---

## Considered & Rejected Alternatives

1. **Relying Only on Transaction Reverts (`eth_simulateV1` success status):**
   - *Why Rejected:* Multicall transactions can succeed while silently stranding user funds inside intermediate contracts. A transaction passing simulation does not prove that all funds reached their intended destination.

2. **Pre-funding the Bundler for Test Simplicity:**
   - *Why Rejected:* Pre-funding masked real routing bugs (such as passing the wrong swap receiver address). Banning pre-funding ensures that every wei needed for flashloan settlement must flow organically through the transaction pipeline.

---

## Consequences

### Positive
- Guarantees complete hermetic integrity: transactions that pass simulation are guaranteed to settle organically without relying on external residual balances.
- Prevents user funds from being stranded inside shared or public contract infrastructure.
- Provides immediate diagnostic visibility if any protocol upgrade or route change introduces token leakage.

### Negative / Trade-offs
- Adds a small number of read-only calls to the simulation payload.
- Tests must accurately model complete token flow so that all swept balances end in either the user wallet or Morpho market positions.
