const networks = Object.freeze({
  mainnet: { id: 4663, name: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } }, blockExplorers: { default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' } } },
  testnet: { id: 46630, name: 'Robinhood Chain Testnet', testnet: true, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.testnet.chain.robinhood.com'] } }, blockExplorers: { default: { name: 'Blockscout', url: 'https://explorer.testnet.chain.robinhood.com' } } }
});
function supplyUnits(value) {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/.test(value)) throw new Error('Use a positive decimal supply with at most 18 decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const units = BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
  if (units <= 0n || units > (1n << 256n) - 1n) throw new Error('Supply must be positive and fit uint256.');
  return units;
}
module.exports = { networks, supplyUnits };
