import { createPublicClient, createWalletClient, custom, http, isAddress, formatUnits } from 'viem';
import { networks, supplyUnits } from './core.cjs';
import artifact from './artifact.json';
const $ = id => document.getElementById(id);
let busy = false;
const chain = () => networks[$('network').value];
const publicClient = network => createPublicClient({ chain: network, transport: http() });
function status(message) { $('status').textContent = message; }
function link(parent, text, href) { const a = document.createElement('a'); a.textContent = text; a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; parent.append(a); }
function history() { try { return JSON.parse(localStorage.getItem('vaul-launches') || '[]').filter(x => networks[x.network] && isAddress(x.address)).slice(0, 100); } catch { return []; } }
function renderHistory() { $('history').replaceChildren(); for (const item of history()) link($('history'), `${item.name} · ${item.network} · ${item.address}`, `${networks[item.network].blockExplorers.default.url}/address/${item.address}`); }
async function connect() {
  if (!window.ethereum?.request) throw new Error('Open this page in a browser with an EVM wallet extension enabled.');
  const [account] = await window.ethereum.request({ method: 'eth_requestAccounts' });
  if (!isAddress(account)) throw new Error('Wallet did not return a valid account.');
  $('account').textContent = account;
  return { account, wallet: createWalletClient({ transport: custom(window.ethereum) }) };
}
$('connect').onclick = () => connect().catch(error => status(error.shortMessage || error.message));
window.ethereum?.on?.('accountsChanged', () => { $('account').textContent = 'Account changed. Reconnect before reviewing a deployment.'; $('review').checked = false; });
window.ethereum?.on?.('chainChanged', () => { $('review').checked = false; });
$('network').onchange = () => { $('review').checked = false; $('details').replaceChildren(); status(chain().testnet ? 'Testnet selected: tokens have no monetary value.' : 'Mainnet selected: deployment spends real ETH gas. Review the wallet transaction.'); };
$('launch').onsubmit = async event => {
  event.preventDefault(); if (busy) return;
  busy = true; $('submit').disabled = true; $('network').disabled = true; $('receipt').replaceChildren();
  try {
    const network = chain(); const name = $('name').value.trim(); const symbol = $('symbol').value.trim(); const supply = supplyUnits($('supply').value.trim());
    if (!name || name.length > 64 || !/^[a-zA-Z0-9]{1,12}$/.test(symbol) || !$('review').checked) throw new Error('Complete and review the token fields.');
    const { account, wallet } = await connect();
    try { await wallet.switchChain({ id: network.id }); } catch (error) { if (error.code !== 4902 && error.cause?.code !== 4902) throw error; await wallet.addChain({ chain: network }); await wallet.switchChain({ id: network.id }); }
    const currentAccounts = await wallet.getAddresses();
    if (currentAccounts[0]?.toLowerCase() !== account.toLowerCase() || await wallet.getChainId() !== network.id) throw new Error('Wallet account or network changed. Review and retry.');
    status(`Review in your wallet: ${name} (${symbol}), ${$('supply').value.trim()} tokens to ${account} on ${network.name}.`);
    const hash = await wallet.deployContract({ account, chain: network, abi: artifact.abi, bytecode: artifact.bytecode, args: [name, symbol, supply, account] });
    link($('receipt'), 'View submitted transaction', `${network.blockExplorers.default.url}/tx/${hash}`);
    status('Wallet submitted the transaction. Waiting for its receipt…');
    const client = publicClient(network); const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180000 });
    if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error('Deployment failed. Inspect the transaction in the explorer.');
    const address = receipt.contractAddress;
    const actualSupply = await client.readContract({ address, abi: artifact.abi, functionName: 'totalSupply' });
    if (actualSupply !== supply) throw new Error('Receipt returned but supply verification failed. Inspect the contract before using it.');
    const item = { name, address, network: network.testnet ? 'testnet' : 'mainnet', hash };
    let saved = true; try { localStorage.setItem('vaul-launches', JSON.stringify([item, ...history()].slice(0, 100))); } catch { saved = false; }
    renderHistory(); $('receipt').append(document.createElement('br')); link($('receipt'), 'View deployed token', `${network.blockExplorers.default.url}/address/${address}`);
    status(`Deployed. Confirmed total supply: ${formatUnits(actualSupply, 18)}.${saved ? '' : ' Browser history could not be saved; keep the explorer link.'}`);
  } catch (error) { status(error.shortMessage || error.message); } finally { busy = false; $('submit').disabled = false; $('network').disabled = false; $('review').checked = false; }
};
$('inspect').onsubmit = async event => {
  event.preventDefault(); const network = chain(); const address = $('address').value.trim(); $('details').textContent = 'Reading contract…';
  try {
    if (!isAddress(address)) throw new Error('Enter a valid EVM contract address.');
    const client = publicClient(network);
    const [name, symbol, decimals, total] = await Promise.all(['name', 'symbol', 'decimals', 'totalSupply'].map(functionName => client.readContract({ address, abi: artifact.abi, functionName })));
    $('details').textContent = `${name} (${symbol}) · ${formatUnits(total, decimals)} total supply · ${decimals} decimals. Fixed-supply status is unverified: metadata alone cannot prove that minting is disabled. `;
    link($('details'), 'Inspect source and activity', `${network.blockExplorers.default.url}/address/${address}`);
  } catch (error) { $('details').textContent = error.shortMessage || error.message; }
};
renderHistory();
