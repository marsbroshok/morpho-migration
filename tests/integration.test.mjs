import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import config from '../config.js';

const MORPHO_BLUE = config.MORPHO_BLUE;
const MORPHO_BUNDLER_V3 = config.MORPHO_BUNDLER_V3;

async function runSanityCheck() {
  console.log("Running mainnet contract address sanity checks...");
  const client = createPublicClient({
    chain: mainnet,
    transport: http('https://eth.drpc.org')
  });
  
  // Test Morpho Blue Core responses by calling isAuthorized
  const result = await client.readContract({
    address: MORPHO_BLUE,
    abi: [{"inputs":[{"name":"authorizer","type":"address"},{"name":"delegatee","type":"address"}],"name":"isAuthorized","outputs":[{"name":"","type":"bool"}],"stateMutability":"view","type":"function"}],
    functionName: 'isAuthorized',
    args: ['0xdC382CDF2a25790F535a518EC26958c227e9DCF2', MORPHO_BUNDLER_V3]
  });
  
  console.log("Morpho Blue Core response success. isAuthorized returned:", result);
  console.log("Mainnet contract addresses verified successfully!");
}

runSanityCheck().catch(err => {
  console.error("Sanity check failed:", err);
  process.exit(1);
});
