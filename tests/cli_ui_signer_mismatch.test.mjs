import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';
import { encodeAbiParameters } from 'viem';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('Running JSDOM UI Signer Mismatch Validation Tests...');

// 1. Load HTML layout
const htmlPath = path.resolve(__dirname, '../index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// 2. Initialize JSDOM
const dom = new JSDOM(html, { url: 'http://localhost' });
global.window = dom.window;
global.document = dom.window.document;
try {
  Object.defineProperty(global, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
    writable: true
  });
} catch (e) {
  // Ignore fallback
}
global.HTMLElement = dom.window.HTMLElement;

// Mock localStorage
const storage = {
  morpho_migration_rpc_url: 'https://eth-mainnet.g.alchemy.com/v2/mockkey',
  morpho_migration_alchemy_key: 'mockkey',
  morpho_migration_auto_simulate: 'false'
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

// Mock window.ethereum with a mismatch signer account (e.g. signer = 0x999... but target = 0x555...)
global.window.ethereum = {
  request: async (requestObj) => {
    if (requestObj.method === 'eth_requestAccounts' || requestObj.method === 'eth_accounts') {
      return ['0x9999999999999999999999999999999999999999']; // mismatch account
    }
    throw new Error(`Unhandled eth request: ${requestObj.method}`);
  }
};

// Mock global fetch for config.json loading during module import
global.fetch = async (url, options) => {
  const urlStr = typeof url === 'string' ? url : url.toString();
  if (urlStr.endsWith('config.json')) {
    const configPath = path.resolve(__dirname, '../config.json');
    return {
      ok: true,
      json: async () => JSON.parse(fs.readFileSync(configPath, 'utf8'))
    };
  }
  throw new Error(`Unhandled mock fetch request before setup: ${urlStr}`);
};

// 3. Preprocess app.js and write shadow file
const appPath = path.resolve(__dirname, '../app.js');
let appCode = fs.readFileSync(appPath, 'utf8');
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
          {
            address: '0x3365554A61CeFF74A76528f9e86C1E87946d16a5',
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '0x0000000000000000000000006566194141eefa99Af43Bb5Aa71460Ca2Dc90245',
              '0x0000000000000000000000000000000000000000000000000000000000000004'
            ],
            data: '0x00000000000000000000000000000000000000000000003635c9adc5dea00000'
          }
        ]
      };
    }
  };
})()`);

const shadowPath = path.resolve(__dirname, './app.shadow_mismatch.mjs');
fs.writeFileSync(shadowPath, appCode, 'utf8');

try {
  // 4. Import shadow file to run bindings
  const appModule = await import('./app.shadow_mismatch.mjs');
  await new Promise(resolve => setTimeout(resolve, 50));

  // --- Step 1: Set user address input to a mismatched value ---
  const userAddressInput = document.getElementById('userAddress');
  userAddressInput.value = "0x5555555555555555555555555555555555555555";
  userAddressInput.dispatchEvent(new window.Event('input'));

  // Let's mock fetch for this test:
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
              outputs: [{ amount: '9000000000000000000' }],
              tx: { to: '0x0000000000000000000000000000000000000004', data: '0x00' }
            }
          ]
        })
      };
    }
    
    if (urlStr.includes('eth-mainnet.g.alchemy.com/v2/')) {
      const reqBody = JSON.parse(options.body);
      const mockCalls = reqBody.params[0].blockStateCalls[0].calls.map(() => {
        // Encode position tuple properly: (supplyShares, borrowShares, collateral)
        const returnData = encodeAbiParameters(
          [
            { name: 'supplyShares', type: 'uint256' },
            { name: 'borrowShares', type: 'uint128' },
            { name: 'collateral', type: 'uint128' }
          ],
          [0n, 6195880000n, 8000320000000000000000n]
        );
        return {
          status: "0x1",
          gasUsed: "0x1000",
          returnData
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

  // --- Step 2: Load the position (uses 0x555... from input) ---
  const loadBtn = document.getElementById('loadPositionBtn');
  loadBtn.click();
  await new Promise(resolve => setTimeout(resolve, 150));

  const statusEl = document.getElementById('status');
  console.log("Status after loadPositionBtn click:", statusEl.innerText);

  // --- Step 3: Click migrateBtn to run initiateMigration, which sets pendingTx and userAddress = 0x555... ---
  document.getElementById('settingsAutoSimulate').checked = false;
  const migrateBtn = document.getElementById('migrateBtn');
  migrateBtn.click();
  
  // Wait for initiateMigration to complete
  await new Promise(resolve => setTimeout(resolve, 200));

  if (statusEl.style.display !== 'none' && statusEl.className === 'error') {
    throw new Error(`Migration generation failed: ${statusEl.innerText}`);
  }

  // --- Step 4: Now click confirmExecuteBtn ---
  const confirmExecuteBtn = document.getElementById('confirmExecuteBtn');
  confirmExecuteBtn.click();

  await new Promise(resolve => setTimeout(resolve, 100));

  // The confirmAndSubmitTransaction should fail due to signer address mismatch,
  // showing the error in status element!
  console.log("Status El message after mismatch execution:", statusEl.innerText);
  assert.ok(statusEl.innerText.includes("does not match the target position user address"), 
    "Status message should report signer mismatch error");
  assert.strictEqual(statusEl.className, 'error', "Status element class should be error");

  console.log('✅ Signer Mismatch Validation Test Passed!');
} finally {
  if (fs.existsSync(shadowPath)) {
    fs.unlinkSync(shadowPath);
  }
}
