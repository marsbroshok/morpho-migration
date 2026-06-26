import { SignClient } from '@walletconnect/sign-client';
import qrcode from 'qrcode-terminal';
import { createWalletClient, custom } from 'viem';
import { mainnet } from 'viem/chains';

export class WalletConnector {
  /**
   * @param {string} projectId 
   * @param {object} [dependencies]
   * @param {object} [dependencies.SignClient]
   * @param {object} [dependencies.qrcode]
   */
  constructor(projectId, dependencies = {}) {
    this.projectId = projectId;
    this.client = null;
    this.session = null;
    this.SignClient = dependencies.SignClient || SignClient;
    this.qrcode = dependencies.qrcode || qrcode;
  }

  async initialize() {
    this.client = await this.SignClient.init({
      projectId: this.projectId,
      metadata: {
        name: 'Morpho Blue PT Position Migrator',
        description: 'CLI tool to migrate Morpho Blue PT positions',
        url: 'https://github.com/marsbroshok/morpho-migration',
        icons: ['https://walletconnect.org/walletconnect-logo.png']
      }
    });
  }

  async connect() {
    if (!this.client) {
      throw new Error("WalletConnector not initialized. Call initialize() first.");
    }

    const { uri, approval } = await this.client.connect({
      requiredNamespaces: {
        eip155: {
          methods: [
            'eth_sendTransaction',
            'eth_signTransaction',
            'eth_sign',
            'personal_sign',
            'eth_accounts',
            'eth_requestAccounts'
          ],
          chains: ['eip155:1'],
          events: ['chainChanged', 'accountsChanged']
        }
      }
    });

    if (uri) {
      console.log('\n--- WALLETCONNECT PAIRING REQUIRED ---');
      console.log('Scan the QR code below or copy the connection URI to Rabby Wallet:\n');
      
      this.qrcode.generate(uri, { small: true });

      console.log('\nRaw Connection URI:');
      console.log(uri);
      console.log('\nWaiting for wallet pairing confirmation...');
    }

    this.session = await approval();
    console.log('Wallet paired successfully! Connected Session Topic:', this.session.topic);
  }

  /**
   * Returns a custom Viem walletClient that forwards calls to WalletConnect session.
   */
  getWalletClient() {
    if (!this.session) {
      throw new Error("No active WalletConnect session. Connect first.");
    }

    const self = this;
    const customProvider = {
      request: async (requestObj) => {
        if (requestObj.method === 'eth_requestAccounts' || requestObj.method === 'eth_accounts') {
          // Extract accounts from eip155 namespace
          const accounts = self.session.namespaces.eip155.accounts;
          return accounts.map(acc => acc.split(':')[2]);
        }

        if (requestObj.method === 'eth_chainId') {
          return '0x1';
        }

        // Forward arbitrary JSON-RPC calls via WalletConnect sign client request
        const accounts = self.session.namespaces.eip155.accounts;
        const fromAddress = accounts[0].split(':')[2];

        try {
          const result = await self.client.request({
            topic: self.session.topic,
            chainId: 'eip155:1',
            request: {
              method: requestObj.method,
              params: requestObj.params || []
            }
          });
          return result;
        } catch (err) {
          console.error(`WalletConnect RPC request error for ${requestObj.method}:`, err.message);
          throw err;
        }
      }
    };

    return createWalletClient({
      chain: mainnet,
      transport: custom(customProvider)
    });
  }
}
