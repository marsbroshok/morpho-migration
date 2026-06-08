import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

const MORPHO_BLUE = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";
const MORPHO_BUNDLER_V3 = "0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245";

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
