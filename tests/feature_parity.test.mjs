import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';
import { encodeFunctionData, getAddress } from 'viem';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('Running JSDOM Feature Parity unit and integration tests (TDD)...');

// 1. Load HTML layout
const htmlPath = path.resolve(__dirname, '../index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// 2. Initialize JSDOM
const dom = new JSDOM(html, { url: 'http://localhost' });

// 3. Mock browser global environment
global.window = dom.window;
global.document = dom.window.document;
try {
  Object.defineProperty(global, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
    writable: true
  });
} catch (e) {
  // Fallback
}
global.HTMLElement = dom.window.HTMLElement;

// Mock localStorage on global delegating to JSDOM window
global.localStorage = {
  getItem: (key) => dom.window.localStorage.getItem(key),
  setItem: (key, val) => dom.window.localStorage.setItem(key, val)
};
// Mock window.ethereum
global.window.ethereum = {
  selectedAddress: '0xE14f5DAab7E7fF2527F3B3cE582033e4A1Df8D0a',
  request: async (requestObj) => {
    if (requestObj.method === 'eth_requestAccounts' || requestObj.method === 'eth_accounts') {
      return ['0xE14f5DAab7E7fF2527F3B3cE582033e4A1Df8D0a'];
    }
    throw new Error(`Unhandled eth request: ${requestObj.method}`);
  }
};

// Mock fetch to intercept .env lookup and Alchemy simulation calls
let fetchedUrls = [];
let lastSimulatePayload = null;

