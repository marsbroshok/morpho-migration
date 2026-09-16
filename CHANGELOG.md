# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-06-30

### Added
- **Morpho Blue Market Rollover Engine:** Atomic migration of borrow and collateral positions across Morpho Blue markets using Morpho Bundler V3 flashloans, collateral unwinds, Pendle PT swaps, and collateral supply.
- **Cross-Loan Asset Rollover Support:** Atomic position rollover across differing loan asset pairs (e.g. USDC to apyUSD) with dynamic swap deficit settlement.
- **Leverage Adjustment Workflows:** Multi-step leverage-up and deleverage capabilities allowing borrowers to adjust LTV and leverage factors dynamically in both CLI and Web UI.
- **Two-Step Iterative Swap Quoter:** Dynamic swap quote solver that queries real-world rates using nominal input guesses, solves required borrow amounts under slippage, and prevents flashloan repayment shortfalls.
- **Double-Layered Permit2 Authorization:** Automated check and prompt flow for both ERC20 token allowance to Permit2 and internal Permit2 spender allowance to Morpho General Adapter.
- **Fork Simulation Balance Leak Detection:** Post-simulation automated balance inspection asserting that all intermediate bundler and adapter contracts end transactions with a 0 token balance.
- **Dynamic Spender and Token Resolution:** Automatic extraction of active swap spenders and intermediate tokens from structured quote payloads, removing hardcoded address maps.
- **Private MEV Protection:** Automatic routing to MEV-blocker private RPC endpoints on Ethereum mainnet (`CHAIN_ID = 1`).
- **CLI Suite:** Interactive and scripted commands (`cli.js rollover`, `cli.js leverage`) with live market parameters, position inspection, and fork dry-run capabilities.

### Changed
- Refactored all market parameter queries to resolve dynamically via on-chain calls and Morpho Blue GraphQL endpoints.
- Replaced static collateral price ratio estimations with real-time DEX/Pendle execution quoter integration.
- Switched display formatters to dynamically scale balances based on on-chain token decimals instead of hardcoded 6-decimal or 18-decimal assumptions.
- Migrated system-level core contract addresses (Morpho Blue Core, Morpho Bundler V3, General Adapter, Permit2) to external configuration (`config.json` / `config.js`).

### Fixed
- Fixed transaction reverts caused by Permit2 internal allowance deficits during shortfall settlements.
- Fixed underflow and deficit reverts during cross-loan asset rollovers by introducing iterative swap input scaling.
- Fixed post-execution audit calculation double-counting intermediate transfer events in multicall receipts.
- Fixed simulation false positives caused by pre-funding intermediate contracts, establishing zero-balance starting constraints.
- Fixed inverted oracle exchange rate math across collateral-to-loan conversions.

### Security
- Audited repository for accidental PII and private RPC keys, ensuring all credentials load exclusively from environment variables.
- Established strict zero-funding rules for intermediate contracts during fork simulation to prevent masking routing vulnerabilities.
- Enforced structured JSON parsing for spender address resolution to prevent loose regex false-positive contract approvals.
