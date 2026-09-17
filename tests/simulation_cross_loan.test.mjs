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

console.log('Running JSDOM live cross-loan transaction simulation integration tests...');

// 1. Pin block number before creating clients!
process.env.FORK_BLOCK_NUMBER = "25411200";
console.log(`Pinning mainnet fork block number to: ${process.env.FORK_BLOCK_NUMBER}`);

// 2. Fetch Alchemy API Key
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
const blockchainClient = new BlockchainClient({ transportUrl: ALCHEMY_RPC_URL });

async function buildPrependCalls() {
  const prependCalls = [];
  
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

// 3. Load HTML layout
const htmlPath = path.resolve(__dirname, '../index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// 4. Initialize JSDOM
const virtualConsole = new VirtualConsole();
virtualConsole.on("log", (...args) => console.log(...args));
virtualConsole.on("info", (...args) => console.info(...args));
virtualConsole.on("warn", (...args) => console.warn(...args));
virtualConsole.on("error", (...args) => console.error(...args));

const dom = new JSDOM(html, {
  url: 'http://localhost',
  virtualConsole
});

// Mock localStorage
const storage = {};
Object.defineProperty(dom.window, 'localStorage', {
  value: {
    getItem: (key) => storage[key] || null,
    setItem: (key, value) => { storage[key] = value.toString(); },
    removeItem: (key) => { delete storage[key]; },
    clear: () => { for (const key in storage) delete storage[key]; }
  },
  writable: true,
  configurable: true
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

// Mock window.ethereum to act as a custom forwarding provider connected to Alchemy RPC
const TEST_USER_ADDRESS = '0xE14f5DAab7E7fF2527F3B3cE582033e4A1Df8D0a';

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

// Helper function to call eth_simulateV1 on Alchemy RPC
async function simulateTransaction(txPayload, prependCalls = [], tokensToCheck = []) {
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

  const BUNDLER_ADDRESS = '0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245';
  const ADAPTER_ADDRESS = '0x4A6c312ec70E8747a587EE860a0353cd42Be0aE0';
  const ERC20_BALANCE_OF_ABI = [{
    "inputs": [{ "name": "account", "type": "address" }],
    "name": "balanceOf",
    "outputs": [{ "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  }];

  for (const token of tokensToCheck) {
    // Check Adapter balance
    calls.push({
      from: TEST_USER_ADDRESS,
      to: getAddress(token),
      value: '0x0',
      data: encodeFunctionData({
        abi: ERC20_BALANCE_OF_ABI,
        functionName: 'balanceOf',
        args: [ADAPTER_ADDRESS]
      })
    });
    // Check Bundler balance
    calls.push({
      from: TEST_USER_ADDRESS,
      to: getAddress(token),
      value: '0x0',
      data: encodeFunctionData({
        abi: ERC20_BALANCE_OF_ABI,
        functionName: 'balanceOf',
        args: [BUNDLER_ADDRESS]
      })
    });
  }

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

// Preprocess app.js and write shadow file
const appPath = path.resolve(__dirname, '../app.js');
let appCode = fs.readFileSync(appPath, 'utf8');

// Replace CDN imports with standard Node package imports
appCode = appCode.replace(/from\s+['"]https:\/\/esm\.sh\/viem['"]/g, "from 'viem'");
appCode = appCode.replace(/from\s+['"]https:\/\/esm\.sh\/viem\/chains['"]/g, "from 'viem/chains'");
appCode = appCode.replace(/from\s+['"]\.\/math\.js['"]/g, "from '../math.js'");
appCode = appCode.replace(/from\s+['"]\.\/labels\.js['"]/g, "from '../labels.js'");
appCode = appCode.replace(/from\s+['"]\.\/builders\.js['"]/g, "from '../builders.js'");
appCode = appCode.replace(/from\s+['"]\.\/config\.js['"]/g, "from '../config.js'");

const shadowPath = path.resolve(__dirname, './simulation_cross_loan.shadow.mjs');
fs.writeFileSync(shadowPath, appCode, 'utf8');

try {
  // Import app code to bind events
  const appModule = await import('./simulation_cross_loan.shadow.mjs');
  await new Promise(resolve => setTimeout(resolve, 2500)); // wait for initial render and queries to finish

  const loadPositionBtn = document.getElementById('loadPositionBtn');
  const migrateBtn = document.getElementById('migrateBtn');
  const oldMarketIdInput = document.getElementById('oldMarketId');
  const newMarketIdInput = document.getElementById('newMarketId');
  const debtAmountInput = document.getElementById('debtAmount');
  const collateralAmountInput = document.getElementById('collateralAmount');
  const statusEl = document.getElementById('status');

  // Set settings inputs for simulation RPC calls inside app.js
  document.getElementById('settingsAlchemyKey').value = apiKey;

  // Set cross-loan market inputs
  oldMarketIdInput.value = '0x9c28c8fa039a8df548a7f27adf062d751b0f2e9b9131931810535543adb23291';
  newMarketIdInput.value = '0xe23380494e365453f72f736f2d941959ae945773eb67a06cf4f538c7c4201264';
  
  // Trigger input event to load market details
  oldMarketIdInput.dispatchEvent(new window.Event('input'));
  newMarketIdInput.dispatchEvent(new window.Event('input'));
  await new Promise(resolve => setTimeout(resolve, 2000));

  // --- Step 1: Load Live Position ---
  console.log("Loading live cross-loan position from mainnet for user:", TEST_USER_ADDRESS);
  loadPositionBtn.click();
  
  // Wait for position to load
  let retries = 20;
  while (retries > 0 && (!debtAmountInput.value || parseFloat(debtAmountInput.value) === 6195.88)) {
    await new Promise(resolve => setTimeout(resolve, 250));
    retries--;
  }

  const liveDebt = parseFloat(debtAmountInput.value);
  const liveCollateral = parseFloat(collateralAmountInput.value);
  console.log(`Loaded position successfully: Debt = ${liveDebt} USDC, Collateral = ${liveCollateral} apyUSD`);
  
  assert.ok(liveDebt > 0, "Live debt should be loaded from mainnet (> 0)");
  assert.ok(liveCollateral > 0, "Live collateral should be loaded from mainnet (> 0)");

  // --- Test 1: Full Migration Simulation ---
  console.log("\n--- Simulating Full Cross-Loan Migration Flow ---");
  // Set full migration
  document.getElementById('toggleFull').click();
  // Set to full values
  debtAmountInput.value = liveDebt.toString();
  collateralAmountInput.value = liveCollateral.toString();
  
  console.log("DEBUG TEST: oldCollateralAddress =", document.getElementById('oldCollateralAddress').value);
  console.log("DEBUG TEST: newCollateralAddress =", document.getElementById('newCollateralAddress').value);
  
  migrateBtn.click();
  
  // Wait for calldata to populate (including the two-phase simulation runs!)
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  let calldata = document.getElementById('rawCalldataTextarea').value;
  if (!calldata) {
    console.error("DEBUG: statusEl class =", statusEl.className);
    console.error("DEBUG: statusEl text =", statusEl.innerText);
  }
  assert.ok(calldata, "Calldata should be populated in textarea");
  
  let txPayload = { to: '0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245', data: calldata, value: 0n };
  
  console.log("Calldata generated for Cross-Loan Migration. Simulating on mainnet fork...");
  
  // Retrieve USDC and apxUSD addresses to verify 0 contract leak
  const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0CE3606eB48';
  const APXUSD_ADDRESS = '0x98A878b1Cd98131B271883b390f68D2c90674665';

  const prependCalls = await buildPrependCalls();
  const simResult = await simulateTransaction(txPayload, prependCalls, [USDC_ADDRESS, APXUSD_ADDRESS]);
  
  const mainCall = simResult.calls[simResult.calls.length - 5]; // main call index is length - 2 * tokens - 1
  console.log("Full Cross-Loan Migration simulation status:", mainCall.status, "Gas Used:", mainCall.gasUsed);
  if (mainCall.status !== '0x1') {
    console.error("Sub-calls of main call:");
    console.error(JSON.stringify(mainCall.calls, null, 2));
  }
  assert.strictEqual(mainCall.status, '0x1', "Full Cross-Loan Migration simulation failed/reverted");

  // Verify USDC balance checks
  const adapterUsdcBal = BigInt(simResult.calls[simResult.calls.length - 4].returnData);
  const bundlerUsdcBal = BigInt(simResult.calls[simResult.calls.length - 3].returnData);
  console.log(`[Adapter USDC Leak]: ${adapterUsdcBal.toString()} wei`);
  console.log(`[Bundler USDC Leak]: ${bundlerUsdcBal.toString()} wei`);
  assert.strictEqual(adapterUsdcBal, 0n, "USDC leaked on General Adapter!");
  assert.strictEqual(bundlerUsdcBal, 0n, "USDC leaked on Morpho Bundler!");

  // Verify apxUSD balance checks
  const adapterApxBal = BigInt(simResult.calls[simResult.calls.length - 2].returnData);
  const bundlerApxBal = BigInt(simResult.calls[simResult.calls.length - 1].returnData);
  console.log(`[Adapter apxUSD Leak]: ${adapterApxBal.toString()} wei`);
  console.log(`[Bundler apxUSD Leak]: ${bundlerApxBal.toString()} wei`);
  assert.strictEqual(adapterApxBal, 0n, "apxUSD leaked on General Adapter!");
  assert.strictEqual(bundlerApxBal, 0n, "apxUSD leaked on Morpho Bundler!");

  console.log("\nAll live cross-loan migration transaction simulation integration tests passed successfully with 0 contract leaks!");
} finally {
  if (fs.existsSync(shadowPath)) {
    fs.unlinkSync(shadowPath);
  }
}