global.fetch = async (url, options) => {
  const urlStr = typeof url === 'string' ? url : url.toString();
  fetchedUrls.push(urlStr);

  if (urlStr.endsWith('.env')) {
    return new Response(`
      ALCHEMY_API_KEY=mock-alchemy-key-123
      RPC_URL=https://eth-mainnet.g.alchemy.com/v2/mock-alchemy-key-123
    `, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' }
    });
  }

  if (urlStr.includes('eth-mainnet.g.alchemy.com/v2/')) {
    if (!options || !options.body) {
      console.log("ALCHEMY FETCH CALL WITHOUT BODY:", options);
      return new Response("{}", { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    let body;
    try {
      body = JSON.parse(options.body);
    } catch (e) {
      console.error("Failed to parse body:", options.body, e);
      return new Response("Invalid request body", { status: 400 });
    }
    console.log("ALCHEMY RPC METHOD:", body.method);
    if (body.method === 'eth_simulateV1') {
      lastSimulatePayload = body;
      const requestFrom = body.params[0].blockStateCalls[0].calls[0].from || "0xE14f5DAab7E7fF2527F3B3cE582033e4A1Df8D0a";
      const requestTo = body.params[0].blockStateCalls[0].calls[0].to || "0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245";
      const resData = {
        result: [
          {
            calls: [
              {
                from: requestFrom,
                to: requestTo,
                status: "0x1",
                gasUsed: "0x54321",
                value: "0x0",
                calls: [
                  {
                    from: requestTo,
                    to: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
                    status: "0x1",
                    gasUsed: "0x1234",
                    value: "0x0"
                  }
                ]
              }
            ]
          }
        ]
      };
      return new Response(JSON.stringify(resData), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } else if (body.method === 'eth_call') {
      const resData = {
        jsonrpc: "2.0",
        id: body.id,
        result: "0x0000000000000000000000000000000000000000000000000000000000000001"
      };
      return new Response(JSON.stringify(resData), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  if (urlStr.includes('blue-api.morpho.org/graphql')) {
    const resData = {
      data: {
        markets: { items: [] },
        assets: { items: [] }
      }
    };
    return new Response(JSON.stringify(resData), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  throw new Error(`Unhandled mock fetch request: ${urlStr}`);
};

// 4. Preprocess app.js and write shadow file
const appPath = path.resolve(__dirname, '../app.js');
let appCode = fs.readFileSync(appPath, 'utf8');

// Replace CDN imports with standard Node package imports
appCode = appCode.replace(/from\s+['"]https:\/\/esm\.sh\/viem['"]/g, "from 'viem'");
appCode = appCode.replace(/from\s+['"]https:\/\/esm\.sh\/viem\/chains['"]/g, "from 'viem/chains'");
appCode = appCode.replace(/from\s+['"]\.\/math\.js['"]/g, "from '../math.js'");
appCode = appCode.replace(/from\s+['"]\.\/labels\.js['"]/g, "from '../labels.js'");
appCode = appCode.replace(/from\s+['"]\.\/builders\.js['"]/g, "from '../builders.js'");

const shadowPath = path.resolve(__dirname, './feature_parity.shadow.mjs');
fs.writeFileSync(shadowPath, appCode, 'utf8');

try {
  // 5. Import shadow file to run the script under JSDOM
  await import('./feature_parity.shadow.mjs');

  // Let event loop run initial microtasks (on-load setups, autoloading)
  await new Promise(resolve => setTimeout(resolve, 100));

  // --- Test 1: Verify New Elements Exist ---
  console.log('Testing element presence in DOM...');
  const tabHeader = document.getElementById('tabHeaderSimulateRaw');
  assert.ok(tabHeader, "Simulate Raw Tx tab header should exist");
  
  const tabContent = document.getElementById('tabContentSimulateRaw');
  assert.ok(tabContent, "Simulate Raw Tx tab content should exist");

  const keyInput = document.getElementById('settingsAlchemyKey');
  assert.ok(keyInput, "settingsAlchemyKey input should exist");
  assert.strictEqual(keyInput.type, "password", "settingsAlchemyKey should be a password-type input to mask keys");

  const rpcInput = document.getElementById('settingsRpcUrl');
  assert.ok(rpcInput, "settingsRpcUrl input should exist");

  const rawTxTextarea = document.getElementById('rawTxDataTextarea');
  assert.ok(rawTxTextarea, "rawTxDataTextarea input should exist");

  const simulateRawBtn = document.getElementById('simulateRawBtn');
  assert.ok(simulateRawBtn, "simulateRawBtn button should exist");

  // --- Test 2: Autoload Settings from .env ---
  console.log('Testing settings autoloading from mock .env...');
  assert.strictEqual(keyInput.value, 'mock-alchemy-key-123', "Alchemy key should autoload from mock .env");
  assert.strictEqual(rpcInput.value, 'https://eth-mainnet.g.alchemy.com/v2/mock-alchemy-key-123', "RPC URL should autoload from mock .env");

  // --- Test 3: Tab Switching ---
  console.log('Testing tab switching to Simulate Raw Tx...');
  tabHeader.click();
  assert.ok(tabContent.classList.contains('active'), "Simulate Raw Tx content should be active after click");

  // --- Test 4: Simulation Execution & Render call trace tree ---
  console.log('Testing simulation execution and rendering...');
  // Paste a valid mock transaction payload
  const validTxPayload = {
    from: "0xE14f5DAab7E7fF2527F3B3cE582033e4A1Df8D0a",
    to: "0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245",
    data: "0x8f001234",
    value: "0"
  };
  rawTxTextarea.value = JSON.stringify(validTxPayload);
  rawTxTextarea.dispatchEvent(new window.Event('input'));

  // Trigger simulate
  simulateRawBtn.click();
  
  // Wait for async simulation fetch & render
  await new Promise(resolve => setTimeout(resolve, 1000));

  const statusEl = document.getElementById('status');
  if (!lastSimulatePayload) {
    console.log("Status textContent:", statusEl.textContent);
    console.log("Fetched URLs:", fetchedUrls);
  }
  assert.ok(lastSimulatePayload, "Simulation fetch should have been sent");
  assert.strictEqual(lastSimulatePayload.params[0].blockStateCalls[0].calls[0].from, validTxPayload.from);

  const simResultEl = document.getElementById('simulationResultContainer');
  if (!simResultEl.textContent.includes("SUCCESSFUL")) {
    console.log("simulationResultContainer HTML:", simResultEl.outerHTML);
  }
  assert.ok(simResultEl.textContent.includes("SUCCESSFUL"), "Should render success message");
  assert.ok(simResultEl.textContent.includes("Gas Used"), "Should render gas used");

  // --- Test 5: Address mismatch warnings ---
  console.log('Testing address context mismatch validation...');
  
  const BUNDLER_ABI = [
    {
      inputs: [
        {
          components: [
            { name: "to", type: "address" },
            { name: "data", type: "bytes" },
            { name: "value", type: "uint256" },
            { name: "skipRevert", type: "bool" },
            { name: "callbackHash", type: "bytes32" }
          ],
          name: "bundle",
          type: "tuple[]"
        }
      ],
      name: "multicall",
      outputs: [],
      stateMutability: "payable",
      type: "function"
    }
  ];

  const ADAPTER_ABI = [
    {
      inputs: [
        {
          components: [
            { name: "loanToken", type: "address" },
            { name: "collateralToken", type: "address" },
            { name: "oracle", type: "address" },
            { name: "irm", type: "address" },
            { name: "lltv", type: "uint256" }
          ],
          name: "marketParams",
          type: "tuple"
        },
        { name: "assets", type: "uint256" },
        { name: "shares", type: "uint256" },
        { name: "maxSharePriceE27", type: "uint256" },
        { name: "onBehalf", type: "address" },
        { name: "data", type: "bytes" }
      ],
      name: "morphoRepay",
      outputs: [],
      stateMutability: "nonpayable",
      type: "function"
    }
  ];

  const subCalldata = encodeFunctionData({
    abi: ADAPTER_ABI,
    functionName: 'morphoRepay',
    args: [
      {
        loanToken: getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0CE3606eB48'),
        collateralToken: getAddress('0x3365554a61CeFF74A76528f9e86C1E87946d16a5'),
        oracle: getAddress('0x0000000000000000000000000000000000000000'),
        irm: getAddress('0x0000000000000000000000000000000000000000'),
        lltv: 0n
      },
      100n,
      0n,
      0n,
      getAddress('0x0000000000000000000000000000000000000009'), // mismatch onBehalf
      '0x'
    ]
  });

  const multicallData = encodeFunctionData({
    abi: BUNDLER_ABI,
    functionName: 'multicall',
    args: [
      [
        {
          to: getAddress('0x4a6c312ec70e8747a587ee860a0353cd42be0ae0'),
          data: subCalldata,
          value: 0n,
          skipRevert: false,
          callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
        }
      ]
    ]
  });

  const invalidTxPayload = {
    from: getAddress("0xE14f5DAab7E7fF2527F3B3cE582033e4A1Df8D0a"), // user sender
    to: getAddress("0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245"), // bundler
    data: multicallData,
    value: "0"
  };
  rawTxTextarea.value = JSON.stringify(invalidTxPayload);
  rawTxTextarea.dispatchEvent(new window.Event('input'));

  simulateRawBtn.click();
  await new Promise(resolve => setTimeout(resolve, 1000));

  const warningsEl = document.getElementById('simulationWarningsContainer');
  assert.ok(warningsEl.textContent.includes("Address Context Mismatch Detected"), "Should show address mismatch warnings in DOM");

  console.log('All Feature Parity integration tests passed successfully!');
} finally {
  // Cleanup shadow file
  if (fs.existsSync(shadowPath)) {
    fs.unlinkSync(shadowPath);
  }
}
