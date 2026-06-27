import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { getAddress, encodeFunctionData } from 'viem';
import { BlockchainClient } from '../cli/blockchain-client.js';
import { findUniswapV3Pool, ERC20_ABI } from '../builders.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('Running JSDOM live transaction simulation integration tests...');

// 1. Fetch Alchemy API Key
let apiKey = process.env.ALCHEMY_API_KEY;
if (!apiKey) {
  try {
    let envPath = path.resolve('.env');
    if (!fs.existsSync(envPath)) {
      envPath = path.resolve(__dirname, '../.env');
    }
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/ALCHEMY_API_KEY\s*=\s*(.*)/);
    if (match) {
      apiKey = match[1].trim();
    }
  } catch (err) {
    console.error('Could not read .env file:', err.message);
  }
}

if (!apiKey) {
  console.error('Error: ALCHEMY_API_KEY is not defined in process.env or .env file.');
  process.exit(1);
}

const ALCHEMY_RPC_URL = `https://eth-mainnet.g.alchemy.com/v2/${apiKey}`;

// 2. Load HTML layout
const htmlPath = path.resolve(__dirname, '../index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// 3. Initialize JSDOM
const virtualConsole = new VirtualConsole();
virtualConsole.on("log", (...args) => console.log(...args));
virtualConsole.on("info", (...args) => console.info(...args));
virtualConsole.on("warn", (...args) => console.warn(...args));
virtualConsole.on("error", (...args) => console.error(...args));

const dom = new JSDOM(html, {
  url: 'http://localhost',
  virtualConsole
});

global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.window.fetch = global.fetch; // map fetch to Node fetch

// 4. Mock window.ethereum to act as a custom forwarding provider connected to Alchemy RPC
const TEST_USER_ADDRESS = '0xF0A6e66B4396a70eE0620064da847821BeE70731';

global.window.ethereum = {
  request: async (requestObj) => {
    if (requestObj.method === 'eth_requestAccounts' || requestObj.method === 'eth_accounts') {
      return [TEST_USER_ADDRESS];
    }
    if (requestObj.method === 'eth_sendTransaction') {
      throw new Error("eth_sendTransaction is disabled in simulation tests.");
    }
    // Forward to Alchemy RPC
    try {
      const response = await fetch(ALCHEMY_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: requestObj.method,
          params: requestObj.params || []
        })
      });
      const resData = await response.json();
      if (resData.error) {
        throw new Error(resData.error.message || JSON.stringify(resData.error));
      }
      return resData.result;
    } catch (err) {
      console.error(`Forwarding RPC error for ${requestObj.method}:`, err.message);
      throw err;
    }
  }
};

