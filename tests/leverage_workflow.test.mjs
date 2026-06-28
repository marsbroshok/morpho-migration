import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM, VirtualConsole } from 'jsdom';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('Running JSDOM leverage adjustment workflow tests...');

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
  
  if (urlStr.endsWith('config.json')) {
    const configPath = path.resolve(__dirname, '../config.json');
    return {
      ok: true,
      json: async () => JSON.parse(fs.readFileSync(configPath, 'utf8'))
    };
  }

  if (urlStr.includes('blue-api.morpho.org/graphql')) {
    return {
      ok: true,
      json: async () => ({
        data: {
          markets: {
            items: [
              {
                loanAsset: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0CE3606eB48', symbol: 'USDC', decimals: '6' },
                collateralAsset: { address: '0x3365554a61CeFF74A76528f9e86C1E87946d16a5', symbol: 'PT-apyUSD-18JUN2026', decimals: '18' },
                oracleAddress: '0x0000000000000000000000000000000000000002',
                irmAddress: '0x0000000000000000000000000000000000000003',
                lltv: '860000000000000000'
              }
            ]
          },
          assets: {
            items: [{ symbol: 'PT-apyUSD-18JUN2026' }]
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
            outputs: [{ amount: '3000000000' }], // USDC expected output amount (for PT -> USDC swap during deleverage)
            tx: { to: '0x0000000000000000000000000000000000000004', data: '0x00' }
          }
        ]
      })
    };
  }
  if (urlStr.includes('alchemy.com') || urlStr.includes('localhost') || urlStr.includes('127.0.0.1')) {
    return {
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        result: [
          {
            calls: [
              {
                status: "0x1",
                returnData: "0x",
                gasUsed: "0x1234"
              }
            ]
          }
        ]
      })
    };
  }
  throw new Error(`Unhandled mock fetch request: ${urlStr}`);
};

// 3. Preprocess app.js and write shadow file
const appPath = path.resolve(__dirname, '../app.js');
let appCode = fs.readFileSync(appPath, 'utf8');

// Replace CDN imports with standard Node package imports
appCode = appCode.replace(/from\s+['"]https:\/\/esm\.sh\/viem['"]/g, "from 'viem'");
appCode = appCode.replace(/from\s+['"]https:\/\/esm\.sh\/viem\/chains['"]/g, "from 'viem/chains'");
appCode = appCode.replace(/from\s+['"]\.\/math\.js['"]/g, "from '../math.js'");
appCode = appCode.replace(/from\s+['"]\.\/labels\.js['"]/g, "from '../labels.js'");
appCode = appCode.replace(/from\s+['"]\.\/builders\.js['"]/g, "from '../builders.js'");
appCode = appCode.replace(/from\s+['"]\.\/config\.js['"]/g, "from '../config.js'");

// Intercept createPublicClient and inject a customized mock client
appCode = appCode.replace(/createPublicClient\s*\(\s*\{[^}]*\}\s*\)/g, `(() => {
  return {
    readContract: async ({ address, abi, functionName, args }) => {
      if (functionName === 'expiry') {
        return BigInt(Math.floor(Date.now() / 1000) + 86400 * 10);
      }
      if (functionName === 'price') {
        return 950000000000000000000000n; // 0.95 USDC per PT
      }
      if (functionName === 'position') {
        return [0n, 6086530000n, 7832723800000000000000n]; // debt, collateral matching the user's screenshot
      }
      if (functionName === 'market') {
        return [0n, 0n, 1000000n * 10n**6n, 1000000n * 10n**6n, 0n, 0n];
      }
      return 0n;
    }
  };
})()`);

appCode = appCode.replace(/walletClient\.sendTransaction\s*\(\s*\{[^}]*\}\s*\)/g, `(() => {
  global.sendTransactionCalled = true;
  return Promise.resolve("0xmocktxhash123");
})()`);

const shadowPath = path.resolve(__dirname, './leverage_workflow.shadow.mjs');
fs.writeFileSync(shadowPath, appCode, 'utf8');

try {
  // Import app code to bind events
  const appModule = await import('./leverage_workflow.shadow.mjs');
  await new Promise(resolve => setTimeout(resolve, 50));

  const levLoadBtn = document.getElementById('levLoadBtn');
  const levExecuteBtn = document.getElementById('levExecuteBtn');
  const levSlider = document.getElementById('levSlider');
  const statusEl = document.getElementById('status');
  const previewContainer = document.getElementById('previewContainer');

  console.log("Loading user leverage position...");
  levLoadBtn.click();
  await new Promise(resolve => setTimeout(resolve, 50));

  // Verify position loaded
  assert.ok(statusEl.innerText === "" || !statusEl.innerText.includes("Blocked"), "Position should load without errors");
  
  // Set slider to 5.00x (which is a deleverage from the loaded ~81.8% LTV position which is 5.49x, target is 5.0x / 80% LTV)
  console.log("Setting target leverage to 5.00x...");
  levSlider.value = "5.00";
  levSlider.dispatchEvent(new window.Event('input'));

  console.log("Simulating deleveraging to generate preview...");
  levExecuteBtn.click();
  await new Promise(resolve => setTimeout(resolve, 50));

  // Check if error banner was displayed
  if (statusEl.className === 'error') {
    throw new Error(`Execution failed with error message: ${statusEl.innerText}`);
  }

  // Verify that preview container is visible
  assert.strictEqual(previewContainer.style.display, 'block', "previewContainer should be visible");
  console.log("Leverage workflow preview test passed successfully!");
} finally {
  if (fs.existsSync(shadowPath)) {
    fs.unlinkSync(shadowPath);
  }
}
