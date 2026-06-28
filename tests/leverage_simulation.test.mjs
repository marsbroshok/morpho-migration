import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { encodeFunctionData, createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import config from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('Running JSDOM live transaction leverage simulation integration tests...');

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
const originalFetch = global.fetch;
global.fetch = async (url, options) => {
  const urlStr = typeof url === 'string' ? url : url.toString();
  if (urlStr.endsWith('config.json')) {
    const configPath = path.resolve(__dirname, '../config.json');
    return new Response(fs.readFileSync(configPath, 'utf8'), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  return originalFetch(url, options);
};
global.window.fetch = global.fetch; // map fetch to Node fetch

// Mock localStorage
const storage = {
  morpho_migration_rpc_url: ALCHEMY_RPC_URL,
  morpho_migration_alchemy_key: apiKey,
  morpho_migration_auto_simulate: 'true'
};
const mockLocalStorage = {
  getItem: (key) => storage[key] || null,
  setItem: (key, val) => { storage[key] = val; },
  removeItem: (key) => { delete storage[key]; },
  clear: () => { Object.keys(storage).forEach(k => delete storage[k]); }
};
Object.defineProperty(dom.window, 'localStorage', {
  value: mockLocalStorage,
  writable: true
});
global.localStorage = mockLocalStorage;

// Constants & mutable test state
let TEST_USER_ADDRESS = '0xF0A6e66B4396a70eE0620064da847821BeE70731'; // Old market user (for deleveraging)
const MORPHO_BLUE = config.MORPHO_BLUE;
const BUNDLER_ADDRESS = config.MORPHO_BUNDLER_V3;
const ADAPTER_ADDRESS = config.ETHER_GENERAL_ADAPTER_1;
const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0CE3606eB48';
const PT_ADDRESS_OLD = '0x3365554a61CeFF74A76528f9e86C1E87946d16a5';
const PT_ADDRESS_NEW = '0xb5Be35D8fF83D431899b95851CB17a2B4bcEF150';

// 4. Mock window.ethereum to act as a custom forwarding provider connected to Alchemy RPC
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
      let params = requestObj.params ? [...requestObj.params] : [];
      if (process.env.FORK_BLOCK_NUMBER) {
        const forkBlockHex = `0x${BigInt(process.env.FORK_BLOCK_NUMBER).toString(16)}`;
        if (['eth_call', 'eth_getBalance', 'eth_getTransactionCount', 'eth_getCode'].includes(requestObj.method)) {
          if (!params[1] || params[1] === 'latest') {
            params[1] = forkBlockHex;
          }
        } else if (requestObj.method === 'eth_getStorageAt') {
          if (!params[2] || params[2] === 'latest') {
            params[2] = forkBlockHex;
          }
        }
      }

      const response = await fetch(ALCHEMY_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: requestObj.method,
          params
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

const client = createPublicClient({
  chain: mainnet,
  transport: http(ALCHEMY_RPC_URL)
});

let mainCallIndex = 0;

// Helper function to call eth_simulateV1 on Alchemy RPC
async function simulateTransaction(txPayload) {
  // Fetch authorization statuses first
  const isAdapterAuth = await client.readContract({
    address: MORPHO_BLUE,
    abi: [{"inputs":[{"name":"authorizer","type":"address"},{"name":"delegatee","type":"address"}],"name":"isAuthorized","outputs":[{"name":"","type":"bool"}],"stateMutability":"view","type":"function"}],
    functionName: 'isAuthorized',
    args: [TEST_USER_ADDRESS, ADAPTER_ADDRESS]
  });

  const isBundlerAuth = await client.readContract({
    address: MORPHO_BLUE,
    abi: [{"inputs":[{"name":"authorizer","type":"address"},{"name":"delegatee","type":"address"}],"name":"isAuthorized","outputs":[{"name":"","type":"bool"}],"stateMutability":"view","type":"function"}],
    functionName: 'isAuthorized',
    args: [TEST_USER_ADDRESS, BUNDLER_ADDRESS]
  });

  const setAuthAdapterData = encodeFunctionData({
    abi: [{"inputs":[{"name":"authorized","type":"address"},{"name":"newIsAuthorized","type":"bool"}],"name":"setAuthorization","outputs":[],"stateMutability":"nonpayable","type":"function"}],
    functionName: 'setAuthorization',
    args: [ADAPTER_ADDRESS, true]
  });

  const setAuthBundlerData = encodeFunctionData({
    abi: [{"inputs":[{"name":"authorized","type":"address"},{"name":"newIsAuthorized","type":"bool"}],"name":"setAuthorization","outputs":[],"stateMutability":"nonpayable","type":"function"}],
    functionName: 'setAuthorization',
    args: [BUNDLER_ADDRESS, true]
  });

  const calls = [];
  if (!isAdapterAuth) {
    console.log("Adapter is not authorized. Prepending setAuthorization call...");
    calls.push({
      from: TEST_USER_ADDRESS,
      to: MORPHO_BLUE,
      value: '0x0',
      data: setAuthAdapterData
    });
  }
  if (!isBundlerAuth) {
    console.log("Bundler is not authorized. Prepending setAuthorization call...");
    calls.push({
      from: TEST_USER_ADDRESS,
      to: MORPHO_BLUE,
      value: '0x0',
      data: setAuthBundlerData
    });
  }

  mainCallIndex = calls.length;

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
            calls: calls
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
  return result;
}

// Helper to recursively collect all logs in the simulation result
function collectAllLogs(simResult) {
  let logs = [];
  if (simResult.calls && Array.isArray(simResult.calls)) {
    for (const call of simResult.calls) {
      if (call.logs && Array.isArray(call.logs)) {
        logs = logs.concat(call.logs);
      }
      if (call.calls && Array.isArray(call.calls)) {
        logs = logs.concat(collectAllLogs(call));
      }
    }
  }
  if (simResult.logs && Array.isArray(simResult.logs)) {
    logs = logs.concat(simResult.logs);
  }
  return logs;
}

// Helper to verify a transfer event log
function findTransferLog(logs, tokenAddress, fromAddress, toAddress) {
  const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  let matchedLogs = [];
  for (const log of logs) {
    if (log.topics[0] === TRANSFER_TOPIC && log.topics.length >= 3) {
      const token = log.address.toLowerCase();
      const from = ('0x' + log.topics[1].slice(26)).toLowerCase();
      const to = ('0x' + log.topics[2].slice(26)).toLowerCase();
      const value = BigInt(log.data === '0x' ? '0' : log.data);
      
      if (token === tokenAddress.toLowerCase() && 
          (!fromAddress || from === fromAddress.toLowerCase()) && 
          (!toAddress || to === toAddress.toLowerCase())) {
        matchedLogs.push({ from, to, value });
      }
    }
  }
  return matchedLogs;
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
appCode = appCode.replace(/from\s+['"]\.\/config\.js['"]/g, "from '../config.js'");

const shadowPath = path.resolve(__dirname, './leverage_simulation.shadow.mjs');
fs.writeFileSync(shadowPath, appCode, 'utf8');

try {
  // Import shadow app code
  const appModule = await import('./leverage_simulation.shadow.mjs');
  await new Promise(resolve => setTimeout(resolve, 200)); // wait for initial render

  const levLoadBtn = document.getElementById('levLoadBtn');
  const levExecuteBtn = document.getElementById('levExecuteBtn');
  const levSlider = document.getElementById('levSlider');
  const statusEl = document.getElementById('status');

  // --- Switch to Tab 2 (Adjust Leverage) ---
  console.log("Switching to Adjust Leverage Tab...");
  document.getElementById('tabHeaderLeverage').click();
  await new Promise(resolve => setTimeout(resolve, 200));

  // --- Step 1: Load Live Leverage Position (Old Market) ---
  console.log("Loading live leverage position from mainnet for user:", TEST_USER_ADDRESS);
  document.getElementById('levUserAddress').value = TEST_USER_ADDRESS;
  levLoadBtn.click();
  
  // Wait for position to load
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  let levPositionInfo = document.getElementById('levPositionInfo').innerHTML;
  console.log("Loaded leverage position info:", levPositionInfo.replace(/<[^>]*>/g, ' ').trim());
  assert.ok(levPositionInfo.includes("Active Position Found"), "Leverage position should be loaded");

  // --- Step 2: Simulate Deleveraging Flow (Target Leverage 2.0x) ---
  console.log("\n--- Simulating Deleveraging Flow (Target: 2.00x) ---");
  levSlider.value = "2.00";
  levSlider.dispatchEvent(new window.Event('input'));
  await new Promise(resolve => setTimeout(resolve, 500));

  console.log("Generating deleveraging transaction bundle...");
  levExecuteBtn.click();
  
  // Wait for calldata generation (Pendle route lookup and bundle construction)
  await new Promise(resolve => setTimeout(resolve, 5000));

  let calldata = document.getElementById('rawCalldataTextarea').value;
  if (!calldata) {
    console.error("Status Element Text on Failure:", document.getElementById('status').innerText);
  }
  assert.ok(calldata, "Deleveraging calldata should be generated");

  let txPayload = { to: BUNDLER_ADDRESS, data: calldata, value: 0n };
  console.log("Simulating deleveraging transaction via Alchemy eth_simulateV1...");
  let simResult = await simulateTransaction(txPayload);

  // Check status of the main call
  const delevMainCallResult = simResult.calls[mainCallIndex];
  console.log("Deleveraging main call execution status:", delevMainCallResult.status, "Gas Used:", delevMainCallResult.gasUsed);
  if (delevMainCallResult.status === '0x0') {
    console.error("Main call error details:", JSON.stringify(delevMainCallResult.error));
  }
  assert.ok(delevMainCallResult.status === '0x1', "Deleveraging simulation main call failed or reverted");

  // Collect and analyze logs from the main call specifically
  const delevLogs = collectAllLogs(delevMainCallResult);
  
  // Find PT transfer from Morpho Bundler to Pendle Router/Pool (deleveraging swaps PT to USDC)
  const ptTransfers = findTransferLog(delevLogs, PT_ADDRESS_OLD, BUNDLER_ADDRESS, null);
  console.log(`Deleveraging PT transfers found: ${ptTransfers.length}`);
  assert.ok(ptTransfers.length > 0, "No PT transfers found from Bundler during deleveraging");
  ptTransfers.forEach((tx, idx) => console.log(`  [PT Transfer ${idx + 1}] to ${tx.to}, amount: ${(Number(tx.value) / 1e18).toFixed(4)} PT`));

  // Find USDC transfer to General Adapter (swapped USDC received in Adapter to pay back debt)
  const usdcTransfers = findTransferLog(delevLogs, USDC_ADDRESS, null, ADAPTER_ADDRESS);
  console.log(`Deleveraging USDC transfers to Adapter found: ${usdcTransfers.length}`);
  assert.ok(usdcTransfers.length > 0, "No USDC transfers to Adapter found during deleveraging");
  usdcTransfers.forEach((tx, idx) => console.log(`  [USDC Transfer ${idx + 1}] from ${tx.from}, amount: ${(Number(tx.value) / 1e6).toFixed(2)} USDC`));


  // --- Step 3: Switch User & Market to Simulate Leveraging Up on active PT market ---
  TEST_USER_ADDRESS = '0x03aAA2081d2dCaB61AE20BeDAfACf2A5E44BBbE6'; // New Market user with active position
  const newMarketId = '0xb37c30f34bff11c81ee8400133965f450a5f7c5d81ba2cf5740076f49eabc95c'; // New Market ID
  
  console.log("\nSwitching to New Market for Leveraging-up simulation...");
  console.log(`New User Address: ${TEST_USER_ADDRESS}`);
  console.log(`New Market ID: ${newMarketId}`);

  document.getElementById('levMarketId').value = newMarketId;
  document.getElementById('levCollateralAddress').value = PT_ADDRESS_NEW;
  
  // Dispatch input events to trigger UI label changes
  document.getElementById('levMarketId').dispatchEvent(new window.Event('input'));
  document.getElementById('levCollateralAddress').dispatchEvent(new window.Event('input'));
  await new Promise(resolve => setTimeout(resolve, 500));

  console.log("Loading live position in new market...");
  document.getElementById('levUserAddress').value = TEST_USER_ADDRESS;
  levLoadBtn.click();
  await new Promise(resolve => setTimeout(resolve, 5000));

  levPositionInfo = document.getElementById('levPositionInfo').innerHTML;
  console.log("Loaded new leverage position info:", levPositionInfo.replace(/<[^>]*>/g, ' ').trim());
  assert.ok(levPositionInfo.includes("Active Position Found"), "New leverage position should be loaded");

  // --- Step 4: Simulate Leveraging Up Flow (Target Leverage 3.00x) ---
  console.log("\n--- Simulating Leveraging Up Flow (Target: 3.00x) ---");
  levSlider.value = "3.00";
  levSlider.dispatchEvent(new window.Event('input'));
  await new Promise(resolve => setTimeout(resolve, 500));

  console.log("Generating leveraging-up transaction bundle...");
  levExecuteBtn.click();

  // Wait for calldata generation (Pendle route lookup and bundle construction)
  await new Promise(resolve => setTimeout(resolve, 5000));

  console.log("Leveraging-up status class:", statusEl.className, "text:", statusEl.innerText);
  calldata = document.getElementById('rawCalldataTextarea').value;
  assert.ok(calldata, "Leveraging-up calldata should be generated");

  txPayload = { to: BUNDLER_ADDRESS, data: calldata, value: 0n };
  console.log("Simulating leveraging-up transaction via Alchemy eth_simulateV1...");
  simResult = await simulateTransaction(txPayload);

  // Check status of the main call
  const levUpMainCallResult = simResult.calls[mainCallIndex];
  console.log("Leveraging-up main call execution status:", levUpMainCallResult.status, "Gas Used:", levUpMainCallResult.gasUsed);
  if (levUpMainCallResult.status === '0x0') {
    console.error("Main call error details:", JSON.stringify(levUpMainCallResult.error));
    console.error("Leveraging-up simulation calls:", JSON.stringify(simResult.calls, null, 2));
  }
  assert.ok(levUpMainCallResult.status === '0x1', "Leveraging-up simulation main call failed or reverted");

  // Collect and analyze logs
  const levUpLogs = collectAllLogs(levUpMainCallResult);

  console.log("Debug: All Transfer events in levUpLogs:");
  levUpLogs.forEach(log => {
    if (log.topics[0] === "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" && log.topics.length >= 3) {
      const token = log.address;
      const from = '0x' + log.topics[1].slice(26);
      const to = '0x' + log.topics[2].slice(26);
      const value = BigInt(log.data === '0x' ? '0' : log.data);
      console.log(`  Token: ${token}, From: ${from}, To: ${to}, Value: ${value}`);
    }
  });

  // Find USDC transfer from Adapter to Morpho Bundler V3 (borrowed USDC routed to Bundler to swap for PT)
  const usdcUpTransfers = findTransferLog(levUpLogs, USDC_ADDRESS, ADAPTER_ADDRESS, BUNDLER_ADDRESS);
  console.log(`Leveraging-up USDC transfers from Adapter to Bundler found: ${usdcUpTransfers.length}`);
  assert.ok(usdcUpTransfers.length > 0, "No USDC transfers from Adapter to Bundler found during leveraging-up");
  usdcUpTransfers.forEach((tx, idx) => console.log(`  [USDC Transfer ${idx + 1}] amount: ${(Number(tx.value) / 1e6).toFixed(2)} USDC`));

  // Find PT transfer to Adapter/Morpho Blue (bought PT supplied to user's position)
  const ptUpTransfers = findTransferLog(levUpLogs, PT_ADDRESS_NEW, null, ADAPTER_ADDRESS);
  console.log(`Leveraging-up PT transfers to Adapter found: ${ptUpTransfers.length}`);
  assert.ok(ptUpTransfers.length > 0, "No PT transfers to Adapter found during leveraging-up");
  ptUpTransfers.forEach((tx, idx) => console.log(`  [PT Transfer ${idx + 1}] from ${tx.from}, amount: ${(Number(tx.value) / 1e18).toFixed(4)} PT`));

  console.log("\nAll leverage & deleverage simulation checks passed successfully!");

} finally {
  if (fs.existsSync(shadowPath)) {
    fs.unlinkSync(shadowPath);
  }
}
