# Project Work Log

## 2026-06-17 - Renamed UI Slippage Tolerance Labels to Slippage to Prevent Layout Wrapping

### Summary of Investigation
1. **The Goal:** Align the "Slippage Tolerance (%)" label in the UI rows, preventing text wrapping onto a new line and preserving form layout aesthetics.
2. **Resolution:**
   * Renamed the "Slippage Tolerance (%)" labels to "Slippage (%)" in both the Rollover Migration and Adjust Leverage sections of `index.html`.
   * Added JSDOM frontend unit test assertions in `tests/app.test.mjs` to verify that both slippage label texts match exactly `Slippage (%)`.

### Changes Applied
* **File Updated:** [index.html](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/index.html)
  * Renamed slippage labels from "Slippage Tolerance (%)" to "Slippage (%)".
* **File Updated:** [tests/app.test.mjs](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/tests/app.test.mjs)
  * Added unit test asserting that both slippage labels read "Slippage (%)".

### Verification Terminal Commands Run
* Verified unit and integration tests:
  ```bash
  npm test
  ```

---

## 2026-06-17 - Compare Realized Rate and Price Impact with Estimated Values in Post-Execution Audit


### Summary of Investigation
1. **The Goal:** Provide the user with a direct comparison of the *real* (realized) swap/exchange rate and price impact against the *estimated* values computed during the pre-transaction preview.
2. **Resolution:**
   * Captured the estimated rate, oracle rate, estimated price impact, and transaction type in `pendingTx` state during the simulation preview phase for both Rollover and Leverage Adjustment workflows.
   * Modified the post-execution audit function (`auditRealizedPrice`) to retrieve these estimated values from the global `pendingTx` state.
   * Computed the realized price impact using the same oracle rate formula used in the preview.
   * Appended comparison details (`(Estimated: ...)` and `Realized Price Impact: ... (Estimated: ..., vs. Oracle)`) into the transaction success status display.
   * Updated the JSDOM integration test suite (`tests/preview_workflow.test.mjs`) to assert the correct formatting and presence of comparison values in the transaction confirmation log.

### Changes Applied
* **File Updated:** `app.js`
  * Stored preview estimation metadata in `pendingTx` inside the Rollover and Leverage preview functions.
  * Enhanced the audit message formatting in `auditRealizedPrice` to print comparison logs.
* **File Updated:** `tests/preview_workflow.test.mjs`
  * Added assertions to verify the presence of compared rates and price impacts in the transaction success message.

### Verification Terminal Commands Run
* Verified unit and integration tests:
  ```bash
  npm test --prefix tests
  ```

---

## 2026-06-17 - Clarified Slippage Terminology in UI: Renamed Slippage Tolerance vs Price Impact

### Summary of Investigation
1. **The Goal:** Clear up confusion between "Slippage Tolerance" (maximum deviation from quoted price allowed during execution) and "Price Impact" (market price deviation relative to the oracle fair value).
2. **Resolution:**
   * Renamed the slippage inputs in `index.html` from "Slippage (%)" to "Slippage Tolerance (%)".
   * Renamed "Execution Preview & Slippage Estimate" title to "Execution Preview & Price Impact Estimate".
   * Renamed the badge in `app.js` from "Slippage: X.XX%" to "Price Impact: X.XX%".
   * Renamed execution rate "Price Impact / Slippage" details to "Price Impact (vs. Oracle)".
   * Renamed "Slippage Limit" detail to "Slippage Tolerance Limit".
   * Updated JSDOM pre-transaction workflow unit test expectations from "Slippage:" to "Price Impact:".

### Changes Applied
* **File Updated:** `index.html`
  * Clarified labels and headers for slippage tolerance vs price impact.
* **File Updated:** `app.js`
  * Updated badge texts and metrics lists rendering.
* **File Updated:** `tests/preview_workflow.test.mjs`
  * Updated assertion to check for "Price Impact:" instead of "Slippage:".

### Verification Terminal Commands Run
* Verified unit and integration tests:
  ```bash
  npm test --prefix tests
  ```

---

## 2026-06-15 - Adjusted Frontend Layout: Renamed and Reordered Rollover Fields & Kept Only Tenderly Simulator

### Summary of Investigation
1. **The Goal:** Rename and reorder the input fields in the "Rollover Collateral" tab of `index.html` to align with the new source/destination flow nomenclature, and remove the Phalcon Simulator from the simulation layout, keeping only Tenderly.
2. **Resolution:**
   * Reordered fields in `index.html` to place "Source Morpho Market ID" (formerly "Old Morpho Market ID") second and "Source PT Token Address" (formerly "PT Token Address") third.
   * Renamed "New Morpho Market ID" to "Destination Morpho Market ID" and "Target PT Token Address" to "Destination PT Token Address".
   * Kept DOM IDs (`usdcAddress`, `oldPtAddress`, `newPtAddress`, `oldMarketId`, `newMarketId`) intact to prevent breaking any programmatic flow or DOM element queries in test scripts.
   * Removed "Phalcon Simulator" links and references in both `index.html` and the compilation comments in `app.js`.

### Changes Applied
* **File Updated:** [index.html](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/index.html)
  * Renamed and reordered the form groups in the "Rollover Collateral" tab.
  * Updated `payloadContainer` text and links to point only to the Tenderly Transaction Simulator.
* **File Updated:** [app.js](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/app.js)
  * Updated comment in transaction encoding flow to reference only Tenderly.

### Verification Terminal Commands Run
* Verified unit and integration tests:
  ```bash
  npm test
  ```

---

## 2026-06-15 - Enriched Developer Reference in README with Tech Stack & Architecture Details

