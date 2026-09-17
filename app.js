import { createWalletClient, createPublicClient, http, custom, getAddress } from 'https://esm.sh/viem';
import { mainnet } from 'https://esm.sh/viem/chains';
import { formatMarketLabel } from './labels.js';
import config from './config.js';
import { AppController } from './src/ui/app-controller.js';
import { RolloverWorkflow } from './src/ui/controllers/rollover-workflow.js';
import { LeverageWorkflow } from './src/ui/controllers/leverage-workflow.js';
import { RawSimulationWorkflow } from './src/ui/controllers/raw-simulation-workflow.js';

export const appController = new AppController(typeof document !== 'undefined' ? document : null);
export const rolloverWorkflow = new RolloverWorkflow({ marketService: appController.marketService, swapQuoterService: appController.swapQuoterService, simulationService: appController.simulationService });
export const leverageWorkflow = new LeverageWorkflow({ marketService: appController.marketService, swapQuoterService: appController.swapQuoterService });
export const rawSimulationWorkflow = new RawSimulationWorkflow({ simulationService: appController.simulationService });

let publicClient = null, userAddress = null, liveDebt = 0n, liveCollateral = 0n, liveBorrowShares = 0n, pendingTx = null;

export const fetchMarketParams = (marketId) => rolloverWorkflow.fetchMarketParams(marketId);
export const checkCollateralMaturity = (client, addr) => rolloverWorkflow.checkCollateralMaturity(client, addr);
export const fetchMorphoPosition = (client, id, user) => rolloverWorkflow.fetchMorphoPosition(client, id, user);
export const fetchSwapRoute = (...args) => rolloverWorkflow.fetchSwapRoute(...args);

export async function resolveUserAndClients(userAddressInputId, statusEl) {
  const inputEl = document.getElementById(userAddressInputId);
  const resolvedAddress = inputEl?.value?.trim();
  const apiKey = document.getElementById('settingsAlchemyKey')?.value?.trim();
  const rpcUrl = document.getElementById('settingsRpcUrl')?.value?.trim() || (apiKey ? `https://eth-mainnet.g.alchemy.com/v2/${apiKey}` : null);

  publicClient = rpcUrl
    ? createPublicClient({ chain: mainnet, transport: http(rpcUrl) })
    : (window.ethereum ? createPublicClient({ chain: mainnet, transport: custom(window.ethereum) }) : createPublicClient({ chain: mainnet, transport: http() }));

  if (resolvedAddress) {
    if (resolvedAddress.length !== 42 || !resolvedAddress.startsWith('0x')) throw new Error("Invalid address format. Must be a 42-character hex address starting with 0x.");
    userAddress = getAddress(resolvedAddress);
  } else {
    if (!window.ethereum) throw new Error("No wallet connected. Please enter a User Wallet Address or connect your wallet.");
    const walletClient = createWalletClient({ chain: mainnet, transport: custom(window.ethereum) });
    const [address] = await walletClient.requestAddresses();
    userAddress = getAddress(address);
    if (inputEl) inputEl.value = userAddress;
  }
  return userAddress;
}

export async function connectAndLoadPosition() {
  const statusEl = document.getElementById('status');
  if (statusEl) { statusEl.style.display = 'block'; statusEl.className = 'info'; statusEl.innerText = "Loading position..."; }
  try {
    const user = await resolveUserAndClients('userAddress', statusEl);
    if (statusEl) statusEl.innerText = `User Address: ${user}\nLoading position data from Morpho Blue...`;
    const oldMarketId = document.getElementById('oldMarketId').value.trim();
    const position = await fetchMorphoPosition(publicClient, oldMarketId, user);
    liveDebt = position.debt; liveCollateral = position.collateral; liveBorrowShares = position.borrowShares;
    const sourceParams = await fetchMarketParams(oldMarketId);
    appController.cliGenerator.setMarketParams('oldMarketId', sourceParams);
    const debtInput = document.getElementById('debtAmount');
    if (debtInput) { debtInput.value = (Number(liveDebt) / (10 ** sourceParams.loanDecimals)).toString(); if (debtInput.previousElementSibling) debtInput.previousElementSibling.textContent = `Source Debt to Repay (${sourceParams.loanSymbol})`; }
    const collInput = document.getElementById('collateralAmount');
    if (collInput) { collInput.value = (Number(liveCollateral) / (10 ** sourceParams.collateralDecimals)).toString(); if (collInput.previousElementSibling) collInput.previousElementSibling.textContent = `Collateral to Migrate (${sourceParams.collateralSymbol})`; }
    if (statusEl) statusEl.innerText = `Loaded position successfully: Debt = ${(Number(liveDebt) / (10 ** sourceParams.loanDecimals)).toFixed(2)} ${sourceParams.loanSymbol}, Collateral = ${(Number(liveCollateral) / (10 ** sourceParams.collateralDecimals)).toFixed(4)} ${sourceParams.collateralSymbol}`;
  } catch (err) {
    appController.errorBanner.showError(err.message, 'status');
  }
  updateCliCommand();
}

