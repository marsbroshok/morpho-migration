import { createWalletClient, createPublicClient, http, custom, getAddress, encodeFunctionData, encodeAbiParameters, keccak256 } from 'https://esm.sh/viem';
import { mainnet } from 'https://esm.sh/viem/chains';
import { calculateCollateralValue, calculateLtv, calculateLeverage, calculateLeverageAdjustmentParams } from './math.js';
import { formatMarketLabel } from './labels.js';
import { buildDeleveragingBundle, buildLeveragingUpBundle, ERC20_ABI, ADAPTER_ABI } from './builders.js';

// --- CONSTANTS & ABIs ---
const MORPHO_BLUE = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";
const MORPHO_BUNDLER_V3 = "0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245";
const ETHER_GENERAL_ADAPTER_1 = "0x4A6c312ec70E8747a587EE860a0353cd42Be0aE0";

const BUNDLER_ABI = [
  {
    "inputs": [
      {
        "components": [
          { "name": "to", "type": "address" },
          { "name": "data", "type": "bytes" },
          { "name": "value", "type": "uint256" },
          { "name": "skipRevert", "type": "bool" },
          { "name": "callbackHash", "type": "bytes32" }
        ],
        "name": "bundle",
        "type": "tuple[]"
      }
    ],
    "name": "multicall",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  }
];

async function fetchMarketParams(marketId) {
  const query = `
    query GetMarket($id: String!) {
      markets(where: { uniqueKey_in: [$id] }) {
        items {
          loanAsset { address symbol }
          collateralAsset { address symbol }
          oracleAddress
          irmAddress
          lltv
        }
      }
    }
  `;
  const response = await fetch('https://blue-api.morpho.org/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      variables: { id: marketId }
    })
  });
  if (!response.ok) {
    throw new Error(`Morpho Blue GraphQL API request failed: ${response.statusText}`);
  }
  const result = await response.json();
  if (result.errors && result.errors.length > 0) {
    throw new Error(`Morpho Blue GraphQL API error: ${result.errors[0].message}`);
  }
  const items = result.data.markets.items;
  if (items.length === 0) {
    throw new Error(`Market ID ${marketId} not found on Morpho Blue.`);
  }
  const market = items[0];
  return {
    loanToken: getAddress(market.loanAsset.address),
    collateralToken: getAddress(market.collateralAsset.address),
    loanSymbol: market.loanAsset.symbol,
    collateralSymbol: market.collateralAsset.symbol,
    oracle: getAddress(market.oracleAddress),
    irm: getAddress(market.irmAddress),
    lltv: BigInt(market.lltv)
  };
}

// --- MORPHO BLUE ABI FOR POSITION & MARKET STATE QUERIES ---
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
  }
];

let userAddress = null;
let liveDebt = 0n;
let liveCollateral = 0n;
let migrationType = 'full';
let publicClient = null;

async function fetchMorphoPosition(publicClient, marketId, userAddress) {
  const [posData, marketData] = await Promise.all([
    publicClient.readContract({
      address: MORPHO_BLUE,
      abi: MORPHO_BLUE_ABI,
      functionName: 'position',
      args: [marketId, userAddress]
    }),
    publicClient.readContract({
      address: MORPHO_BLUE,
      abi: MORPHO_BLUE_ABI,
      functionName: 'market',
      args: [marketId]
    })
  ]);

  const [, borrowShares, collateral] = posData;
  const [,, totalBorrowAssets, totalBorrowShares] = marketData;

  let debt = 0n;
  if (borrowShares > 0n && totalBorrowShares > 0n) {
    debt = (borrowShares * totalBorrowAssets) / totalBorrowShares;
  }

  return { collateral, debt };
}

async function fetchPendleRoute(inputToken, inputAmount, outputToken, slippage) {
  const chainId = 1;
  const pendleApiUrl = `https://api-v2.pendle.finance/core/v3/sdk/${chainId}/convert`;
  const response = await fetch(pendleApiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      receiver: ETHER_GENERAL_ADAPTER_1,
      slippage: slippage,
      inputs: [
        {
          token: inputToken,
          amount: inputAmount.toString()
        }
      ],
      outputs: [
        outputToken
      ],
      enableAggregator: true
    })
  });
  if (!response.ok) {
    const errData = await response.json();
    throw new Error(errData.message || "Failed to fetch routing data from Pendle.");
  }
  const data = await response.json();
  return data.routes[0];
}

