import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('Running JSDOM UI Different Loan Asset Rollover Tests...');

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

// Mock window.ethereum
global.window.ethereum = {
  request: async (requestObj) => {
    if (requestObj.method === 'eth_requestAccounts' || requestObj.method === 'eth_accounts') {
      return ['0x0000000000000000000000000000000000000005'];
    }
    throw new Error(`Unhandled eth request: ${requestObj.method}`);
  }
};

// Mock global fetch for GraphQL and Pendle API
global.fetch = async (url, options) => {
  const urlStr = typeof url === 'string' ? url : url.toString();
  console.log("[Mock Fetch] URL:", urlStr);
  if (urlStr.includes('blue-api.morpho.org/graphql')) {
    const body = JSON.parse(options.body);
    console.log("[Mock Fetch] GQL Variables:", body.variables);
    const id = body.variables.id;
    const address = body.variables.address;
    
    if (id) {
      const isNew = id.toLowerCase().includes('new');
      return {
        ok: true,
        json: async () => ({
          data: {
            markets: {
              items: [
                {
                  loanAsset: { 
                    address: isNew ? '0x98A878b1Cd98131B271883B390f68D2c90674665' : '0xA0b86991c6218b36c1d19D4a2e9Eb0CE3606eB48', 
                    symbol: isNew ? 'apxUSD' : 'USDC', 
                    decimals: isNew ? '18' : '6' 
                  },
                  collateralAsset: { 
                    address: isNew ? '0xb5Be35D8fF83D431899b95851CB17a2B4bcEF150' : '0x3365554a61CeFF74A76528f9e86C1E87946d16a5', 
                    symbol: isNew ? 'PT-new' : 'PT-old', 
                    decimals: '18' 
                  },
                  oracleAddress: isNew ? '0x0000000000000000000000000000000000000004' : '0x0000000000000000000000000000000000000002',
                  irmAddress: '0x0000000000000000000000000000000000000003',
                  lltv: '860000000000000000'
                }
              ]
            }
          }
        })
      };
    } else if (address) {
      const isNewPt = address.toLowerCase() === '0xb5be35d8ff83d431899b95851cb17a2b4bcef150';
      return {
        ok: true,
        json: async () => ({
          data: {
            assets: {
              items: [{ symbol: isNewPt ? 'PT-new' : 'PT-old' }]
            }
          }
        })
      };
    }
  }

  if (urlStr.includes('api-v2.pendle.finance/core/v3/sdk/1/convert')) {
    const body = JSON.parse(options.body);
    const inputToken = body.inputs[0].token.toLowerCase();
    
    // Collateral swap (PT-old -> PT-new)
    if (inputToken === '0x3365554a61ceff74a76528f9e86c1e87946d16a5') {
      return {
        ok: true,
        json: async () => ({
          routes: [
            {
              outputs: [{ amount: '7800000000000000000000' }], // 7800 PT-new output for 8000 PT-old input
              tx: { to: '0x0000000000000000000000000000000000000006', data: '0xabcdef' }
            }
          ]
        })
      };
    }
    if (inputToken === '0x98a878b1cd98131b271883b390f68d2c90674665') {
      return {
        ok: true,
        json: async () => ({
          routes: [
            {
              outputs: [{ amount: (BigInt(body.inputs[0].amount) / 10n ** 12n).toString() }],
              tx: { to: '0x0000000000000000000000000000000000000007', data: '0x123456' }
            }
          ]
        })
      };
    }
  }

  throw new Error(`Unhandled mock fetch request: ${urlStr}`);
};

