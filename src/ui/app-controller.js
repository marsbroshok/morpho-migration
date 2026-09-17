/**
 * @fileoverview Main frontend controller coordinating UI components and core services.
 */

import { UiStateStore } from './state/ui-state-store.js';
import { ErrorBanner } from './components/error-banner.js';
import { MarketSelector } from './components/market-selector.js';
import { PositionPreview } from './components/position-preview.js';
import { WalletModal } from './components/wallet-modal.js';
import { CliCommandGenerator } from './components/cli-command-generator.js';
import { MorphoMarketService } from '../core/services/morpho-market-service.js';
import { SwapQuoterService } from '../core/services/swap-quoter-service.js';
import { SimulationService } from '../core/services/simulation-service.js';

/**
 * Coordinates user events, component states, and business services.
 */
export class AppController {
  /**
   * @param {Document} doc
   * @param {object} [dependencies]
   */
  constructor(doc = typeof document !== 'undefined' ? document : null, dependencies = {}) {
    this.doc = doc;
    this.stateStore = dependencies.stateStore || new UiStateStore();
    this.errorBanner = dependencies.errorBanner || new ErrorBanner(doc);
    this.marketService = dependencies.marketService || new MorphoMarketService();
    this.swapQuoterService = dependencies.swapQuoterService || new SwapQuoterService();
    this.simulationService = dependencies.simulationService || new SimulationService();
    this.marketSelector = dependencies.marketSelector || new MarketSelector(doc, this.marketService);
    this.positionPreview = dependencies.positionPreview || new PositionPreview(doc);
    this.walletModal = dependencies.walletModal || new WalletModal(doc);
    this.cliGenerator = dependencies.cliGenerator || new CliCommandGenerator(doc, this.stateStore);
  }

  /**
   * Switches active navigation tab in the interface.
   *
   * @param {'rollover'|'leverage'|'simulateRaw'|'settings'} tabName
   */
  switchTab(tabName) {
    if (!this.doc) return;
    this.stateStore.set('activeTab', tabName);
    this.cliGenerator.update(tabName);

    const tabMap = {
      rollover: { header: 'tabHeaderRollover', content: 'tabContentRollover' },
      leverage: { header: 'tabHeaderLeverage', content: 'tabContentLeverage' },
      simulateRaw: { header: 'tabHeaderSimulateRaw', content: 'tabContentSimulateRaw' },
      settings: { header: 'tabHeaderSettings', content: 'tabContentSettings' }
    };

    for (const [key, mapping] of Object.entries(tabMap)) {
      const headerEl = this.doc.getElementById(mapping.header);
      const contentEl = this.doc.getElementById(mapping.content);

      if (headerEl) {
        if (key === tabName) {
          headerEl.classList.add('active');
        } else {
          headerEl.classList.remove('active');
        }
      }

      if (contentEl) {
        if (key === tabName) {
          contentEl.classList.add('active');
        } else {
          contentEl.classList.remove('active');
        }
      }
    }
  }

  /**
   * Binds click events to all top-level tab headers.
   */
  bindTabHeaders() {
    if (!this.doc) return;
    const tabHeaders = [
      { id: 'tabHeaderRollover', name: 'rollover' },
      { id: 'tabHeaderLeverage', name: 'leverage' },
      { id: 'tabHeaderSimulateRaw', name: 'simulateRaw' },
      { id: 'tabHeaderSettings', name: 'settings' }
    ];

    for (const { id, name } of tabHeaders) {
      const el = this.doc.getElementById(id);
      if (el) {
        el.addEventListener('click', () => {
          this.switchTab(name);
        });
      }
    }
  }

  /**
   * Autoloads configuration settings from `.env` file if accessible.
   */
  async autoloadSettings() {
    if (!this.doc) return;
    try {
      const response = await fetch('.env');
      if (!response.ok) return;

      const text = await response.text();
      const lines = text.split('\n');

      let alchemyKey = '';
      let rpcUrl = '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
        const [k, ...v] = trimmed.split('=');
        const key = k.trim();
        const val = v.join('=').trim().replace(/^["']|["']$/g, '');

        if (key === 'ALCHEMY_API_KEY') {
          alchemyKey = val;
        } else if (key === 'RPC_URL') {
          rpcUrl = val;
        }
      }

      const keyInput = this.doc.getElementById('settingsAlchemyKey');
      const rpcInput = this.doc.getElementById('settingsRpcUrl');

      if (keyInput && alchemyKey) {
        keyInput.value = alchemyKey;
      }
      if (rpcInput && (rpcUrl || alchemyKey)) {
        rpcInput.value = rpcUrl || `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`;
      }

      this.stateStore.update('settings', {
        alchemyKey: keyInput?.value || '',
        rpcUrl: rpcInput?.value || ''
      });
    } catch {
      // .env autoloading is optional in browser context
    }
  }

  /**
   * Loads settings from localStorage on initial page startup.
   */
  loadSettings() {
    if (!this.doc) return;
    try {
      if (typeof localStorage !== 'undefined') {
        const alchemyKey = localStorage.getItem('morpho_migration_alchemy_key') || '';
        const rpcUrl = localStorage.getItem('morpho_migration_rpc_url') || '';
        const autoSimulate = localStorage.getItem('morpho_migration_auto_simulate') !== 'false';

        const keyInput = this.doc.getElementById('settingsAlchemyKey');
        const rpcInput = this.doc.getElementById('settingsRpcUrl');
        const autoSimInput = this.doc.getElementById('settingsAutoSimulate');

        if (keyInput && alchemyKey) keyInput.value = alchemyKey;
        if (rpcInput && rpcUrl) rpcInput.value = rpcUrl;
        if (autoSimInput) autoSimInput.checked = autoSimulate;
      }
    } catch {
      // ignore restricted storage
    }
  }

  /**
   * Initializes the application controller.
   */
  init() {
    this.errorBanner.initGlobalErrorListeners();
    this.walletModal.bindCloseButton();
    this.bindTabHeaders();
    this.cliGenerator.init();
    this.loadSettings();
    this.autoloadSettings();
  }
}
