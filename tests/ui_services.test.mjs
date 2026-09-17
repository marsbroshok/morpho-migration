import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import { UiStateStore } from '../src/ui/state/ui-state-store.js';
import { ErrorBanner } from '../src/ui/components/error-banner.js';
import { MarketSelector } from '../src/ui/components/market-selector.js';
import { PositionPreview } from '../src/ui/components/position-preview.js';
import { WalletModal } from '../src/ui/components/wallet-modal.js';
import { AppController } from '../src/ui/app-controller.js';

console.log('--- Running UI State and Components Unit Tests (TDD) ---');

// Setup mock DOM environment
const dom = new JSDOM(`
  <!DOCTYPE html>
  <html>
  <head></head>
  <body>
    <div id="globalErrorBanner" style="display: none;"></div>
    <div id="status" style="display: none;"></div>
    <div id="wcModal" style="display: none;">
      <button id="closeWcModalBtn"></button>
    </div>
    <input id="oldMarketId" value="" />
    <input id="oldCollateralAddress" value="" />
    <span id="oldCollateralSymbol"></span>
    <span id="oldPtExpiry"></span>
    <div id="positionDetails"></div>
    <div id="simulationResultContainer"></div>
    <button id="tabHeaderRollover" class="tab-btn active"></button>
    <button id="tabHeaderLeverage" class="tab-btn"></button>
    <div id="tabContentRollover" class="tab-content active"></div>
    <div id="tabContentLeverage" class="tab-content"></div>
  </body>
  </html>
`);

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Event = dom.window.Event;

// ==========================================
// 1. UiStateStore Tests
// ==========================================
console.log('Testing UiStateStore...');
{
  const store = new UiStateStore();
  assert.strictEqual(store.get('userAddress'), null);

  let notified = false;
  store.subscribe((key, val) => {
    if (key === 'userAddress' && val === '0x1234567890123456789012345678901234567890') {
      notified = true;
    }
  });

  store.set('userAddress', '0x1234567890123456789012345678901234567890');
  assert.strictEqual(store.get('userAddress'), '0x1234567890123456789012345678901234567890');
  assert.strictEqual(notified, true);

  store.update('settings', { alchemyKey: 'my-key' });
  assert.strictEqual(store.get('settings').alchemyKey, 'my-key');

  store.reset();
  assert.strictEqual(store.get('userAddress'), null);
}
console.log('✅ UiStateStore tests passed!');

// ==========================================
// 2. ErrorBanner Tests
// ==========================================
console.log('Testing ErrorBanner...');
{
  const banner = new ErrorBanner(document);
  banner.showError('Something went wrong!', 'global');
  const globalBannerEl = document.getElementById('globalErrorBanner');
  assert.strictEqual(globalBannerEl.style.display, 'block');
  assert.ok(globalBannerEl.textContent.includes('Something went wrong!'));

  banner.clearError('global');
  assert.strictEqual(globalBannerEl.style.display, 'none');

  banner.showInfo('Loading data...', 'status');
  const statusEl = document.getElementById('status');
  assert.strictEqual(statusEl.style.display, 'block');
  assert.strictEqual(statusEl.className, 'info');
  assert.ok(statusEl.textContent.includes('Loading data...'));
}
console.log('✅ ErrorBanner tests passed!');

// ==========================================
// 3. MarketSelector Tests
// ==========================================
console.log('Testing MarketSelector...');
{
  const mockMarketService = {
    fetchMarketParams: async () => ({
      loanToken: '0xusdc',
      collateralToken: '0xpt',
      loanSymbol: 'USDC',
      collateralSymbol: 'PT-USDe',
      loanDecimals: 6,
      collateralDecimals: 18,
      oracle: '0xoracle',
      irm: '0xirm',
      lltv: 860000000000000000n
    }),
    checkCollateralMaturity: async () => ({
      expiryDate: '12/31/2025',
      isExpired: false
    })
  };

  const selector = new MarketSelector(document, mockMarketService);
  let resolvedParams = null;

  await selector.handleMarketIdInput({
    marketId: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    collateralInputId: 'oldCollateralAddress',
    symbolLabelId: 'oldCollateralSymbol',
    expiryLabelId: 'oldPtExpiry',
    onResolved: (params) => {
      resolvedParams = params;
    }
  });

  assert.strictEqual(resolvedParams.loanSymbol, 'USDC');
  assert.strictEqual(document.getElementById('oldCollateralAddress').value, '0xpt');
  assert.strictEqual(document.getElementById('oldCollateralSymbol').textContent, 'PT-USDe');
  assert.strictEqual(document.getElementById('oldPtExpiry').textContent, 'Maturity: 12/31/2025');
}
console.log('✅ MarketSelector tests passed!');

// ==========================================
// 4. PositionPreview Tests
// ==========================================
console.log('Testing PositionPreview...');
{
  const preview = new PositionPreview(document);
  preview.renderPositionDetails('positionDetails', {
    debtFormatted: '1,000.00 USDC',
    collateralFormatted: '2,000.00 PT-USDe',
    ltvFormatted: '50.00%',
    leverageFormatted: '2.00x',
    healthFactorFormatted: '1.72'
  });

  const posEl = document.getElementById('positionDetails');
  assert.ok(posEl.innerHTML.includes('1,000.00 USDC'));
  assert.ok(posEl.innerHTML.includes('2,000.00 PT-USDe'));
  assert.ok(posEl.innerHTML.includes('50.00%'));

  preview.renderSimulationResult('simulationResultContainer', {
    success: true,
    gasUsed: 1200000n,
    traceTree: {
      to: '0xbundler',
      gasUsed: '0x124f80',
      calls: []
    },
    leaks: []
  });

  const simEl = document.getElementById('simulationResultContainer');
  assert.ok(simEl.innerHTML.includes('SIMULATION SUCCESSFUL'));
  assert.ok(simEl.innerHTML.includes('1,200,000'));
}
console.log('✅ PositionPreview tests passed!');

// ==========================================
// 5. WalletModal Tests
// ==========================================
console.log('Testing WalletModal...');
{
  const modal = new WalletModal(document);
  modal.showModal();
  assert.strictEqual(document.getElementById('wcModal').style.display, 'flex');

  modal.hideModal();
  assert.strictEqual(document.getElementById('wcModal').style.display, 'none');
}
console.log('✅ WalletModal tests passed!');

// ==========================================
// 6. AppController Tests
// ==========================================
console.log('Testing AppController...');
{
  const controller = new AppController(document);
  assert.ok(controller.stateStore instanceof UiStateStore);
  assert.ok(controller.errorBanner instanceof ErrorBanner);
  assert.ok(controller.marketSelector instanceof MarketSelector);
  assert.ok(controller.positionPreview instanceof PositionPreview);
  assert.ok(controller.walletModal instanceof WalletModal);

  controller.switchTab('leverage');
  assert.strictEqual(controller.stateStore.get('activeTab'), 'leverage');
  assert.ok(document.getElementById('tabHeaderLeverage').classList.contains('active'));
  assert.ok(!document.getElementById('tabHeaderRollover').classList.contains('active'));
}
console.log('✅ AppController tests passed!');
console.log('🎉 All UI State and Components unit tests passed successfully!');
