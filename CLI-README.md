# Morpho Blue Position Migrator CLI

A modular, object-oriented command-line interface (CLI) tool for executing cross-market rollovers and adjusting leverage ratios for collateralized debt positions on Morpho Blue.

This CLI tool provides 100% feature parity with the web application while offering robust security options (e.g., WalletConnect pairing) and automated execution modes.

---

## Features & Operations

1. **Load Position & Metrics Query**: Reads live borrow debt, collateral balance, current LTV, and leverage ratio from Morpho Blue for any user address.
2. **Proportional Migration Calculation**: Automatically calculates proportional collateral to withdraw and migrate during a partial rollover to keep the position healthy.
3. **Optimal Swap Routing**: Queries Swap Router API (e.g., Pendle Convert V3) to discover the most capital-efficient swap path (e.g., old collateral to new collateral, collateral to loan token, or loan token to collateral), and computes estimated slippage and price impact compared to Oracle fair-value ratios.
4. **Leverage adjustment solving**: Solves target LTV/mode (`deleverage`, `deleverage-to-1x`, or `leverage-up`) and required swap amounts given a target leverage level between 1.0x and 6.0x.
5. **Mainnet Fork Simulations**: Runs a full EVM execution trace of the compiled atomic flashloan multicall bundle on a mainnet fork, mock-authorizing adapter approvals on the fly and logging nested call steps, gas usage, and reverts.
6. **Secure WalletConnect pairing**: Displays connection QR codes and URIs directly in the terminal, allowing pairing with desktop/mobile wallets (e.g., Rabby Wallet, MetaMask) so users never have to paste private keys.
7. **Private Key execution fallback**: Supports local signing for automated scripts/CI environments.
8. **Post-Execution Auditing**: Waits for transaction confirmation and parses receipt event logs to report realized exchange rates and finalized price impact.

---

## Installation & Setup

