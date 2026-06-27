import { createWalletClient, createPublicClient, http, custom, getAddress, encodeFunctionData, encodeAbiParameters, keccak256, decodeFunctionData, decodeAbiParameters } from 'https://esm.sh/viem';
import { mainnet } from 'https://esm.sh/viem/chains';
import { calculateCollateralValue, calculateLtv, calculateLeverage, calculateLeverageAdjustmentParams } from './math.js';
import { formatMarketLabel } from './labels.js';
import { buildDeleveragingBundle, buildLeveragingUpBundle, buildRolloverBundle, ERC20_ABI, ADAPTER_ABI, findCurvePoolAndIndices, findUniswapV3Pool } from './builders.js';

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
          loanAsset { address symbol decimals }
          collateralAsset { address symbol decimals }
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
    loanDecimals: Number(market.loanAsset.decimals),
    collateralDecimals: Number(market.collateralAsset.decimals),
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
let liveBorrowShares = 0n;
let migrationType = 'full';
let publicClient = null;
let pendingTx = null;
let activeTab = 'rollover';
let sourceMarketParams = null;
let destMarketParams = null;
let currentLevMarketParams = null;

async function checkCollateralMaturity(client, collateralAddress) {
  try {
    const expiry = await client.readContract({
      address: collateralAddress,
      abi: [{"inputs":[],"name":"expiry","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"}],
      functionName: 'expiry'
    });
    const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));
    return {
      expiryDate: new Date(Number(expiry) * 1000).toLocaleDateString(),
      isExpired: expiry <= currentTimestamp
    };
  } catch (err) {
    console.warn("Failed to fetch collateral expiry info:", err);
    return { expiryDate: "Unknown", isExpired: false };
  }
}

async function confirmAndSubmitTransaction() {
  if (!pendingTx || !userAddress) return;
  const statusEl = document.getElementById('status');
  statusEl.style.display = 'block';
  statusEl.className = 'info';
  statusEl.innerText = "Requesting transaction approval in wallet...";
  
  try {
    const walletClient = createWalletClient({
      chain: mainnet,
      transport: custom(window.ethereum)
    });
    
    const hash = await walletClient.sendTransaction({
      account: userAddress,
      to: pendingTx.to,
      data: pendingTx.data,
      value: pendingTx.value
    });
    
    statusEl.className = 'info';
    statusEl.innerText = `Transaction Submitted! Hash: ${hash}\nAwaiting block confirmation to audit execution price...`;
    
    // Hide preview container since tx is broadcasted
    document.getElementById('previewContainer').style.display = 'none';
    
    // Start tracking realized price
    await auditRealizedPrice(hash);
  } catch (err) {
    showError(err.message || err);
  }
}

async function auditRealizedPrice(txHash) {
  const statusEl = document.getElementById('status');
  try {
    if (!publicClient) {
      publicClient = createPublicClient({
        chain: mainnet,
        transport: custom(window.ethereum)
      });
    }
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    
    const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
    
    // We can extract input/output tokens dynamically from input fields if available
    const oldPt = document.getElementById('oldCollateralAddress')?.value || document.getElementById('levCollateralAddress')?.value;
    const newPt = document.getElementById('newCollateralAddress')?.value || oldPt; // fallback
    const usdc = document.getElementById('sourceLoanAddress')?.value || document.getElementById('levLoanAddress')?.value;

    let spentToken = null;
    let receivedToken = null;
    let isLeverageUp = false;

    if (pendingTx) {
      if (pendingTx.type === 'rollover') {
        spentToken = oldPt ? getAddress(oldPt) : null;
        receivedToken = newPt ? getAddress(newPt) : null;
      } else if (pendingTx.type === 'leverage') {
        if (pendingTx.subType === 'deleverage') {
          spentToken = oldPt ? getAddress(oldPt) : null;
          receivedToken = usdc ? getAddress(usdc) : null;
        } else if (pendingTx.subType === 'leverage_up') {
          spentToken = usdc ? getAddress(usdc) : null;
          receivedToken = oldPt ? getAddress(oldPt) : null;
          isLeverageUp = true;
        }
      }
    }

    let spentAmount = 0n;
    let receivedAmount = 0n;

    for (const log of receipt.logs) {
      if (log.topics[0] === TRANSFER_TOPIC && log.topics.length >= 3) {
        const value = BigInt(log.data === '0x' ? '0' : log.data);
        const tokenAddr = getAddress(log.address);
        const fromAddr = getAddress('0x' + log.topics[1].slice(26));
        const toAddr = getAddress('0x' + log.topics[2].slice(26));

        if (spentToken && tokenAddr === spentToken && fromAddr === getAddress(MORPHO_BUNDLER_V3)) {
          spentAmount += value;
        }
        if (receivedToken && tokenAddr === receivedToken && toAddr === getAddress(ETHER_GENERAL_ADAPTER_1)) {
          receivedAmount += value;
        }
      }
    }
    
    let auditMessage = "";
    if (spentAmount > 0n && receivedAmount > 0n) {
      let realizedRate = 0;
      if (pendingTx && pendingTx.type === 'rollover') {
        realizedRate = Number(receivedAmount * 10n**18n / spentAmount) / 1e18;
        let rateCompare = ` (Estimated: ${pendingTx.estimatedRate.toFixed(4)} PT-new)`;
        let priceImpactMessage = "";
        if (pendingTx.oracleRate) {
          const realizedPriceImpact = ((pendingTx.oracleRate - realizedRate) / pendingTx.oracleRate) * 100;
          priceImpactMessage = `\nRealized Price Impact: ${realizedPriceImpact.toFixed(2)}% (Estimated: ${pendingTx.estimatedPriceImpact.toFixed(2)}%, vs. Oracle).`;
        }
        auditMessage = `\n[Post-Execution Audit]\nRealized Swap Rate: 1 PT-old = ${realizedRate.toFixed(4)} PT-new${rateCompare}.${priceImpactMessage}\n(Checked via transfer events: spent ${spentAmount / 10n**18n} PT, received ${receivedAmount / 10n**18n} PT).`;
      } else if (pendingTx && pendingTx.type === 'leverage') {
        if (isLeverageUp) {
          // Leveraging up (USDC -> PT)
          realizedRate = Number(spentAmount * 10n**30n / receivedAmount) / 1e18; // Price of 1 PT in USDC
          let rateCompare = ` (Estimated: ${pendingTx.estimatedRate.toFixed(4)} USDC)`;
          let priceImpactMessage = "";
          if (pendingTx.oracleRate) {
            const realizedPriceImpact = ((pendingTx.oracleRate - realizedRate) / pendingTx.oracleRate) * 100;
            priceImpactMessage = `\nRealized Price Impact: ${realizedPriceImpact.toFixed(2)}% (Estimated: ${pendingTx.estimatedPriceImpact.toFixed(2)}%, vs. Oracle).`;
          }
          auditMessage = `\n[Post-Execution Audit]\nRealized Exchange Rate: 1 PT = ${realizedRate.toFixed(4)} USDC${rateCompare}.${priceImpactMessage}\n(Checked via transfer events: spent ${spentAmount / 10n**6n} USDC, received ${receivedAmount / 10n**18n} PT).`;
        } else {
          // Deleveraging (PT -> USDC)
          realizedRate = Number(receivedAmount * 10n**30n / spentAmount) / 1e18; // Price of 1 PT in USDC
          let rateCompare = ` (Estimated: ${pendingTx.estimatedRate.toFixed(4)} USDC)`;
          let priceImpactMessage = "";
          if (pendingTx.oracleRate) {
            const realizedPriceImpact = ((pendingTx.oracleRate - realizedRate) / pendingTx.oracleRate) * 100;
            priceImpactMessage = `\nRealized Price Impact: ${realizedPriceImpact.toFixed(2)}% (Estimated: ${pendingTx.estimatedPriceImpact.toFixed(2)}%, vs. Oracle).`;
          }
          auditMessage = `\n[Post-Execution Audit]\nRealized Exchange Rate: 1 PT = ${realizedRate.toFixed(4)} USDC${rateCompare}.${priceImpactMessage}\n(Checked via transfer events: spent ${spentAmount / 10n**18n} PT, received ${receivedAmount / 10n**6n} USDC).`;
        }
      }
    }
    
    statusEl.className = 'success';
    statusEl.innerText = `Migration Transaction Confirmed Successfully!\n\nTx Hash: ${txHash}\n${auditMessage}`;
  } catch (err) {
    console.error("Audit log parsing failed:", err);
    statusEl.className = 'success';
    statusEl.innerText = `Migration Transaction Confirmed!\n\nTx Hash: ${txHash}\n\nNote: Transaction confirmed, but realized price audit failed: ${err.message}`;
  }
}

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

  return { collateral, debt, borrowShares };
}

