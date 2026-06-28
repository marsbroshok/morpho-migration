/**
 * Dynamic configuration loader for both Node.js and browser environments.
 * config.json is the single source of truth for default contract addresses.
 */

const config = {
  MORPHO_BLUE: "",
  MORPHO_BUNDLER_V3: "",
  ETHER_GENERAL_ADAPTER_1: "",
  PERMIT2_ADDRESS: "",
  PENDLE_ROUTER: "",
  PENDLE_LIMIT_ROUTER: ""
};

// Environment detection
const isNode = typeof process !== 'undefined' && process.env;

if (isNode) {
  try {
    // Dynamic import to avoid breaking browser compatibility
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const configPath = path.resolve(__dirname, './config.json');

    if (fs.existsSync(configPath)) {
      const fileData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (fileData.contracts && fileData.contracts["1"]) {
        Object.assign(config, fileData.contracts["1"]);
      }
    } else {
      throw new Error(`config.json not found at ${configPath}`);
    }
  } catch (err) {
    console.error("Critical: Failed to load config.json in Node.js:", err);
    throw err;
  }

  // Support environment variables override
  config.MORPHO_BLUE = process.env.MORPHO_BLUE || config.MORPHO_BLUE;
  config.MORPHO_BUNDLER_V3 = process.env.MORPHO_BUNDLER_V3 || config.MORPHO_BUNDLER_V3;
  config.ETHER_GENERAL_ADAPTER_1 = process.env.ETHER_GENERAL_ADAPTER_1 || config.ETHER_GENERAL_ADAPTER_1;
  config.PERMIT2_ADDRESS = process.env.PERMIT2_ADDRESS || config.PERMIT2_ADDRESS;
  config.PENDLE_ROUTER = process.env.PENDLE_ROUTER || config.PENDLE_ROUTER;
  config.PENDLE_LIMIT_ROUTER = process.env.PENDLE_LIMIT_ROUTER || config.PENDLE_LIMIT_ROUTER;
}

/**
 * Fetch configuration in the browser from config.json.
 */
export async function initializeConfig() {
  if (typeof window !== 'undefined') {
    try {
      const response = await fetch('./config.json');
      if (response.ok) {
        const fileData = await response.json();
        if (fileData.contracts && fileData.contracts["1"]) {
          Object.assign(config, fileData.contracts["1"]);
          return;
        }
      }
      throw new Error(`Failed to fetch config.json: status ${response.status}`);
    } catch (err) {
      console.error("Critical: Could not load config.json from browser:", err);
      throw err;
    }
  }
}

export default config;
