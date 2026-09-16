# Morpho Bundler Reference Contracts

This directory preserves reference source code for the deployed Morpho Blue Bundler V3 and Adapter smart contracts.

These contracts are deployed on Ethereum Mainnet:
- **Bundler3 (`Bundler3.sol`):** Morpho Bundler V3 contract (`0x4095F064B3d3cAA353Cd715Ce39794B34A3fB356`). Batches calls, handles transient storage and multicall callbacks.
- **CoreAdapter (`CoreAdapter.sol`):** Base adapter logic for Morpho Blue position interactions.
- **GeneralAdapter1 (`GeneralAdapter1.sol`):** Morpho General Adapter (`0x4A6c312ec70E8747a587EE860a0353cd42Be0aE0`). Handles token transfers, Permit2 interactions (`permit2TransferFrom`), and slippage reconciliation.
- **EthereumGeneralAdapter1 (`EthereumGeneralAdapter1.sol`):** Ethereum mainnet specific adapter implementation including native WETH wrapping and DEX router integrations.

## Provenance
These reference artifacts were extracted from verified Etherscan contracts and Morpho protocol repositories to verify exact method signatures, transient storage handling, error selectors, and callback interfaces used in transaction bundle construction.
