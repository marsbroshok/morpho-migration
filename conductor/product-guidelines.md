# Product Guidelines

## Voice & Tone

- **Technical and precise.** The audience is DeFi-literate. Use protocol-specific terminology (LTV, LLTV, collateral factor, flashloan) without over-explaining.
- **Safety-first.** Always surface warnings, simulation results, and risk metrics before any irreversible action.
- **Transparent.** Display all transaction parameters (amounts, slippage, gas estimates, approval targets) clearly. Never hide costs.

## UX Principles

1. **Simulation Before Execution:** Every on-chain transaction must be simulated and displayed before the user is prompted to sign.
2. **Clear State Transitions:** The UI must unambiguously indicate current position state, target state, and the delta between them.
3. **Fail-Safe Defaults:** Slippage tolerance, MEV protection, and gas limits should default to conservative values.
4. **CLI/UI Consistency:** Mathematical calculations, route fetching, and calldata generation must be identical across both interfaces.

## Error Handling

- All errors must surface through the visual error boundary (`#globalErrorBanner`) in the Web UI.
- CLI errors must include actionable context (contract address, function selector, revert reason) — not raw hex dumps.
- Network errors and RPC failures should retry with exponential backoff before surfacing to the user.

## Branding

- The application is a utility tool — function over form.
- Dark-themed UI consistent with DeFi conventions.
- No marketing copy or promotional language in the interface.