async function connectAndLoadPosition() {
  const loadBtn = document.getElementById('loadPositionBtn');
  const statusEl = document.getElementById('status');
  
  statusEl.style.display = 'block';
  statusEl.className = 'info';
  statusEl.innerText = "Connecting to wallet...";
  document.getElementById('payloadContainer').style.display = 'none';

  if (!window.ethereum) {
    showError("No injected wallet found. Please make sure Rabby Wallet is unlocked.");
    return;
  }

  try {
    const walletClient = createWalletClient({
      chain: mainnet,
      transport: custom(window.ethereum)
    });

    publicClient = createPublicClient({
      chain: mainnet,
      transport: custom(window.ethereum)
    });

    const [address] = await walletClient.requestAddresses();
    userAddress = getAddress(address);
    statusEl.innerText = `Connected Wallet: ${userAddress}\nLoading position data from Morpho Blue...`;

    const oldMarketId = document.getElementById('oldMarketId').value.trim();
    if (!oldMarketId || oldMarketId.length !== 66) {
      throw new Error("Please enter a valid 32-byte hex Market ID (66 characters).");
    }

    const position = await fetchMorphoPosition(publicClient, oldMarketId, userAddress);
    liveCollateral = position.collateral;
    liveDebt = position.debt;

    const oldMarketParams = await fetchMarketParams(oldMarketId);
    const oraclePrice = await publicClient.readContract({
      address: oldMarketParams.oracle,
      abi: [{"inputs":[],"name":"price","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"}],
      functionName: 'price'
    });

    const collateralValue = calculateCollateralValue(liveCollateral, oraclePrice);
    const ltv = calculateLtv(liveDebt, collateralValue);
    const leverage = calculateLeverage(collateralValue, liveDebt);

    const formattedCollateral = (Number(liveCollateral) / 1e18).toFixed(4);
    const formattedDebt = (Number(liveDebt) / 1e6).toFixed(2);

    // Display position info
    const infoEl = document.getElementById('positionInfo');
    infoEl.innerHTML = `
      <strong>Active Position Found:</strong><br>
      Collateral: <span style="color: #38bdf8;">${formattedCollateral} PT</span><br>
      Current Debt: <span style="color: #f43f5e;">${formattedDebt} USDC</span><br>
      LTV & Leverage: <span style="color: #34d399;">${ltv.toFixed(2)}% (${leverage} Leverage)</span>
    `;
    infoEl.style.display = 'block';

    // Update form fields and enable controls
    document.getElementById('migrationOptions').style.display = 'block';
    
    // Default to Full Migration
    selectMigrationType('full');

    statusEl.style.display = 'none';
    loadBtn.innerText = "Refresh Position Data";
  } catch (err) {
    showError(err.message || err);
  }
}

function selectMigrationType(type) {
  migrationType = type;
  const debtInput = document.getElementById('debtAmount');
  const collateralInput = document.getElementById('collateralAmount');
  const toggleFull = document.getElementById('toggleFull');
  const togglePartial = document.getElementById('togglePartial');

  if (type === 'full') {
    toggleFull.className = 'toggle-btn active';
    togglePartial.className = 'toggle-btn';
    
    debtInput.value = (Number(liveDebt) / 1e6).toFixed(2);
    collateralInput.value = (Number(liveCollateral) / 1e18).toFixed(4);
    
    debtInput.disabled = true;
    collateralInput.disabled = true;
  } else {
    toggleFull.className = 'toggle-btn';
    togglePartial.className = 'toggle-btn active';
    
    debtInput.disabled = false;
    // Pre-fill with half of the position for convenience
    debtInput.value = (Number(liveDebt / 2n) / 1e6).toFixed(2);
    calculateProportionalCollateral();
    
    // Collateral is auto-calculated proportionally to keep it healthy
    collateralInput.disabled = true;
  }
}

function calculateProportionalCollateral() {
  const debtInputVal = parseFloat(document.getElementById('debtAmount').value);
  if (isNaN(debtInputVal) || debtInputVal <= 0 || liveDebt === 0n) {
    document.getElementById('collateralAmount').value = "0.0000";
    return;
  }
  
  const debtInputBig = BigInt(Math.floor(debtInputVal * 1e6));
  if (debtInputBig > liveDebt) {
    // Cap it at live position maximum
    document.getElementById('debtAmount').value = (Number(liveDebt) / 1e6).toFixed(2);
    document.getElementById('collateralAmount').value = (Number(liveCollateral) / 1e18).toFixed(4);
    return;
  }

  // Proportional collateral: C_withdrawn = Collateral_total * X / Debt_total
  const collateralWithdrawnBig = (liveCollateral * debtInputBig) / liveDebt;
  document.getElementById('collateralAmount').value = (Number(collateralWithdrawnBig) / 1e18).toFixed(4);
}

// Attach listener for debt input changes under partial mode
function onDebtInputChange() {
  calculateProportionalCollateral();
}

