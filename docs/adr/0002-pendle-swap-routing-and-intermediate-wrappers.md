# ADR 0002: Pendle Swap Routing Against Underlying Base Assets and Dynamic Intermediate Wrapper Resolution

- **Status:** Accepted
- **Date:** 2026-06-26
- **Deciders:** Morpho Migration Engineering Team

---

## Context

Morpho Blue rollover and leverage adjustment operations often require swapping between collateral Principal Tokens (e.g. `PT-apyUSD-28MAY2026` to `PT-apyUSD-5NOV2026`) or between collateral assets and debt assets (e.g. `PT-apyUSD` to `USDC` / `apyUSD`).

Pendle's on-chain architecture does not trade PTs directly against arbitrary assets on a standard constant product pool. Instead, Pendle routes trades through:
1. **Standardized Yield (SY) Wrappers:** (e.g. `SY-apyUSD`), which tokenize yield-bearing collateral.
2. **Pendle AMM Pools:** (e.g. `PT-apyUSD` / `SY-apyUSD` market pools).
3. **DEX Aggregators (KyberSwap / Uniswap):** to route between `SY` underlying assets and target loan assets (such as `USDC`).

Early transaction builders attempted to manually resolve and encode intermediate `SY` token addresses (e.g., hardcoding `0x04F8DCa7bcCD8997ac57ca6feF7c705E17d6bcB6` for `SY-apyUSD`) into calldata payloads, or hardcode spender approvals for specific intermediate wrapper contracts.

This created multiple failure modes:
- Different Pendle PT maturities frequently wrap different SY contract deployments or updated yield implementations.
- Hardcoding specific pool or wrapper addresses broke rollover compatibility whenever a new maturity market was selected.
- Cross-asset routes failed when the Pendle Convert API utilized dynamic multi-hop paths involving third-party aggregator spenders (e.g. KyberSwap Router).

---

## Decision

We instituted the following routing architecture:
1. **Base Underlying Asset Targeting:** All swap quote queries and swap operations target the fundamental base underlying assets (e.g. `apyUSD` or `USDC`). The transaction builder requests quotes from the Pendle Convert / Router API specifying `tokenIn` (the source PT) and `tokenOut` (the target base loan or target PT).
2. **Dynamic Spender and Intermediate Resolution:**
   - The application relies on the swap router client or external API response (`routeData`) to resolve and encode intermediate wrapper steps under the hood.
   - Active intermediate tokens (such as `SY` wrappers or intermediate tokens) and spenders (e.g. `limitRouter`, KyberSwap aggregation endpoints) are extracted dynamically from the structured JSON metadata in the quote payload rather than from hardcoded lists.
   - Zero token addresses, market IDs, or intermediate wrapper contracts are permitted to be inline hardcoded.

---

## Considered & Rejected Alternatives

1. **Manual In-House Encoding of Pendle AMM & SY Unwrapping Multicalls:**
   - *Why Rejected:* Highly complex, brittle, and subject to breaking whenever Pendle upgrades router contracts or changes SY exchange rate calculation mechanisms. The official Pendle Convert API and Router contracts encapsulate this logic accurately with optimal gas routing.

2. **Hardcoded Intermediate Wrapper Tables (`SY_TOKENS_MAP`):**
   - *Why Rejected:* Requires continuous code updates and deployments every time a new PT maturity or collateral market is launched on Morpho Blue. Dynamic query resolution completely removes maintenance overhead.

3. **Loose Calldata Regex Extraction for Router Spenders:**
   - *Why Rejected:* Scanning raw hex `tx.data` for 20-byte substrings matched non-address data offsets and integer values, prompting users to approve arbitrary, unvalidated addresses. Spenders must only be extracted from structured quote object properties.

---

## Consequences

### Positive
- Fully future-proof: New PT maturities and Morpho Blue collateral pools work seamlessly without code alterations.
- Reduced codebase size and eliminated dozens of lines of brittle contract-address mapping dictionaries.
- Guaranteed best-execution routing leveraging Pendle's quoter and integrated DEX aggregators.

### Negative / Trade-offs
- The client must have network access to the Pendle Router / Convert API or quoter contract at planning time to generate valid swap calldata.
- Tests must use realistic mock quote payloads that return structured spenders and intermediate token descriptors.
