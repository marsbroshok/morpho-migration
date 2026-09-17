import { createPublicClient, createWalletClient, http, getAddress } from 'viem';
import { mainnet } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import config from '../config.js';
import { MorphoMarketService } from '../src/core/services/morpho-market-service.js';

const MORPHO_BLUE = config.MORPHO_BLUE;

const MORPHO_BLUE_ABI = [
  {
    "inputs": [
      { "name": "id", "type": "bytes32" },
      { "name": "user", "type": "address" }
    ],
    "name": "position",
    "outputs": [
      { "name": "supplyShares", "type": "uint256" },
      { "name": "borrowShares", "type": "uint128" },
      { "name": "collateral", "type": "uint128" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "name": "id", "type": "bytes32" }
    ],
    "name": "market",
    "outputs": [
      { "name": "totalSupplyAssets", "type": "uint128" },
      { "name": "totalSupplyShares", "type": "uint128" },
      { "name": "totalBorrowAssets", "type": "uint128" },
      { "name": "totalBorrowShares", "type": "uint128" },
      { "name": "lastUpdate", "type": "uint128" },
      { "name": "fee", "type": "uint128" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "name": "authorizer", "type": "address" },
      { "name": "delegatee", "type": "address" }
    ],
    "name": "isAuthorized",
    "outputs": [
      { "name": "", "type": "bool" }
    ],
    "stateMutability": "view",
    "type": "function"
  }
];

export class BlockchainClient {
  /**
   * @param {string|null} rpcUrl 
   * @param {string|object|null} walletSigner 
   */
  constructor(rpcUrl, walletSigner) {
    const transportUrl = rpcUrl || 'https://cloudflare-eth.com';
    this.publicClient = createPublicClient({
      chain: mainnet,
      transport: http(transportUrl)
    });

    if (typeof walletSigner === 'string' && walletSigner.startsWith('0x')) {
      // Local Private Key signer
      const account = privateKeyToAccount(walletSigner);
      this.walletClient = createWalletClient({
        account,
        chain: mainnet,
        transport: http(transportUrl)
      });
      this.userAddress = account.address;
    } else if (walletSigner && typeof walletSigner === 'object') {
      // WalletConnect custom walletClient
      this.walletClient = walletSigner;
      // Retrieve address from the walletClient when initialized
      this.userAddress = null;
    } else {
      this.walletClient = null;
      this.userAddress = null;
    }
    this.marketService = new MorphoMarketService(MORPHO_BLUE);
  }

  getBlockNumber() {
    return process.env.FORK_BLOCK_NUMBER ? BigInt(process.env.FORK_BLOCK_NUMBER) : undefined;
  }

  async fetchMorphoPosition(marketId, userAddress, forceLive = false) {
    if (!forceLive && (process.env.MOCK_POSITION_DEBT !== undefined || process.env.MOCK_POSITION_COLLATERAL !== undefined)) {
      const debt = process.env.MOCK_POSITION_DEBT ? BigInt(process.env.MOCK_POSITION_DEBT) : 0n;
      const collateral = process.env.MOCK_POSITION_COLLATERAL ? BigInt(process.env.MOCK_POSITION_COLLATERAL) : 1000000000000000000n;
      const borrowShares = debt;
      return { collateral, debt, borrowShares };
    }
    return await this.marketService.fetchPosition(
      this.publicClient,
      marketId,
      userAddress,
      this.getBlockNumber()
    );
  }

  async fetchMarketParams(marketId) {
    return await this.marketService.fetchMarketParams(marketId);
  }

  async fetchDecimals(tokenAddress) {
    return await this.marketService.fetchTokenDecimals(
      this.publicClient,
      tokenAddress,
      this.getBlockNumber()
    );
  }

  async checkCollateralMaturity(collateralAddress) {
    return await this.marketService.checkCollateralMaturity(
      this.publicClient,
      collateralAddress,
      this.getBlockNumber()
    );
  }