async function onPtAddressInput(inputId, badgeId) {
  const addressVal = document.getElementById(inputId).value.trim();
  const badgeEl = document.getElementById(badgeId);
  if (addressVal.length === 42 && addressVal.startsWith('0x')) {
    try {
      // Attempt 1: Fetch via Morpho Blue GraphQL API (fast, public, no wallet needed)
      try {
        const query = `
          query GetAsset($address: String!) {
            assets(where: { address_in: [$address] }) {
              items { symbol }
            }
          }
        `;
        const response = await fetch('https://blue-api.morpho.org/graphql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query,
            variables: { address: getAddress(addressVal) }
          })
        });
        if (response.ok) {
          const result = await response.json();
          if (result.data && result.data.assets.items.length > 0) {
            badgeEl.innerText = result.data.assets.items[0].symbol;
            badgeEl.style.display = 'inline-block';
            return;
          }
        }
      } catch (gqlErr) {
        console.warn("GraphQL symbol lookup failed, falling back to on-chain read:", gqlErr);
      }

      // Attempt 2: Fallback to on-chain read (only if GQL lookup failed or token is not on Morpho)
      const client = publicClient || (window.ethereum ? createPublicClient({ chain: mainnet, transport: custom(window.ethereum) }) : createPublicClient({ chain: mainnet, transport: http() }));
      const symbol = await client.readContract({
        address: addressVal,
        abi: [{"inputs":[],"name":"symbol","outputs":[{"name":"","type":"string"}],"stateMutability":"view","type":"function"}],
        functionName: 'symbol'
      });
      badgeEl.innerText = symbol;
      badgeEl.style.display = 'inline-block';
    } catch (err) {
      console.error("onPtAddressInput error for address", addressVal, err);
      badgeEl.innerText = "Unknown Token";
    }
  } else {
    badgeEl.innerText = "";
    badgeEl.style.display = 'none';
  }
}

async function onMarketIdInput(inputId, labelId, ptInputId, ptBadgeId) {
  const marketIdVal = document.getElementById(inputId).value.trim();
  const labelEl = document.getElementById(labelId);
  if (marketIdVal.length === 66 && marketIdVal.startsWith('0x')) {
    try {
      const params = await fetchMarketParams(marketIdVal);
      labelEl.innerText = ` ${formatMarketLabel(params.collateralSymbol, params.loanSymbol)}`;
      
      if (ptInputId && ptBadgeId) {
        const ptInput = document.getElementById(ptInputId);
        ptInput.value = params.collateralToken;
        onPtAddressInput(ptInputId, ptBadgeId);
      }
    } catch (err) {
      labelEl.innerText = " (Invalid Market)";
    }
  } else {
    labelEl.innerText = "";
  }
}