export async function onTokenAddressInput(inputId, badgeId) {
  await appController.marketSelector.handleTokenAddressInput(document.getElementById(inputId)?.value, badgeId, publicClient);
  updateCliCommand();
}

export async function onMarketIdInput(inputId, labelId, ptInputId, ptBadgeId, loanInputId, loanBadgeId) {
  const marketId = document.getElementById(inputId)?.value;
  await appController.marketSelector.handleMarketIdInput({
    marketId, collateralInputId: ptInputId, symbolLabelId: ptBadgeId, expiryLabelId: labelId,
    onResolved: async (params) => {
      appController.cliGenerator.setMarketParams(inputId, params);
      const labelEl = document.getElementById(labelId);
      if (labelEl) labelEl.textContent = ` ${formatMarketLabel(params.collateralSymbol, params.loanSymbol)}`;
      if (loanInputId) { const el = document.getElementById(loanInputId); if (el) el.value = params.loanToken; }
      if (loanBadgeId) await onTokenAddressInput(loanInputId, loanBadgeId);
      if (inputId === 'oldMarketId') {
        const debtInput = document.getElementById('debtAmount');
        if (debtInput?.previousElementSibling) debtInput.previousElementSibling.textContent = `Source Debt to Repay (${params.loanSymbol})`;
        const collInput = document.getElementById('collateralAmount');
        if (collInput?.previousElementSibling) collInput.previousElementSibling.textContent = `Collateral to Migrate (${params.collateralSymbol})`;
      }
    }
  });
  updateCliCommand();
}

export async function initiateMigration() {
  const statusEl = document.getElementById('status');
  if (statusEl) { statusEl.style.display = 'block'; statusEl.className = 'info'; statusEl.innerText = "Compiling migration payload..."; }
  try {
    const user = await resolveUserAndClients('userAddress', statusEl);
    const sourceMarketId = document.getElementById('oldMarketId').value.trim(), destMarketId = document.getElementById('newMarketId').value.trim();
    const [sourceMarketParams, destMarketParams] = await Promise.all([fetchMarketParams(sourceMarketId), fetchMarketParams(destMarketId)]);
    const isFull = document.getElementById('toggleFull')?.classList?.contains('active') ?? true;
    const debtAmount = isFull ? liveDebt : BigInt(Math.floor(parseFloat(document.getElementById('debtAmount').value) * (10 ** sourceMarketParams.loanDecimals)));
    const collateralAmount = isFull ? liveCollateral : BigInt(Math.floor(parseFloat(document.getElementById('collateralAmount').value) * (10 ** sourceMarketParams.collateralDecimals)));
    const slippage = parseFloat(document.getElementById('slippage').value) / 100, capBorrow = document.getElementById('capBorrow')?.checked ?? true;
    const apiKey = document.getElementById('settingsAlchemyKey')?.value?.trim(), rpcUrl = document.getElementById('settingsRpcUrl')?.value?.trim() || (apiKey ? `https://eth-mainnet.g.alchemy.com/v2/${apiKey}` : null);

    const compiled = await rolloverWorkflow.compileRolloverPayload({
      sourceMarketId, destMarketId, sourceMarketParams, destMarketParams,
      collateralAmount, debtAmount, isFull, slippage, capBorrow, userAddress: user, liveBorrowShares, publicClient, rpcUrl,
      sourceCollateralAddress: getAddress(document.getElementById('oldCollateralAddress').value),
      destCollateralAddress: getAddress(document.getElementById('newCollateralAddress').value),
      sourceLoanAddress: getAddress(document.getElementById('sourceLoanAddress').value),
      destLoanAddress: getAddress(document.getElementById('newLoanAddress').value)
    });
    pendingTx = compiled.pendingTx;
    appController.positionPreview.renderRolloverPreview(compiled);
  } catch (err) {
    appController.errorBanner.showError(err.message, 'status');
  }
}

