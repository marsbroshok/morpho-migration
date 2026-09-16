# Morpho Position Migrator & Leverage Adjuster

## Vision

A trustless, client-side toolset for DeFi power users to atomically manage collateralized debt positions on **Morpho Blue** (Ethereum Mainnet). The application enables three core workflows — collateral rollovers between maturing markets, leverage adjustments (up/down), and pre-flight transaction simulation — delivered through both a browser-based Web UI and a fully-featured CLI with WalletConnect integration.

## Problem Statement

DeFi users holding positions on Morpho Blue face operational complexity when:
- **Maturing collateral** (e.g., Pendle PT tokens) requires rolling over to new markets with fresh maturity dates.
- **Leverage adjustment** requires multi-step flashloan → repay → withdraw → swap → supply → borrow sequences that are error-prone if done manually.
- **Cross-asset swaps** during migration introduce exchange rate risk, slippage, and MEV exposure.

Manual execution of these operations across multiple contracts and transactions is slow, gas-inefficient, and exposes users to front-running.

## Core Capabilities

1. **Atomic Collateral Rollover:** Single-transaction migration of a Morpho Blue position from one market to another via Bundler V3 multicalls (flashloan, repay, withdraw, swap, supply, borrow).
2. **Leverage Up / Deleverage:** Adjust position leverage within the same market by looping borrow-supply cycles atomically.
3. **Pre-Flight Simulation:** Run `eth_simulateV1` traces before on-chain submission to detect reverts, gas issues, and validate expected state changes.
4. **Dual Interface Parity:** Both Web UI (via injected wallets like Rabby/MetaMask) and CLI (via private keys or WalletConnect) offer 100% feature parity.
5. **MEV Protection:** Mainnet transactions are routed through private MEV-blocker RPC endpoints by default.
6. **Permit2 Auto-Approvals:** Automatic two-layer allowance detection and approval flows for Permit2-integrated protocols.

## Target Users

- DeFi power users managing Morpho Blue positions
- Yield farmers rolling over Pendle PT collateral
- Automated strategies and bots (via CLI)

## Non-Goals

- General-purpose DeFi portfolio management
- Support for lending protocols other than Morpho Blue
- Mobile-native application