async function fetchSwapRoute(inputToken, inputAmount, outputToken, slippage, receiver, sender = null) {
  const chainId = 1;
  const swapRouterApiUrl = `https://api-v2.pendle.finance/core/v3/sdk/${chainId}/convert`;
  const requestBody = {
    receiver: receiver,
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
  };

  if (sender) {
    requestBody.sender = sender;
  }

  const response = await fetch(swapRouterApiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });
  if (!response.ok) {
    const errData = await response.json();
    throw new Error(errData.message || "Failed to fetch routing data from Swap Router.");
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
    updateCliCommand();

    const oldMarketId = document.getElementById('oldMarketId').value.trim();
    if (!oldMarketId || oldMarketId.length !== 66) {
      throw new Error("Please enter a valid 32-byte hex Market ID (66 characters).");
    }

    const position = await fetchMorphoPosition(publicClient, oldMarketId, userAddress);
    liveCollateral = position.collateral;
    liveDebt = position.debt;
    liveBorrowShares = position.borrowShares;

    const oldMarketParams = await fetchMarketParams(oldMarketId);
    const oraclePrice = await publicClient.readContract({
      address: oldMarketParams.oracle,
      abi: [{"inputs":[],"name":"price","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"}],
      functionName: 'price'
    });

    const collateralValue = calculateCollateralValue(liveCollateral, oraclePrice);
    const ltv = calculateLtv(liveDebt, collateralValue);
    const leverage = calculateLeverage(collateralValue, liveDebt);

    const formattedCollateral = (Number(liveCollateral) / (10 ** oldMarketParams.collateralDecimals)).toFixed(4);
    const formattedDebt = (Number(liveDebt) / (10 ** oldMarketParams.loanDecimals)).toFixed(2);

    // Display position info
    const infoEl = document.getElementById('positionInfo');
    infoEl.innerHTML = `
      <strong>Active Position Found:</strong><br>
      Collateral: <span style="color: #38bdf8;">${formattedCollateral} ${oldMarketParams.collateralSymbol}</span><br>
      Current Debt: <span style="color: #f43f5e;">${formattedDebt} ${oldMarketParams.loanSymbol}</span><br>
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

  const decimals = sourceMarketParams ? sourceMarketParams.loanDecimals : 6;
  const collDecimals = sourceMarketParams ? sourceMarketParams.collateralDecimals : 18;

  if (type === 'full') {
    toggleFull.className = 'toggle-btn active';
    togglePartial.className = 'toggle-btn';
    
    debtInput.value = (Number(liveDebt) / (10 ** decimals)).toFixed(2);
    collateralInput.value = (Number(liveCollateral) / (10 ** collDecimals)).toFixed(4);
    
    debtInput.disabled = true;
    collateralInput.disabled = true;
  } else {
    toggleFull.className = 'toggle-btn';
    togglePartial.className = 'toggle-btn active';
    
    debtInput.disabled = false;
    // Pre-fill with half of the position for convenience
    debtInput.value = (Number(liveDebt / 2n) / (10 ** decimals)).toFixed(2);
    calculateProportionalCollateral();
    
    // Collateral is auto-calculated proportionally to keep it healthy
    collateralInput.disabled = true;
  }
  updateCliCommand();
}

function calculateProportionalCollateral() {
  const debtInputVal = parseFloat(document.getElementById('debtAmount').value);
  if (isNaN(debtInputVal) || debtInputVal <= 0 || liveDebt === 0n || !sourceMarketParams) {
    document.getElementById('collateralAmount').value = "0.0000";
    return;
  }
  
  const decimals = sourceMarketParams.loanDecimals;
  const collDecimals = sourceMarketParams.collateralDecimals;
  
  const debtInputBig = BigInt(Math.floor(debtInputVal * (10 ** decimals)));
  if (debtInputBig > liveDebt) {
    // Cap it at live position maximum
    document.getElementById('debtAmount').value = (Number(liveDebt) / (10 ** decimals)).toFixed(2);
    document.getElementById('collateralAmount').value = (Number(liveCollateral) / (10 ** collDecimals)).toFixed(4);
    return;
  }

  // Proportional collateral: C_withdrawn = Collateral_total * X / Debt_total
  const collateralWithdrawnBig = (liveCollateral * debtInputBig) / liveDebt;
  document.getElementById('collateralAmount').value = (Number(collateralWithdrawnBig) / (10 ** collDecimals)).toFixed(4);
}

// Attach listener for debt input changes under partial mode
function onDebtInputChange() {
  calculateProportionalCollateral();
  updateCliCommand();
}

async function onTokenAddressInput(inputId, badgeId) {
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
      console.error("onTokenAddressInput error for address", addressVal, err);
      badgeEl.innerText = "Unknown Token";
    } finally {
      updateCliCommand();
    }
  } else {
    badgeEl.textContent = "";
    badgeEl.style.display = 'none';
    updateCliCommand();
  }
}

async function onMarketIdInput(inputId, labelId, ptInputId, ptBadgeId, loanInputId, loanBadgeId) {
  const marketIdVal = document.getElementById(inputId).value.trim();
  const labelEl = document.getElementById(labelId);
  if (marketIdVal.length === 66 && marketIdVal.startsWith('0x')) {
    try {
      const params = await fetchMarketParams(marketIdVal);
      if (inputId === 'oldMarketId') {
        sourceMarketParams = params;
        const debtInput = document.getElementById('debtAmount');
        if (debtInput && debtInput.previousElementSibling) {
          debtInput.previousElementSibling.textContent = `Source Debt to Repay (${params.loanSymbol})`;
        }
        const collInput = document.getElementById('collateralAmount');
        if (collInput && collInput.previousElementSibling) {
          collInput.previousElementSibling.textContent = `Collateral to Migrate (${params.collateralSymbol})`;
        }
      }
      if (inputId === 'newMarketId') destMarketParams = params;
      if (inputId === 'levMarketId') currentLevMarketParams = params;

      labelEl.textContent = ` ${formatMarketLabel(params.collateralSymbol, params.loanSymbol)}`;
      
      if (ptInputId && ptBadgeId) {
        const ptInput = document.getElementById(ptInputId);
        ptInput.value = params.collateralToken;
        await onTokenAddressInput(ptInputId, ptBadgeId);
      }
      if (loanInputId && loanBadgeId) {
        const loanInput = document.getElementById(loanInputId);
        loanInput.value = params.loanToken;
        await onTokenAddressInput(loanInputId, loanBadgeId);
      }
    } catch (err) {
      labelEl.textContent = " (Invalid Market)";
    } finally {
      updateCliCommand();
    }
  } else {
    labelEl.textContent = "";
    if (inputId === 'oldMarketId') {
      sourceMarketParams = null;
      const debtInput = document.getElementById('debtAmount');
      if (debtInput && debtInput.previousElementSibling) {
        debtInput.previousElementSibling.textContent = "Source Debt to Repay";
      }
      const collInput = document.getElementById('collateralAmount');
      if (collInput && collInput.previousElementSibling) {
        collInput.previousElementSibling.textContent = "Collateral to Migrate";
      }
    }
    if (inputId === 'newMarketId') destMarketParams = null;
    if (inputId === 'levMarketId') currentLevMarketParams = null;
    updateCliCommand();
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
    const sourceLoanAddress = getAddress(document.getElementById('sourceLoanAddress').value);
    const destLoanAddress = getAddress(document.getElementById('newLoanAddress').value);
    const sourceCollateralAddress = getAddress(document.getElementById('oldCollateralAddress').value);
    const destCollateralAddress = getAddress(document.getElementById('newCollateralAddress').value);
    const sourceMarketId = document.getElementById('oldMarketId').value;
    const destMarketId = document.getElementById('newMarketId').value;

    const sourceMarketParams = await fetchMarketParams(sourceMarketId);
    const destMarketParams = await fetchMarketParams(destMarketId);

    const isFull = (migrationType === 'full');
    const debtAmount = isFull ? liveDebt : BigInt(Math.floor(parseFloat(document.getElementById('debtAmount').value) * (10 ** sourceMarketParams.loanDecimals)));
    const collateralAmount = isFull ? liveCollateral : BigInt(Math.floor(parseFloat(document.getElementById('collateralAmount').value) * (10 ** sourceMarketParams.collateralDecimals)));
    const slippage = parseFloat(document.getElementById('slippage').value) / 100;

    const isSameCollateral = (sourceCollateralAddress === destCollateralAddress);
    const isSameLoan = (sourceLoanAddress.toLowerCase() === destLoanAddress.toLowerCase());

    statusEl.innerText = `Connected Wallet: ${userAddress}\nFetching routing data from Swap Router Convert API...`;

    let routeData = null;
    let expectedNewCollateral = collateralAmount;

    if (!isSameCollateral) {
      try {
        routeData = await fetchSwapRoute(sourceCollateralAddress, collateralAmount, destCollateralAddress, slippage, ETHER_GENERAL_ADAPTER_1, MORPHO_BUNDLER_V3);
        expectedNewCollateral = BigInt(routeData.outputs[0].amount);
      } catch (err) {
        showError(`Swap Router Error: ${err.message}. Check token addresses or slippage bounds.`);
        return;
      }
    }
    const expectedOutput = (Number(expectedNewCollateral) / (10 ** destMarketParams.collateralDecimals)).toFixed(4);

    if (!publicClient) {
      publicClient = createPublicClient({
        chain: mainnet,
        transport: custom(window.ethereum)
      });
    }

    // Fetch oracle prices for old and new markets to compute fair exchange rate
    const [oldOraclePrice, newOraclePrice, maturity] = await Promise.all([
      publicClient.readContract({
        address: sourceMarketParams.oracle,
        abi: [{"inputs":[],"name":"price","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"}],
        functionName: 'price'
      }),
      publicClient.readContract({
        address: destMarketParams.oracle,
        abi: [{"inputs":[],"name":"price","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"}],
        functionName: 'price'
      }),
      checkCollateralMaturity(publicClient, sourceCollateralAddress)
    ]);

    const oldScale = 36n + BigInt(sourceMarketParams.loanDecimals) - BigInt(sourceMarketParams.collateralDecimals);
    const newScale = 36n + BigInt(destMarketParams.loanDecimals) - BigInt(destMarketParams.collateralDecimals);

    const oldOracleUSD = (oldOraclePrice * 10n ** 18n) / 10n ** oldScale;
    const newOracleUSD = (newOraclePrice * 10n ** 18n) / 10n ** newScale;

    const oracleRatio = isSameCollateral ? 10n ** 18n : (oldOracleUSD * 10n ** 18n) / newOracleUSD;
    const quotedRate = isSameCollateral ? 10n ** 18n : (expectedNewCollateral * 10n ** 18n) / collateralAmount;
    const slippagePct = oracleRatio > 0n ? Number((oracleRatio - quotedRate) * 10000n / oracleRatio) / 100 : 0.0;

    // Handle cross-loan-asset routing
    let loanRouteData = null;
    let loanExpectedInput = 0n;
    let loanExpectedOutput = 0n;
    let loanOracleRate = 0n;
    let loanSlippagePct = 0.0;
    let loanQuotedRate = 0n;

    if (!isSameLoan) {
      const exp = 18n + BigInt(newScale) - BigInt(oldScale);
      loanOracleRate = (oldOraclePrice * 10n ** exp) / newOraclePrice;

      const decDiff = BigInt(destMarketParams.loanDecimals) - BigInt(sourceMarketParams.loanDecimals);
      const estimatedInput = (debtAmount * 10n ** 18n * 10n ** decDiff) / loanOracleRate;
      
      const slippageBuffer = BigInt(Math.max(50, Math.ceil(slippage * 10000)));
      loanExpectedInput = (estimatedInput * (10000n + slippageBuffer)) / 10000n;

      const targetLltv = destMarketParams.lltv;
      const safeLtv = targetLltv - 5000000000000000n;
      const newCollateralValue = calculateCollateralValue(expectedNewCollateral, newOraclePrice);
      const maxSafeBorrowAmount = (newCollateralValue * safeLtv) / 10n ** 18n;

      if (loanExpectedInput > maxSafeBorrowAmount) {
        const capBorrow = document.getElementById('capBorrow').checked;
        if (capBorrow) {
          loanExpectedInput = maxSafeBorrowAmount;
        } else {
          const projectedLtv = calculateLtv(loanExpectedInput, newCollateralValue);
          showError(`Projected Target LTV (${projectedLtv.toFixed(2)}%) exceeds Target Market LLTV (${(Number(targetLltv) / 1e16).toFixed(2)}%). Rollover would revert on-chain. Check "Cap target borrow" to automatically cap target leverage.`);
          return;
        }
      }

      try {
        loanRouteData = await fetchSwapRoute(
          destLoanAddress,
          loanExpectedInput,
          sourceLoanAddress,
          slippage,
          ETHER_GENERAL_ADAPTER_1,
          MORPHO_BUNDLER_V3
        );
        loanExpectedOutput = BigInt(loanRouteData.outputs[0].amount);
      } catch (err) {
        showError(`Swap Router Loan Route Error: ${err.message}. Failed to fetch conversion route for loan asset.`);
        return;
      }

      loanQuotedRate = loanExpectedInput > 0n ? (loanExpectedOutput * 10n ** (18n + decDiff)) / loanExpectedInput : 0n;
      loanSlippagePct = loanOracleRate > 0n ? Number((loanOracleRate - loanQuotedRate) * 10000n / loanOracleRate) / 100 : 0.0;
    }

    statusEl.innerText = "Compiling atomic flashloan bundle...";

    // Construct rollover bundle via builders.js helper
    const bundleResult = buildRolloverBundle({
      encodeFunctionData,
      encodeAbiParameters,
      keccak256,
      sourceMarketParams,
      destMarketParams,
      collateralAmount,
      debtAmount,
      isFull,
      sourceCollateralAddress,
      destCollateralAddress,
      routeData,
      userAddress,
      ETHER_GENERAL_ADAPTER_1,
      MORPHO_BUNDLER_V3,
      isSameCollateral,
      isSameLoan,
      loanRouteData,
      loanExpectedInput,
      loanExpectedOutput,
      slippage: slippage * 100,
      borrowShares: liveBorrowShares
    });

    const borrowAmount = bundleResult.borrowAmount;
    const finalCalldata = bundleResult.finalCalldata;

    const newCollateralValue = calculateCollateralValue(expectedNewCollateral, newOraclePrice);
    const newLtv = calculateLtv(borrowAmount, newCollateralValue);
    const newLeverage = calculateLeverage(newCollateralValue, borrowAmount);

    // Update state for confirm execute button
    pendingTx = {
      to: MORPHO_BUNDLER_V3,
      data: finalCalldata,
      value: 0n,
      type: 'rollover',
      oracleRate: Number(oracleRatio) / 1e18,
      estimatedRate: Number(quotedRate) / 1e18,
      estimatedPriceImpact: slippagePct
    };

    // Render Preview
    const badgeEl = document.getElementById('previewSlippageBadge');
    badgeEl.innerText = `Price Impact: ${slippagePct.toFixed(2)}%`;
    badgeEl.style.display = 'inline-block';
    if (slippagePct < 0.5) {
      badgeEl.style.backgroundColor = '#10b981'; // Green
    } else if (slippagePct <= 1.5) {
      badgeEl.style.backgroundColor = '#f59e0b'; // Yellow/Orange
    } else {
      badgeEl.style.backgroundColor = '#ef4444'; // Red
    }

    if (maturity.isExpired) {
      document.getElementById('maturityNotice').style.display = 'block';
    } else {
      document.getElementById('maturityNotice').style.display = 'none';
    }

    const oldOraclePriceUsdc = Number(oldOracleUSD) / 1e18;
    const newOraclePriceUsdc = Number(newOracleUSD) / 1e18;
    const expectedRate = Number(quotedRate) / 1e18;
    const impliedOldPriceUsdc = expectedRate * newOraclePriceUsdc;

    let loanNotice = "";
    if (!isSameLoan) {
      loanNotice = `
        <div style="margin-top: 12px; border-top: 1px dashed #334155; padding-top: 12px;">
          <strong style="color: #60a5fa; font-size: 12px; display: block; text-transform: uppercase; letter-spacing: 0.05em;">Cross-Loan Asset Swap</strong>
          Expected Swap Rate: <span style="font-family: monospace; color: #f8fafc;">1 ${destMarketParams.loanSymbol} = ${(Number(loanQuotedRate)/1e18).toFixed(4)} ${sourceMarketParams.loanSymbol}</span><br>
          Price Impact (vs. Oracle): <span style="font-weight: 600; color: ${loanSlippagePct > 1.0 ? '#f87171' : '#34d399'}">${loanSlippagePct.toFixed(2)}%</span>
        </div>
      `;
    }

    document.getElementById('previewMetrics').innerHTML = `
      <div style="margin-bottom: 12px;">
        <strong style="color: #94a3b8; font-size: 12px; display: block; text-transform: uppercase; letter-spacing: 0.05em;">Token Swap Exchange Rates</strong>
        Expected Swap Rate: <span style="font-family: monospace; color: #f8fafc;">1 ${sourceMarketParams.collateralSymbol} = ${expectedRate.toFixed(4)} ${destMarketParams.collateralSymbol}</span> <span style="color: #94a3b8; font-size: 12px;">(Implied: 1 PT-old = $${impliedOldPriceUsdc.toFixed(4)})</span><br>
        Oracle Fair Value Rate: <span style="font-family: monospace; color: #f8fafc;">1 ${sourceMarketParams.collateralSymbol} = ${(Number(oracleRatio)/1e18).toFixed(4)} ${destMarketParams.collateralSymbol}</span> <span style="color: #94a3b8; font-size: 12px;">(Oracles: PT-old = $${oldOraclePriceUsdc.toFixed(4)}, PT-new = $${newOraclePriceUsdc.toFixed(4)})</span><br>
        Price Impact (vs. Oracle): <span style="font-weight: 600; color: ${slippagePct > 1.0 ? '#f87171' : '#34d399'}">${slippagePct.toFixed(2)}%</span>
        ${loanNotice}
      </div>
      
      <div style="margin-bottom: 12px;">
        <strong style="color: #94a3b8; font-size: 12px; display: block; text-transform: uppercase; letter-spacing: 0.05em;">Simulated Target Position</strong>
        Migrated Collateral: <span style="font-family: monospace; color: #38bdf8;">${expectedOutput} ${destMarketParams.collateralSymbol}</span><br>
        New Borrow Debt: <span style="font-family: monospace; color: #f43f5e;">${(Number(borrowAmount)/(10 ** destMarketParams.loanDecimals)).toFixed(2)} ${destMarketParams.loanSymbol}</span><br>
        New LTV & Leverage: <span style="color: #34d399;">${newLtv.toFixed(2)}% (${newLeverage})</span>
      </div>
    `;

    // Display raw calldata in payload preview container
    document.getElementById('rawFromAddress').innerText = userAddress;
    document.getElementById('rawCalldataTextarea').value = finalCalldata;
    document.getElementById('payloadContainer').style.display = 'block';

    // Show Preview Container & hide loading status
    document.getElementById('previewContainer').style.display = 'block';
    statusEl.style.display = 'none';

    if (document.getElementById('settingsAutoSimulate').checked) {
      const statusEl = document.getElementById('status');
      statusEl.style.display = 'block';
      statusEl.className = 'info';
      statusEl.innerText = "Running dry-run simulation on mainnet fork...";
      try {
        const sim = await runSimulation(userAddress, MORPHO_BUNDLER_V3, finalCalldata, 0n);
        const simContainer = document.getElementById('simulationResultContainer');
        const simWarnings = document.getElementById('simulationWarningsContainer');
        await renderSimulationResult(sim, simContainer, simWarnings, userAddress, finalCalldata, sourceMarketParams);
      } catch (simErr) {
        console.error("Auto-simulation failed:", simErr);
        const simContainer = document.getElementById('simulationResultContainer');
        simContainer.style.display = 'block';
        simContainer.innerHTML = `<span style="color: #ef4444;">⚠️ Auto-simulation failed: ${simErr.message}</span>`;
      }
    }

  } catch (error) {
    showError(error.message || error);
  }
}

// --- TAB 2: ADJUST LEVERAGE JS IMPLEMENTATION ---
let levDebt = 0n;
let levCollateral = 0n;

function switchTab(tabName) {
  activeTab = tabName;
  document.getElementById('tabContentRollover').classList.remove('active');
  document.getElementById('tabContentLeverage').classList.remove('active');
  document.getElementById('tabContentSimulateRaw').classList.remove('active');
  document.getElementById('tabHeaderRollover').classList.remove('active');
  document.getElementById('tabHeaderLeverage').classList.remove('active');
  document.getElementById('tabHeaderSimulateRaw').classList.remove('active');

  document.getElementById('status').style.display = 'none';
  document.getElementById('payloadContainer').style.display = 'none';
  document.getElementById('simulationResultContainer').style.display = 'none';
  document.getElementById('simulationWarningsContainer').style.display = 'none';

  if (tabName === 'rollover') {
    document.getElementById('tabContentRollover').classList.add('active');
    document.getElementById('tabHeaderRollover').classList.add('active');
  } else if (tabName === 'leverage') {
    document.getElementById('tabContentLeverage').classList.add('active');
    document.getElementById('tabHeaderLeverage').classList.add('active');
  } else if (tabName === 'simulate_raw') {
    document.getElementById('tabContentSimulateRaw').classList.add('active');
    document.getElementById('tabHeaderSimulateRaw').classList.add('active');
  }
  updateCliCommand();
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
    updateCliCommand();

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
  } else {
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
  updateCliCommand();
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
    const ptAddress = getAddress(document.getElementById('levCollateralAddress').value.trim());
    const usdcAddress = getAddress(document.getElementById('levLoanAddress').value.trim());
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
    let routeData;
    
    if (params.mode === 'deleverage' || params.mode === 'deleverage-to-1x') {
      // --- DELEVERAGING SWAP PATH: PT -> USDC ---
      statusEl.innerText = `Connected Wallet: ${userAddress}\nFetching routing data for deleverage swap...`;
      
      routeData = await fetchSwapRoute(ptAddress, params.collateralAmount, usdcAddress, Number(slippage) / 10000, ETHER_GENERAL_ADAPTER_1, MORPHO_BUNDLER_V3);
      const expectedUsdcOutput = BigInt(routeData.outputs[0].amount);
      
      statusEl.innerText = `Swap path resolved! Expected Output: ${(Number(expectedUsdcOutput)/1e6).toFixed(2)} loan tokens.\nGenerating atomic flashloan bundle...`;

      // Setup multicall variables
      const is1x = (params.mode === 'deleverage-to-1x');
      const bufferAmount = params.debtAmount > 100n * 10n ** 6n ? 1n * 10n ** 6n : (params.debtAmount * 2n / 1000n);
      const flashLoanAmount = is1x ? (params.debtAmount + bufferAmount) : (expectedUsdcOutput - bufferAmount);

      const reenterBundle = buildDeleveragingBundle({
        encodeFunctionData,
        marketParams,
        collateralAmount: params.collateralAmount,
        debtAmount: is1x ? expectedUsdcOutput : flashLoanAmount,
        is1x,
        collateralAddress: ptAddress,
        loanAddress: usdcAddress,
        routeData,
        userAddress,
        ETHER_GENERAL_ADAPTER_1,
        MORPHO_BUNDLER_V3,
        flashLoanAmount
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

      finalCalldata = encodeFunctionData({
        abi: BUNDLER_ABI,
        functionName: 'multicall',
        args: [outerBundle]
      });

    } else {
      // --- LEVERAGING UP SWAP PATH: USDC -> PT ---
      statusEl.innerText = `Connected Wallet: ${userAddress}\nFetching routing data for leverage-up swap...`;
      
      routeData = await fetchSwapRoute(usdcAddress, params.debtAmount, ptAddress, Number(slippage) / 10000, ETHER_GENERAL_ADAPTER_1, MORPHO_BUNDLER_V3);
      const expectedPtOutput = BigInt(routeData.outputs[0].amount);
      
      statusEl.innerText = `Swap path resolved! Expected Output: ${(Number(expectedPtOutput)/1e18).toFixed(4)} collateral.\nGenerating atomic flashloan bundle...`;

      const reenterBundle = buildLeveragingUpBundle({
        encodeFunctionData,
        marketParams,
        collateralAmount: expectedPtOutput,
        debtAmount: params.debtAmount,
        collateralAddress: ptAddress,
        loanAddress: usdcAddress,
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

    // Calculate rates and slippage for preview
    const oracleRate = oraclePrice / 10n ** 6n; // USDC per PT in 18 decimals
    let quotedRate = 0n;
    let detailsText = "";

    if (params.mode === 'deleverage' || params.mode === 'deleverage-to-1x') {
      const expectedUsdcOutput = BigInt(routeData.outputs[0].amount);
      if (params.collateralAmount > 0n) {
        quotedRate = (expectedUsdcOutput * 10n ** 30n) / params.collateralAmount;
      }
      detailsText = `
        Expected Output: <span style="font-family: monospace; color: #34d399;">${(Number(expectedUsdcOutput)/1e6).toFixed(2)} USDC</span><br>
        Collateral to Sell: <span style="font-family: monospace; color: #f8fafc;">${(Number(params.collateralAmount)/1e18).toFixed(4)} PT</span>
      `;
    } else {
      const expectedPtOutput = BigInt(routeData.outputs[0].amount);
      if (expectedPtOutput > 0n) {
        quotedRate = (params.debtAmount * 10n ** 30n) / expectedPtOutput;
      }
      detailsText = `
        Expected Output: <span style="font-family: monospace; color: #38bdf8;">${(Number(expectedPtOutput)/1e18).toFixed(4)} PT</span><br>
        USDC to Spend: <span style="font-family: monospace; color: #f43f5e;">${(Number(params.debtAmount)/1e6).toFixed(2)} USDC</span>
      `;
    }

    const slippagePct = oracleRate > 0n ? Number((oracleRate - quotedRate) * 10000n / oracleRate) / 100 : 0.0;
    const slippageLimit = parseFloat(document.getElementById('levSlippage').value);

    // Update state for confirm execute button
    pendingTx = {
      to: MORPHO_BUNDLER_V3,
      data: finalCalldata,
      value: 0n,
      type: 'leverage',
      subType: (params.mode === 'deleverage' || params.mode === 'deleverage-to-1x') ? 'deleverage' : 'leverage_up',
      oracleRate: Number(oracleRate) / 1e18,
      estimatedRate: Number(quotedRate) / 1e18,
      estimatedPriceImpact: slippagePct
    };

    // Fetch old PT maturity for info
    const maturity = await checkCollateralMaturity(publicClient, ptAddress);

    // Render Preview UI
    const badgeEl = document.getElementById('previewSlippageBadge');
    badgeEl.innerText = `Price Impact: ${slippagePct.toFixed(2)}%`;
    badgeEl.style.display = 'inline-block';
    if (slippagePct < 0.5) {
      badgeEl.style.backgroundColor = '#10b981'; // Green
    } else if (slippagePct <= 1.5) {
      badgeEl.style.backgroundColor = '#f59e0b'; // Yellow/Orange
    } else {
      badgeEl.style.backgroundColor = '#ef4444'; // Red
    }

    if (maturity.isExpired) {
      document.getElementById('maturityNotice').style.display = 'block';
    } else {
      document.getElementById('maturityNotice').style.display = 'none';
    }

    document.getElementById('previewMetrics').innerHTML = `
      <div style="margin-bottom: 12px;">
        <strong style="color: #94a3b8; font-size: 12px; display: block; text-transform: uppercase; letter-spacing: 0.05em;">Execution Exchange Rates</strong>
        Expected Price: <span style="font-family: monospace; color: #f8fafc;">1 PT = ${(Number(quotedRate)/1e18).toFixed(4)} USDC</span><br>
        Oracle Price: <span style="font-family: monospace; color: #f8fafc;">1 PT = ${(Number(oracleRate)/1e18).toFixed(4)} USDC</span><br>
        Price Impact (vs. Oracle): <span style="font-weight: 600; color: ${slippagePct > 1.0 ? '#f87171' : '#34d399'}">${slippagePct.toFixed(2)}%</span>
      </div>
      
      <div style="margin-bottom: 12px;">
        <strong style="color: #94a3b8; font-size: 12px; display: block; text-transform: uppercase; letter-spacing: 0.05em;">Simulated Outputs</strong>
        ${detailsText}
        Slippage Tolerance Limit: <span style="font-family: monospace; color: #cbd5e1;">${slippageLimit.toFixed(1)}%</span>
      </div>
    `;

    // Display raw calldata in payload preview container
    document.getElementById('rawFromAddress').innerText = userAddress;
    document.getElementById('rawCalldataTextarea').value = finalCalldata;
    document.getElementById('payloadContainer').style.display = 'block';

    // Show Preview Container & hide loading status
    document.getElementById('previewContainer').style.display = 'block';
    statusEl.style.display = 'none';

    if (document.getElementById('settingsAutoSimulate').checked) {
      const statusEl = document.getElementById('status');
      statusEl.style.display = 'block';
      statusEl.className = 'info';
      statusEl.innerText = "Running dry-run simulation on mainnet fork...";
      try {
        const sim = await runSimulation(userAddress, MORPHO_BUNDLER_V3, finalCalldata, 0n);
        const simContainer = document.getElementById('simulationResultContainer');
        const simWarnings = document.getElementById('simulationWarningsContainer');
        await renderSimulationResult(sim, simContainer, simWarnings, userAddress, finalCalldata, currentLevMarketParams);
      } catch (simErr) {
        console.error("Auto-simulation failed:", simErr);
        const simContainer = document.getElementById('simulationResultContainer');
        simContainer.style.display = 'block';
        simContainer.innerHTML = `<span style="color: #ef4444;">⚠️ Auto-simulation failed: ${simErr.message}</span>`;
      }
    }

  } catch (err) {
    showError(err.message || err);
  }
}

function showError(msg) {
  const statusEl = document.getElementById('status');
  statusEl.className = 'error';
  statusEl.innerText = `Migration Execution Blocked:\n${msg}`;
}

// --- SETTINGS STORAGE & AUTOLOAD ---
function saveSettings() {
  const alchemyKey = document.getElementById('settingsAlchemyKey').value.trim();
  const rpcUrl = document.getElementById('settingsRpcUrl').value.trim();
  const autoSimulate = document.getElementById('settingsAutoSimulate').checked;

  localStorage.setItem('morpho_migration_alchemy_key', alchemyKey);
  localStorage.setItem('morpho_migration_rpc_url', rpcUrl);
  localStorage.setItem('morpho_migration_auto_simulate', autoSimulate ? 'true' : 'false');
}

function loadSettings() {
  const alchemyKey = localStorage.getItem('morpho_migration_alchemy_key') || '';
  const rpcUrl = localStorage.getItem('morpho_migration_rpc_url') || '';
  const autoSimulate = localStorage.getItem('morpho_migration_auto_simulate') !== 'false'; // default true

  document.getElementById('settingsAlchemyKey').value = alchemyKey;
  document.getElementById('settingsRpcUrl').value = rpcUrl;
  document.getElementById('settingsAutoSimulate').checked = autoSimulate;
}

async function tryAutoloadFromEnv() {
  try {
    const response = await fetch('.env');
    if (response.ok) {
      const text = await response.text();
      const lines = text.split('\n');
      let envKey = '';
      let envRpc = '';

      for (const line of lines) {
        const matchKey = line.match(/^\s*ALCHEMY_API_KEY\s*=\s*(.*)?\s*$/);
        if (matchKey) {
          envKey = (matchKey[1] || '').replace(/['"]/g, '').trim();
        }
        const matchRpc = line.match(/^\s*RPC_URL\s*=\s*(.*)?\s*$/);
        if (matchRpc) {
          envRpc = (matchRpc[1] || '').replace(/['"]/g, '').trim();
        }
      }

      if (envKey && !document.getElementById('settingsAlchemyKey').value) {
        document.getElementById('settingsAlchemyKey').value = envKey;
      }
      if (envRpc && !document.getElementById('settingsRpcUrl').value) {
        document.getElementById('settingsRpcUrl').value = envRpc;
      }
      saveSettings();
    }
  } catch (err) {
    // Silent fail if .env is missing or unreadable
  }
}

// --- TAB 3: SIMULATE RAW TX IMPLEMENTATION ---
function onRawTxTextChanged() {
  const text = document.getElementById('rawTxDataTextarea').value.trim();
  const preAssessmentEl = document.getElementById('rawTxPreAssessment');
  if (!text) {
    preAssessmentEl.style.display = 'none';
    return;
  }

  try {
    const json = JSON.parse(text);
    if (!json.from || !json.to || !json.data) {
      preAssessmentEl.style.display = 'block';
      preAssessmentEl.innerHTML = `<span style="color: #ef4444;">⚠️ Invalid JSON: Must contain "from", "to", and "data" keys.</span>`;
      return;
    }

    const value = json.value || '0';
    const calldataLen = (json.data.length - 2) / 2;

    preAssessmentEl.style.display = 'block';
    preAssessmentEl.innerHTML = `
      <strong>Raw Transaction Assessment:</strong><br>
      From: <span style="font-family: monospace; color: #38bdf8;">${json.from}</span><br>
      To: <span style="font-family: monospace; color: #38bdf8;">${json.to}</span><br>
      Value: <span style="font-family: monospace; color: #f8fafc;">${value} wei</span><br>
      Calldata Length: <span style="font-family: monospace; color: #f8fafc;">${calldataLen} bytes</span>
    `;
  } catch (err) {
    preAssessmentEl.style.display = 'block';
    preAssessmentEl.innerHTML = `<span style="color: #ef4444;">⚠️ JSON Parse Error: ${err.message}</span>`;
  }
}

async function onRawTxFileSelected(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('rawTxDataTextarea').value = e.target.result;
    onRawTxTextChanged();
  };
  reader.readAsText(file);
}

function warnOnAddressMismatches(fromAddress, data) {
  const mismatches = [];
  try {
    const decodedOuter = decodeFunctionData({
      abi: BUNDLER_ABI,
      data
    });

    const bundle = decodedOuter.args[0];

    const checkReenterBundle = (reenterItems) => {
      for (const item of reenterItems) {
        try {
          const decodedSub = decodeFunctionData({
            abi: ADAPTER_ABI,
            data: item.data
          });

          let onBehalf;
          if (decodedSub.functionName === 'morphoRepay') {
            onBehalf = getAddress(decodedSub.args[4]);
          } else if (decodedSub.functionName === 'morphoSupplyCollateral') {
            onBehalf = getAddress(decodedSub.args[2]);
          }

          if (onBehalf && onBehalf.toLowerCase() !== fromAddress.toLowerCase()) {
            mismatches.push({
              functionName: decodedSub.functionName,
              onBehalf,
              expected: fromAddress
            });
          }
        } catch (e) {
          // Ignore decode error
        }
      }
    };

    for (const item of bundle) {
      try {
        const decoded = decodeFunctionData({
          abi: ADAPTER_ABI,
          data: item.data
        });

        let onBehalf;
        if (decoded.functionName === 'morphoRepay') {
          onBehalf = getAddress(decoded.args[4]);
        } else if (decoded.functionName === 'morphoSupplyCollateral') {
          onBehalf = getAddress(decoded.args[2]);
        }

        if (onBehalf && onBehalf.toLowerCase() !== fromAddress.toLowerCase()) {
          mismatches.push({
            functionName: decoded.functionName,
            onBehalf,
            expected: fromAddress
          });
        } else if (decoded.functionName === 'morphoFlashLoan') {
          const callbackData = decoded.args[2];
          const decodedReenter = decodeAbiParameters(
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
            callbackData
          );
          checkReenterBundle(decodedReenter[0]);
        }
      } catch (e) {
        // Ignore decode error
      }
    }
  } catch (e) {
    // Ignore outer decode failure
  }
  return mismatches;
}

async function runSimulation(fromAddress, toAddress, calldata, value) {
  const apiKey = document.getElementById('settingsAlchemyKey').value.trim();
  const customRpcUrl = document.getElementById('settingsRpcUrl').value.trim();

  let rpcUrl = customRpcUrl;
  if (!rpcUrl && apiKey) {
    rpcUrl = `https://eth-mainnet.g.alchemy.com/v2/${apiKey}`;
  }

  if (!rpcUrl) {
    throw new Error("RPC URL or Alchemy API Key is required to run simulations. Please configure it in the Simulate Raw Tx tab.");
  }

  const checkAuth = async (authorized) => {
    try {
      const client = publicClient || createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
      const auth = await client.readContract({
        address: MORPHO_BLUE,
        abi: [{"inputs":[{"name":"","type":"address"},{"name":"","type":"address"}],"name":"isAuthorized","outputs":[{"name":"","type":"bool"}],"stateMutability":"view","type":"function"}],
        functionName: 'isAuthorized',
        args: [fromAddress, authorized]
      });
      return auth;
    } catch (err) {
      console.warn(`Failed to read authorization state for ${authorized}:`, err);
      return true;
    }
  };

  const [isAdapterAuth, isBundlerAuth] = await Promise.all([
    checkAuth(ETHER_GENERAL_ADAPTER_1),
    checkAuth(MORPHO_BUNDLER_V3)
  ]);

  const calls = [];
  if (!isAdapterAuth) {
    calls.push({
      from: fromAddress,
      to: MORPHO_BLUE,
      value: '0x0',
      data: encodeFunctionData({
        abi: [{"inputs":[{"name":"authorized","type":"address"},{"name":"newIsAuthorized","type":"bool"}],"name":"setAuthorization","outputs":[],"stateMutability":"nonpayable","type":"function"}],
        functionName: 'setAuthorization',
        args: [ETHER_GENERAL_ADAPTER_1, true]
      })
    });
  }
  if (!isBundlerAuth) {
    calls.push({
      from: fromAddress,
      to: MORPHO_BLUE,
      value: '0x0',
      data: encodeFunctionData({
        abi: [{"inputs":[{"name":"authorized","type":"address"},{"name":"newIsAuthorized","type":"bool"}],"name":"setAuthorization","outputs":[],"stateMutability":"nonpayable","type":"function"}],
        functionName: 'setAuthorization',
        args: [MORPHO_BUNDLER_V3, true]
      })
    });
  }

  calls.push({
    from: fromAddress,
    to: toAddress,
    value: value ? `0x${BigInt(value).toString(16)}` : '0x0',
    data: calldata
  });

  const payload = {
    id: 1,
    jsonrpc: "2.0",
    method: "eth_simulateV1",
    params: [
      {
        blockStateCalls: [
          {
            calls
          }
        ]
      },
      "latest"
    ]
  };

  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Simulation RPC failed with status ${response.status}: ${response.statusText}`);
  }

  const resJson = await response.json();
  if (resJson.error) {
    throw new Error(`Simulation failed: ${resJson.error.message || JSON.stringify(resJson.error)}`);
  }

  const results = resJson.result[0].calls;
  const mainCallResult = results[results.length - 1];
  mainCallResult.to = toAddress;

  const collectLogs = (res) => {
    let logs = [];
    if (res.calls && Array.isArray(res.calls)) {
      for (const call of res.calls) {
        if (call.logs && Array.isArray(call.logs)) {
          logs = logs.concat(call.logs);
        }
        if (call.calls && Array.isArray(call.calls)) {
          logs = logs.concat(collectLogs(call));
        }
      }
    }
    if (res.logs && Array.isArray(res.logs)) {
      logs = logs.concat(res.logs);
    }
    return logs;
  };

  const logs = collectLogs(mainCallResult);

  return {
    success: mainCallResult.status === '0x1',
    gasUsed: BigInt(mainCallResult.gasUsed),
    traceTree: mainCallResult,
    error: mainCallResult.error,
    logs
  };
}

const KNOWN_CONTRACTS = {
  "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb": "Morpho Blue Core",
  "0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245": "Morpho Bundler V3",
  "0x4A6c312ec70E8747a587EE860a0353cd42Be0aE0": "Ether General Adapter V1"
};

class BrowserLabelResolver {
  constructor(rpcUrl) {
    this.client = publicClient || createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
    this.cache = {};
  }

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

    const matchSystem = Object.keys(KNOWN_CONTRACTS).find(k => k.toLowerCase() === key);
    if (matchSystem) {
      this.cache[key] = KNOWN_CONTRACTS[matchSystem];
      return this.cache[key];
    }

    if (marketParams) {
      if (marketParams.collateralToken && key === getAddress(marketParams.collateralToken).toLowerCase()) {
        this.cache[key] = `Collateral PT (${marketParams.collateralSymbol})`;
        return this.cache[key];
      }
      if (marketParams.loanToken && key === getAddress(marketParams.loanToken).toLowerCase()) {
        this.cache[key] = `Loan Asset (${marketParams.loanSymbol})`;
        return this.cache[key];
      }
    }

    try {
      const symbol = await this.client.readContract({
        address: cleanAddr,
        abi: [{"inputs":[],"name":"symbol","outputs":[{"name":"","type":"string"}],"stateMutability":"view","type":"function"}],
        functionName: 'symbol'
      });
      this.cache[key] = symbol;
      return symbol;
    } catch (err) {
      return null;
    }
  }
}

async function renderSimulationResult(simResult, containerEl, warningsEl, fromAddress, data, marketParams = null) {
  containerEl.style.display = 'block';
  containerEl.innerHTML = '';
  warningsEl.style.display = 'none';
  warningsEl.textContent = '';

  const mismatches = warnOnAddressMismatches(fromAddress, data);
  if (mismatches.length > 0) {
    warningsEl.style.display = 'block';
    let warningText = `⚠️ Address Context Mismatch Detected in Calldata!\n`;
    warningText += `Transaction Sender: ${fromAddress}\n\n`;
    mismatches.forEach(m => {
      warningText += `├── Function: ${m.functionName}\n`;
      warningText += `└── Encoded onBehalf: ${m.onBehalf} (does NOT match transaction sender)\n`;
    });
    warningText += `\nWithdrawal/borrow steps in General Adapter always act on the transaction sender. This transaction will likely revert on-chain.`;
    warningsEl.textContent = warningText;
  }

  const headerHtml = `
    <h3 style="margin-top: 0; color: #f8fafc; font-size: 16px; border-bottom: 1px solid #334155; padding-bottom: 10px;">
      On-Chain Fork Simulation Summary
    </h3>
    <div style="margin-bottom: 16px; font-size: 14px;">
      Status: ${simResult.success 
        ? `<span style="color: #34d399; font-weight: bold;">✅ SUCCESSFUL</span>`
        : `<span style="color: #f87171; font-weight: bold;">❌ REVERTED</span>`}
      ${simResult.error ? `<br><span style="color: #f87171;">Revert Reason: ${simResult.error.message || JSON.stringify(simResult.error)}</span>` : ''}
      <br>Gas Used: <span style="font-family: monospace; color: #38bdf8;">${simResult.gasUsed.toLocaleString()}</span>
      <br>Estimated Net Cost: <span style="font-family: monospace; color: #e2e8f0;">${(Number(simResult.gasUsed) * 15 / 1e9).toFixed(6)} ETH</span> (at 15 gwei base fee)
    </div>
  `;
  containerEl.innerHTML = headerHtml;

  const traceTitle = `<h4 style="margin: 10px 0; color: #94a3b8; font-size: 13px; text-transform: uppercase;">Simulation Call Trace:</h4>`;
  const treeContainer = document.createElement('div');
  treeContainer.style.fontFamily = 'monospace';
  treeContainer.style.fontSize = '12px';
  treeContainer.style.lineHeight = '1.6';
  treeContainer.style.backgroundColor = '#0f172a';
  treeContainer.style.padding = '12px';
  treeContainer.style.borderRadius = '8px';
  treeContainer.style.overflowX = 'auto';

  const apiKey = document.getElementById('settingsAlchemyKey').value.trim();
  const customRpcUrl = document.getElementById('settingsRpcUrl').value.trim();
  const resolver = new BrowserLabelResolver(customRpcUrl || `https://eth-mainnet.g.alchemy.com/v2/${apiKey}`);

  async function buildTraceNode(call, depth = 0) {
    const nodeDiv = document.createElement('div');
    nodeDiv.style.marginLeft = `${depth * 16}px`;
    nodeDiv.style.borderLeft = depth > 0 ? '1px dashed #334155' : 'none';
    nodeDiv.style.paddingLeft = depth > 0 ? '8px' : '0px';

    const toAddress = call.to || 'Unknown';
    const label = await resolver.resolveLabel(toAddress, marketParams);
    const labelDisplay = label 
      ? `<span style="color: #38bdf8; font-weight: bold;">${label}</span> <span style="color: #64748b;">[${toAddress}]</span>`
      : `<span style="color: #64748b;">${toAddress}</span>`;

    const statusDisplay = call.status === '0x1' 
      ? `<span style="color: #34d399; font-weight: 600;">SUCCESS</span>`
      : `<span style="color: #f87171; font-weight: 600;">REVERT</span>`;

    const valueStr = call.value ? BigInt(call.value).toString() : '0';
    const gas = parseInt(call.gasUsed, 16);

    nodeDiv.innerHTML = `└── [CALL] To: ${labelDisplay} | Value: ${valueStr} | Status: ${statusDisplay} | Gas: ${gas.toLocaleString()}`;

    if (call.error) {
      const errDiv = document.createElement('div');
      errDiv.style.color = '#f87171';
      errDiv.style.paddingLeft = '16px';
      errDiv.textContent = `⚠ Error: ${call.error.message || JSON.stringify(call.error)}`;
      nodeDiv.appendChild(errDiv);
    }

    if (call.calls && Array.isArray(call.calls)) {
      for (const subcall of call.calls) {
        const childNode = await buildTraceNode(subcall, depth + 1);
        nodeDiv.appendChild(childNode);
      }
    }

    return nodeDiv;
  }

  const rootNode = await buildTraceNode(simResult.traceTree, 0);
  treeContainer.appendChild(rootNode);

  containerEl.appendChild(document.createRange().createContextualFragment(traceTitle));
  containerEl.appendChild(treeContainer);
}