async function initiateMigration() {
  const statusEl = document.getElementById('status');
  statusEl.style.display = 'block';
  statusEl.className = 'info';
  statusEl.innerText = "Connecting to Rabby Wallet...";
  document.getElementById('payloadContainer').style.display = 'none';

  if (!window.ethereum) {
    showError("No injected wallet found. Please make sure Rabby Wallet is unlocked and ready.");
    return;
  }

  try {
    // Initialize Viem Wallet Client connected to Rabby Wallet
    const walletClient = createWalletClient({
      chain: mainnet,
      transport: custom(window.ethereum)
    });

    const [userAddress] = await walletClient.requestAddresses();
    statusEl.innerText = `Connected Wallet: ${userAddress}\nRetrieving market parameters from Morpho Blue API...`;

    // --- 1. Gather User Inputs & Fetch Market Parameters ---
    const usdcAddress = getAddress(document.getElementById('usdcAddress').value);
    const oldPtAddress = getAddress(document.getElementById('oldPtAddress').value);
    const newPtAddress = getAddress(document.getElementById('newPtAddress').value);
    const oldMarketId = document.getElementById('oldMarketId').value;
    const newMarketId = document.getElementById('newMarketId').value;

    const oldMarketParams = await fetchMarketParams(oldMarketId);
    const newMarketParams = await fetchMarketParams(newMarketId);

    // Conversions using native BigInt scaling (6 decimals for USDC, 18 decimals for PT collateral)
    const debtAmount = BigInt(Math.floor(parseFloat(document.getElementById('debtAmount').value) * 1e6));
    const collateralAmount = BigInt(Math.floor(parseFloat(document.getElementById('collateralAmount').value) * 1e18));
    const slippage = parseFloat(document.getElementById('slippage').value) / 100;

    const isFull = (migrationType === 'full');

    // Dynamic parameters mapping (DRY & KISS)
    const bufferAmount = 2n * 10n ** 6n; // 2 USDC interest buffer
    const flashLoanAmount = isFull ? (debtAmount + bufferAmount) : debtAmount;
    const repayAmount = isFull ? 0n : debtAmount;
    const repayShares = isFull ? 2n ** 256n - 1n : 0n;
    const supplyAmount = 2n ** 256n - 1n; // Always supply entire swapped balance
    const borrowAmount = flashLoanAmount;

    statusEl.innerText = `Connected Wallet: ${userAddress}\nFetching routing data from Pendle Convert API...`;

    let routeData;
    try {
      routeData = await fetchPendleRoute(oldPtAddress, collateralAmount, newPtAddress, slippage);
    } catch (err) {
      showError(`Pendle Router Error: ${err.message}. Check token addresses or slippage bounds.`);
      return;
    }
    const expectedOutput = (Number(routeData.outputs[0].amount) / 1e18).toFixed(4);

    // Fetch new oracle price to simulate target market leverage
    if (!publicClient) {
      publicClient = createPublicClient({
        chain: mainnet,
        transport: custom(window.ethereum)
      });
    }
    const newOraclePrice = await publicClient.readContract({
      address: newMarketParams.oracle,
      abi: [{"inputs":[],"name":"price","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"}],
      functionName: 'price'
    });

    const expectedNewCollateral = BigInt(routeData.outputs[0].amount);
    const newCollateralValue = calculateCollateralValue(expectedNewCollateral, newOraclePrice);
    const newLtv = calculateLtv(borrowAmount, newCollateralValue);
    const newLeverage = calculateLeverage(newCollateralValue, borrowAmount);

    statusEl.innerText += `\nPendle Swap path resolved! Expected Output: ${expectedOutput} PT-apyUSD-5NOV2026 (Simulated LTV: ${newLtv.toFixed(2)}%, Leverage: ${newLeverage}).\nGenerating atomic flashloan bundle...`;

    // --- 3. Construct Morpho Bundler V3 Callback Bundle ---
    const reenterBundle = [];

    // Call A: Repay the old market debt (full by shares, or partial by assets)
    reenterBundle.push({
      to: ETHER_GENERAL_ADAPTER_1,
      data: encodeFunctionData({
        abi: ADAPTER_ABI,
        functionName: 'morphoRepay',
        args: [oldMarketParams, repayAmount, repayShares, 2n ** 256n - 1n, userAddress, '0x']
      }),
      value: 0n,
      skipRevert: false,
      callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
    });

    // Call B: Withdraw the old PT collateral to the Bundler Contract
    reenterBundle.push({
      to: ETHER_GENERAL_ADAPTER_1,
      data: encodeFunctionData({
        abi: ADAPTER_ABI,
        functionName: 'morphoWithdrawCollateral',
        args: [oldMarketParams, collateralAmount, MORPHO_BUNDLER_V3]
      }),
      value: 0n,
      skipRevert: false,
      callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
    });

    // Call C: Approve the Pendle Swap Router to spend the old PT from the Bundler
    reenterBundle.push({
      to: oldPtAddress,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [routeData.tx.to, collateralAmount]
      }),
      value: 0n,
      skipRevert: false,
      callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
    });

    // Call D: Execute the Pendle Swap via Router direct call
    reenterBundle.push({
      to: routeData.tx.to,
      data: routeData.tx.data,
      value: 0n,
      skipRevert: false,
      callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
    });

    // Call F: Supply the newly acquired PT token as collateral to the new Morpho market (pulls adapter balance directly)
    reenterBundle.push({
      to: ETHER_GENERAL_ADAPTER_1,
      data: encodeFunctionData({
        abi: ADAPTER_ABI,
        functionName: 'morphoSupplyCollateral',
        args: [newMarketParams, supplyAmount, userAddress, '0x']
      }),
      value: 0n,
      skipRevert: false,
      callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
    });

    // Call G: Borrow USDC back out of the new market to satisfy the flashloan repayment (sends to adapter)
    reenterBundle.push({
      to: ETHER_GENERAL_ADAPTER_1,
      data: encodeFunctionData({
        abi: ADAPTER_ABI,
        functionName: 'morphoBorrow',
        args: [newMarketParams, borrowAmount, 0n, 0n, ETHER_GENERAL_ADAPTER_1]
      }),
      value: 0n,
      skipRevert: false,
      callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
    });

    // --- 4. Encode Callback Bundle & Compute callbackHash ---
    const encodedReenterBundle = encodeAbiParameters(
      [
        {
          name: 'bundle',
          type: 'tuple[]',
          components: [
            { name: 'to', type: 'address' },
            { name: 'data', type: 'bytes' },
            { name: 'value', type: 'uint256' },
            { name: 'skipRevert', type: 'bool' },
            { name: 'callbackHash', type: 'bytes32' }
          ]
        }
      ],
      [reenterBundle]
    );

    const callbackHash = keccak256(encodedReenterBundle);

    // --- 5. Construct Outer Multicall Payload ---
    const outerBundle = [
      // Action 1: Execute the flashloan and nested callback actions
      {
        to: ETHER_GENERAL_ADAPTER_1,
        data: encodeFunctionData({
          abi: ADAPTER_ABI,
          functionName: 'morphoFlashLoan',
          args: [usdcAddress, flashLoanAmount, encodedReenterBundle]
        }),
        value: 0n,
        skipRevert: false,
        callbackHash: callbackHash
      }
    ];

    // Action 2: Refund any leftover USDC buffer to the user's wallet (only in Full mode where buffer is used)
    if (isFull) {
      outerBundle.push({
        to: ETHER_GENERAL_ADAPTER_1,
        data: encodeFunctionData({
          abi: ADAPTER_ABI,
          functionName: 'erc20Transfer',
          args: [usdcAddress, userAddress, 2n ** 256n - 1n]
        }),
        value: 0n,
        skipRevert: false,
        callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
      });
    }

    // Master multicall encoding
    const finalCalldata = encodeFunctionData({
      abi: BUNDLER_ABI,
      functionName: 'multicall',
      args: [outerBundle]
    });

    // Display raw calldata for external simulations (Tenderly, Phalcon)
    document.getElementById('rawFromAddress').innerText = userAddress;
    document.getElementById('rawCalldataTextarea').value = finalCalldata;
    document.getElementById('payloadContainer').style.display = 'block';

    statusEl.innerText += `\nCalldata compiled. Requesting transaction approval in Rabby...`;

    // --- 6. Submit Transaction to Rabby ---
    const hash = await walletClient.sendTransaction({
      account: userAddress,
      to: MORPHO_BUNDLER_V3,
      data: finalCalldata,
      value: 0n
    });

    statusEl.className = 'success';
    statusEl.innerText = `Migration Transaction Submitted Successfully!\n\nTx Hash: ${hash}\n\nTrack your migration status inside your Rabby Dashboard.`;

  } catch (error) {
    showError(error.message || error);
  }
}

