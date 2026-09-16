# ADR 0001: Permit2 Two-Layer Allowance Verification and Authorization

- **Status:** Accepted
- **Date:** 2026-06-26
- **Deciders:** Morpho Migration Engineering Team

---

## Context

When users execute cross-loan rollover or deleveraging transactions, the Morpho Blue General Adapter contract pulls any residual debt shortfall (e.g. USDC) directly from the user's wallet to satisfy the flashloan repayment obligation.

In early implementations, the application checked and requested a standard ERC20 token allowance directly to the General Adapter contract (`0x4A6c312ec70E8747a587EE860a0353cd42Be0aE0`). However, on-chain execution unexpectedly reverted during the shortfall pull even when the user's direct ERC20 allowance to the Adapter was sufficient.

Investigation revealed that the Morpho General Adapter contract does not execute a direct `IERC20.transferFrom()`. Instead, it invokes Uniswap's **Permit2** contract (`0x000000000022D473030F116dDEE9F6B43aC78BA3`) via `permit2TransferFrom(token, from, to, amount)`.

Permit2 operates with an internal, nested two-layer authorization model:
1. **Layer 1 (ERC20 Token Allowance):** The user must grant the Permit2 contract an allowance on the underlying ERC20 token contract.
2. **Layer 2 (Permit2 Internal Spender Allowance):** Inside Permit2's internal registry, the user must explicitly authorize the *target spender* (the Morpho General Adapter) to draw tokens via `approve(token, spender, amount, expiration)`.

Because the user had approved the Adapter directly on the ERC20 token, but had a zero allowance inside the Permit2 contract for the Adapter, the `permit2TransferFrom` call reverted with `AllowanceExpired` or insufficient Permit2 allowance.

---

## Decision

We instituted a mandatory **double-layered Permit2 allowance check and prompt sequence** across both the CLI (`cli/blockchain-client.js`, `cli/cli-runner.js`) and UI controllers:

1. **Query Layer 1 (ERC20 Allowance to Permit2):** Query `IERC20(token).allowance(user, PERMIT2_ADDRESS)`. If the allowance is less than the required shortfall/transfer amount, prompt and submit an ERC20 `approve(PERMIT2_ADDRESS, maxUint256)`.
2. **Query Layer 2 (Permit2 Allowance to Spender):** Query `IPermit2(PERMIT2_ADDRESS).allowance(user, token, spender)`. The response is a tuple `[amount, expiration, nonce]`. If `amount` is less than the shortfall or `expiration <= block.timestamp`, prompt and submit a Permit2 transaction calling `approve(token, spender, amount, expiration)`.
3. In fork simulations, both Layer 1 and Layer 2 approvals must be dynamically prepended to the user's transaction execution payload to ensure hermetic simulation without manual user pre-funding.

---

## Considered & Rejected Alternatives

1. **Direct ERC20 Approvals to General Adapter:**
   - *Why Rejected:* Failed with on-chain revert. The General Adapter contract code strictly routes user token pulls through Permit2. Direct approvals to the Adapter are completely ignored by Permit2.

2. **Off-Chain EIP-712 Permit2 Signatures (`permitTransferFrom` with witness):**
   - *Why Rejected:* While gas-efficient for one-shot signatures, integrating interactive EIP-712 signature collection across both headless CLI scripts and heterogeneous Web3 wallet providers added fragility and wallet popup friction. Standard on-chain Permit2 `approve()` transactions provide predictable state across both CLI and browser environments.

3. **Loose Calldata Regex Matching for Spender Extraction:**
   - *Why Rejected:* Attempting to extract spenders by scanning raw bundle calldata with `/[a-fA-F0-9]{40}/g` generated dozens of false-positive spenders (matching function selectors, numerical arguments, and offsets), prompting users for dozens of spurious approvals. Structured JSON property extraction is strictly enforced instead.

---

## Consequences

### Positive
- Completely eliminates on-chain reverts caused by unapproved Permit2 spenders during shortfall settlements.
- Prevents false-positive approval checks where the user appeared approved at the ERC20 level but lacked Permit2 authorization.
- Provides identical approval behavior between CLI and Web UI.

### Negative / Trade-offs
- First-time users need to execute two approval transactions (ERC20 -> Permit2, then Permit2 -> Adapter) before executing their first shortfall rollover.
- Tests mocking `readContract` must return tuple structures matching `[amount, expiration, nonce]` rather than simple single BigInt allowances.
