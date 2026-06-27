import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { decodeFunctionData, decodeAbiParameters, encodeAbiParameters } from 'viem';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('Running JSDOM pre-transaction workflow & slippage audit tests...');

// 1. Load HTML layout
const htmlPath = path.resolve(__dirname, '../index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// 2. Initialize JSDOM
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

// Mock localStorage
const storage = {
  morpho_migration_rpc_url: 'https://eth-mainnet.g.alchemy.com/v2/mockkey',
  morpho_migration_alchemy_key: 'mockkey',
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

// Mock window.ethereum
global.sendTransactionCalled = false;
global.window.ethereum = {
  request: async (requestObj) => {
    if (requestObj.method === 'eth_requestAccounts' || requestObj.method === 'eth_accounts') {
      return ['0xdC382CDF2a25790F535a518EC26958c227e9DCF2'];
    }
    throw new Error(`Unhandled eth request: ${requestObj.method}`);
  }
};

// Mock fetch
global.fetch = async (url, options) => {
  const urlStr = typeof url === 'string' ? url : url.toString();
  if (urlStr.includes('blue-api.morpho.org/graphql')) {
    const body = JSON.parse(options.body);
    const id = body.variables?.id || "";
    let collateralAddress = '0x3365554a61CeFF74A76528f9e86C1E87946d16a5';
    let collateralSymbol = 'PT-apyUSD-18JUN2026';
    
    if (id && id.toLowerCase().includes('b37c30f34bff11c81ee8400133965f450a5f7c5d81ba2cf5740076f49eabc95c')) {
      collateralAddress = '0xb5Be35D8fF83D431899b95851CB17a2B4bcEF150';
      collateralSymbol = 'PT-apyUSD-5NOV2026';
    }
    
    return {
      ok: true,
      json: async () => ({
        data: {
          markets: {
            items: [
              {
                loanAsset: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0CE3606eB48', symbol: 'USDC', decimals: '6' },
                collateralAsset: { address: collateralAddress, symbol: collateralSymbol, decimals: '18' },
                oracleAddress: '0x0000000000000000000000000000000000000002',
                irmAddress: '0x0000000000000000000000000000000000000003',
                lltv: '860000000000000000'
              }
            ]
          },
          assets: {
            items: [{ symbol: collateralSymbol }]
          }
        }
      })
    };
  }
  if (urlStr.includes('api-v2.pendle.finance')) {
    return {
      ok: true,
      json: async () => ({
        routes: [
          {
            outputs: [{ amount: '8000320000000000000000' }], // 8000.32 PT
            tx: { to: '0x0000000000000000000000000000000000000004', data: '0x00' }
          }
        ]
      })
    };
  }
  if (urlStr.includes('alchemy.com') || urlStr.includes('localhost') || urlStr.includes('127.0.0.1')) {
    const reqBody = JSON.parse(options.body);
    console.log(`[DEBUG fetch mock] Intercepted RPC URL: ${urlStr}, method: ${reqBody.method}`);
    let positionCallCount = 0;
    const mockCalls = reqBody.params[0].blockStateCalls[0].calls.map((c) => {
      // Decode data to see if it is a position call
      let isPosition = false;
      try {
        const decoded = decodeFunctionData({
          abi: [
            {
              "inputs": [
                { "name": "id", "type": "bytes32" },
                { "name": "user", "type": "address" }
              ],
              "name": "position",
              "outputs": [
                { "name": "supplyShares", "type": "uint256" },
                { "name": "borrowShares", "type": "uint128" },
                { "name": "collateral", "type": "uint128" }
              ],
              "stateMutability": "view",
              "type": "function"
            }
          ],
          data: c.data
        });
        if (decoded.functionName === 'position') {
          isPosition = true;
        }
      } catch (e) {}

      if (isPosition) {
        positionCallCount++;
        const collateralVal = (positionCallCount === 2) ? 8000320000000000000000n : 0n;
        const returnData = encodeAbiParameters(
          [
            { name: 'supplyShares', type: 'uint256' },
            { name: 'borrowShares', type: 'uint128' },
            { name: 'collateral', type: 'uint128' }
          ],
          [0n, 0n, collateralVal]
        );
        return { status: "0x1", returnData };
      }
      return {
        status: "0x1",
        returnData: "0x0000000000000000000000000000000000000000000000000000000000000000"
      };
    });
    return {
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        result: [
          {
            calls: mockCalls
          }
        ]
      })
    };
  }
  throw new Error(`Unhandled mock fetch request: ${urlStr}`);
};
global.window.fetch = global.fetch;

// 3. Preprocess app.js and write shadow file
const appPath = path.resolve(__dirname, '../app.js');
let appCode = fs.readFileSync(appPath, 'utf8');