1. **Prerequisites**: Ensure you have [NodeJS (v18+)](https://nodejs.org/) installed.
2. **Clone and Install Dependencies**:
   ```bash
   git clone https://github.com/marsbroshok/morpho-migration.git
   cd morpho-migration
   npm install
   ```
3. **Environment Configuration**:
   Create a `.env` file in the root directory:
   ```bash
   cp .env.example .env
   ```
   Open `.env` and fill in the required variables:
   * **`ALCHEMY_API_KEY`**: Required for live mainnet fork simulations.
   * **`WC_PROJECT_ID`**: Required for executing transactions securely via WalletConnect (`-w`). Obtain a free Project ID from the [WalletConnect Developer Dashboard](https://dashboard.walletconnect.com/) by creating a new **App** project.

---

## Directory Structure

All CLI implementation modules are organized inside the `cli/` subdirectory:
```
morpho-migration/
├── cli.js                         # CLI entrypoint executable runner
├── package.json                   # Project package configuration
├── cli/                           # Encapsulated CLI class modules
│   ├── cli-runner.js              # Command line argument parser & orchestrator
│   ├── blockchain-client.js       # On-chain queries & transaction sender (Viem)
│   ├── wallet-connector.js        # WalletConnect pairing dApp manager
│   ├── simulation-engine.js       # Mainnet-fork EVM simulator (eth_simulateV1)
│   ├── swap-router-client.js      # Swap router SDK client fetcher
│   ├── rollover-command.js        # Rollover collateral command execution handler
│   ├── leverage-command.js        # Leverage adjustment command execution handler
│   └── transaction-auditor.js     # Post-execution realized price & slippage auditor
└── tests/
    └── cli.test.mjs               # Automated CLI test suite
```

---

## Commands & Flags Reference

### Global Flags
- `--rpc <url>` / `-r`: RPC provider URL (Required if using `--private-key`).
- `--private-key <hex>` / `-k`: Private key hex string to sign transactions locally (Requires `--rpc`).
- `--walletconnect` / `-w`: Initiates secure WalletConnect pairing session (requires `WC_PROJECT_ID` configured in `.env`).
- `--simulation` / `-s`: Simulates the transaction execution on a mainnet fork instead of submitting to the network.
- `--no-simulation`: Bypasses fork simulation and immediately attempts submission (default when execution signer is connected).
- `--slippage <pct>`: Slippage limit percentage (default: `1.0`).
- `--old-loan <address>`: Custom source loan asset address (fetched dynamically if omitted; alias: `--usdc`).

---

### Command 1: `rollover`
Migrates user collateral and loan debt from a source Morpho Blue market to a destination market.

#### Options
- `--old-market-id <id>`: (Required) Source Morpho Blue market ID.
- `--new-market-id <id>`: (Required) Destination Morpho Blue market ID.
- `--user <address>`: (Required in simulation mode) Wallet address to fetch position for.
- `--type <full|partial>`: Migration type (default: `full`).
- `--debt <amount>`: Debt amount to repay (Required if type is `partial`).
- `--old-collateral <address>`: Source Collateral address (fetched dynamically if omitted; alias: `--old-pt`).
- `--new-collateral <address>`: Destination Collateral address (fetched dynamically if omitted; alias: `--new-pt`).

---

### Command 2: `adjust-leverage` (alias: `leverage`)
Adjusts leverage ratio on an active Morpho Blue market.

#### Options
- `--market-id <id>`: (Required) Morpho Blue market ID.
- `--target-leverage <number>`: (Required) Target leverage level between `1.0` (debt-free) and `6.0`.
- `--user <address>`: (Required in simulation mode) Wallet address to fetch position for.
- `--collateral <address>`: Collateral Token address (fetched dynamically if omitted; alias: `--pt`).

---

## Usage Examples

### 1. Read-Only Mainnet Simulation (Default Mode)
Simulates a position rollover on mainnet fork without connecting a wallet, using Alchemy RPC.

```bash
export ALCHEMY_API_KEY="your-alchemy-key"

node cli.js rollover \
  --old-market-id 0xa75bb490ecfee90c86a9d22ebc2dde42fb83478b3f18722b9fc6f5f668cab124 \
  --new-market-id 0xb37c30f34bff11c81ee8400133965f450a5f7c5d81ba2cf5740076f49eabc95c \
  --user 0xdC382CDF2a25790F535a518EC26958c227e9DCF2 \
  --simulation
```

---

### 2. Secure Execution via WalletConnect (Recommended)
Performs a leverage adjustment. The CLI generates a WalletConnect URI and displays a QR code in the terminal. Once paired via Rabby Wallet, the CLI simulates the transaction and prompts your wallet for approval.

```bash
node cli.js adjust-leverage \
  --market-id 0xb37c30f34bff11c81ee8400133965f450a5f7c5d81ba2cf5740076f49eabc95c \
  --target-leverage 4.5 \
  --walletconnect
```

**Workflow**:
1. Copy the printed `wc:...` URI or scan the QR code using Rabby Wallet ("Quick Connect" button).
2. The CLI pairs, loads your position, solves adjustment parameters, fetches optimal swap routing, and runs simulation checks.
3. The CLI prompts your Rabby Wallet extension for transaction approval.
4. Review the details in Rabby and approve.
5. The CLI prints confirmation status, parses receipts, and outputs the post-execution realized price audit logs.

---

### 3. Execution via Private Key (Automation / CI)
Bypasses manual approvals and executes a partial rollover using a configured private key and RPC node:

```bash
node cli.js rollover \
  --old-market-id 0xa75bb490ecfee90c86a9d22ebc2dde42fb83478b3f18722b9fc6f5f668cab124 \
  --new-market-id 0xb37c30f34bff11c81ee8400133965f450a5f7c5d81ba2cf5740076f49eabc95c \
  --type partial \
  --debt 3000 \
  --rpc https://eth-mainnet.g.alchemy.com/v2/your-key \
  --private-key 0xyourprivatekeyhex...
```

---

## Post-Execution Audit Output Example

Upon successful execution, the tool outputs details from the parsed receipts logs:

```
Waiting for block confirmation for transaction: 0x990113c7ef5f9a4c0c745e02c1c7e50b325868c164887dc1058f941bf0f1e137...

[Post-Execution Audit]
Realized Swap Rate: 1 old-collateral = 0.9754 new-collateral (Estimated: 0.9750 new-collateral).
Realized Price Impact: 2.46% (Estimated: 2.50%, vs. Oracle).
(Checked via transfer events: spent 8.0 old-collateral, received 7.8032 new-collateral).
```

---

## Running CLI Tests
To verify all CLI commands offline and online (live simulations):
```bash
npm test
```