### Summary of Investigation
1. **The Goal:** Enrich the "Developer Reference" section of the README with details about the project's technical architecture, core smart contracts, and external APIs used.
2. **Resolution:**
   * Updated `README.md` to add a new "Architecture & Tech Stack" sub-section under "Developer Reference".
   * Documented details for: Morpho Blue Core, Morpho Bundler V3, Ether General Adapter 1, Pendle AMM & SDK API, Morpho Blue GraphQL API, Viem client library, and Web3 Wallets integration.
   * Ran the test suite to verify everything is working properly.

### Changes Applied
* **File Updated:** [README.md](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/README.md)
  * Restructured the `Developer Reference` section to list the architecture components.

### Verification Terminal Commands Run
* Verified unit and integration tests:
  ```bash
  npm test --prefix tests
  ```

---

## 2026-06-15 - Corrected Outdated/Malformed Ethereum Addresses and Enhanced Simulation UI

### Summary of Investigation
1. **The Goal:** Resolve references to the transcription-error/malformed Ethereum address `0xbbbbbbbbbb9cced63b7b73fe30472d223547645e` in the UI and logs, and expose the transaction's sender (`From`) address.
2. **Analysis:**
   * The core `MORPHO_BLUE` contract address was previously corrected to the correct mainnet deployment address `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`.
   * However, the malformed typo address `0xbbbbbbbbbb9cced63b7b73fe30472d223547645e` remained in `HISTORY_LOG.md` and the frontend simulation UI container of `index.html`.
   * In the simulation UI, the target contract should be the Morpho Bundler V3 address (`0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245`) rather than the Morpho Blue contract.
   * To facilitate external simulations in tools like Tenderly and Phalcon, exposing the active sender (`From`) address dynamically alongside the target contract, value, and calldata payload is highly beneficial.
3. **Resolution:**
   * Replaced the malformed target contract address in the simulation payload UI of `index.html` with the correct Morpho Bundler V3 address.
   * Updated the Morpho Blue Core Contract address in `HISTORY_LOG.md` to the correct mainnet address.
   * Integrated a dynamic `Sender (From)` field in the raw transaction payload section of `index.html`, populated dynamically with the active connected wallet address (`userAddress`).

### Changes Applied
* **File Updated:** [index.html](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/index.html)
  * Corrected Target Contract (To) address in `payloadContainer` to `0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245`.
  * Added `rawFromAddress` HTML element to the payload simulation container block.
  * Added Javascript logic in both migration and leverage adjustment compilation flows to dynamically populate `rawFromAddress` with `userAddress`.
* **File Updated:** [HISTORY_LOG.md](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/HISTORY_LOG.md)
  * Corrected Morpho Blue Core Contract address to `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`.

---

## 2026-06-08 - Resolved Deleveraging Swap Simulation Revert and Refactored Leverage Adjustment Builders

### Summary of Investigation
1. **The Bug:** During simulation of the deleveraging flow on the leverage adjustment tab, the transaction reverted with `ERC20: transfer amount exceeds balance` at the top level and `Called function does not exist in the contract` inside the `ActionSwapPTV3` (Pendle) contract.
2. **Analysis:**
   * **Deleveraging Path:** The collateral PT tokens withdrawn from Morpho Blue were being sent to the `ETHER_GENERAL_ADAPTER_1` address. However, the subsequent Pendle Router direct call was initiated by the `Bundler3` contract itself, which was also the contract that called `approve` on the token. Since `Bundler3` did not hold the PT tokens, the token approval was invalid and the transfer failed.
   * **Leveraging Up Path:** The flashloan USDC was received by `ETHER_GENERAL_ADAPTER_1`, but the Pendle Router swap expected to pull the USDC from `Bundler3`. Since the USDC was not transferred to `Bundler3`, the swap failed.
3. **Resolution:**
   * Extracted the transaction bundle builders into a new ES module: [builders.js](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/builders.js).
   * Developed a new unit test suite [tests/builders.test.mjs](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/tests/builders.test.mjs) verifying the correct call layout, recipients, and amounts.
   * **Deleveraging Fix:** Configured the `morphoWithdrawCollateral` call in the deleveraging path to withdraw PT tokens directly to `MORPHO_BUNDLER_V3` so that the bundler owns the tokens it approves and swaps.
   * **Leveraging Up Fix:** Added a step at the beginning of the callback to transfer the flashloaned USDC from the adapter to `MORPHO_BUNDLER_V3`. Updated the supply step to use `type(uint256).max` (`2n ** 256n - 1n`) for collateral supply.

### Changes Applied
* **File Created:** [builders.js](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/builders.js)
  * Implemented environment-agnostic transaction bundle encoders via dependency-injected `encodeFunctionData`.
* **File Created:** [tests/builders.test.mjs](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/tests/builders.test.mjs)
  * Asserted step counts, token transfers, approvals, and contract parameter values.
* **File Updated:** [tests/package.json](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/tests/package.json)
  * Integrated builder test validation into the local test runner script.
* **File Updated:** [index.html](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/index.html)
  * Imported the modular bundle builders and replaced the inline transaction encoders.

### Verification Terminal Commands Run
* Running all test suites (including math, labeling, and transaction builders):
  ```bash
  npm test --prefix tests
  ```

---

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

---

## 2026-06-08 - Resolved Swap Routing and Collateral Supply transferFrom Revert