// --- TAB 2: ADJUST LEVERAGE JS IMPLEMENTATION ---
let levDebt = 0n;
let levCollateral = 0n;

function switchTab(tabName) {
  document.getElementById('tabContentRollover').classList.remove('active');
  document.getElementById('tabContentLeverage').classList.remove('active');
  document.getElementById('tabHeaderRollover').classList.remove('active');
  document.getElementById('tabHeaderLeverage').classList.remove('active');

  document.getElementById('status').style.display = 'none';
  document.getElementById('payloadContainer').style.display = 'none';

  if (tabName === 'rollover') {
    document.getElementById('tabContentRollover').classList.add('active');
    document.getElementById('tabHeaderRollover').classList.add('active');
  } else if (tabName === 'leverage') {
    document.getElementById('tabContentLeverage').classList.add('active');
    document.getElementById('tabHeaderLeverage').classList.add('active');
  }
}

async function levConnectAndLoadPosition() {
  const loadBtn = document.getElementById('levLoadBtn');
  const statusEl = document.getElementById('status');

  statusEl.style.display = 'block';
  statusEl.className = 'info';
  statusEl.innerText = "Connecting to wallet...";
  document.getElementById('payloadContainer').style.display = 'none';

  if (!window.ethereum) {
    showError("No injected wallet found. Please make sure Rabby Wallet is unlocked.");
    return;
  }

  try {
    const walletClient = createWalletClient({
      chain: mainnet,
      transport: custom(window.ethereum)
    });

    if (!publicClient) {
      publicClient = createPublicClient({
        chain: mainnet,
        transport: custom(window.ethereum)
      });
    }

    const [address] = await walletClient.requestAddresses();
    userAddress = getAddress(address);
    statusEl.innerText = `Connected Wallet: ${userAddress}\nLoading position data from Morpho Blue...`;

    const marketId = document.getElementById('levMarketId').value.trim();
    if (!marketId || marketId.length !== 66) {
      throw new Error("Please enter a valid 32-byte hex Market ID.");
    }

    const position = await fetchMorphoPosition(publicClient, marketId, userAddress);
    levCollateral = position.collateral;
    levDebt = position.debt;

    const marketParams = await fetchMarketParams(marketId);
    const oraclePrice = await publicClient.readContract({
      address: marketParams.oracle,
      abi: [{"inputs":[],"name":"price","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"}],
      functionName: 'price'
    });

    const collateralValue = calculateCollateralValue(levCollateral, oraclePrice);
    const ltv = calculateLtv(levDebt, collateralValue);
    const leverageVal = calculateLeverage(collateralValue, levDebt);

    const formattedCollateral = (Number(levCollateral) / 1e18).toFixed(4);
    const formattedDebt = (Number(levDebt) / 1e6).toFixed(2);

    const infoEl = document.getElementById('levPositionInfo');
    infoEl.innerHTML = `
      <strong>Active Position Found:</strong><br>
      Collateral: <span style="color: #38bdf8;">${formattedCollateral} PT</span><br>
      Current Debt: <span style="color: #f43f5e;">${formattedDebt} USDC</span><br>
      LTV & Leverage: <span style="color: #34d399;">${ltv.toFixed(2)}% (${leverageVal} Leverage)</span>
    `;
    infoEl.style.display = 'block';

    // Display controls and calculate initial metrics
    document.getElementById('levAdjustmentControls').style.display = 'block';
    
    // Match slider value to current leverage (cap at max 6.0)
    let currentLeverageNum = 1.0;
    if (collateralValue > levDebt && (collateralValue - levDebt) > 0n) {
      currentLeverageNum = Number(collateralValue * 100n / (collateralValue - levDebt)) / 100;
    }
    document.getElementById('levSlider').value = Math.min(6.0, currentLeverageNum).toString();
    
    onLevSliderChange();
    statusEl.style.display = 'none';
    loadBtn.innerText = "Refresh Position Data";
  } catch (err) {
    showError(err.message || err);
  }
}