async function executeRawSimulation() {
  const statusEl = document.getElementById('status');
  statusEl.style.display = 'block';
  statusEl.className = 'info';
  statusEl.textContent = "Parsing transaction payload...";

  const text = document.getElementById('rawTxDataTextarea').value.trim();
  const containerEl = document.getElementById('simulationResultContainer');
  const warningsEl = document.getElementById('simulationWarningsContainer');

  try {
    const json = JSON.parse(text);
    if (!json.from || !json.to || !json.data) {
      throw new Error("Invalid payload JSON. Must contain 'from', 'to', and 'data' fields.");
    }

    statusEl.textContent = "Executing mainnet fork simulation via eth_simulateV1...";
    const simResult = await runSimulation(json.from, json.to, json.data, json.value || 0n);

    statusEl.textContent = "Resolving address labels and rendering call trace...";
    await renderSimulationResult(simResult, containerEl, warningsEl, json.from, json.data, null);
    statusEl.style.display = 'none';

  } catch (err) {
    statusEl.className = 'error';
    statusEl.textContent = `Simulation Execution Failed:\n${err.message}`;
    containerEl.style.display = 'none';
    warningsEl.style.display = 'none';
  }
}

function generateRolloverCommand() {
  const sourceMarketId = document.getElementById('oldMarketId').value.trim() || '<old-market-id>';
  const destMarketId = document.getElementById('newMarketId').value.trim() || '<new-market-id>';
  const user = userAddress || '<user-address>';
  const type = migrationType; // 'full' or 'partial'
  const debt = document.getElementById('debtAmount').value.trim() || '0';
  const sourceCollateral = document.getElementById('oldCollateralAddress').value.trim();
  const destCollateral = document.getElementById('newCollateralAddress').value.trim();
  const slippage = document.getElementById('slippage').value.trim() || '1.0';
  const sourceLoan = document.getElementById('sourceLoanAddress').value.trim();
  const destLoan = document.getElementById('newLoanAddress').value.trim();

  let cmd = `node cli.js rollover \\\n  --old-market-id ${sourceMarketId} \\\n  --new-market-id ${destMarketId} \\\n  --user ${user}`;
  
  if (type === 'partial') {
    cmd += ` \\\n  --type partial \\\n  --debt ${debt}`;
  } else {
    cmd += ` \\\n  --type full`;
  }

  // Only include Collateral addresses if they don't match the current loaded market's collateral token
  let includeSourceCollateral = true;
  if (sourceMarketParams && sourceMarketParams.collateralToken.toLowerCase() === sourceCollateral.toLowerCase()) {
    includeSourceCollateral = false;
  }
  if (sourceCollateral && includeSourceCollateral) {
    cmd += ` \\\n  --old-collateral ${sourceCollateral}`;
  }

  let includeDestCollateral = true;
  if (destMarketParams && destMarketParams.collateralToken.toLowerCase() === destCollateral.toLowerCase()) {
    includeDestCollateral = false;
  }
  if (destCollateral && includeDestCollateral) {
    cmd += ` \\\n  --new-collateral ${destCollateral}`;
  }

  if (slippage !== '1.0') {
    cmd += ` \\\n  --slippage ${slippage}`;
  }
  if (sourceLoan && sourceLoan.toLowerCase() !== '0xA0b86991c6218b36c1d19D4a2e9Eb0CE3606eB48'.toLowerCase()) {
    cmd += ` \\\n  --old-loan ${sourceLoan}`;
  }
  let includeDestLoan = true;
  if (destMarketParams && destMarketParams.loanToken.toLowerCase() === destLoan.toLowerCase()) {
    includeDestLoan = false;
  } else if (destLoan.toLowerCase() === '0xA0b86991c6218b36c1d19D4a2e9Eb0CE3606eB48'.toLowerCase()) {
    includeDestLoan = false;
  }
  if (destLoan && includeDestLoan) {
    cmd += ` \\\n  --new-loan ${destLoan}`;
  }
  
  cmd += ` \\\n  --simulation`;

  return cmd;
}

