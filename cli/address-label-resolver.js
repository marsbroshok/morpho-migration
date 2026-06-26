import { getAddress } from 'viem';

const KNOWN_CONTRACTS = {
  "0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb": "Morpho Blue Core",
  "0x6566194141eefa99af43bb5aa71460ca2dc90245": "Morpho Bundler V3",
  "0x4a6c312ec70e8747a587ee860a0353cd42be0ae0": "Ether General Adapter V1"
};

export class AddressLabelResolver {
  /**
   * @param {object} publicClient Viem Public Client
   */
  constructor(publicClient) {
    this.publicClient = publicClient;
    this.cache = {};
  }

  /**
   * Resolve label for any address. Cache resolved names to prevent duplicate RPC calls.
   * @param {string} address
   * @param {object} [marketParams] Current market parameters for context
   * @returns {Promise<string|null>}
   */
  async resolveLabel(address, marketParams = null) {
    if (!address) return null;
    let cleanAddr;
    try {
      cleanAddr = getAddress(address);
    } catch (err) {
      return null;
    }
    const key = cleanAddr.toLowerCase();

    if (this.cache[key]) return this.cache[key];

    // 1. Check known system contracts
    if (KNOWN_CONTRACTS[key]) {
      this.cache[key] = KNOWN_CONTRACTS[key];
      return this.cache[key];
    }

    // 2. Check current market params context
    if (marketParams) {
      if (marketParams.collateralToken && key === getAddress(marketParams.collateralToken).toLowerCase()) {
        this.cache[key] = `Collateral (${marketParams.collateralSymbol})`;
        return this.cache[key];
      }
      if (marketParams.loanToken && key === getAddress(marketParams.loanToken).toLowerCase()) {
        this.cache[key] = `Loan Asset (${marketParams.loanSymbol})`;
        return this.cache[key];
      }
    }

    // 3. Dynamic On-Chain Query (ERC20 symbol check)
    try {
      const symbol = await this.publicClient.readContract({
        address: cleanAddr,
        abi: [{"inputs":[],"name":"symbol","outputs":[{"name":"","type":"string"}],"stateMutability":"view","type":"function"}],
        functionName: 'symbol'
      });
      this.cache[key] = `${symbol}`;
      return this.cache[key];
    } catch (err) {
      // Fallback to generic address label
      return null;
    }
  }
}