### Summary of Investigation
1. **The Bug:** During wallet transaction simulation, the wallet threw a `Simulation Failed (revert: transferFrom reverted #-39000)` error.
2. **Analysis:**
   * The swap receiver was previously set to `MORPHO_BUNDLER_V3`.
   * The `morphoSupplyCollateral` function is executed by `EthereumGeneralAdapter1`.
   * For the adapter to supply the collateral, the collateral tokens must reside directly inside the adapter contract itself.
   * If they reside in `Bundler3`, the adapter's internal balance check or pull fails.
   * Trying to pass a hardcoded expected amount also creates a risk of failure if the actual swap output is slightly different due to slippage or price impact.
3. **Resolution:**
   * Updated the Pendle V3 Swap quote request to route the swapped new PT tokens directly to `ETHER_GENERAL_ADAPTER_1` (by setting the swap `receiver` to the adapter's address instead of `MORPHO_BUNDLER_V3`).
   * Configured `morphoSupplyCollateral` to supply `assets = type(uint256).max` (`2n ** 256n - 1n`). This instructs the adapter to check its own balance dynamically (which will hold the exact amount received from the swap) and supply the entire balance to the new market.
   * This removes the need for approval or transfer steps on the new PT token between `Bundler3` and `EthereumGeneralAdapter1`, making the transaction more gas-efficient and robust.

### Changes Applied
* **File Updated:** [index.html](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/index.html)
  * Set `receiver: ETHER_GENERAL_ADAPTER_1` in the Pendle API fetch payload.
  * Removed the obsolete Approve call on the new PT token.
  * Set `assets = 2n ** 256n - 1n` in the `morphoSupplyCollateral` call parameters.

---

## 2026-06-08 - Added Raw Calldata Output Block for External Simulations

### Summary of Investigation
1. **The Goal:** Provide the user with a method to run parallel, independent transaction simulations using external tools (Tenderly, Phalcon) to verify transaction safety.
2. **Resolution:**
   * Updated the frontend UI in `index.html` to output the raw, compiled transaction payload parameters (`To`, `Value`, and `Calldata` hex) directly on the screen.
   * Users can copy this compiled hex payload and paste it directly into tools like **Tenderly Transaction Simulator** or **Phalcon by BlockSec** to examine call trees, stack traces, and net asset outputs independently of the wallet's internal simulator.

### Changes Applied
* **File Updated:** [index.html](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/index.html)
  * Appended the `#payloadContainer` elements to the page layout.
  * Added logic in `initiateMigration` to display and write the compiled `finalCalldata` into the container's textarea.

---

## 2026-06-08 - Added Full & Partial Migration Options with Live On-Chain Queries

### Summary of Investigation
1. **The Goal:** Support both full position rollovers and partial position splits (migrating only a specific sum $X$ of debt).
2. **Analysis:**
   * Full migration requires repay-by-shares (repaying 100% of outstanding debt and retrieving 100% of old collateral) and utilizes a 2 USDC buffer.
   * Partial migration requires repay-by-assets (repaying exactly $X$ USDC of debt and withdrawing a proportional amount of collateral). It does not require a repayment buffer.
   * Dynamic on-chain queries are needed to display active position status and compute correct proportional collateral amounts to keep the remaining position healthy.
3. **Resolution:**
   * Initialized a Viem `publicClient` to read the user's active position debt and collateral directly from the Morpho Blue contract.
   * Added toggle switches in the UI to select "Full Migration" vs "Partial Migration".
   * For Full Migration, the input fields are locked to the retrieved live position quantities.
   * For Partial Migration, the debt input is enabled, and a listener calculates and updates the collateral input proportionally: $C_{withdrawn} = Collateral_{total} \times X / Debt_{total}$.
   * Unified the transaction builder logic (DRY/KISS) to map bundle parameters dynamically based on the active mode (e.g. mapping repayment to assets vs shares, adding/removing buffer, and conditionally appending the sweep refund).

### Changes Applied
* **File Updated:** [index.html](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/index.html)
  * Imported `createPublicClient` and `http` from Viem.
  * Added position toggling/loading elements and CSS styles.
  * Defined `MORPHO_BLUE_ABI` and implemented `connectAndLoadPosition` and proportional calculation handlers.
  * Refactored `initiateMigration` to dynamically compile and execute the unified multicall payload.

---

## 2026-06-08 - Solved RPC Connection Failure in Position Queries

### Summary of Investigation
1. **The Bug:** When clicking "Connect Wallet & Fetch Live Position", the page threw an `HTTP request failed. URL: https://eth.merkle.io/ Details: Failed to fetch` error.
2. **Analysis:**
   * Viem's default public RPC endpoint (`https://eth.merkle.io/`) can be rate-limited, unstable, or block queries initiated from local origins like `http://localhost:8080`.
3. **Resolution:**
   * Updated `publicClient` to instantiate using `custom(window.ethereum)` inside the connection function.
   * This forces all read-only calls (like `eth_call` for `position` and `market` reads) to route directly through the user's active wallet connection (e.g. Rabby), bypassing external public HTTP constraints.

### Changes Applied
* **File Updated:** [index.html](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/index.html)
  * Removed global public RPC client instantiator.
  * Initialized `publicClient` with `custom(window.ethereum)` inside the `connectAndLoadPosition` function.

---

## 2026-06-08 - Corrected Mainnet Morpho Blue Address

### Summary of Investigation
1. **The Bug:** Querying position data returned no data (`0x`), indicating the contract address was invalid or did not host the requested bytecode.
2. **Analysis:**
   * Checked the mainnet Morpho Blue deployment registry.
   * The actual mainnet address is `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`.
   * The constant in the code had been hardcoded to `0xbBbbBBbBBb9CCEd63b7B73Fe30472d223547645e`, which was a transcription error from the original setup.
3. **Resolution:**
   * Corrected the `MORPHO_BLUE` address constant to `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`.

### Changes Applied
* **File Updated:** [index.html](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/index.html)
  * Updated `MORPHO_BLUE` constant.

---

## 2026-06-08 - Fixed Template Literal Interpolation Escaping

### Summary of Investigation
1. **The Bug:** The position status box rendered literally `${formattedCollateral} PT` and `${formattedDebt} USDC` on-screen instead of their numeric values.
2. **Analysis:**
   * In `index.html`, the template literal variables were mistakenly escaped with backslashes (`\${formattedCollateral}`), preventing the Javascript engine from performing string interpolation.
3. **Resolution:**
   * Removed the backslash escape characters from the template literal strings in `index.html`.

---

## 2026-06-08 - Added LTV and Leverage Indicators (TDD)

### Summary of Investigation
1. **The Goal:** Provide the user with LTV and Leverage multipliers for both their active old position and their simulated target position to improve visibility.
2. **Analysis:**
   * Morpho Blue oracle prices are returned as a `uint256` scaled by $10^{36}$.
   * Under collateral decimals $18$ (PT) and loan decimals $6$ (USDC), the actual USD collateral value calculation is: $\text{Collateral Value} = \text{Amount} \times \text{Price} / 10^{36}$, resulting in standard 6-decimal USDC values.
   * LTV ratio: $\text{USDC Debt} / \text{Collateral Value} \times 100$.
   * Leverage: $\text{Collateral Value} / (\text{Collateral Value} - \text{Debt})$.
3. **Resolution:**
   * Created a separate `math.js` module to hold these calculations.
   * Developed a unit test suite `tests/leverage.test.mjs` using Node's native ESM assertions (TDD) and verified it passes successfully.
   * Imported `math.js` inside `index.html`.
   * Updated `connectAndLoadPosition` to fetch the old market's oracle price on-chain and display LTV & Leverage.
   * Updated `initiateMigration` to fetch the new market's oracle price on-chain and display the simulated target LTV & Leverage on routing path resolution.

### Changes Applied
* **File Created:** [math.js](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/math.js)
  * Calculation helpers with robust edge-case checks.
* **File Created:** [tests/leverage.test.mjs](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/tests/leverage.test.mjs)
  * Unit test suite for LTV and Leverage calculations.
* **File Updated:** [index.html](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/index.html)
  * Integrated math helpers, queried oracle price feeds, and rendered metrics in the UI cards.

### Verification Terminal Commands Run
* Run the calculations unit test suite:
  ```bash
  node tests/leverage.test.mjs
  ```

---

## 2026-06-08 - Made Token Badges and Market Labels Dynamic (TDD)

### Summary of Investigation
1. **The Goal:** Automatically update token symbols and market subtexts in the UI dynamically when the user edits or pastes token addresses or Market IDs.
2. **Analysis:**
   * Token symbols can be queried on-chain using the standard ERC20 `symbol()` signature.
   * Market pair names (e.g. `(CollateralAsset/LoanAsset)`) can be resolved by retrieving asset symbols from Morpho Blue's GraphQL API.
3. **Resolution:**
   * Created a formatting module `labels.js` and verified it passes its unit tests in `tests/labels.test.mjs`.
   * Expanded `fetchMarketParams` GraphQL query schema to fetch `symbol` fields for collateral and loan assets.
   * Defined `onPtAddressInput` to fetch token symbols on-chain and update HTML badges.
   * Defined `onMarketIdInput` to fetch market params and format subtext labels dynamically.
   * Bound inputs to these event listeners and registered a `load` handler to resolve symbols dynamically for the default fields on page load.

### Changes Applied
* **File Created:** [labels.js](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/labels.js)
  * Symbol formatting helpers.
* **File Created:** [tests/labels.test.mjs](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/tests/labels.test.mjs)
  * Unit test suite for label format verification.
* **File Updated:** [index.html](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/index.html)
  * Added dynamic listeners, bound inputs, and updated GraphQL parameter fetch structure.

### Verification Terminal Commands Run
* Run the labels unit test suite:
  ```bash
  node tests/labels.test.mjs
  ```

---

## 2026-06-08 - Solved Token Badge Query Failures by Querying GraphQL API First

### Summary of Investigation
1. **The Bug:** On page load, token badges still showed `"Unknown Token"` on some client setups.
2. **Analysis:**
   * In modern Web3 wallets (like Rabby/MetaMask), if the page has not requested account connections yet, calling `window.ethereum.request({ method: 'eth_call', ... })` can be blocked or rejected by the wallet to prevent fingerprinting.
   * As a result, the provider transport fallback also fails on load.
3. **Resolution:**
   * Updated `onPtAddressInput` to first fetch the token symbol from the public Morpho Blue GraphQL API (`assets(where: { address_in: [$address] }) { items { symbol } }`). This query is fully public, fast, does not trigger wallet alerts, and requires zero user approval.
   * If the GraphQL query doesn't find the asset (e.g. for a custom token address not indexed on Morpho), it falls back to the on-chain read client.

---

## 2026-06-08 - Fixed publicClient Scope in Simulation

### Summary of Investigation
1. **The Bug:** Clicking "Simulate & Migrate Position" threw a `publicClient is not defined` error.
2. **Analysis:**
   * The `publicClient` variable was declared locally with `const` inside `connectAndLoadPosition()`, preventing it from being accessed by the outer scope or other functions.
3. **Resolution:**
   * Declared `publicClient` globally at the top of the script (`let publicClient = null;`) and removed the `const` keyword from its assignment in `connectAndLoadPosition()`.

---

## 2026-06-08 - Added Leverage Level Adjustment Calculations (TDD)

### Summary of Investigation
1. **The Goal:** Define calculations to solve the exact transaction parameters for adjusting a position's leverage (leveraging up or deleveraging) on the same market.
2. **Analysis:**
   * Targeting $1\text{x}$ leverage means completely paying down debt using a proportion of collateral.
   * Target leverage $L_{\text{target}}$ maps to $\text{LTV}_{\text{target}} = 1 - 1/L_{\text{target}}$.
   * If target LTV < current LTV: We deleverage by withdrawing and selling a portion of PT collateral for USDC.
   * If target LTV > current LTV: We leverage up by borrowing USDC to swap for PT.
3. **Resolution:**
   * Implemented `calculateLeverageAdjustmentParams` in `math.js` using native BigInts to handle high-precision calculations.
   * Created a unit test suite `tests/leverage_adjust.test.mjs` verifying parameter results for deleveraging, leveraging up, unleveraging (1.0x), and safety guards (>6.0x).
   * Verified all tests pass successfully.

### Changes Applied
* **File Updated:** [math.js](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/math.js)
  * Implemented leverage adjustment math solvers.
* **File Created:** [tests/leverage_adjust.test.mjs](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/tests/leverage_adjust.test.mjs)
  * Unit test suite for verifying calculation outputs.

### Verification Terminal Commands Run
* Run the leverage adjustment tests:
  ```bash
  node tests/leverage_adjust.test.mjs
  ```

---

## 2026-06-08 - Integrated Tabbed UI and Leverage Adjustment Operations

### Summary of Investigation
1. **The Goal:** Build a tabbed interface separating "Rollover Collateral" and "Adjust Leverage" to isolate execution paths and protect existing functionality.
2. **Analysis:**
   * Tab 1: Rollover Collateral (fully preserved).
   * Tab 2: Adjust Leverage (new features).
   * Swapping token targets: PT -> USDC (deleverage) and USDC -> PT (leverage-up).
   * Leveraging Morpho Bundler V3 multicalls for both paths.
3. **Resolution:**
   * Implemented CSS styles for tab selection and active containers hiding/showing.
   * Created tab toggle handler `switchTab` resetting status previews.
   * Defined Tab 2 page loading (`levConnectAndLoadPosition`) reading active Morpho Blue positions and resolving parameters.
   * Defined range slider inputs capping LTV target at 6.0x leverage (83.33% LTV) safety margin.
   * Structured deleveraging multicall (Flashloan -> Repay -> Withdraw -> Swap -> Repay Flashloan) and leveraging-up multicall (Flashloan -> Swap -> Supply -> Borrow -> Repay Flashloan).
   * Integrated Pendle routing APIs and Rabby wallet broadcast handlers.

### Changes Applied
* **File Updated:** [index.html](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/index.html)
  * Restructured DOM layouts, added CSS styles, and implemented all JS orchestrators.

### Verification Terminal Commands Run
* Run all ESM test suites:
  ```bash
  node tests/leverage.test.mjs && node tests/leverage_adjust.test.mjs
  ```

---

## 2026-06-08 - Fixed Leverage Adjustment Multicall Encoding Mismatch

### Summary of Investigation
1. **The Bug:** Clicking "Simulate & Adjust Leverage" threw an `ABI encoding params/values length mismatch` error: expected 3, given 5.
2. **Analysis:**
   * `morphoWithdrawCollateral` in the adapter ABI accepts exactly 3 parameters (`marketParams`, `assets`, `receiver`). The code incorrectly passed 5 arguments (including `userAddress` and callback data).
   * The swap operation was incorrectly trying to call a non-existent `swap` function on the adapter.
3. **Resolution:**
   * Corrected `morphoWithdrawCollateral` to pass exactly 3 parameters (`marketParams`, `params.collateralAmount`, `ETHER_GENERAL_ADAPTER_1`).
   * Replaced the incorrect `adapter.swap` call in both deleveraging and leveraging-up bundles with the correct Pendle Router direct call pattern (direct ERC20 approval and router call execution via `routeData.tx.to` and `routeData.tx.data`).

---

## 2026-06-08 - Fixed reenter Function ABI Mismatch in Flashloans

### Summary of Investigation
1. **The Bug:** Clicking "Simulate & Adjust Leverage" threw a `Function "reenter" not found on ABI` error.
2. **Analysis:**
   * In the Morpho flashloan integration, the callback bundle actions cannot be encoded using a direct `reenter` method call (which is not part of the adapter contract interface).
   * Instead, the nested bundle must be serialized as custom `tuple[]` parameters using `encodeAbiParameters`, hashed via `keccak256` to create a `callbackHash` parameter, and passed to `morphoFlashLoan` as a generic `bytes` parameter.
3. **Resolution:**
   * Rewrote the flashloan wrapping in both deleveraging and leveraging-up builders to match the exact ABI serialization flow used in the rollover tab.
   * Registered `encodedReenterBundle` via `encodeAbiParameters` and calculated the hash via `keccak256`.
   * Appended a USDC refund sweep to the outer bundle in the deleveraging path to sweep leftovers from the buffer.

---

## 2026-06-08 - Fixed Deleveraging Flashloan ERC20 Transfer Balance Deficit Revert

### Summary of Investigation
1. **The Bug:** During Rabby simulation for deleveraging, the transaction failed with `revert: ERC20: transfer amount exceeds balance`.
2. **Analysis:**
   * In a deleveraging swap, the mathematical solver calculates a theoretical USDC debt reduction amount.
   * However, the actual swap output USDC returned by the Pendle Convert API (`expectedUsdcOutput`) is slightly lower due to AMM price impact and swap fees.
   * Because the flashloan borrowed the full theoretical amount to repay Morpho Blue, but the swap received slightly less USDC, the general adapter had a USDC balance deficit at the end of the block, preventing it from repaying the flashloan.
3. **Resolution:**
   * Aligned the deleveraging flashloan borrow and Morpho repayment amount directly with the actual quoted swap output (`expectedUsdcOutput`). This ensures the adapter's USDC balance sheet balances perfectly.

---

## 2026-06-08 - Automated PT Token Address Auto-Fill on Market ID Input

### Summary of Investigation
1. **The Goal:** Prevent user entry mismatches by automatically populating the corresponding PT Token Address field when a Morpho Market ID is entered or pasted.
2. **Analysis:**
   * Morpho Blue's GraphQL API (`fetchMarketParams`) already returns the collateral asset contract address (`collateralToken`) alongside symbols.
3. **Resolution:**
   * Extended `onMarketIdInput` to accept target PT address input and badge element IDs as optional arguments.
   * On successful GraphQL lookup, populates the PT address value dynamically and triggers `onPtAddressInput` to resolve the symbol badge.
   * Bound the HTML input fields on both the Rollover and Leverage tabs to support this automated flow.

---

## 2026-06-08 - Fixed Morpho Bundler Address and Added Authorization Helper

### Summary of Investigation
1. **The Bug:** Live wallet simulations reverted with `ERC20: transfer amount exceeds balance` when executing rollover or leverage adjustments.
2. **Analysis:**
   * The DApp constant `MORPHO_BUNDLER_V3` was pointing to the local mock/test address instead of the real mainnet contract address.
   * Verified correct mainnet contract address mappings using the [Morpho Addresses Documentation](https://docs.morpho.org/get-started/resources/addresses/#bundlers).
3. **Resolution:**
   * Restored `MORPHO_BLUE` to point to the correct mainnet contract address `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` (ending in `EEFFCb`).
   * Configured `MORPHO_BUNDLER_V3` to point to the correct mainnet Bundler V3 address `0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245`.
   * Created a live on-chain integration sanity test (`tests/integration.test.mjs`) to test the address constants against live mainnet state during development, preventing regression errors.
   * **Bypassed Bundler Delegation Prompt:** Removed the unnecessary `isAuthorized` checks and delegation UI buttons. Because the multicall continues to route position modifications (withdraw, repay, supply, borrow) through the already-authorized **Ether General Adapter 1** (`0x4A6c312e...`) rather than calling raw Bundler actions, no new delegation or authorization of the Bundler contract (`MORPHO_BUNDLER_V3`) is required.

---

## 2026-06-15 - Created README for Running DApp as Localhost Server

### Summary of Investigation
1. **The Goal:** Create a comprehensive README guide instructing the user on how to run `index.html` locally on macOS.
2. **Analysis:**
   * Browser extensions like Rabby or MetaMask block DApp integration when pages are loaded directly from a filesystem path (e.g. `file:///Users/...`).
   * Serving `index.html` from a local origin (e.g., `http://localhost:8000`) is a strict security requirement of standard browser Web3 providers.
3. **Resolution:**
   * Created a central reference document [README.md](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/README.md) listing multiple macOS terminal server commands (Python 3, Node/npx, Ruby, PHP) for maximum utility.
   * Documented wallet connection guides and developer test-running commands.

### Changes Applied
* **File Created:** [README.md](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/README.md)
  * Created setup documentation for macOS local server hosting, Web3 interaction guidelines, and testing.

### Verification Terminal Commands Run
* Verified unit tests pass:
  ```bash
  npm test --prefix tests
  ```

---

## 2026-06-15 - Refined README to Remove Promotional Language

### Summary of Investigation
1. **The Goal:** Remove non-technical/marketing terminology (such as "premium", "dynamically", "real-time") from the tool documentation to focus purely on functional clarity.
2. **Resolution:**
   * Simplified the description to describe the repository as a client-side web utility focusing strictly on its features.

### Changes Applied
* **File Updated:** [README.md](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/README.md)
  * Refined the introductory paragraph to remove marketing adjectives.

---

## 2026-06-15 - Simplified Codebase & KISS Optimization

### Summary of Investigation
1. **The Goal**: Clean up and simplify the codebase following the KISS (Keep It Simple, Stupid) principle, removing duplicated logic, and ensuring the same exact functionality with no regressions.
2. **Analysis**:
   - **ABI Duplication**: `ERC20_ABI` and `ADAPTER_ABI` were declared both in `index.html` and `builders.js`.
   - **Position Fetching Duplication**: Both `connectAndLoadPosition` (rollover tab) and `levConnectAndLoadPosition` (leverage tab) duplicated the logic for fetching position details (collateral/debt shares) and computing the net debt balance from Morpho Blue core.
   - **Pendle Route Fetching Duplication**: Pendle Convert API calls were duplicated across three different locations: the rollover migration flow, the deleverage adjustment flow, and the leverage-up adjustment flow.
3. **Resolution**:
   - **Deduplicated ABIs**: Exported `ERC20_ABI` and `ADAPTER_ABI` from [builders.js](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/builders.js) and imported them into [index.html](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/index.html). Removed local duplicate declarations in `index.html`.
   - **Abstracted Position Loading**: Created the `fetchMorphoPosition(publicClient, marketId, userAddress)` helper function in [index.html](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/index.html) to encapsulate contract reads and debt calculations.
   - **Abstracted Pendle Routing**: Introduced `fetchPendleRoute(inputToken, inputAmount, outputToken, slippage)` helper function in [index.html](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/index.html) to centralize HTTP calls to Pendle's Convert V3 API.
   - **Verification**: Verified that the ESM unit test suite passes successfully.

### Changes Applied
* **File Updated**: [builders.js](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/builders.js)
  - Added `export` keyword to `ERC20_ABI` and `ADAPTER_ABI`.
* **File Updated**: [index.html](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/index.html)
  - Imported `ERC20_ABI` and `ADAPTER_ABI` from `./builders.js`.
  - Removed duplicate `ERC20_ABI` and `ADAPTER_ABI` declarations.
  - Implemented `fetchMorphoPosition` helper function.
  - Implemented `fetchPendleRoute` helper function.
  - Refactored `connectAndLoadPosition`, `levConnectAndLoadPosition`, `initiateMigration`, and `executeLeverageAdjustment` to use the new helper functions.

### Verification Terminal Commands Run
  ```bash
  npm test --prefix tests
  ```

---

## 2026-06-15 - Simplified Unit Tests & Cleaned Up Comments

### Summary of Investigation
1. **The Goal**: Clean up the unit and integration tests under the `tests/` directory to follow the KISS framework, replacing dynamic placeholder imports with static top-level imports and streamlining overly verbose comments.
2. **Analysis**:
   - The `try/catch` dynamic imports used in tests were original placeholders when source files did not exist. Since source files are now implemented, these are unnecessary.
   - [builders.test.mjs](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/tests/builders.test.mjs) had a mid-file import and rambled about design decisions in the comments instead of being concise.
3. **Resolution**:
   - Replaced dynamic import placeholders with direct static imports at the top of each test file.
   - Relocated nested imports to the top level in `builders.test.mjs`.
   - Streamlined verbose comments to keep them helpful, descriptive, and concise.

### Changes Applied
* **File Updated**: [tests/builders.test.mjs](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/tests/builders.test.mjs)
  - Converted dynamic `try/catch` imports to top-level static imports.
  - Relocated `viem` imports to the top of the file.
  - Streamlined verbose stream-of-consciousness design comments.
* **File Updated**: [tests/labels.test.mjs](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/tests/labels.test.mjs)
  - Replaced dynamic import with top-level static import.
* **File Updated**: [tests/leverage.test.mjs](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/tests/leverage.test.mjs)
  - Replaced dynamic import with top-level static import.
* **File Updated**: [tests/leverage_adjust.test.mjs](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/tests/leverage_adjust.test.mjs)
  - Replaced dynamic import with top-level static import.

### Verification Terminal Commands Run
* Run the test runner script:
  ```bash
  npm test --prefix tests
  ```

---

## 2026-06-15 - Fixed ESM Import & Reference Errors via Programmatic Event Bindings

### Summary of Investigation
1. **The Bug:** After codebase simplification, the app failed to run with:
   - `Uncaught SyntaxError: The requested module './builders.js' does not provide an export named 'ADAPTER_ABI' (at (index):200:75)`
   - `(index):1235 Uncaught ReferenceError: connectAndLoadPosition is not defined at HTMLButtonElement.onclick ((index):1235:170)`
2. **Analysis:**
   - The syntax error occurred because the browser loaded a cached/stale version of `builders.js` that did not yet contain the exported `ADAPTER_ABI`.
   - The reference error occurred because the module script failed to compile/evaluate due to the import syntax error, leaving the global functions undefined when clicked.
3. **Resolution:**
   - **Formulated Rule:** Created [DEVELOPMENT_RULE.md](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/DEVELOPMENT_RULE.md) using the GCCD framework to establish standard practices for avoiding inline event listeners and adding global error UI boundaries.
   - **Added Error Boundary:** Added a global error boundary script and a styled visual alert banner at the top of [index.html](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/index.html) to instantly catch and expose ESM/syntax errors to the developer.
   - **Programmatic Event Binding:** Removed all inline `onclick` and `oninput` handlers from HTML elements and replaced them with `addEventListener` programmatic bindings inside the module script block, preventing runtime `ReferenceError` when scripts fail to evaluate.

### Changes Applied
* **File Created:** [DEVELOPMENT_RULE.md](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/DEVELOPMENT_RULE.md)
  - Documented future development rules to handle ESM and event bindings safely.
* **File Updated:** [index.html](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/index.html)
  - Implemented visual error boundary elements and script.
  - Converted all inline HTML event handlers to programmatic DOM bindings.
  - Cleaned up global `window` function assignments.

### Verification Terminal Commands Run
* Run the test runner script:
  ```bash
  npm test --prefix tests
  ```

---

## 2026-06-15 - Added morphoFlashLoan Signature to builders.js ADAPTER_ABI

### Summary of Investigation
1. **The Bug:** During live testing, the application displayed a validation blockage error: `Migration Execution Blocked: Function "morphoFlashLoan" not found on ABI.`
2. **Analysis:**
   - The refactoring to deduplicate the ABI structures replaced `index.html`'s local `ADAPTER_ABI` (which included `morphoFlashLoan` signature) with the one from `builders.js`.
   - However, `builders.js`'s `ADAPTER_ABI` did not include the `morphoFlashLoan` signature because the transaction builder utility functions only execute the inner callback logic (`morphoRepay`, `morphoWithdrawCollateral`, `erc20Transfer`, etc.) and do not initiate the outer flashloan.
   - The ESM unit tests passed because they only test the unit functions of `builders.js` and do not simulate the outer page-level wallet interaction flow.
3. **Resolution:**
   - Restored `morphoFlashLoan` definition to the imported `ADAPTER_ABI` structure by adding the method signature to `ADAPTER_ABI` inside [builders.js](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/builders.js).

### Changes Applied
* **File Updated:** [builders.js](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/builders.js)
  - Added the `morphoFlashLoan` function signature back into the exported `ADAPTER_ABI` array.

### Verification Terminal Commands Run
* Run the unit and integration tests:
  ```bash
  npm test --prefix tests
  ```

---

## 2026-06-15 - Extracted app.js and Implemented JSDOM Integration Tests

### Summary of Investigation
1. **The Goal:** Follow industry best practices to move JavaScript logic out of HTML tags into a dedicated module, enabling automated JSDOM-based testing of frontend compilation and bindings in Node.js.
2. **Analysis:**
   - Single-file HTML/JS scripting makes testing frontend code difficult.
   - Using JSDOM allows running browser-scoped code in Node.js by mocking DOM interfaces.
   - Rewriting ES module CDN urls (`esm.sh/viem`) to local packages (`viem`) during preprocessing allows testing scripts offline.
3. **Resolution:**
   - Extracted script logic from [index.html](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/index.html) into a standalone [app.js](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/app.js) module.
   - Installed `jsdom` in the `tests/` directory.
   - Created [tests/app.test.mjs](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/tests/app.test.mjs) which loads [index.html](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/index.html) into a JSDOM context, mocks standard Web3 objects (`window.ethereum`), intercepts HTTP requests, and imports the remapped script dynamically.
   - Configured `npm test` pipeline in [tests/package.json](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/tests/package.json) to execute JSDOM tests.

### Changes Applied
* **File Created:** [app.js](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/app.js)
  - Standalone module logic containing all frontend interactions and bindings.
* **File Updated:** [index.html](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/index.html)
  - References `app.js` and loads it as a module.
* **File Created:** [tests/app.test.mjs](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/tests/app.test.mjs)
  - Simulates the DOM environment and verifies script loading, exports, and click listener bindings.
* **File Updated:** [tests/package.json](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/tests/package.json)
  - Registered `jsdom` dependency and updated the test running suite.
* **File Updated:** [DEVELOPMENT_RULE.md](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/DEVELOPMENT_RULE.md)
  - Updated architectural separation guidelines and JSDOM constraints.

### Verification Terminal Commands Run
* Run the entire unit and integration test suite:
  ```bash
  npm test --prefix tests
  ```

---

## 2026-06-16 - Implemented Pre-Transaction Preview, PT Maturity Checks, and Post-Transaction Realized Price Audit

### Summary of Investigation
1. **The Goal:** Upgrade the transaction workflow to provide advanced execution guardrails and price checks.
2. **Analysis:**
   * Instantly requesting wallet signature on button click prevents users from evaluating slippage and rates.
   * Standardizing a two-stage preview-then-execute flow lets users inspect estimated swap rates vs. oracle rates and potential price impact.
   * If a Principal Token (PT) matures, swapping on AMM is inefficient. A redemption check is required to warn users if a PT has matured.
   * After execution, the actual slippage and realized price should be tracked by reading the transaction receipt transfer logs.
3. **Resolution:**
   * **UI updates in [index.html](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/index.html):** Added a `#previewContainer` block that renders the swap preview, maturity alert notice, and confirmation button.
   * **Two-Stage Execution in [app.js](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/app.js):**
     * Stage 1: Action triggers calculate expected swap rates, fair-value oracle prices, and price impact, rendering the preview card without triggering a signature prompt.
     * Stage 2: Renders a "Confirm & Execute via Wallet" button to dispatch the pre-compiled transaction.
   * **PT Maturity Check:** Added `checkPtMaturity` to query the PT contract `expiry()` function and flag matured assets in the UI.
   * **Post-Transaction Audit:** Added `auditRealizedPrice` which awaits transaction receipt, parses the ERC-20 `Transfer` events, and prints the exact net inputs, outputs, and realized rates.
   * **TDD Verification:** Added JSDOM integration test `tests/preview_workflow.test.mjs` verifying UI updates, maturity warning triggers, and log parsing.

### Changes Applied
* **File Updated:** [index.html](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/index.html)
  - Inserted `#previewContainer`, `#previewMetrics`, `#previewSlippageBadge`, `#maturityNotice`, and `#confirmExecuteBtn`.
* **File Updated:** [app.js](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/app.js)
  - Refactored `initiateMigration` and `executeLeverageAdjustment` to run in preview mode.
  - Implemented `checkPtMaturity`, `confirmAndSubmitTransaction`, and `auditRealizedPrice` logic.
  - Bound events for the new confirmation button.
* **File Created:** [tests/preview_workflow.test.mjs](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/tests/preview_workflow.test.mjs)
  - Checks DOM elements presence, state transitions, maturity alert rendering, and transfer log parser logic.
* **File Updated:** [tests/package.json](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/tests/package.json)
  - Registered `preview_workflow.test.mjs` in the primary test script.

### Verification Terminal Commands Run
* Run the entire unit and integration test suite:
  ```bash
  npm test --prefix tests
  ```

## 2026-06-17 - Completed Codebase Security Audit
* **The Goal**: Audit the repository for private data leaks, supply-chain vulnerabilities, and API trust boundaries as requested by the user.
* **Audit Performed**:
  - Searched the codebase for hardcoded private keys, mnemonic phrases, API keys, passwords, and other credentials. Verified that the dApp is client-side and relies securely on `window.ethereum` injected wallets.
  - Performed a threat modeling mapping entry points, trust boundaries, sensitive data paths, and privileged actions.
  - Identified critical supply-chain risks (direct CDN imports of `viem` from `esm.sh`) and API trust boundaries (blind execution of Pendle API calldata).
  - Evaluated dependency vulnerabilities in `tests` directory via `npm audit`.
* **File Created**:
  - Created a local security audit report artifact (`security_audit_report.md`) detailing the findings, threat model, and recommendations.


