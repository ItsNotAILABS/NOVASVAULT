const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('project has the expected isolated runtime files', async () => {
  const root = path.resolve(__dirname, '..');
  for (const file of ['main.cjs', 'preload.cjs', 'lib/vault-store.cjs', 'src/index.html', 'src/styles.css', 'src/renderer.js']) {
    const stat = await require('node:fs/promises').stat(path.join(root, file));
    assert.equal(stat.isFile(), true, file);
  }
});

test('renderer exposes the laptop explorer surfaces', async () => {
  const html = await require('node:fs/promises').readFile(path.resolve(__dirname, '../src/index.html'), 'utf8');
  for (const label of ['Home', 'Documents', 'Nova Vault', 'Kernels', 'Agents', 'Virtual computer']) assert.match(html, new RegExp(label));
});
