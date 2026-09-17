# Specification: Track 2 — DeFi Math & ADR-0003 Realignment

**Track ID:** `defi_math_realignment_20260917`  
**Type:** Bug (Mathematical & Financial Logic Remediation)  
**Priority:** P1 (High — Invariant & Execution Integrity)  
**Related Audit Findings:** MATH-01, MATH-02, MATH-03, MATH-04, MATH-05, TEST-02  
**Target Invariant:** ADR-0003 (Iterative Scaling for Cross-Loan Debt Sizing) & Rule 2 (Multi-Decimal Scaling & BigInt Safety)

---

## 1. Overview & Problem Statement

Mathematical calculation engines and swap sizing routines contain invariant drifts, unit scaling errors, and IEEE-754 precision issues that threaten transaction success on mainnet:

1. **ADR-0003 Invariant Drift (MATH-01):** `cli/rollover-routing-helper.js` and `src/ui/controllers/rollover-workflow.js` use the ratio of collateral oracle prices to estimate cross-loan debt, bypassing the Two-Step Iterative Swap Quoter Solver whenever oracles are available. This corrupts debt calculations when collateral assets differ in yield or maturity and causes swap shortfall reverts.
2. **Slippage Unit Mismatch (MATH-02):** `src/core/builders/rollover-bundle-builder.js` calculates `(100 - slippage) * 100` with a fraction default (`0.005`), yielding `9999 bps` (0.005% slippage tolerance instead of 0.50%), causing swaps to fail on normal DEX price impact.
3. **Floating-Point Precision Drift (MATH-03, TEST-02):** `LtvCalculator.calculateLeverageAdjustmentParams` uses IEEE-754 binary floats (`1.0 - 1.0 / targetLeverage`), turning $2/3$ into `666666666666666752n` instead of `666666666666666666n`, with unit tests overfitted to match this float inaccuracy.
4. **Hardcoded Leverage Ceiling (MATH-04):** `LtvCalculator` hardcodes a static `1.0x - 6.0x` ceiling regardless of market LLTV, which is dangerously excessive for 77% LLTV markets and unnecessarily restrictive for 96.5% LLTV markets.
5. **CLI Float String Parsing (MATH-05):** Partial debt amounts in the CLI are parsed via float multiplication, which truncates low-order digits on 18-decimal tokens.

---

## 2. Functional Requirements

### 2.1 Enforce ADR-0003 Two-Step Iterative Swap Solver (MATH-01)
- Remove the collateral oracle ratio shortcut (`loanOracleRate = (oldOraclePrice * 10n ** exp) / newOraclePrice`) from `cli/rollover-routing-helper.js` and `src/ui/controllers/rollover-workflow.js`.
- Always execute the 2-step iterative swap quoter solver for cross-loan debt estimation:
  1. Fetch a nominal swap quote for 1.0 unit of new loan token to derive the effective rate $R_{\text{effective}}$.
  2. Compute $B_{\text{solved}} = \lceil \frac{D_{\text{old}}}{R_{\text{effective}} \cdot (1 - \text{slippage})} \rceil$.
  3. Re-query the swap router with $B_{\text{solved}}$ as the input amount to obtain the final execution route.

### 2.2 Standardize Slippage to Integer Basis Points (MATH-02)
- Enforce BigInt basis points (`slippageBps`) across all builder interfaces and CLI/UI boundaries.
- Delegate all minimum output calculations directly to `SlippageService.applySlippageTolerance(expectedOutput, slippageBps)` in `src/core/builders/rollover-bundle-builder.js`.

### 2.3 Pure Rational BigInt Leverage Calculations (MATH-03, TEST-02)
- Refactor `LtvCalculator.calculateLeverageAdjustmentParams` to operate strictly with integer BigInt values:
  $$\text{targetLtvBig} = \frac{(\text{targetLeverageScaled} - 100\text{n}) \times 10^{18}\text{n}}{\text{targetLeverageScaled}}$$
- Update `tests/leverage_adjust.test.mjs` assertions to analytical exact values ($3200 \times 10^{18}\text{n}$ PT and $3040 \times 10^6\text{n}$ USDC) instead of float drift artifacts.

### 2.4 Dynamic Safe Leverage Bounds Based on Market LLTV (MATH-04)
- Calculate maximum safe leverage dynamically from the market's specific `lltv` parameter with a configurable safety buffer (e.g. 200 bps):
  $$\text{MaxSafeLeverage} = \frac{10^{18}}{10^{18} - (\text{LLTV} - \text{Buffer})}$$
- Disallow targets that exceed $\text{MaxSafeLeverage}$ or fall below $1.0\text{x}$.

### 2.5 BigInt String Parsing in CLI (MATH-05)
- Replace float multiplication in `cli/rollover-command.js` with `ScalingService.parseUnits(options.debt.toString(), decimals)`.

---

## 3. Non-Functional Requirements & Governance

1. **No Float Arithmetic in Financial Sizing:** Downstream debt, collateral, and LTV amounts must remain natively in BigInt.
2. **File Size Compliance:** All modified modules must remain strictly under 400 lines of code.
3. **Full Multi-Decimal Safety:** Formulas must behave correctly across combinations of 6-decimal (USDC), 8-decimal (WBTC), 18-decimal (WETH/PT), and 27-decimal tokens.

---

## 4. Acceptance Criteria

- [ ] Cross-loan rollover debt estimation strictly uses the 2-step iterative swap solver without falling back to collateral oracle division.
- [ ] `RolloverBundleBuilder` applies the correct slippage tolerance (e.g. 50 bps for 0.5% slippage) via `SlippageService`.
- [ ] `LtvCalculator` performs pure BigInt arithmetic with zero IEEE-754 precision artifacts.
- [ ] `tests/leverage_adjust.test.mjs` passes with exact analytical assertions.
- [ ] Dynamic leverage limit correctly restricts low-LLTV markets and permits safe higher leverage on high-LLTV markets.
- [ ] All math and builder unit tests pass deterministically.

---

## 5. Out of Scope

- Removing `process.env.MOCK_POSITION_DEBT` runtime test cheat from `BlockchainClient` (Track 3).
- Adding `fast-check` randomized property testing (Track 3).
- Extracting shared `CrossLoanRoutingService` between CLI and UI (Track 4).
