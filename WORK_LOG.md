# Project Work Log

## 2026-06-08 - Migrated Pendle Swap API to Convert V3 & Verified PT Token Addresses

### Summary of Investigation
1. **The Bug:** The user experienced a `Failed to fetch routing data from Pendle AMM API` error on the frontend DApp.
2. **Analysis:**
   * Checked logs of the curl request to the legacy endpoint `https://api-v2.pendle.finance/core/v1/1/markets/swap`. The API returned a `400 Bad Request` with message `address must be a valid ethereum address`.
   * Inspected Pendle's interactive documentation (`https://api-v2.pendle.finance/core/docs`) and discovered that the route `/core/v1/{chainId}/markets/{marketAddress}` expects a valid Ethereum address for the `{marketAddress}` path parameter. When the DApp requested `/markets/swap`, the API parsed `"swap"` as a malformed Ethereum address.
   * Discovered that Pendle has deprecated individual `/swap` endpoints in favor of a unified **Convert API** (`POST /core/v3/sdk/{chainId}/convert`).
3. **PT Address Verification:**
   * Wrote a script to query `/v2/markets/all` and search for the user's Principal Token (PT) collateral addresses.
   * Confirmed the active Pendle market contracts:
     * **Old PT Market (maturing 18-JUN-2026):** `0x3c53fae231ad3c0408a8b6d33138bbff1caec330` for PT `0x3365554a61CeFF74A76528f9e86C1E87946d16a5`.
     * **New PT Market (maturing 05-NOV-2026):** `0xc5f938a8ef5f3bf9e72f5aa094baf5e03f4727d3` for PT `0xb5Be35D8fF83D431899b95851CB17a2B4bcEF150`.

### Changes Applied
* **File Updated:** [index.html](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/index.html)
  * Switched default token inputs to the correct active PT addresses provided by the user.
  * Replaced the deprecated `GET /v1/markets/swap` call with a `POST` request to `/v3/sdk/{chainId}/convert`.
  * Updated Javascript logic to build the payload using `TokenAmountDto` and retrieve routing data and transaction calldata from the `routes[0]` array in the response.

### Verification Terminal Commands Run
* To check the old endpoint response:
  ```bash
  curl -i -s "https://api-v2.pendle.finance/core/v1/1/markets/swap?from=0x3365554a61CeFF74A76528f9e86C1E87946d16a5&to=0xb5Be35D8fF83D431899b95851CB17a2B4bcEF150&amountIn=8000320000000000000000&slippage=0.01&receiver=0x4095F064B8d3c3548A3beBFd04df03b827EE8359"
  ```
* To check the new POST Convert V3 endpoint response:
  ```bash
  curl -i -s -X POST -H "Content-Type: application/json" -d '{"receiver":"0x4095F064B8d3c3548A3beBFd04df03b827EE8359","slippage":0.01,"inputs":[{"token":"0x3365554a61CeFF74A76528f9e86C1E87946d16a5","amount":"8000320000000000000000"}],"outputs":["0xb5Be35D8fF83D431899b95851CB17a2B4bcEF150"],"enableAggregator":true}' "https://api-v2.pendle.finance/core/v3/sdk/1/convert"
  ```

---

## 2026-06-08 - Fixed EIP-55 Checksum Errors

### Summary of Investigation
1. **The Bug:** The user encountered an error stating `Address "0x4095F064B8d3c3548A3beBFd04df03b827EE8359" is invalid. Address must match its checksum counterpart.`
2. **Analysis:**
   * Viem performs strict EIP-55 checksum validation on mixed-case Ethereum addresses. If an address contains mixed case, the case pattern must exactly match the Keccak-256 hash of its lowercased string.
   * The hardcoded addresses for `MORPHO_BLUE` and `MORPHO_BUNDLER_V3` had incorrect case configurations.
3. **Resolution:**
   * Installed `viem` locally in the scratch directory and ran a Node command to compute the correct checksummed versions of all addresses:
     ```bash
     node -e "const { getAddress } = require('viem'); console.log(getAddress('0x4095f064b8d3c3548a3bebfd04df03b827ee8359'))"
     ```
   * The corrected capitalizations are:
     * **MORPHO_BLUE:** `0xbBbbBBbBBb9CCEd63b7B73Fe30472d223547645e` (corrected from `0xBBBBBbbBBb9CCEd63b7B73fE30472D223547645E`)
     * **MORPHO_BUNDLER_V3:** `0x4095f064b8d3c3548A3BeBfD04dF03B827eE8359` (corrected from `0x4095F064B8d3c3548A3beBFd04df03b827EE8359`)

### Changes Applied
* **File Updated:** [index.html](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/index.html)
  * Replaced `MORPHO_BLUE` and `MORPHO_BUNDLER_V3` constants with their correct EIP-55 checksummed versions.

---

## 2026-06-08 - Migrated DApp to Morpho Bundler V3 & Dynamic Market Parameters Lookup