// Helper function to call eth_simulateV1 on Alchemy RPC
async function simulateTransaction(txPayload, prependCalls = []) {
  const calls = [];
  if (prependCalls && prependCalls.length > 0) {
    calls.push(...prependCalls);
  }
  calls.push({
    from: TEST_USER_ADDRESS,
    to: txPayload.to,
    value: txPayload.value ? `0x${txPayload.value.toString(16)}` : '0x0',
    data: txPayload.data
  });

  const payload = {
    id: 1,
    jsonrpc: "2.0",
    method: "eth_simulateV1",
    params: [
      {
        blockStateCalls: [
          {
            calls
          }
        ]
      },
      "latest"
    ]
  };

  const response = await fetch(ALCHEMY_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (data.error) {
    throw new Error(`Simulation API error: ${JSON.stringify(data.error)}`);
  }
  const result = data.result[0];
  if (result.status === '0x0' || !result.status) {
    console.error("Simulation failed! Raw result:", JSON.stringify(result, null, 2));
  }
  return result;
}

async function getPrependRepayCalls() {
  const blockchainClient = new BlockchainClient(ALCHEMY_RPC_URL, null);
  const marketIdNew = '0xb37c30f34bff11c81ee8400133965f450a5f7c5d81ba2cf5740076f49eabc95c';
  
  const targetPosition = await blockchainClient.fetchMorphoPosition(marketIdNew, TEST_USER_ADDRESS);
  const prependCalls = [];
  
  if (targetPosition.debt > 0n) {
    console.log(`[Test Prep] User has target market debt of ${targetPosition.debt.toString()} wei. Generating pre-repayment calls to prevent LTV reverts.`);
    const newMarketParams = await blockchainClient.fetchMarketParams(marketIdNew);
    const destLoanToken = newMarketParams.loanToken;
    
    const targetRepayWhale = await findUniswapV3Pool(blockchainClient.publicClient, destLoanToken, getAddress);
    if (targetRepayWhale) {
      prependCalls.push({
        from: targetRepayWhale,
        to: destLoanToken,
        value: '0x0',
        data: encodeFunctionData({
          abi: [{
            "inputs": [
              { "name": "recipient", "type": "address" },
              { "name": "amount", "type": "uint256" }
            ],
            "name": "transfer",
            "outputs": [{ "name": "", "type": "bool" }],
            "stateMutability": "nonpayable",
            "type": "function"
          }],
          functionName: 'transfer',
          args: [TEST_USER_ADDRESS, targetPosition.debt]
        })
      });

      prependCalls.push({
        from: TEST_USER_ADDRESS,
        to: destLoanToken,
        value: '0x0',
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'approve',
          args: ['0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb', targetPosition.debt]
        })
      });

      prependCalls.push({
        from: TEST_USER_ADDRESS,
        to: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb',
        value: '0x0',
        data: encodeFunctionData({
          abi: [
            {
              "inputs": [
                {
                  "components": [
                    { "name": "loanToken", "type": "address" },
                    { "name": "collateralToken", "type": "address" },
                    { "name": "oracle", "type": "address" },
                    { "name": "irm", "type": "address" },
                    { "name": "lltv", "type": "uint256" }
                  ],
                  "name": "marketParams",
                  "type": "tuple"
                },
                { "name": "assets", "type": "uint256" },
                { "name": "shares", "type": "uint256" },
                { "name": "onBehalf", "type": "address" },
                { "name": "data", "type": "bytes" }
              ],
              "name": "repay",
              "outputs": [
                { "name": "assetsRepaid", "type": "uint256" },
                { "name": "sharesRepaid", "type": "uint256" }
              ],
              "stateMutability": "nonpayable",
              "type": "function"
            }
          ],
          functionName: 'repay',
          args: [newMarketParams, targetPosition.debt, 0n, TEST_USER_ADDRESS, '0x']
        })
      });
    }
  }

  // Prepend standard ERC20 and Permit2 approvals for the old and new loan tokens to ETHER_GENERAL_ADAPTER_1
  const oldMarketId = document.getElementById('oldMarketId').value;
  const newMarketId = document.getElementById('newMarketId').value;
  
  const [oldMarketParams, newMarketParams] = await Promise.all([
    blockchainClient.fetchMarketParams(oldMarketId),
    blockchainClient.fetchMarketParams(newMarketId)
  ]);

  const tokensToApprove = [oldMarketParams.loanToken, newMarketParams.loanToken];
  const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
  const ADAPTER_ADDRESS = '0x4A6c312ec70E8747a587EE860a0353cd42Be0aE0';
  
  for (const token of tokensToApprove) {
    // 1. ERC20 approve Permit2
    prependCalls.push({
      from: TEST_USER_ADDRESS,
      to: token,
      value: '0x0',
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [PERMIT2_ADDRESS, 2n ** 256n - 1n]
      })
    });
    
    // 2. Permit2 approve Adapter
    prependCalls.push({
      from: TEST_USER_ADDRESS,
      to: PERMIT2_ADDRESS,
      value: '0x0',
      data: encodeFunctionData({
        abi: [{
          "inputs": [
            { "name": "token", "type": "address" },
            { "name": "spender", "type": "address" },
            { "name": "amount", "type": "uint160" },
            { "name": "expiration", "type": "uint48" }
          ],
          "name": "approve",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        }],
        functionName: 'approve',
        args: [token, ADAPTER_ADDRESS, 2n ** 160n - 1n, 2 ** 32 - 1]
      })
    });
  }

  return prependCalls;
}

// 5. Preprocess app.js and write shadow file
const appPath = path.resolve(__dirname, '../app.js');
let appCode = fs.readFileSync(appPath, 'utf8');