function onLevSliderChange() {
  const targetLeverage = parseFloat(document.getElementById('levSlider').value);
  document.getElementById('levTargetLeverageDisplay').innerText = `${targetLeverage.toFixed(2)}x`;

  const metricsEl = document.getElementById('levTargetMetrics');
  if (levCollateral === 0n) {
    metricsEl.innerHTML = "<em>No active position loaded. Please connect wallet first.</em>";
    return;
  }

  // Compute estimated changes based on current leverage level
  const targetLtv = 1.0 - (1.0 / targetLeverage);
  const targetLtvPct = (targetLtv * 100).toFixed(2);

  // Fetch simulated action
  let actionText = "";
  if (targetLeverage === 1.0) {
    actionText = `<span style="color: #f43f5e; font-weight: bold;">Action: Unleveraging.</span> Will withdraw & sell PT collateral to completely clear your <span style="color: #f43f5e;">${(Number(levDebt)/1e6).toFixed(2)} USDC</span> borrow debt. Position LTV will go to 0%.`;
  } else {
    const targetLtvBig = BigInt(Math.floor(targetLtv * 1e18));
    
    // Approximate LTV checks dynamically
    const currentLtvBig = levCollateral > 0n ? (levDebt * 10n**18n) / ((levCollateral * 95n * 10n**22n) / 10n**36n) : 0n; // Assume approx price of 0.95
    
    if (targetLtvBig < currentLtvBig) {
      actionText = `<span style="color: #38bdf8; font-weight: bold;">Action: Deleveraging.</span> Will withdraw and sell a portion of PT collateral for USDC to pay down borrow debt. Target LTV: <span style="color: #34d399;">${targetLtvPct}%</span>.`;
    } else if (Math.abs(Number(targetLtvBig - currentLtvBig)) < 1e15) {
      actionText = `Target leverage matches current position leverage. No action required.`;
    } else {
      actionText = `<span style="color: #34d399; font-weight: bold;">Action: Leveraging up.</span> Will borrow additional USDC via flashloan to buy and supply more PT collateral. Target LTV: <span style="color: #34d399;">${targetLtvPct}%</span>.`;
    }
  }

  metricsEl.innerHTML = `
    <strong>Simulated Target Metrics:</strong><br>
    Target Leverage: ${targetLeverage.toFixed(2)}x (LTV: ${targetLtvPct}%)<br>
    Liquidation Buffer: ${(86.0 - targetLtvPct).toFixed(2)}% margin to liquidation (86% LLTV)<br>
    <div style="margin-top: 8px; border-top: 1px dashed #475569; padding-top: 8px;">
      ${actionText}
    </div>
  `;
}

