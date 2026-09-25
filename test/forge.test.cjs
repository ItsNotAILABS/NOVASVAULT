const test = require('node:test');
const assert = require('node:assert/strict');
const { supplyUnits, networks } = require('../forge/core.cjs');
test('supply preserves integer precision and smallest unit', () => { assert.equal(supplyUnits('9007199254740993'), 9007199254740993n * 10n ** 18n); assert.equal(supplyUnits('0.000000000000000001'), 1n); });
test('supply rejects ambiguity, zero, precision loss and overflow', () => { for (const value of ['0', '-1', '1e6', '1,000', '01', '0.0000000000000000001', '9'.repeat(79)]) assert.throws(() => supplyUnits(value)); });
test('network identifiers remain distinct', () => { assert.equal(networks.mainnet.id, 4663); assert.equal(networks.testnet.id, 46630); });
