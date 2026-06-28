import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('Running JSDOM frontend integration tests...');

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
  // Fallback for newer Node environments with read-only global navigator
}
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

// Mock window.ethereum for wallet operations
global.window.ethereum = {
  request: async (requestObj) => {
    if (requestObj.method === 'eth_requestAccounts' || requestObj.method === 'eth_accounts') {
      return ['0x0000000000000000000000000000000000000001'];
    }
    throw new Error(`Unhandled eth request: ${requestObj.method}`);
  }
};

// Mock global fetch for Blue GraphQL API and Pendle API calls
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
    const body = JSON.parse(options.body);
    if (body.query.includes('GetMarket')) {
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
            }
          }
        })
      };
    }
    if (body.query.includes('GetAsset')) {
      return {
        ok: true,
        json: async () => ({
          data: {
            assets: {
              items: [{ symbol: 'PT-apyUSD-18JUN2026' }]
            }
          }
        })
      };
    }
  }
  
  if (urlStr.includes('api-v2.pendle.finance')) {
    return {
      ok: true,
      json: async () => ({
        routes: [
          {
            outputs: [{ amount: '9000000000000000000' }],
            tx: { to: '0x0000000000000000000000000000000000000004', data: '0x00' }
          }
        ]
      })
    };
  }

  throw new Error(`Unhandled mock fetch request: ${urlStr}`);
};

// 4. Preprocess app.js and write shadow ESM test file
const appPath = path.resolve(__dirname, '../app.js');
let appCode = fs.readFileSync(appPath, 'utf8');

// Replace CDN imports with standard Node package imports
appCode = appCode.replace(/from\s+['"]https:\/\/esm\.sh\/viem['"]/g, "from 'viem'");
appCode = appCode.replace(/from\s+['"]https:\/\/esm\.sh\/viem\/chains['"]/g, "from 'viem/chains'");

appCode = appCode.replace(/from\s+['"]\.\/math\.js['"]/g, "from '../math.js'");
appCode = appCode.replace(/from\s+['"]\.\/labels\.js['"]/g, "from '../labels.js'");
appCode = appCode.replace(/from\s+['"]\.\/builders\.js['"]/g, "from '../builders.js'");
appCode = appCode.replace(/from\s+['"]\.\/config\.js['"]/g, "from '../config.js'");

// Save the shadow test file
const shadowPath = path.resolve(__dirname, './app.shadow.mjs');
fs.writeFileSync(shadowPath, appCode, 'utf8');

try {
  // 5. Import shadow file to run the scripts in JSDOM mock scope
  await import('./app.shadow.mjs');

  // Allow events loop to process initial microtasks (on-load setups)
  await new Promise(resolve => setTimeout(resolve, 50));

  // 6. Assertions for DOM Elements Initialization
  const loadBtn = document.getElementById('loadPositionBtn');
  assert.ok(loadBtn, "loadPositionBtn should exist in DOM");

  const labels = Array.from(document.querySelectorAll('label'));
  const slippageLabels = labels.filter(el => el.textContent.includes('Slippage'));
  assert.strictEqual(slippageLabels.length, 2, "Should find exactly two slippage labels");
  slippageLabels.forEach(label => {
    assert.strictEqual(label.textContent, 'Slippage (%)', "Label text should be 'Slippage (%)'");
  });


  // Check event bindings
  // Test click connection triggers (verify function connection by running action)
  console.log('Testing wallet connect click binding...');
  loadBtn.click();

  // Allow eth request and gql mock request to resolve
  await new Promise(resolve => setTimeout(resolve, 50));

  const statusEl = document.getElementById('status');
  // Since we don't mock Viem contract read, it will throw error on contract read
  // (e.g. readContract on Morpho Blue position). But it proves it compiled, imported,
  // bound the click handler, executed it, and reached contract call logic!
  assert.ok(statusEl.innerText.includes("Loading position data from Morpho Blue...") || statusEl.innerText.includes("Blocked"), 
    `Status message should be active: "${statusEl.innerText}"`);

  console.log('JSDOM integration test passed successfully!');
} finally {
  // 7. Cleanup shadow file
  if (fs.existsSync(shadowPath)) {
    fs.unlinkSync(shadowPath);
  }
}