function generateLeverageCommand() {
  const marketId = document.getElementById('levMarketId').value.trim() || '<market-id>';
  const targetLeverage = parseFloat(document.getElementById('levSlider').value).toFixed(2);
  const user = userAddress || '<user-address>';
  const pt = document.getElementById('levCollateralAddress').value.trim();
  const slippage = document.getElementById('levSlippage').value.trim() || '1.0';
  const usdc = document.getElementById('levLoanAddress').value.trim();

  let cmd = `node cli.js adjust-leverage \\\n  --market-id ${marketId} \\\n  --target-leverage ${targetLeverage} \\\n  --user ${user}`;
  
  let includePt = true;
  if (currentLevMarketParams && currentLevMarketParams.collateralToken.toLowerCase() === pt.toLowerCase()) {
    includePt = false;
  }
  if (pt && includePt) {
    cmd += ` \\\n  --collateral ${pt}`;
  }

  if (slippage !== '1.0') {
    cmd += ` \\\n  --slippage ${slippage}`;
  }
  if (usdc && usdc.toLowerCase() !== '0xA0b86991c6218b36c1d19D4a2e9Eb0CE3606eB48'.toLowerCase()) {
    cmd += ` \\\n  --loan ${usdc}`;
  }
  
  cmd += ` \\\n  --simulation`;

  return cmd;
}