export async function confirmAndSubmitTransaction() {
  if (!pendingTx || !userAddress) return;
  const statusEl = document.getElementById('status');
  try {
    const walletClient = createWalletClient({ chain: mainnet, transport: custom(window.ethereum) });
    const [addr] = await walletClient.requestAddresses();
    if (getAddress(addr).toLowerCase() !== userAddress.toLowerCase()) {
      throw new Error(`Connected wallet address (${getAddress(addr)}) does not match the target position user address (${userAddress}).`);
    }
    const hash = await walletClient.sendTransaction({ account: userAddress, to: pendingTx.to, data: pendingTx.data, value: pendingTx.value });
    if (statusEl) { statusEl.className = 'info'; statusEl.innerText = `Transaction Submitted! Hash: ${hash}\nAwaiting block confirmation to audit execution price...`; }
    const previewContainer = document.getElementById('previewContainer');
    if (previewContainer) previewContainer.style.display = 'none';
    const oldPt = document.getElementById('oldCollateralAddress')?.value || document.getElementById('levCollateralAddress')?.value;
    const newPt = document.getElementById('newCollateralAddress')?.value || oldPt;
    const usdc = document.getElementById('sourceLoanAddress')?.value || document.getElementById('levLoanAddress')?.value;
    await rolloverWorkflow.auditRealizedPrice({ txHash: hash, publicClient, pendingTx, statusEl, oldPt, newPt, usdc });
  } catch (err) {
    appController.errorBanner.showError(err.message, 'status');
  }
}

export function onLevSliderChange() {
  const target = parseFloat(document.getElementById('levSlider')?.value || '1.0');
  const el = document.getElementById('levTargetLeverageDisplay');
  if (el) el.innerText = `${target.toFixed(2)}x`;
  appController.positionPreview.renderLeverageSliderMetrics(target, liveCollateral, liveDebt);
  updateCliCommand();
}

export async function levConnectAndLoadPosition() {
  const statusEl = document.getElementById('status');
  if (statusEl) { statusEl.style.display = 'block'; statusEl.className = 'info'; statusEl.innerText = "Loading position..."; }
  try {
    const user = await resolveUserAndClients('levUserAddress', statusEl);
    const marketId = document.getElementById('levMarketId').value.trim();
    const data = await leverageWorkflow.loadPosition({ publicClient, marketId, userAddress: user });
    liveDebt = data.liveDebt; liveCollateral = data.liveCollateral;
    appController.positionPreview.renderLeveragePositionInfo(data.info);
    const sliderEl = document.getElementById('levSlider');
    if (sliderEl) sliderEl.value = Math.min(6.0, data.currentLeverageNum).toString();
    onLevSliderChange();
    if (statusEl) { statusEl.innerText = ""; statusEl.style.display = 'none'; }
  } catch (err) {
    appController.errorBanner.showError(err.message, 'status');
  }
  updateCliCommand();
}

export async function executeLeverageAdjustment() {
  const statusEl = document.getElementById('status');
  if (statusEl) { statusEl.style.display = 'block'; statusEl.className = 'info'; statusEl.innerText = "Simulating leverage adjustment..."; }
  try {
    const user = await resolveUserAndClients('levUserAddress', statusEl), marketId = document.getElementById('levMarketId').value.trim();
    const marketParams = await fetchMarketParams(marketId);
    const oraclePrice = await rolloverWorkflow.marketService.fetchOraclePrice(publicClient, marketParams.oracle);
    const targetLeverage = parseFloat(document.getElementById('levSlider').value), slippageBps = BigInt(Math.floor(parseFloat(document.getElementById('levSlippage').value) * 100));
    const compiled = await leverageWorkflow.compileLeveragePayload({
      marketParams, oraclePrice, userCollateral: liveCollateral, userDebt: liveDebt, targetLeverage, slippageBps, userAddress: user, publicClient
    });
    pendingTx = compiled.pendingTx;
    appController.positionPreview.renderLeveragePreview(compiled);
  } catch (err) {
    appController.errorBanner.showError(err.message, 'status');
  }
}

