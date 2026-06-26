import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('Running JSDOM CLI UI Component Tests...');

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

// Mock global fetch for API calls
global.fetch = async (url, options) => {
  const urlStr = typeof url === 'string' ? url : url.toString();
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
  throw new Error(`Unhandled mock fetch request: ${urlStr}`);
};

// 3. Preprocess app.js and write shadow file
const appPath = path.resolve(__dirname, '../app.js');
let appCode = fs.readFileSync(appPath, 'utf8');
appCode = appCode.replace(/from\s+['"]https:\/\/esm\.sh\/viem['"]/g, "from 'viem'");
appCode = appCode.replace(/from\s+['"]https:\/\/esm\.sh\/viem\/chains['"]/g, "from 'viem/chains'");
appCode = appCode.replace(/from\s+['"]\.\/math\.js['"]/g, "from '../math.js'");
appCode = appCode.replace(/from\s+['"]\.\/labels\.js['"]/g, "from '../labels.js'");
appCode = appCode.replace(/from\s+['"]\.\/builders\.js['"]/g, "from '../builders.js'");

const shadowPath = path.resolve(__dirname, './app.shadow_cli.mjs');
fs.writeFileSync(shadowPath, appCode, 'utf8');

try {
  // 4. Import shadow file to run bindings
  await import('./app.shadow_cli.mjs');
  await new Promise(resolve => setTimeout(resolve, 50));

  // --- Test Case 1: Elements existence ---
  const cliCard = document.getElementById('cliCard');
  const cliHeader = document.getElementById('cliHeader');
  const cliCommandCode = document.getElementById('cliCommandCode');
  const copyCliBtn = document.getElementById('copyCliBtn');
  const cliToggleText = document.getElementById('cliToggleText');

  assert.ok(cliCard, "cliCard element should exist in DOM");
  assert.ok(cliHeader, "cliHeader element should exist in DOM");
  assert.ok(cliCommandCode, "cliCommandCode element should exist in DOM");
  assert.ok(copyCliBtn, "copyCliBtn element should exist in DOM");
  assert.ok(cliToggleText, "cliToggleText element should exist in DOM");

  // --- Test Case 2: Expand/Collapse click toggle ---
  assert.strictEqual(cliCard.classList.contains('expanded'), false, "CLI card should be collapsed by default");
  assert.strictEqual(cliToggleText.textContent, 'Click to expand');

  cliHeader.click();
  assert.strictEqual(cliCard.classList.contains('expanded'), true, "CLI card should be expanded after click");
  assert.strictEqual(cliToggleText.textContent, 'Click to collapse');

  cliHeader.click();
  assert.strictEqual(cliCard.classList.contains('expanded'), false, "CLI card should collapse again on second click");
  assert.strictEqual(cliToggleText.textContent, 'Click to expand');

  // --- Test Case 3: Initial Rollover command value ---
  let command = cliCommandCode.textContent;
  console.log("Default Rollover Command:\n", command);
  assert.ok(command.includes("node cli.js rollover"), "Command should be a rollover command");
  assert.ok(command.includes("--old-market-id 0xa75bb490ecfee90c86a9d22ebc2dde42fb83478b3f18722b9fc6f5f668cab124"), "Should output default old market ID");
  assert.ok(command.includes("--new-market-id 0xb37c30f34bff11c81ee8400133965f450a5f7c5d81ba2cf5740076f49eabc95c"), "Should output default new market ID");
  assert.ok(command.includes("--type full"), "Should default to type full");
  assert.ok(command.includes("--user <user-address>"), "Should default to <user-address> placeholder when wallet not connected");
  assert.ok(command.includes("--simulation"), "Should include --simulation flag by default");

  // --- Test Case 4: Inputs changes updates command live ---
  document.getElementById('oldMarketId').value = "0x1111111111111111111111111111111111111111111111111111111111111111";
  document.getElementById('oldMarketId').dispatchEvent(new window.Event('input'));
  command = cliCommandCode.textContent;
  assert.ok(command.includes("--old-market-id 0x1111111111111111111111111111111111111111111111111111111111111111"), "Command old-market-id should change when input field is changed");

  // Toggle migration type to partial
  document.getElementById('togglePartial').click();
  command = cliCommandCode.textContent;
  assert.ok(command.includes("--type partial"), "Command should update to type partial");
  
  // Custom slippage
  document.getElementById('slippage').value = "1.5";
  document.getElementById('slippage').dispatchEvent(new window.Event('input'));
  command = cliCommandCode.textContent;
  assert.ok(command.includes("--slippage 1.5"), "Command slippage should update to 1.5");

  // --- Test Case 5: Tab Switch to Leverage adjust updates command ---
  const tabLeverage = document.getElementById('tabHeaderLeverage');
  tabLeverage.click();
  await new Promise(resolve => setTimeout(resolve, 10)); // allow callback to propagate

  command = cliCommandCode.textContent;
  console.log("Default Leverage Command:\n", command);
  assert.ok(command.includes("node cli.js adjust-leverage"), "Command should switch to adjust-leverage");
  assert.ok(command.includes("--market-id 0xa75bb490ecfee90c86a9d22ebc2dde42fb83478b3f18722b9fc6f5f668cab124"), "Should use default leverage market ID");
  assert.ok(command.includes("--target-leverage 3.00"), "Should use default target leverage slider value (3.00)");
  assert.ok(command.includes("--simulation"), "Should contain --simulation flag");

  // Change slider value
  document.getElementById('levSlider').value = "4.55";
  document.getElementById('levSlider').dispatchEvent(new window.Event('input'));
  command = cliCommandCode.textContent;
  assert.ok(command.includes("--target-leverage 4.55"), "Target leverage should change to 4.55 when slider moves");

  // Connect wallet changes user address in command
  document.getElementById('loadPositionBtn').click();
  await new Promise(resolve => setTimeout(resolve, 50));
  command = cliCommandCode.textContent;
  assert.ok(command.includes("--user 0x0000000000000000000000000000000000000005"), "Command should reflect connected wallet address");

  console.log("All JSDOM CLI UI Component Tests passed successfully!");
} finally {
  if (fs.existsSync(shadowPath)) {
    fs.unlinkSync(shadowPath);
  }
}