async function executeLeverageAdjustment() {
  const statusEl = document.getElementById('status');
  statusEl.style.display = 'block';
  statusEl.className = 'info';
  statusEl.innerText = "Connecting to Rabby Wallet...";
  document.getElementById('payloadContainer').style.display = 'none';

  if (!window.ethereum) {
    showError("No injected wallet found. Please make sure Rabby Wallet is unlocked.");
    return;
  }

  try {
    const walletClient = createWalletClient({
      chain: mainnet,
      transport: custom(window.ethereum)
    });

    if (!publicClient) {
      publicClient = createPublicClient({
        chain: mainnet,
        transport: custom(window.ethereum)
      });
    }

    const [address] = await walletClient.requestAddresses();
    userAddress = getAddress(address);
    statusEl.innerText = `Connected Wallet: ${userAddress}\nRetrieving market parameters from Morpho Blue API...`;

    const marketId = document.getElementById('levMarketId').value.trim();
    const ptAddress = getAddress(document.getElementById('levPtAddress').value.trim());
    const usdcAddress = getAddress(document.getElementById('levUsdcAddress').value.trim());
    const slippage = BigInt(Math.floor(parseFloat(document.getElementById('levSlippage').value) * 100)); // 1% = 100
    const targetLeverage = parseFloat(document.getElementById('levSlider').value);

    const marketParams = await fetchMarketParams(marketId);
    const oraclePrice = await publicClient.readContract({
      address: marketParams.oracle,
      abi: [{"inputs":[],"name":"price","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"}],
      functionName: 'price'
    });

    // 1. Solve parameters for adjustment
    const swapPrice = oraclePrice; 
    const params = calculateLeverageAdjustmentParams(levDebt, levCollateral, oraclePrice, swapPrice, targetLeverage);

    let finalCalldata;
    
    if (params.mode === 'deleverage' || params.mode === 'deleverage-to-1x') {
      // --- DELEVERAGING SWAP PATH: PT -> USDC ---
      statusEl.innerText = `Connected Wallet: ${userAddress}\nFetching routing data for deleverage swap (PT -> USDC)...`;
      
      const routeData = await fetchPendleRoute(ptAddress, params.collateralAmount, usdcAddress, Number(slippage) / 10000);
      const expectedUsdcOutput = BigInt(routeData.outputs[0].amount);
      
      statusEl.innerText = `Pendle Swap path resolved! Expected Output: ${(Number(expectedUsdcOutput)/1e6).toFixed(2)} USDC.\nGenerating atomic flashloan bundle...`;

      // Setup multicall variables
      const is1x = (params.mode === 'deleverage-to-1x');
      const bufferAmount = 2n * 10n ** 6n; // 2 USDC buffer
      const flashLoanAmount = is1x ? (params.debtAmount + bufferAmount) : expectedUsdcOutput;

      const reenterBundle = buildDeleveragingBundle({
        encodeFunctionData,
        marketParams,
        collateralAmount: params.collateralAmount,
        debtAmount: expectedUsdcOutput,
        is1x,
        ptAddress,
        usdcAddress,
        routeData,
        userAddress,
        ETHER_GENERAL_ADAPTER_1,
        MORPHO_BUNDLER_V3
      });

      const encodedReenterBundle = encodeAbiParameters(
        [
          {
            name: 'bundle',
            type: 'tuple[]',
            components: [
              { name: 'to', type: 'address' },
              { name: 'data', type: 'bytes' },
              { name: 'value', type: 'uint256' },
              { name: 'skipRevert', type: 'bool' },
              { name: 'callbackHash', type: 'bytes32' }
            ]
          }
        ],
        [reenterBundle]
      );

      const callbackHash = keccak256(encodedReenterBundle);

      // Wrap inside flashloan
      const outerBundle = [
        {
          to: ETHER_GENERAL_ADAPTER_1,
          data: encodeFunctionData({
            abi: ADAPTER_ABI,
            functionName: 'morphoFlashLoan',
            args: [usdcAddress, flashLoanAmount, encodedReenterBundle]
          }),
          value: 0n,
          skipRevert: false,
          callbackHash: callbackHash
        }
      ];

      // Sweep any remaining USDC buffer back to the user's wallet
      if (is1x) {
        outerBundle.push({
          to: ETHER_GENERAL_ADAPTER_1,
          data: encodeFunctionData({
            abi: ADAPTER_ABI,
            functionName: 'erc20Transfer',
            args: [usdcAddress, userAddress, 2n ** 256n - 1n]
          }),
          value: 0n,
          skipRevert: false,
          callbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
        });
      }

      finalCalldata = encodeFunctionData({
        abi: BUNDLER_ABI,
        functionName: 'multicall',
        args: [outerBundle]
      });

    } else {
      // --- LEVERAGING UP SWAP PATH: USDC -> PT ---
      statusEl.innerText = `Connected Wallet: ${userAddress}\nFetching routing data for leverage-up swap (USDC -> PT)...`;
      
      const routeData = await fetchPendleRoute(usdcAddress, params.debtAmount, ptAddress, Number(slippage) / 10000);
      const expectedPtOutput = BigInt(routeData.outputs[0].amount);
      
      statusEl.innerText = `Pendle Swap path resolved! Expected Output: ${(Number(expectedPtOutput)/1e18).toFixed(4)} PT.\nGenerating atomic flashloan bundle...`;

      const reenterBundle = buildLeveragingUpBundle({
        encodeFunctionData,
        marketParams,
        collateralAmount: expectedPtOutput,
        debtAmount: params.debtAmount,
        ptAddress,
        usdcAddress,
        routeData,
        userAddress,
        ETHER_GENERAL_ADAPTER_1,
        MORPHO_BUNDLER_V3
      });

      const encodedReenterBundle = encodeAbiParameters(
        [
          {
            name: 'bundle',
            type: 'tuple[]',
            components: [
              { name: 'to', type: 'address' },
              { name: 'data', type: 'bytes' },
              { name: 'value', type: 'uint256' },
              { name: 'skipRevert', type: 'bool' },
              { name: 'callbackHash', type: 'bytes32' }
            ]
          }
        ],
        [reenterBundle]
      );

      const callbackHash = keccak256(encodedReenterBundle);

      // Wrap inside flashloan
      const outerBundle = [
        {
          to: ETHER_GENERAL_ADAPTER_1,
          data: encodeFunctionData({
            abi: ADAPTER_ABI,
            functionName: 'morphoFlashLoan',
            args: [usdcAddress, params.debtAmount, encodedReenterBundle]
          }),
          value: 0n,
          skipRevert: false,
          callbackHash: callbackHash
        }
      ];

      finalCalldata = encodeFunctionData({
        abi: BUNDLER_ABI,
        functionName: 'multicall',
        args: [outerBundle]
      });
    }

    // Display raw calldata
    document.getElementById('rawFromAddress').innerText = userAddress;
    document.getElementById('rawCalldataTextarea').value = finalCalldata;
    document.getElementById('payloadContainer').style.display = 'block';

    statusEl.innerText += `\nCalldata compiled. Requesting transaction approval in Rabby...`;

    // 6. Submit Transaction
    const hash = await walletClient.sendTransaction({
      account: userAddress,
      to: MORPHO_BUNDLER_V3,
      data: finalCalldata,
      value: 0n
    });

    statusEl.className = 'success';
    statusEl.innerText = `Leverage Adjustment Transaction Submitted Successfully!\n\nTx Hash: ${hash}\n\nTrack your status inside your Rabby Dashboard.`;
  } catch (err) {
    showError(err.message || err);
  }
}

