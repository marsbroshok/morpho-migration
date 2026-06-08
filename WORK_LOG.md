# Project Work Log

## 2026-06-08 - Fixed EIP-55 Checksum Errors

### Summary of Investigation
1. **The Bug:** The user encountered an error stating `Address "0x4095F064B8d3c3548A3beBFd04df03b827EE8359" is invalid. Address must match its checksum counterpart.`
2. **Analysis:**
   * Viem performs strict EIP-55 checksum validation on mixed-case Ethereum addresses. If an address contains mixed case, the case pattern must exactly match the Keccak-256 hash of its lowercased string.
   * The hardcoded addresses for `MORPHO_BLUE` and `MORPHO_BUNDLER_V3` had incorrect case configurations.
3. **Resolution:**
   * Installed `viem` locally in the scratch directory and ran a Node command to compute the correct checksummed versions of all addresses:
     ```bash
     node -e "const { getAddress } = require('viem'); console.log(getAddress('0x4095f064b8d3c3548a3bebfd04df03b827ee8359'))"
     ```
   * The corrected capitalizations are:
     * **MORPHO_BLUE:** `0xbBbbBBbBBb9CCEd63b7B73Fe30472d223547645e` (corrected from `0xBBBBBbbBBb9CCEd63b7B73fE30472D223547645E`)
     * **MORPHO_BUNDLER_V3:** `0x4095f064b8d3c3548A3BeBfD04dF03B827eE8359` (corrected from `0x4095F064B8d3beBFd04df03b827EE8359`)

### Changes Applied
* **File Updated:** [index.html](file:///Users/auv/Documents/Work/vibe-it-now-or-never/morpho-migration/index.html)
  * Replaced `MORPHO_BLUE` and `MORPHO_BUNDLER_V3` constants with their correct EIP-55 checksummed versions.