export async function executeRawSimulation() {
  const rawTxText = document.getElementById('rawTxDataTextarea')?.value;
  const apiKey = document.getElementById('settingsAlchemyKey')?.value?.trim();
  const rpcUrl = document.getElementById('settingsRpcUrl')?.value?.trim() || (apiKey ? `https://eth-mainnet.g.alchemy.com/v2/${apiKey}` : null);
  try {
    const res = await rawSimulationWorkflow.executeRawSimulation({ rpcUrl, forkBlockNumber: process.env.FORK_BLOCK_NUMBER, rawTxPayload: rawTxText });
    appController.positionPreview.renderSimulationResult('simulationResultContainer', res.simResult, { mismatches: res.mismatches, fromAddress: res.fromAddress });
  } catch (err) {
    appController.errorBanner.showError(err.message, 'status');
  }
}

export function onDebtInputChange() {
  const p = appController.cliGenerator.sourceMarketParams;
  appController.positionPreview.updateProportionalCollateral(liveDebt, liveCollateral, p?.loanDecimals || 6, p?.collateralDecimals || 18);
  updateCliCommand();
}

export function selectMigrationType(type) {
  const isFull = type === 'full';
  document.getElementById('toggleFull')?.classList.toggle('active', isFull);
  document.getElementById('togglePartial')?.classList.toggle('active', !isFull);
  const debtInput = document.getElementById('debtAmount');
  const collInput = document.getElementById('collateralAmount');
  const p = appController.cliGenerator.sourceMarketParams;
  const lDec = p?.loanDecimals || 6, cDec = p?.collateralDecimals || 18;

  if (isFull) {
    if (debtInput) { debtInput.value = (Number(liveDebt) / (10 ** lDec)).toFixed(2); debtInput.disabled = true; }
    if (collInput) { collInput.value = (Number(liveCollateral) / (10 ** cDec)).toFixed(4); collInput.disabled = true; }
  } else {
    if (debtInput) { debtInput.disabled = false; debtInput.value = (Number(liveDebt / 2n) / (10 ** lDec)).toFixed(2); onDebtInputChange(); }
    if (collInput) collInput.disabled = true;
  }
  updateCliCommand();
}

export function updateCliCommand() {
  appController.cliGenerator.update();
}

export async function init() {
  appController.init();
  const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  const addInput = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('input', fn); };
  [['loadPositionBtn', connectAndLoadPosition], ['migrateBtn', initiateMigration], ['confirmExecuteBtn', confirmAndSubmitTransaction],
   ['levLoadBtn', levConnectAndLoadPosition], ['levExecuteBtn', executeLeverageAdjustment], ['simulateRawBtn', executeRawSimulation],
   ['toggleFull', () => selectMigrationType('full')], ['togglePartial', () => selectMigrationType('partial')]
  ].forEach(([id, fn]) => bind(id, fn));
  ['userAddress', 'levUserAddress', 'slippage', 'levSlippage', 'sourceLoanAddress', 'newLoanAddress', 'levLoanAddress', 'oldMarketId', 'newMarketId', 'levMarketId'].forEach(id => addInput(id, updateCliCommand));
  addInput('debtAmount', onDebtInputChange);
  addInput('oldMarketId', () => onMarketIdInput('oldMarketId', 'oldMarketLabel', 'oldCollateralAddress', 'oldCollateralSymbol', 'sourceLoanAddress', 'oldLoanSymbol'));
  addInput('newMarketId', () => onMarketIdInput('newMarketId', 'newMarketLabel', 'newCollateralAddress', 'newCollateralSymbol', 'newLoanAddress', 'newLoanSymbol'));
  addInput('levMarketId', () => onMarketIdInput('levMarketId', 'levMarketLabel', 'levCollateralAddress', 'levCollateralSymbol', 'levLoanAddress', 'levLoanSymbol'));
  addInput('levSlider', onLevSliderChange);
  updateCliCommand();
}

if (typeof window !== 'undefined') {
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
}