function updateCliCommand() {
  const codeEl = document.getElementById('cliCommandCode');
  if (!codeEl) return;
  if (activeTab === 'rollover') {
    codeEl.textContent = generateRolloverCommand();
  } else if (activeTab === 'leverage') {
    codeEl.textContent = generateLeverageCommand();
  }
}

async function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  
  // Fallback for non-secure contexts or older browsers
  const textArea = document.createElement("textarea");
  textArea.value = text;
  
  // Avoid scrolling to bottom
  textArea.style.top = "0";
  textArea.style.left = "0";
  textArea.style.position = "fixed";
  
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  
  try {
    const successful = document.execCommand('copy');
    if (!successful) {
      throw new Error('Fallback copy command failed');
    }
  } catch (err) {
    throw new Error('Fallback copy failed: ' + err.message);
  } finally {
    document.body.removeChild(textArea);
  }
}

// Programmatic Event Listener Bindings & Initializations
try {
  // Tab Selection Navigation
  document.getElementById('tabHeaderRollover').addEventListener('click', () => switchTab('rollover'));
  document.getElementById('tabHeaderLeverage').addEventListener('click', () => switchTab('leverage'));
  document.getElementById('tabHeaderSimulateRaw').addEventListener('click', () => switchTab('simulate_raw'));

  // Settings
  document.getElementById('settingsAlchemyKey').addEventListener('input', saveSettings);
  document.getElementById('settingsRpcUrl').addEventListener('input', saveSettings);
  document.getElementById('settingsAutoSimulate').addEventListener('change', saveSettings);

  // Tab 1 (Rollover) Inputs & Buttons
  document.getElementById('oldCollateralAddress').addEventListener('input', () => { onTokenAddressInput('oldCollateralAddress', 'oldCollateralBadge'); updateCliCommand(); });
  document.getElementById('newCollateralAddress').addEventListener('input', () => { onTokenAddressInput('newCollateralAddress', 'newCollateralBadge'); updateCliCommand(); });
  document.getElementById('sourceLoanAddress').addEventListener('input', () => { onTokenAddressInput('sourceLoanAddress', 'sourceLoanBadge'); updateCliCommand(); });
  document.getElementById('newLoanAddress').addEventListener('input', () => { onTokenAddressInput('newLoanAddress', 'destLoanBadge'); updateCliCommand(); });
  document.getElementById('oldMarketId').addEventListener('input', () => { onMarketIdInput('oldMarketId', 'oldMarketLabel', 'oldCollateralAddress', 'oldCollateralBadge', 'sourceLoanAddress', 'sourceLoanBadge'); updateCliCommand(); });
  document.getElementById('newMarketId').addEventListener('input', () => { onMarketIdInput('newMarketId', 'newMarketLabel', 'newCollateralAddress', 'newCollateralBadge', 'newLoanAddress', 'destLoanBadge'); updateCliCommand(); });
  document.getElementById('loadPositionBtn').addEventListener('click', connectAndLoadPosition);
  document.getElementById('toggleFull').addEventListener('click', () => selectMigrationType('full'));
  document.getElementById('togglePartial').addEventListener('click', () => selectMigrationType('partial'));
  document.getElementById('debtAmount').addEventListener('input', onDebtInputChange);
  document.getElementById('migrateBtn').addEventListener('click', initiateMigration);
  document.getElementById('slippage').addEventListener('input', updateCliCommand);

  // Tab 2 (Leverage) Inputs & Buttons
  document.getElementById('levMarketId').addEventListener('input', () => { onMarketIdInput('levMarketId', 'levMarketLabel', 'levCollateralAddress', 'levCollateralBadge'); updateCliCommand(); });
  document.getElementById('levCollateralAddress').addEventListener('input', () => { onTokenAddressInput('levCollateralAddress', 'levCollateralBadge'); updateCliCommand(); });
  document.getElementById('levLoadBtn').addEventListener('click', levConnectAndLoadPosition);
  document.getElementById('levSlider').addEventListener('input', onLevSliderChange);
  document.getElementById('levExecuteBtn').addEventListener('click', executeLeverageAdjustment);
  document.getElementById('confirmExecuteBtn').addEventListener('click', confirmAndSubmitTransaction);
  document.getElementById('levLoanAddress').addEventListener('input', updateCliCommand);
  document.getElementById('levSlippage').addEventListener('input', updateCliCommand);

  // Tab 3 (Simulate Raw) Inputs & Buttons
  document.getElementById('rawTxFileInput').addEventListener('change', onRawTxFileSelected);
  document.getElementById('rawTxDataTextarea').addEventListener('input', onRawTxTextChanged);
  document.getElementById('simulateRawBtn').addEventListener('click', executeRawSimulation);

  // CLI Collapsible Header & Copy to Clipboard listeners
  const cliCard = document.getElementById('cliCard');
  const cliHeader = document.getElementById('cliHeader');
  const cliToggleText = document.getElementById('cliToggleText');
  cliHeader.addEventListener('click', () => {
    const isExpanded = cliCard.classList.toggle('expanded');
    cliToggleText.textContent = isExpanded ? 'Click to collapse' : 'Click to expand';
  });

  const copyCliBtn = document.getElementById('copyCliBtn');
  const cliCommandCode = document.getElementById('cliCommandCode');
  copyCliBtn.addEventListener('click', async () => {
    try {
      await copyToClipboard(cliCommandCode.textContent);
      const originalHtml = copyCliBtn.innerHTML;
      copyCliBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
        <span>Copied!</span>
      `;
      copyCliBtn.classList.add('copied');
      setTimeout(() => {
        copyCliBtn.innerHTML = originalHtml;
        copyCliBtn.classList.remove('copied');
      }, 2000);
    } catch (err) {
      console.warn("Failed to copy CLI command:", err);
    }
  });

  // Run Initial dynamic setups
  onTokenAddressInput('sourceLoanAddress', 'sourceLoanBadge');
  onTokenAddressInput('newLoanAddress', 'destLoanBadge');
  onTokenAddressInput('oldCollateralAddress', 'oldCollateralBadge');
  onTokenAddressInput('newCollateralAddress', 'newCollateralBadge');
  onTokenAddressInput('levCollateralAddress', 'levCollateralBadge');
  onMarketIdInput('oldMarketId', 'oldMarketLabel', 'oldCollateralAddress', 'oldCollateralBadge', 'sourceLoanAddress', 'sourceLoanBadge');
  onMarketIdInput('newMarketId', 'newMarketLabel', 'newCollateralAddress', 'newCollateralBadge', 'newLoanAddress', 'destLoanBadge');
  onMarketIdInput('levMarketId', 'levMarketLabel', 'levCollateralAddress', 'levCollateralBadge');

  loadSettings();
  tryAutoloadFromEnv();
  
  updateCliCommand();
} catch (err) {
  console.error("Failed to bind event listeners:", err);
  showError("Initialization Error: " + err.message);
}