### Summary of Investigation
1. **The Goal:** Migrate the position rollover transaction encoding from the deprecated V2 structure to the active Morpho Bundler V3 (`0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245`) and correct a malformed hardcoded bundler address.
2. **Analysis:**
   * Morpho Bundler V3 does not support V2-style `multicall(bytes32[] actions, bytes[] data)`. It acts as a call dispatcher executing an array of `Call` structs (`multicall(Call[] calldata bundle)`).
   * Flashloans must be initiated via an adapter (such as `EthereumGeneralAdapter1` at `0x4A6c312ec70E8747a587EE860a0353cd42Be0aE0`) which implements `onMorphoFlashLoan` and performs re-entry into `Bundler3` via `reenter(Call[] bundle)`.
   * The `callbackHash` parameter for the flashloan call must be the `keccak256` of the ABI-encoded re-entry bundle.
   * Standard Morpho Blue actions require a `MarketParams` tuple. To avoid manual or static values, we integrated dynamic parameters lookup targeting the public Morpho Blue GraphQL API (`https://blue-api.morpho.org/graphql`) using the inputs `oldMarketId` and `newMarketId`.

### Changes Applied
* **File Updated:** [index.html](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/index.html)
  * Set `MORPHO_BUNDLER_V3` to the correct mainnet Bundler V3 address `0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245`.
  * Added `ETHER_GENERAL_ADAPTER_1` constant for mainnet adapter `0x4A6c312ec70E8747a587EE860a0353cd42Be0aE0`.
  * Switched multicall ABI to use V3 `Call[]` struct format.
  * Added `ADAPTER_ABI` for flashloan, repay, withdraw collateral, supply collateral, and borrow actions.
  * Implemented dynamic lookup helper `fetchMarketParams` querying Morpho's public GraphQL API.
  * Refactored transaction assembly in `initiateMigration` to construct, pack, and hash the re-entry bundle and submit it to the wallet.
* **File Updated:** [HISTORY_LOG.md](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/HISTORY_LOG.md)
  * Updated documented contract addresses to align with the correct mainnet configurations.

---

## 2026-06-08 - Resolved Simulation Revert (Insufficient Collateral) via Self-Balancing Repayment Buffer

### Summary of Investigation
1. **The Bug:** During wallet transaction simulation, the Rabby wallet returned a `Simulation Failed (revert: insufficient collateral #-39000)` error.
2. **Analysis:**
   * Morpho Blue enforces collateral health factors atomically.
   * If the debt amount requested for repayment is exactly `debtAmount`, any interest accrued block-by-block makes the user's actual debt slightly higher than `debtAmount`.
   * When the repay action attempts to repay exactly `debtAmount`, a tiny fraction of debt remains on the old market.
   * Consequently, when the script attempts to withdraw the *entire* old PT collateral, the transaction reverts because the remaining 0 collateral cannot support the remaining interest debt.
3. **Resolution:**
   * Implemented a self-balancing repayment buffer of `2 USDC` added to the flashloan amount.
   * Configured the repayment step to repay the user's *entire* debt (`assets = type(uint256).max` in `morphoRepay`), which is capped automatically at the actual debt amount by Morpho Blue. This leaves the old market's debt at exactly 0.
   * Configured the new borrow step to borrow the full flashloan amount (`debtAmount + buffer`) to ensure the flashloan is fully repaid at the end of the callback.
   * Appended a final sweep action (`erc20Transfer` with `amount = type(uint256).max`) to the outer multicall bundle, executing immediately after the flashloan settlements are completed. This transfers any remaining USDC buffer cash (approximately 2 USDC minus the tiny accrued interest) directly back to the user's wallet address.
   * This leaves the user's net position mathematically identical to a zero-slippage repayment while ensuring successful atomic execution.

### Changes Applied
* **File Updated:** [index.html](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/index.html)
  * Added `erc20Transfer` to `ADAPTER_ABI`.
  * Added `bufferAmount = 2 USDC` and configured the flashloan to request `debtAmount + bufferAmount`.
  * Updated borrowing to request `flashLoanAmount`.
  * Appended the sweep refund `Call` struct to the outer multicall bundle.

---

## 2026-06-08 - Fixed Arithmetic Underflow Panic (0x11) in Repayment Step

### Summary of Investigation
1. **The Bug:** During simulation of the updated buffer transaction flow, the wallet threw a `Simulation Failed (panic: arithmetic underflow or overflow (0x11) #-39000)` error.
2. **Analysis:**
   * In Morpho Blue, repayment can be executed by assets or by shares.
   * Capping by assets causes the contract to calculate shares to burn. If the assets provided exceed the user's actual debt assets (due to the added buffer), the calculated shares to burn exceed the user's actual borrow shares.
   * This triggers an arithmetic underflow (`borrowShares -= shares` goes below zero) resulting in the Solidity `0x11` panic code.
3. **Resolution:**
   * Switched the repayment mode to full repayment by shares.
   * Configured the repayment parameters to set `assets = 0` and `shares = type(uint256).max` (`2n ** 256n - 1n`).
   * This instructs Morpho Blue to look up your actual borrow shares, burn exactly those shares, calculate the precise corresponding USDC debt assets dynamically, and pull only that amount from the adapter.
   * This resolves the underflow panic and correctly clears the entire debt position.

* **File Updated:** [index.html](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/index.html)
  * Set `assets = 0n` and `shares = 2n ** 256n - 1n` in the `morphoRepay` call parameters.
