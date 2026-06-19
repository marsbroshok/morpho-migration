# [IGNORE] Local Smart Contract Simulation with Anvil Fork

> [!IMPORTANT]
> **AI Agent Notice**: Ignore this document and its contents for the moment. Do not implement this feature or modify the codebase based on it.

---

This document outlines the research and step-by-step setup to run real, local transaction simulations against a mainnet fork using **Anvil** (from Foundry), **Alchemy**, and **Viem**.

---

## 1. Goal Description

The Morpho Position Migrator uses the Morpho Bundler V3 contract and Pendle Router to execute atomic position adjustments. Currently, unit and JSDOM tests use mocked providers and static responses. To ensure the generated transaction payloads execute successfully on-chain, we can run a **real simulation locally** against a fork of Ethereum mainnet.

This plan details:
1. Installing and configuring **Anvil**.
2. Understanding the concept of "Mainnet block pinning" and why/how to use it.
3. Writing a standalone integration test/script (`tests/simulate_mainnet_fork.mjs`) using **Viem** to programmatically execute the leverage/migration bundle on the local fork and check the results.

---

## 2. Key Concepts & Research

### What is an Anvil Fork?
Anvil is a local Ethereum node designed for development and testing. When running in fork mode, Anvil acts as a proxy:
- Whenever you read state (e.g., query a user's Morpho position or token balance), Anvil fetches that data from mainnet via your Alchemy RPC node and caches it locally.
- Whenever you write state (e.g., execute a transaction, approve tokens, withdraw collateral), Anvil processes it locally in memory. **None of these transactions are sent to mainnet or cost real gas.**

### What does "Mainnet block to pin" mean?
When you start a fork, you can specify a specific block number to fork from using the `--fork-block-number` flag.
* **Why pin a block?**
  1. **Determinism**: Since the blockchain state is frozen at that block, any test run will yield the exact same results (no unexpected interest accrual or price swings).
  2. **Speed**: Anvil caches RPC responses for that block. Subsequent runs are extremely fast.
  3. **Reproducibility**: If a bug or transaction revert happens, pinning the block ensures you can reproduce the exact error state every time until it is fixed.
* **How to choose a block**:
  * You should select a recent block (e.g., the latest block at the time you start your testing session) to have fresh states (current token balances, latest pool exchange rates).
  * You can find the latest block number on [Etherscan](https://etherscan.io/) or by running `cast block-number` in your command line.

---

## 3. Implementation Plan

### Step 1: Install Foundry (Anvil)
Foundry includes `anvil` (local node) and `cast` (cli helper).
Run the following in your terminal:
```bash
# Download and install foundryup installer
curl -L https://foundry.paradigm.xyz | bash

# Install the actual binaries (restart your terminal if 'foundryup' is not found)
foundryup
```
Verify the installation:
```bash
anvil --version
```

### Step 2: Spin Up the Anvil Fork
Start the local node by forking mainnet. Replace `<alchemy-api-key>` with your actual key, and `<block-number>` with a recent block number (e.g., `20123456`).

```bash
anvil --fork-url https://eth-mainnet.g.alchemy.com/v2/<alchemy-api-key> --fork-block-number <block-number>
```
*Note: If you omit `--fork-block-number`, Anvil will fork from the latest block, which is fine for ad-hoc manual testing but less recommended for automated test consistency.*

### Step 3: Programmatic Simulation Script (Viem)
We will create a new test file: `tests/simulate_mainnet_fork.mjs`.
This script will:
1. Connect to the local Anvil node (`http://127.0.0.1:8545`).
2. Impersonate a real mainnet address that has an active Morpho Blue position (using Anvil's `impersonateAccount` cheatcode).
3. Fund the account with local ETH for gas (using `setBalance`).
4. Execute the leverage adjustment or migration transaction locally and verify that the transaction successfully completes (doesn't revert) and that the final Morpho position metrics are adjusted.

#### [NEW] `tests/simulate_mainnet_fork.mjs`
```javascript
import { createPublicClient, createTestClient, http, parseEther, encodeFunctionData, encodeAbiParameters, keccak256 } from 'viem';
import { mainnet } from 'viem/chains';
import { buildDeleveragingBundle, ADAPTER_ABI } from '../builders.js';

// 1. Setup Clients connected to local Anvil node
const localRpcUrl = 'http://127.0.0.1:8545';

const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(localRpcUrl),
});

const testClient = createTestClient({
  chain: mainnet,
  mode: 'anvil',
  transport: http(localRpcUrl),
});

// 2. Constants for Morpho Contracts
const MORPHO_BLUE = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";
const MORPHO_BUNDLER_V3 = "0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245";
const ETHER_GENERAL_ADAPTER_1 = "0x4A6c312ec70E8747a587EE860a0353cd42Be0aE0";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0CE3606eB48";

// 3. Define the mainnet account to impersonate for the simulation
// Use a real address that has a position in the targeted Morpho market
const TARGET_USER = "0xdC382CDF2a25790F535a518EC26958c227e9DCF2"; 

async function runSimulation() {
  console.log(`Starting mainnet fork simulation for user: ${TARGET_USER}...`);

  // Setup local state: Fund user with ETH for gas fees
  await testClient.setBalance({
    address: TARGET_USER,
    value: parseEther('10.0'),
  });

  // Enable account impersonation on the local node
  await testClient.impersonateAccount({
    address: TARGET_USER,
  });

  // Fetch initial position state directly from the local node (representing mainnet state at the pinned block)
  // Let's print out the position values to confirm
  console.log("Fetching current position state...");
  
  // (Optional: fetch current Morpho Blue position metrics here to log them)

  // 4. Construct the bundle transaction using builders.js
  // (In a real test, you'd fetch routing data from Pendle API or mock the Pendle routing calldata)
  const mockRouteData = {
    tx: {
      to: '0x0000000000000000000000000000000000000004', // Replace with real router address or mock
      data: '0x00'
    }
  };

  const marketParams = {
    loanToken: USDC,
    collateralToken: '0x3365554a61CeFF74A76528f9e86C1E87946d16a5', // PT-apyUSD
    oracle: '0x0000000000000000000000000000000000000002',
    irm: '0x0000000000000000000000000000000000000003',
    lltv: 860000000000000000n
  };

  console.log("Building deleveraging transaction payload...");
  const reenterBundle = buildDeleveragingBundle({
    encodeFunctionData,
    marketParams,
    collateralAmount: 1000n * 10n**18n, // 1000 PT
    debtAmount: 900n * 10n**6n, // 900 USDC
    is1x: false,
    ptAddress: marketParams.collateralToken,
    usdcAddress: USDC,
    routeData: mockRouteData,
    userAddress: TARGET_USER,
    ETHER_GENERAL_ADAPTER_1,
    MORPHO_BUNDLER_V3
  });

  const encodedReenterBundle = encodeAbiParameters(
    [{
      name: 'bundle',
      type: 'tuple[]',
      components: [
        { name: 'to', type: 'address' },
        { name: 'data', type: 'bytes' },
        { name: 'value', type: 'uint256' },
        { name: 'skipRevert', type: 'bool' },
        { name: 'callbackHash', type: 'bytes32' }
      ]
    }],
    [reenterBundle]
  );

  const callbackHash = keccak256(encodedReenterBundle);

  const outerBundle = [
    {
      to: ETHER_GENERAL_ADAPTER_1,
      data: encodeFunctionData({
        abi: ADAPTER_ABI,
        functionName: 'morphoFlashLoan',
        args: [USDC, 900n * 10n**6n, encodedReenterBundle]
      }),
      value: 0n,
      skipRevert: false,
      callbackHash: callbackHash
    }
  ];

  // 5. Send transaction as the impersonated user
  console.log("Submitting transaction to local fork...");
  try {
    const txHash = await testClient.sendTransaction({
      account: TARGET_USER,
      to: MORPHO_BUNDLER_V3,
      data: encodeFunctionData({
        abi: [{
          name: 'multicall',
          type: 'function',
          stateMutability: 'payable',
          inputs: [{
            name: 'bundle',
            type: 'tuple[]',
            components: [
              { name: 'to', type: 'address' },
              { name: 'data', type: 'bytes' },
              { name: 'value', type: 'uint256' },
              { name: 'skipRevert', type: 'bool' },
              { name: 'callbackHash', type: 'bytes32' }
            ]
          }],
          outputs: []
        }],
        functionName: 'multicall',
        args: [outerBundle]
      }),
      gas: 2000000n,
    });

    console.log(`Transaction submitted! Hash: ${txHash}`);
    
    // Fetch transaction receipt to check success
    const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
    console.log(`Transaction status: ${receipt.status === 'success' ? 'SUCCESS ✅' : 'REVERTED ❌'}`);
    
  } catch (error) {
    console.error("Simulation transaction failed:", error);
  }

  // Disable account impersonation
  await testClient.stopImpersonatingAccount({
    address: TARGET_USER,
  });
}

runSimulation();
```

---

## 4. Verification Plan

### Manual Verification
1. Start the Anvil fork locally.
2. Run the newly created simulation script:
   ```bash
   node tests/simulate_mainnet_fork.mjs
   ```
3. Observe the outputs and ensure the transaction receipt status logs `SUCCESS ✅`.
