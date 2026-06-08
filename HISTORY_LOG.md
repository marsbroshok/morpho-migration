### Context Migration Summary: Morpho Blue Cross-Market PT Position Rollover

This engineering summary contains the core context, parameter sets, and logic flows needed by your AI developer agent (`antigravity` / CLI environment) to orchestrate and simulate the custom DeFi position migration transaction.

---

### 1. Goal & Architecture

The objective is to execute an **atomic, single-transaction migration (rollover)** of an isolated borrow position on **Morpho Blue (Mainnet)** across two distinct Principle Token (PT) collateral markets via a zero-fee flashloan. Because Morpho Blue positions are completely separate at the immutable smart-contract level, the migration requires an orchestrated multicall sequence via Morpho's **Bundler V3** contract.

The transaction flow must execute the following actions within a single block:

1. **Flashloan:** Borrow the required `USDC` debt natively from Morpho Blue (0% fee).
2. **Repay & Unwind:** Repay the `USDC` debt in the old market, unlocking the old PT collateral.
3. **Withdraw:** Withdraw the old PT tokens into the execution context.
4. **DeFi Swap:** Interact with the **Pendle AMM Router** to swap the old PT tokens directly for the new PT tokens.
5. **Supply & Lock:** Deposit the new PT tokens as collateral into the target Morpho market.
6. **Re-borrow & Repay Flashloan:** Borrow the identical `USDC` amount from the new market to fulfill and close the flashloan loop.

---

### 2. Precise Position Parameters

* **Network:** Ethereum Mainnet (Chain ID: 1)
* **Morpho Blue Core Contract:** `0xBBBBBbbBBb9CCEd63b7B73fE30472d223547645E`
* **Morpho Bundler V3 Contract:** `0x4095F064B8d3c3548A3beBFd04df03b827EE8359`
* **USDC Stablecoin Address:** `0xA0b86991c6218b36c1d19D4a2e9Eb0CE3606eB48`
* **Old Collateral (PT-apyUSD-18JUN2026):** `0x600170A2dEfA1ebE356A32791e84F17aC9eD3df6`
* **New Collateral (PT-apyUSD-5NOV2026):** `0x8992BeF4Ecf6c21e64627CFF8f0376251b69C8b8`
* **Old Morpho Market ID:** `0xa75bb490ecfee90c86a9d22ebc2dde42fb83478b3f18722b9fc6f5f668cab124`
* **New Morpho Market ID:** `0xb37c30f34bff11c81ee8400133965f450a5f7c5d81ba2cf5740076f49eabc95c`
* **Collateral Amount:** 8,000.32 PT
* **USDC Debt Amount:** 6,195.88 USDC

---

### 3. Engineering Constraints & Critical Subtleties

* **The Timing/Slippage Constraint:** The current date is **June 8, 2026**. The old collateral asset matures on **June 18, 2026** (in exactly 10 days). Because it has not reached absolute maturity, it cannot be redeemed 1:1 for the underlying token at par yet. It must be routed through the **Pendle AMM** using an exact token-to-token swap. Slippage settings must accommodate the pool depth for `apyUSD` pairs (recommended limit: 1.0%).
* **Calldata Generation:** The swap calldata cannot be hardcoded or static. The agent must pull a live, real-time quote payload from Pendle's core swap router API endpoint (`https://api-v2.pendle.finance/core/v1/1/markets/swap`) right before constructing the block bundle.
* **Security & Execution:** The script environment does **not** have access to the user's private keys. It must compile the tightly-packed execution bundle using a library like `viem` or `ethers` and generate a standard transaction payload object containing target address, transaction data, and native value. This payload must be passed up to the browser context or local CLI bridge for signature and state simulation via **Rabby Wallet**.

---

### 4. Instructions for the AI Dev Agent

1. Parse the provided market metadata, asset variables, and position quantities.
2. Formulate the dynamic payload query targeting the Pendle AMM exchange routing API.
3. Handle the encoding of the parameters into the array formatting required by the Morpho Bundler V3 multicall specification (`flashloan`, `repay`, `withdraw`, `externalSwap`, `supply`, `borrow`).
4. Output a clean transaction dictionary to pass directly into the wallet connector without exposing sensitive key states. Use Rabby's internal transaction simulation frame to visually cross-check net asset outcomes before broadcasting.