// 3. Preprocess app.js and write shadow file
const appPath = path.resolve(__dirname, '../app.js');
let appCode = fs.readFileSync(appPath, 'utf8');
appCode = appCode.replace(/import\s+\{\s*createWalletClient,\s*createPublicClient,/g, "import { createWalletClient,");
appCode = appCode.replace(/from\s+['"]https:\/\/esm\.sh\/viem['"]/g, "from 'viem'");
appCode = appCode.replace(/from\s+['"]https:\/\/esm\.sh\/viem\/chains['"]/g, "from 'viem/chains'");
appCode = appCode.replace(/from\s+['"]\.\/math\.js['"]/g, "from '../math.js'");
appCode = appCode.replace(/from\s+['"]\.\/labels\.js['"]/g, "from '../labels.js'");
appCode = appCode.replace(/from\s+['"]\.\/builders\.js['"]/g, "from '../builders.js'");

appCode = "\nconst createPublicClient = () => global.mockPublicClient;\n" + appCode;

const shadowPath = path.resolve(__dirname, './app.shadow_different_loan.mjs');
fs.writeFileSync(shadowPath, appCode, 'utf8');

// Mock public client calls
const mockPublicClient = {
  readContract: async ({ address, functionName, args }) => {
    const addr = address.toLowerCase();
    if (functionName === 'position') {
      return [0n, 6000n * 10n**6n, 8000n * 10n**18n];
    }
    if (functionName === 'market') {
      return [0n, 0n, 100n * 10n**6n, 100n * 10n**6n, 0n, 0n];
    }
    if (functionName === 'price') {
      if (addr === '0x0000000000000000000000000000000000000002') {
        return 117n * 10n ** 22n; // PT-old price: 1.17 USDC
      }
      if (addr === '0x0000000000000000000000000000000000000004') {
        return 138n * 10n ** 34n; // PT-new price: 1.38 apxUSD
      }
    }
    if (functionName === 'expiry') {
      return 1800000000n; // future expiry
    }
    return 0n;
  }
};

global.mockPublicClient = mockPublicClient;

try {
  // 4. Import shadow file to run bindings
  const appModule = await import('./app.shadow_different_loan.mjs');
  await new Promise(resolve => setTimeout(resolve, 50));

  // Connect and set parameters for different loan assets
  const oldMarketInput = document.getElementById('oldMarketId');
  const newMarketInput = document.getElementById('newMarketId');
  const oldPtInput = document.getElementById('oldCollateralAddress');
  const newPtInput = document.getElementById('newCollateralAddress');
  const usdcInput = document.getElementById('sourceLoanAddress');
  const newLoanInput = document.getElementById('newLoanAddress');
  const capBorrowCheckbox = document.getElementById('capBorrow');

  oldMarketInput.value = '0xold0000000000000000000000000000000000000000000000000000000000000';
  newMarketInput.value = '0xnew0000000000000000000000000000000000000000000000000000000000000';
  oldPtInput.value = '0x3365554a61CeFF74A76528f9e86C1E87946d16a5';
  newPtInput.value = '0xb5Be35D8fF83D431899b95851CB17a2B4bcEF150';
  usdcInput.value = '0xA0b86991c6218b36c1d19D4a2e9Eb0CE3606eB48';
  newLoanInput.value = '0x98A878b1Cd98131B271883B390f68D2c90674665';

  // Trigger input change handlers
  oldMarketInput.dispatchEvent(new window.Event('input'));
  newMarketInput.dispatchEvent(new window.Event('input'));
  usdcInput.dispatchEvent(new window.Event('input'));
  newLoanInput.dispatchEvent(new window.Event('input'));
  
  await new Promise(resolve => setTimeout(resolve, 100));

  // Check generated CLI command contains custom loan tokens if they are overridden or differ
  let cliCommand = document.getElementById('cliCommandCode').textContent;
  assert.ok(cliCommand.includes("node cli.js rollover"), "CLI command should be generated");

  // Override to a different loan asset address
  newLoanInput.value = '0x1111111111111111111111111111111111111111';
  newLoanInput.dispatchEvent(new window.Event('input'));
  cliCommand = document.getElementById('cliCommandCode').textContent;
  assert.ok(cliCommand.includes('--new-loan 0x1111111111111111111111111111111111111111'), "CLI command should include custom --new-loan address");

  // Restore for simulation execution
  newLoanInput.value = '0x98A878b1Cd98131B271883B390f68D2c90674665';
  newLoanInput.dispatchEvent(new window.Event('input'));

  // Connect wallet
  document.getElementById('loadPositionBtn').click();
  await new Promise(resolve => setTimeout(resolve, 100));

  // Click migrate
  const migrateBtn = document.getElementById('migrateBtn');
  assert.ok(migrateBtn, 'migrateBtn should exist');
  
  // Check if labels updated dynamically
  const debtLabel = document.querySelector('label[for="debtAmount"]') || document.getElementById('debtAmount').previousElementSibling;
  assert.strictEqual(debtLabel.textContent.trim(), 'Source Debt to Repay (USDC)', 'Label should update to generic with symbol "Source Debt to Repay (USDC)"');
  
  // Click migrate
  migrateBtn.click();
  await new Promise(resolve => setTimeout(resolve, 150));

  // Assert that pendingTx was populated correctly with different loan swap routing details
  // Wait, let's verify if the status element has any errors or if it shows success/preview
  const statusEl = document.getElementById('status');
  if (statusEl.style.display !== 'none' && statusEl.className === 'error') {
    throw new Error(`Migration simulation failed: ${statusEl.innerText}`);
  }

  const rawCalldata = document.getElementById('rawCalldataTextarea').value;
  assert.ok(rawCalldata, 'Calldata should be generated');
  assert.ok(rawCalldata.startsWith('0x'), 'Calldata should start with 0x');

  const previewMetricsHtml = document.getElementById('previewMetrics').innerHTML;
  console.log('DEBUG previewMetricsHtml:', previewMetricsHtml);
  assert.ok(previewMetricsHtml.includes('1 apxUSD = 0.8394 USDC'), `Expected Swap Rate should be 0.8394 USDC but got: ${previewMetricsHtml}`);

  console.log('✅ UI Different Loan Asset Rollover Tests Passed!');
} finally {
  if (fs.existsSync(shadowPath)) {
    fs.unlinkSync(shadowPath);
  }
}