function showError(msg) {
  const statusEl = document.getElementById('status');
  statusEl.className = 'error';
  statusEl.innerText = `Migration Execution Blocked:\n${msg}`;
}

// Programmatic Event Listener Bindings & Initializations
try {
  // Tab Selection Navigation
  document.getElementById('tabHeaderRollover').addEventListener('click', () => switchTab('rollover'));
  document.getElementById('tabHeaderLeverage').addEventListener('click', () => switchTab('leverage'));

  // Tab 1 (Rollover) Inputs & Buttons
  document.getElementById('oldPtAddress').addEventListener('input', () => onPtAddressInput('oldPtAddress', 'oldPtBadge'));
  document.getElementById('newPtAddress').addEventListener('input', () => onPtAddressInput('newPtAddress', 'newPtBadge'));
  document.getElementById('oldMarketId').addEventListener('input', () => onMarketIdInput('oldMarketId', 'oldMarketLabel', 'oldPtAddress', 'oldPtBadge'));
  document.getElementById('newMarketId').addEventListener('input', () => onMarketIdInput('newMarketId', 'newMarketLabel', 'newPtAddress', 'newPtBadge'));
  document.getElementById('loadPositionBtn').addEventListener('click', connectAndLoadPosition);
  document.getElementById('toggleFull').addEventListener('click', () => selectMigrationType('full'));
  document.getElementById('togglePartial').addEventListener('click', () => selectMigrationType('partial'));
  document.getElementById('debtAmount').addEventListener('input', onDebtInputChange);
  document.getElementById('migrateBtn').addEventListener('click', initiateMigration);

  // Tab 2 (Leverage) Inputs & Buttons
  document.getElementById('levMarketId').addEventListener('input', () => onMarketIdInput('levMarketId', 'levMarketLabel', 'levPtAddress', 'levPtBadge'));
  document.getElementById('levPtAddress').addEventListener('input', () => onPtAddressInput('levPtAddress', 'levPtBadge'));
  document.getElementById('levLoadBtn').addEventListener('click', levConnectAndLoadPosition);
  document.getElementById('levSlider').addEventListener('input', onLevSliderChange);
  document.getElementById('levExecuteBtn').addEventListener('click', executeLeverageAdjustment);

  // Run Initial dynamic setups
  onPtAddressInput('oldPtAddress', 'oldPtBadge');
  onPtAddressInput('newPtAddress', 'newPtBadge');
  onPtAddressInput('levPtAddress', 'levPtBadge');
  onMarketIdInput('oldMarketId', 'oldMarketLabel', 'oldPtAddress', 'oldPtBadge');
  onMarketIdInput('newMarketId', 'newMarketLabel', 'newPtAddress', 'newPtBadge');
  onMarketIdInput('levMarketId', 'levMarketLabel', 'levPtAddress', 'levPtBadge');
} catch (err) {
  console.error("Failed to bind event listeners:", err);
  showError("Initialization Error: " + err.message);
}