// Replace CDN imports with standard Node package imports
appCode = appCode.replace(/from\s+['"]https:\/\/esm\.sh\/viem['"]/g, "from 'viem'");
appCode = appCode.replace(/from\s+['"]https:\/\/esm\.sh\/viem\/chains['"]/g, "from 'viem/chains'");
appCode = appCode.replace(/from\s+['"]\.\/math\.js['"]/g, "from '../math.js'");
appCode = appCode.replace(/from\s+['"]\.\/labels\.js['"]/g, "from '../labels.js'");
appCode = appCode.replace(/from\s+['"]\.\/builders\.js['"]/g, "from '../builders.js'");

const shadowPath = path.resolve(__dirname, './simulation.shadow.mjs');
fs.writeFileSync(shadowPath, appCode, 'utf8');

try {
  // Import app code to bind events
  const appModule = await import('./simulation.shadow.mjs');
  await new Promise(resolve => setTimeout(resolve, 100)); // wait for initial render

  const loadPositionBtn = document.getElementById('loadPositionBtn');
  const migrateBtn = document.getElementById('migrateBtn');
  const debtAmountInput = document.getElementById('debtAmount');
  const collateralAmountInput = document.getElementById('collateralAmount');
  
  const levLoadBtn = document.getElementById('levLoadBtn');
  const levExecuteBtn = document.getElementById('levExecuteBtn');
  const levSlider = document.getElementById('levSlider');
  const statusEl = document.getElementById('status');

  // --- Step 1: Load Live Position ---
  console.log("Loading live position from mainnet for user:", TEST_USER_ADDRESS);
  loadPositionBtn.click();
  
  // Wait for position to load (this will perform real RPC queries via our mock ethereum provider)
  let retries = 20;
  while (retries > 0 && (!debtAmountInput.value || parseFloat(debtAmountInput.value) === 6195.88)) {
    await new Promise(resolve => setTimeout(resolve, 250));
    retries--;
  }

  const liveDebt = parseFloat(debtAmountInput.value);
  const liveCollateral = parseFloat(collateralAmountInput.value);
  console.log(`Loaded position successfully: Debt = ${liveDebt} USDC, Collateral = ${liveCollateral} PT`);
  
  assert.ok(liveDebt > 0, "Live debt should be loaded from mainnet (> 0)");
  assert.ok(liveCollateral > 0, "Live collateral should be loaded from mainnet (> 0)");

  // Keep reference of loaded live position details for leverage tab testing
  const savedDebt = liveDebt;
  const savedCollateral = liveCollateral;

  // --- Test 1: Full Migration Simulation ---
  console.log("\n--- Simulating Full Migration Flow ---");
  // Set full migration
  document.getElementById('toggleFull').click();
  // Set to full values
  debtAmountInput.value = liveDebt.toString();
  collateralAmountInput.value = liveCollateral.toString();
  
  migrateBtn.click();
  
  // Wait for calldata to populate
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  let calldata = document.getElementById('rawCalldataTextarea').value;
  if (!calldata) {
    console.error("DEBUG: statusEl class =", statusEl.className);
    console.error("DEBUG: statusEl text =", statusEl.innerText);
  }
  assert.ok(calldata, "Calldata should be populated in textarea");
  
  let txPayload = { to: '0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245', data: calldata, value: 0n };
  
  console.log("Calldata generated for Full Migration. Simulating on mainnet fork...");
  const prependCalls = await getPrependRepayCalls();
  let simResult = await simulateTransaction(txPayload, prependCalls);
  console.log("Full Migration simulation status:", simResult.status || simResult.calls?.[0]?.status, "Gas Used:", simResult.gasUsed);
  assert.ok(simResult.status === '0x1' || simResult.calls?.every(c => c.status === '0x1'), "Full Migration simulation failed");

  // --- Test 2: Partial Migration Simulation (50% of position) ---
  console.log("\n--- Simulating Partial Migration Flow (50% of position) ---");
  document.getElementById('togglePartial').click();
  
  const partialDebt = (liveDebt * 0.5).toFixed(2);
  const partialCollateral = (liveCollateral * 0.5).toFixed(4);
  console.log(`Setting partial values: Debt = ${partialDebt} USDC, Collateral = ${partialCollateral} PT`);
  
  debtAmountInput.value = partialDebt;
  debtAmountInput.dispatchEvent(new window.Event('input'));
  await new Promise(resolve => setTimeout(resolve, 200));

  migrateBtn.click();
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  calldata = document.getElementById('rawCalldataTextarea').value;
  assert.ok(calldata, "Calldata should be populated in textarea for partial migration");
  txPayload = { to: '0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245', data: calldata, value: 0n };

  console.log("Calldata generated for Partial Migration. Simulating on mainnet fork...");
  simResult = await simulateTransaction(txPayload, prependCalls);
  console.log("Partial Migration simulation status:", simResult.status || simResult.calls?.[0]?.status, "Gas Used:", simResult.gasUsed);
  assert.ok(simResult.status === '0x1' || simResult.calls?.every(c => c.status === '0x1'), "Partial Migration simulation failed");

  console.log("\nAll live migration transaction simulation integration tests passed successfully!");
} finally {
  if (fs.existsSync(shadowPath)) {
    fs.unlinkSync(shadowPath);
  }
}
