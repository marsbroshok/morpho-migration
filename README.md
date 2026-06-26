# Morpho Position Migrator & Leverage Adjuster

A client-side web utility to manage and migrate collateralized debt positions on **Morpho Blue** (Ethereum Mainnet). It allows users to roll over maturing collateral assets, adjust leverage levels (leverage up/down), and simulate transactions.

---

## Why a Local Host Server is Required

Web3 wallet extensions (such as **Rabby Wallet** or **MetaMask**) strictly block connections to DApps loaded directly from the local filesystem (i.e., using the `file:///` protocol in your browser's address bar).

To allow your wallet to communicate with the page, request accounts, and simulate or submit transactions, the application must be served over a secure local origin (i.e., `http://localhost` or `http://127.0.0.1`).

---

## Configuration Requirements

Unlike the CLI tool, the Web UI runs entirely client-side inside your browser context and interacts directly with standard injected extension wallets (such as Rabby Wallet or MetaMask) via `window.ethereum`. Therefore, it does **not** require any API keys or `.env` configuration files to run.

---

## How to Run the App on macOS Terminal

You can serve `index.html` using any of the following standard command-line methods. 

First, open your terminal application (e.g., Terminal, iTerm2) and navigate to the project directory:

```bash
cd /Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration
```

Choose **one** of the methods below to start the server:

### Method 1: Using Python 3 (Recommended & Pre-installed)
macOS usually comes with Python 3 pre-installed. Run:
```bash
python3 -m http.server 8000
```
* **Access URL:** [http://localhost:8000](http://localhost:8000)

### Method 2: Using Node.js (via `npx`)
If you have Node.js installed, you can spin up a lightweight server instantly using `npx` without installing anything permanently:
```bash
npx http-server -p 8000
```
or
```bash
npx serve -l 8000
```
* **Access URL:** [http://localhost:8000](http://localhost:8000)

### Method 3: Using PHP
If you have PHP installed:
```bash
php -S localhost:8000
```
* **Access URL:** [http://localhost:8000](http://localhost:8000)

### Method 4: Using Ruby
If you have Ruby installed:
```bash
ruby -run -e httpd . -p 8000
```
* **Access URL:** [http://localhost:8000](http://localhost:8000)

---

## How to Connect Your Wallet & Migrate

1. Start your local server using one of the methods above.
2. Open your web browser (with Rabby or MetaMask active) and go to [http://localhost:8000](http://localhost:8000).
3. Select the appropriate tab for your operation:
    * **Rollover Collateral:** To roll over collateral from an old maturing market to a new market.
   * **Adjust Leverage:** To leverage up or delever/unleverage your position on the same market.
4. Click the **"Connect Wallet & Fetch Live Position"** button. This will trigger a wallet approval request.
5. Once connected, your active position metrics (LTV, Collateral, and Debt) will load automatically.
6. Set your target parameters:
    * **For Rollover:** Review the target collateral address and select Full or Partial migration.
   * **For Leverage Adjustment:** Use the slider to set your target LTV/Leverage multiplier.
7. Click **"Simulate & Migrate Position"** (or **"Simulate & Adjust Leverage"**).
8. The app will fetch live routes from the swap router and compile the transaction payload.
9. Review the simulation in your wallet popup (e.g., Rabby's transaction simulation preview) to verify safety before executing on-chain.

---

## Developer Reference

### Architecture & Tech Stack

The application coordinates atomic position migrations and leverage adjustments by interacting with the following protocol contracts, APIs, and libraries:

* **Morpho Blue Core (`0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`)**: The main lending contract where lending/borrowing states are tracked.
* **Morpho Bundler V3 (`0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245`)**: The multicall utility contract enabling sequential operations (flashloan, repay, withdraw, supply, borrow, transfers) in a single atomic transaction.
* **Ether General Adapter 1 (`0x4A6c312ec70E8747a587EE860a0353cd42Be0aE0`)**: A helper adapter contract integrated with the Bundler to handle deposits, borrowings, ERC20 transfers, and interface with Morpho.
* **Swap Router API (e.g. Pendle Convert API) (`https://api-v2.pendle.finance`)**: Used to query optimal swap routes and fetch raw transaction calldata to execute exchange operations between collateral/loan assets.
* **Morpho Blue GraphQL API (`https://blue-api.morpho.org/graphql`)**: Provides real-time metadata query capabilities for loan assets, collateral assets, oracles, IRMs, and LLTV properties.
* **Viem**: ESM-compatible client library used to interact with Ethereum, read contract states, and compile custom multicall calldata.
* **Web3 Wallets (e.g., Rabby, MetaMask)**: Interfaces with the application via the standard `window.ethereum` JSON-RPC provider to simulate, approve, and sign transaction payloads.

### Running Unit Tests

The project includes unit tests for calculations, token badge labeling, and multicall bundle generation.

To install dependencies and execute the test suite, run:

```bash
npm install --prefix tests
npm test --prefix tests
```