// Replace CDN imports with standard Node package imports
appCode = appCode.replace(/from\s+['"]https:\/\/esm\.sh\/viem['"]/g, "from 'viem'");
appCode = appCode.replace(/from\s+['"]https:\/\/esm\.sh\/viem\/chains['"]/g, "from 'viem/chains'");
appCode = appCode.replace(/from\s+['"]\.\/math\.js['"]/g, "from '../math.js'");
appCode = appCode.replace(/from\s+['"]\.\/labels\.js['"]/g, "from '../labels.js'");
appCode = appCode.replace(/from\s+['"]\.\/builders\.js['"]/g, "from '../builders.js'");

// Intercept createPublicClient and inject a customized mock client
appCode = appCode.replace(/createPublicClient\s*\(\s*\{[^}]*\}\s*\)/g, `(() => {
  return {
    readContract: async ({ address, abi, functionName, args }) => {
      if (functionName === 'expiry') {
        // Expiry in future (non-expired)
        return BigInt(Math.floor(Date.now() / 1000) + 86400 * 10);
      }
      if (functionName === 'price') {
        return 950000000000000000000000n; // 0.95 USDC per PT
      }
      if (functionName === 'position') {
        return [0n, 6195880000n, 8000320000000000000000n]; // debt, collateral
      }
      if (functionName === 'market') {
        return [0n, 0n, 1000000n * 10n**6n, 1000000n * 10n**6n, 0n, 0n];
      }
      return 0n;
    },
    waitForTransactionReceipt: async () => {
      return {
        logs: [
          // 1. Real Transfer of old PT: from MORPHO_BUNDLER_V3 (1000 PT)
          {
            address: '0x3365554A61CeFF74A76528f9e86C1E87946d16a5',
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '0x0000000000000000000000006566194141eefa99Af43Bb5Aa71460Ca2Dc90245', // from BUNDLER
              '0x0000000000000000000000000000000000000000000000000000000000000004'
            ],
            data: '0x00000000000000000000000000000000000000000000003635c9adc5dea00000'
          },
          // 2. Dummy Transfer of old PT (500 PT) - should be ignored (not from BUNDLER)
          {
            address: '0x3365554A61CeFF74A76528f9e86C1E87946d16a5',
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '0x0000000000000000000000000000000000000000000000000000000000000008', // not BUNDLER
              '0x0000000000000000000000006566194141eefa99Af43Bb5Aa71460Ca2Dc90245'
            ],
            data: '0x00000000000000000000000000000000000000000000001b1ae4d6e2ef500000'
          },
          // 3. Real Transfer of new PT: to ETHER_GENERAL_ADAPTER_1 (994.498 PT)
          {
            address: '0xb5Be35D8fF83D431899b95851CB17a2B4bcEF150',
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '0x0000000000000000000000000000000000000000000000000000000000000004',
              '0x0000000000000000000000004A6c312ec70E8747a587EE860a0353cd42Be0aE0'  // to ADAPTER
            ],
            data: '0x000000000000000000000000000000000000000000000035ee8b199ee5100000'
          },
          // 4. Dummy Transfer of new PT (300 PT) - should be ignored (not to ADAPTER)
          {
            address: '0xb5Be35D8fF83D431899b95851CB17a2B4bcEF150',
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '0x0000000000000000000000004A6c312ec70E8747a587EE860a0353cd42Be0aE0',
              '0x0000000000000000000000000000000000000000000000000000000000000009'  // not ADAPTER
            ],
            data: '0x00000000000000000000000000000000000000000000001043561a8829300000'
          }
        ]
      };
    }
  };
})()`);

// Intercept createWalletClient sendTransaction call
appCode = appCode.replace(/walletClient\.sendTransaction\s*\(\s*\{[^}]*\}\s*\)/g, `(() => {
  global.sendTransactionCalled = true;
  return Promise.resolve("0xmocktxhash123");
})()`);

const shadowPath = path.resolve(__dirname, './preview_workflow.shadow.mjs');
fs.writeFileSync(shadowPath, appCode, 'utf8');



try {
  // Import app code to bind events
  const appModule = await import('./preview_workflow.shadow.mjs');
  await new Promise(resolve => setTimeout(resolve, 50));

  const previewContainer = document.getElementById('previewContainer');
  const confirmExecuteBtn = document.getElementById('confirmExecuteBtn');
  const previewSlippageBadge = document.getElementById('previewSlippageBadge');
  const maturityNotice = document.getElementById('maturityNotice');
  const loadPositionBtn = document.getElementById('loadPositionBtn');
  const migrateBtn = document.getElementById('migrateBtn');

  console.log("Loading user position...");
  loadPositionBtn.click();
  await new Promise(resolve => setTimeout(resolve, 50));

  // Step 2: Trigger preview simulation (clicking migrateBtn)
  console.log("Simulating migration to generate preview...");
  migrateBtn.click();
  await new Promise(resolve => setTimeout(resolve, 50));

  // Verify that preview container is visible but transaction was NOT sent to wallet yet
  if (previewContainer.style.display !== 'block') {
    const errorBanner = document.getElementById('globalErrorBanner');
    console.error("Global Error Banner Text:", errorBanner ? errorBanner.innerText : "none");
    const statusText = document.getElementById('status');
    console.error("Status Element Text:", statusText ? statusText.innerText : "none");
  }
  assert.strictEqual(previewContainer.style.display, 'block', "previewContainer should be visible");
  assert.strictEqual(global.sendTransactionCalled, false, "walletClient.sendTransaction should NOT be called yet");
  assert.strictEqual(maturityNotice.style.display, 'none', "maturityNotice should be hidden since PT is not expired");

  // Verify that slippage badge contains calculated rate
  assert.ok(previewSlippageBadge.innerText.includes("Price Impact:"), "Slippage badge should display Price Impact text");

  // Verify that previewMetrics element contains oracle prices and implied prices next to the ratios
  const previewMetrics = document.getElementById('previewMetrics');
  assert.ok(previewMetrics.innerHTML.includes("Oracles: PT-old = $0.9500, PT-new = $0.9500"), "Should display oracle prices in preview metrics");
  assert.ok(previewMetrics.innerHTML.includes("Implied: 1 PT-old = $0.9500"), "Should display implied swap price of PT-old in preview metrics");

  // Verify compiled calldata structure and repayShares parameter
  const rawCalldata = document.getElementById('rawCalldataTextarea').value;
  assert.ok(rawCalldata, "Raw calldata should be populated in textarea");

  const decodedMulticall = decodeFunctionData({
    abi: [
      {
        "inputs": [
          {
            "components": [
              { "name": "to", "type": "address" },
              { "name": "data", "type": "bytes" },
              { "name": "value", "type": "uint256" },
              { "name": "skipRevert", "type": "bool" },
              { "name": "callbackHash", "type": "bytes32" }
            ],
            "name": "calls",
            "type": "tuple[]"
          }
        ],
        "name": "multicall",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
      }
    ],
    data: rawCalldata
  });

  const outerBundle = decodedMulticall.args[0];
  assert.strictEqual(outerBundle.length, 2, "Outer bundle should contain flashloan and sweep refund");

  const flashloanCall = outerBundle[0];
  const decodedFlashloan = decodeFunctionData({
    abi: [
      {
        "inputs": [
          { "name": "token", "type": "address" },
          { "name": "assets", "type": "uint256" },
          { "name": "data", "type": "bytes" }
        ],
        "name": "morphoFlashLoan",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      }
    ],
    data: flashloanCall.data
  });

  const encodedReenterBundle = decodedFlashloan.args[2];
  
  const decodedReenterParams = decodeAbiParameters(
    [
      {
        name: 'bundle',
        type: 'tuple[]',
        components: [
          { name: 'to', type: 'address' },
          { name: 'data', type: 'bytes' },
          { name: 'value', type: 'uint256' },
          { name: 'skipRevert', type: 'bool' },
          { name: 'callbackHash', type: 'bytes32' }
        ]
      }
    ],
    encodedReenterBundle
  );

  const reenterBundle = decodedReenterParams[0];
  console.log("Decoded reenterBundle calls in test:");
  reenterBundle.forEach((c, idx) => {
    console.log(`  Call #${idx}: to=${c.to}`);
  });
  assert.strictEqual(reenterBundle.length, 9, "Reenter bundle should contain 9 actions");

  const repayCall = reenterBundle[0];
  const decodedRepay = decodeFunctionData({
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
          { "name": "maxSharePriceE27", "type": "uint256" },
          { "name": "onBehalf", "type": "address" },
          { "name": "data", "type": "bytes" }
        ],
        "name": "morphoRepay",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      }
    ],
    data: repayCall.data
  });

  const repaySharesArg = decodedRepay.args[2];
  console.log("Decoded repayShares:", repaySharesArg);
  assert.strictEqual(repaySharesArg, 6195880000n, "repayShares should be the exact user's borrow shares (6195880000n)");

  // Step 3: Trigger confirm execution

  console.log("Confirming execution to send transaction to wallet...");
  confirmExecuteBtn.click();
  await new Promise(resolve => setTimeout(resolve, 100)); // wait for tx confirmation and audit log parsing

  assert.strictEqual(global.sendTransactionCalled, true, "walletClient.sendTransaction should be called");
  assert.strictEqual(previewContainer.style.display, 'none', "previewContainer should be hidden post-execution");

  const statusEl = document.getElementById('status');
  console.log("Status text printed: \n" + statusEl.innerText);

  assert.ok(statusEl.innerText.includes("Migration Transaction Confirmed Successfully!"), "Success notification should be active");
  assert.ok(statusEl.innerText.includes("[Post-Execution Audit]"), "Audit section should be included in output");
  assert.ok(statusEl.innerText.includes("Realized Swap Rate: 1 PT-old = 0.9949 PT-new (Estimated: 1.0000 PT-new)."), "Should display comparison of realized vs estimated swap rate");
  assert.ok(statusEl.innerText.includes("Realized Price Impact: 0.51% (Estimated: 0.00%, vs. Oracle)."), "Should display comparison of realized vs estimated price impact");
  console.log("All pre-transaction workflow & slippage audit tests passed!");
} finally {
  if (fs.existsSync(shadowPath)) {
    fs.unlinkSync(shadowPath);
  }
}
