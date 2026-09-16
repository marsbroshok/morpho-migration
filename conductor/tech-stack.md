# Technology Stack

## Language

- **JavaScript (ES Modules)** — Native browser ESM (`import ... from './module.js'`) for the Web UI; Node.js ESM (`"type": "module"` in `package.json`) for the CLI.

## Runtime

- **Browser** (Web UI): Vanilla HTML/CSS/JS served via a local HTTP server. No bundler, no transpiler.
- **Node.js v18+** (CLI): Direct ESM execution with `node` for CLI commands and test scripts.

## Core Libraries

| Library | Version | Purpose |
|---------|---------|---------|
| **viem** | `^2.52.2` | Ethereum client: contract reads, calldata encoding, transaction simulation, ABI handling |
| **@walletconnect/sign-client** | `^2.13.0` | WalletConnect v2 session management for CLI wallet connectivity |
| **qrcode-terminal** | `^0.12.0` | Terminal QR code rendering for WalletConnect pairing |

## Testing

| Tool | Purpose |
|------|---------|
| **Node.js `assert`** | Built-in assertion library for unit tests |
| **jsdom** (`^29.1.1`) | DOM simulation for headless Web UI testing (`app.test.mjs`, `cli_ui.test.mjs`) |
| **viem (test)** | Mainnet fork simulation via Anvil for integration tests |

## External APIs

| API | Endpoint | Purpose |
|-----|----------|---------|
| **Morpho Blue GraphQL** | `https://blue-api.morpho.org/graphql` | Market metadata, oracle params, position queries |
| **Pendle Convert API** | `https://api-v2.pendle.finance` | Swap route quotes and raw calldata for PT/SY token conversions |
| **MEV Blocker RPC** | `https://rpc.mevblocker.io` | Private transaction submission for MEV protection (Mainnet only) |

## Smart Contract Dependencies

| Contract | Address | Role |
|----------|---------|------|
| Morpho Blue Core | `0xBBBB...FFCb` | Lending/borrowing state machine |
| Morpho Bundler V3 | `0x6566...0245` | Atomic multicall executor |
| Ether General Adapter 1 | `0x4A6c...aE0` | ERC20/deposit/borrow adapter |
| Permit2 | `0x0000...8BA3` | Gasless approval infrastructure |
| Pendle Router | `0x8888...8946` | Swap execution router |

## Architecture Notes

- **No build step.** The Web UI is served as raw HTML + ES modules.
- **No framework.** DOM manipulation is vanilla JS.
- **Config-driven contracts.** All contract addresses are loaded from `config.json`, not hardcoded.
- **Shadow testing.** JSDOM-based tests import `app.js` via regex-rewritten shadow files to strip browser-only APIs.