  /**
   * Check allowance of a spender for a specific token and user.
   */
  async checkAllowance(tokenAddress, ownerAddress, spenderAddress) {
    return await this.publicClient.readContract({
      address: tokenAddress,
      abi: [
        {
          "inputs": [
            { "name": "owner", "type": "address" },
            { "name": "spender", "type": "address" }
          ],
          "name": "allowance",
          "outputs": [{ "name": "", "type": "uint256" }],
          "stateMutability": "view",
          "type": "function"
        }
      ],
      functionName: 'allowance',
      args: [ownerAddress, spenderAddress],
      blockNumber: this.getBlockNumber()
    });
  }

  /**
   * Execute ERC20 token approval.
   */
  async approveToken(tokenAddress, spenderAddress, amount) {
    const { encodeFunctionData } = await import('viem');
    const data = encodeFunctionData({
      abi: [{
        "inputs": [
          { "name": "spender", "type": "address" },
          { "name": "amount", "type": "uint256" }
        ],
        "name": "approve",
        "outputs": [{ "name": "", "type": "bool" }],
        "stateMutability": "nonpayable",
        "type": "function"
      }],
      functionName: 'approve',
      args: [spenderAddress, amount]
    });

    return await this.executeTransaction({
      to: tokenAddress,
      data,
      value: 0n
    });
  }

  /**
   * Check internal Permit2 allowance of a spender for a specific token and user.
   */
  async checkPermit2Allowance(tokenAddress, ownerAddress, spenderAddress) {
    const PERMIT2_ADDRESS = config.PERMIT2_ADDRESS;
    const [amount, expiration, nonce] = await this.publicClient.readContract({
      address: PERMIT2_ADDRESS,
      abi: [
        {
          "inputs": [
            { "name": "owner", "type": "address" },
            { "name": "token", "type": "address" },
            { "name": "spender", "type": "address" }
          ],
          "name": "allowance",
          "outputs": [
            { "name": "amount", "type": "uint160" },
            { "name": "expiration", "type": "uint48" },
            { "name": "nonce", "type": "uint48" }
          ],
          "stateMutability": "view",
          "type": "function"
        }
      ],
      functionName: 'allowance',
      args: [ownerAddress, tokenAddress, spenderAddress],
      blockNumber: this.getBlockNumber()
    });

    // Check if the allowance has expired
    const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));
    if (expiration <= currentTimestamp) {
      return 0n;
    }
    return amount;
  }

  /**
   * Execute Permit2 token approval.
   */
  async approvePermit2(tokenAddress, spenderAddress, amount) {
    const PERMIT2_ADDRESS = config.PERMIT2_ADDRESS;
    const { encodeFunctionData } = await import('viem');
    
    // Default expiration to max uint48 (approx 8900 years)
    const maxExpiration = 281474976710655n; 
    
    const data = encodeFunctionData({
      abi: [{
        "inputs": [
          { "name": "token", "type": "address" },
          { "name": "spender", "type": "address" },
          { "name": "amount", "type": "uint160" },
          { "name": "expiration", "type": "uint48" }
        ],
        "name": "approve",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      }],
      functionName: 'approve',
      args: [tokenAddress, spenderAddress, amount, maxExpiration]
    });

    return await this.executeTransaction({
      to: PERMIT2_ADDRESS,
      data,
      value: 0n
    });
  }


  async isAuthorized(userAddress, spenderAddress) {
    return await this.marketService.isAuthorized(
      this.publicClient,
      userAddress,
      spenderAddress,
      MORPHO_BLUE,
      this.getBlockNumber()
    );
  }

  async executeTransaction({ to, data, value }) {
    if (!this.walletClient) {
      throw new Error("Wallet execution required. Please provide a private key or connect via WalletConnect.");
    }
    if (!this.userAddress) {
      const addresses = await this.walletClient.getAddresses();
      this.userAddress = getAddress(addresses[0]);
    }
    
    return await this.walletClient.sendTransaction({
      account: this.userAddress,
      to,
      data,
      value: value || 0n
    });
  }
}
