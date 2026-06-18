import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM, VirtualConsole } from 'jsdom';

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
                loanAsset: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0CE3606eB48', symbol: 'USDC' },
                collateralAsset: { address: collateralAddress, symbol: collateralSymbol },
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
          // Transfer of old PT (1000 PT)
          {
            address: '0x3365554A61CeFF74A76528f9e86C1E87946d16a5',
            topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'],
            data: '0x00000000000000000000000000000000000000000000003635c9adc5dea00000'
          },
          // Transfer of new PT (995 PT)
          {
            address: '0xb5Be35D8fF83D431899b95851CB17a2B4bcEF150',
            topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'],
            data: '0x000000000000000000000000000000000000000000000035ee8b199ee5100000'
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
  assert.strictEqual(previewContainer.style.display, 'block', "previewContainer should be visible");
  assert.strictEqual(global.sendTransactionCalled, false, "walletClient.sendTransaction should NOT be called yet");
  assert.strictEqual(maturityNotice.style.display, 'none', "maturityNotice should be hidden since PT is not expired");

  // Verify that slippage badge contains calculated rate
  assert.ok(previewSlippageBadge.innerText.includes("Price Impact:"), "Slippage badge should display Price Impact text");

  // Verify that previewMetrics element contains oracle prices and implied prices next to the ratios
  const previewMetrics = document.getElementById('previewMetrics');
  assert.ok(previewMetrics.innerHTML.includes("Oracles: PT-old = $0.9500, PT-new = $0.9500"), "Should display oracle prices in preview metrics");
  assert.ok(previewMetrics.innerHTML.includes("Implied: 1 PT-old = $0.9500"), "Should display implied swap price of PT-old in preview metrics");

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
