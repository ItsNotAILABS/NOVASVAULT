const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { VaultStore } = require('../lib/vault-store.cjs');

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

async function temporaryVault(t, options) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'novasvaul-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, store: new VaultStore(root, options) };
}

test('initializes, locks, unlocks, and rejects a wrong passphrase', async (t) => {
  const { root, store } = await temporaryVault(t);
  const fresh = await store.status();
  assert.equal(fresh.initialized, false);
  assert.equal(fresh.unlocked, false);
  assert.equal(fresh.guarantee, 'owner-held-passphrase');
  await store.initialize('a strong test passphrase');
  const opened = await store.status();
  assert.equal(opened.initialized, true);
  assert.equal(opened.unlocked, true);
  assert.equal(opened.algorithm, 'aes-256-gcm');
  assert.equal(opened.kdf, 'scrypt');
  store.lock();
  await assert.rejects(store.unlock('this passphrase is wrong'), /Unable to unlock vault/);
  await store.unlock('a strong test passphrase');
  const manifest = JSON.parse(await fs.readFile(path.join(root, '.nova', 'vault.json'), 'utf8'));
  assert.equal(manifest.kdf.name, 'scrypt');
  assert.equal(manifest.verification.algorithm, 'aes-256-gcm');
});

test('record content and identifiers are encrypted at rest', async (t) => {
  const { root, store } = await temporaryVault(t);
  await store.initialize('another strong passphrase');
  await store.write('private-note', 'the launch code is violet', { kind: 'text/plain' });
  const files = await fs.readdir(path.join(root, '.nova', 'records'));
  assert.equal(files.length, 1);
  assert.doesNotMatch(files[0], /private-note/);
  const disk = await fs.readFile(path.join(root, '.nova', 'records', files[0]), 'utf8');
  assert.doesNotMatch(disk, /launch code|private-note|text\/plain/);
  const record = await store.read('private-note');
  assert.equal(record.data.toString('utf8'), 'the launch code is violet');
  assert.deepEqual(await store.list(), [{ id: 'private-note', kind: 'text/plain', updatedAt: record.updatedAt, size: 25 }]);
});

test('authenticated records detect tampering', async (t) => {
  const { root, store } = await temporaryVault(t);
  await store.initialize('tamper evident passphrase');
  await store.write('receipt', 'authentic');
  const [file] = await fs.readdir(path.join(root, '.nova', 'records'));
  const target = path.join(root, '.nova', 'records', file);
  const envelope = JSON.parse(await fs.readFile(target, 'utf8'));
  const ciphertext = Buffer.from(envelope.data, 'base64');
  ciphertext[0] ^= 1;
  envelope.data = ciphertext.toString('base64');
  await fs.writeFile(target, JSON.stringify(envelope));
  await assert.rejects(store.read('receipt'), /failed authentication/);
  assert.equal((await store.list())[0].corrupt, true);
});

test('record IDs cannot traverse the private store', async (t) => {
  const { store } = await temporaryVault(t);
  await store.initialize('path boundary passphrase');
  await assert.rejects(store.write('../escape', 'blocked'), /record ID/i);
  await assert.rejects(store.read('folder/escape'), /record ID/i);
});

test('runtime state persists encrypted across store instances', async (t) => {
  const { root, store } = await temporaryVault(t);
  await store.initialize('runtime state passphrase');
  const state = { version: 1, agents: [{ id: 'nova', status: 'ready' }], queue: ['compile'], kernels: [] };
  await store.saveRuntimeState(state);
  store.lock();
  const reopened = new VaultStore(root);
  await reopened.unlock('runtime state passphrase');
  assert.deepEqual(await reopened.loadRuntimeState(), state);
  const diskFiles = await fs.readdir(path.join(root, '.nova', 'records'));
  const disk = await fs.readFile(path.join(root, '.nova', 'records', diskFiles[0]), 'utf8');
  assert.equal(disk.includes('compile'), false);
});

test('exit bundle is ciphertext and the chain moves when a record changes', async (t) => {
  const { store } = await temporaryVault(t);
  await store.initialize('exit bundle passphrase');
  await store.write('note', 'plain secret text');
  const first = await store.exportExit();
  const dumped = JSON.stringify(first);
  assert.equal(dumped.includes('plain secret text'), false);
  assert.equal(dumped.includes('exit bundle passphrase'), false);
  assert.equal(first.chain, (await store.status()).chain);
  await store.write('note', 'plain secret text changed');
  const second = await store.exportExit();
  assert.notEqual(second.chain, first.chain);
});

test('exportCapsule seals a ciphertext capsule contract', async (t) => {
  const { store } = await temporaryVault(t);
  const passphrase = 'capsule export passphrase';
  const note = 'capsule note plaintext sentinel';
  await store.initialize(passphrase);
  await store.write('capsule-note', note, { kind: 'text/plain' });
  const bundle = await store.exportCapsule();
  assert.equal(bundle.schema, 'capsule.contract.v1');
  assert.equal(bundle.sealed_state.ciphertext_only, true);
  assert.equal(bundle.source.product, 'NOVASVAUL');
  assert.equal(bundle.source.version, '0.1.0');
  assert.equal(bundle.manifest.format, 'novasvaul-encrypted-records-v1');
  assert.equal(bundle.receipts.length, 1);
  assert.equal(bundle.receipts[0].operation, 'vaul.export.capsula');
  assert.equal(bundle.receipts[0].type, 'export');
  assert.match(bundle.manifest.content_hash, /^[a-f0-9]{64}$/);
  assert.equal(bundle.receipts[0].content_hash, bundle.manifest.content_hash);
  const expected = crypto.createHash('sha256').update(canonicalJson({
    manifest: bundle.sealed_state.vault_manifest,
    records: bundle.sealed_state.records.map((record) => ({ file: record.file, sha256: record.sha256, envelope: record.envelope }))
  })).digest('hex');
  assert.equal(bundle.manifest.content_hash, expected);
  assert.equal(bundle.capsule.id, `nv${bundle.manifest.content_hash.slice(0, 30)}`);
  assert.ok(bundle.capsule.id.length >= 8);
  const dumped = JSON.stringify(bundle);
  assert.equal(dumped.includes(passphrase), false);
  assert.equal(dumped.includes(note), false);
});

test('enforces record size limits and delete semantics', async (t) => {
  const { store } = await temporaryVault(t, { maxRecordBytes: 8 });
  await store.initialize('size limit passphrase');
  await assert.rejects(store.write('large', '123456789'), /limited to 8 bytes/);
  await store.write('small', '12345678');
  assert.equal(await store.delete('small'), true);
  assert.equal(await store.delete('small'), false);
  assert.equal(await store.read('small'), null);
});