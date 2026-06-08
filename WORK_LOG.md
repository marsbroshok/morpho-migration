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
