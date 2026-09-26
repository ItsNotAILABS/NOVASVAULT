const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const FORMAT_VERSION = 1;
const KDF = Object.freeze({ name: 'scrypt', N: 32768, r: 8, p: 1, keyLength: 32 });
const MAX_RECORD_BYTES = 16 * 1024 * 1024;
const RECORD_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const VERIFY_TEXT = Buffer.from('NOVASVAUL vault key verification v1', 'utf8');

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function capsuleContentHash(vaultManifest, records) {
  const material = {
    manifest: vaultManifest,
    records: records.map((record) => ({ envelope: record.envelope, file: record.file, sha256: record.sha256 }))
  };
  return crypto.createHash('sha256').update(canonicalJson(material)).digest('hex');
}

function assertRecordId(id) {
  if (typeof id !== 'string' || !RECORD_ID.test(id)) {
    throw new TypeError('Vault record ID must contain only letters, numbers, dots, dashes, or underscores.');
  }
  return id;
}

function assertPassphrase(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 12 || passphrase.length > 1024) {
    throw new TypeError('Vault passphrase must be between 12 and 1024 characters.');
  }
}

function encode(value) {
  return Buffer.from(value).toString('base64');
}

function decode(value, field) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9+/]*={0,2}$/.test(value)) {
    throw new Error(`Invalid encrypted vault ${field}.`);
  }
  return Buffer.from(value, 'base64');
}

function encrypt(key, plaintext, aad) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { version: FORMAT_VERSION, algorithm: 'aes-256-gcm', iv: encode(iv), tag: encode(cipher.getAuthTag()), data: encode(data) };
}

function decrypt(key, envelope, aad) {
  if (!envelope || envelope.version !== FORMAT_VERSION || envelope.algorithm !== 'aes-256-gcm') {
    throw new Error('Unsupported encrypted vault record format.');
  }
  const iv = decode(envelope.iv, 'IV');
  const tag = decode(envelope.tag, 'authentication tag');
  const data = decode(envelope.data, 'payload');
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid encrypted vault record.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

async function atomicWrite(file, contents) {
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temporary, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

class VaultStore {
  constructor(vaultRoot, options = {}) {
    if (!path.isAbsolute(vaultRoot)) throw new TypeError('Vault root must be an absolute path.');
    this.root = path.join(path.resolve(vaultRoot), '.nova');
    this.recordsDirectory = path.join(this.root, 'records');
    this.manifestPath = path.join(this.root, 'vault.json');
    this.maxRecordBytes = options.maxRecordBytes || MAX_RECORD_BYTES;
    this.key = null;
    this.writeQueue = Promise.resolve();
  }

  async ensureDirectories() {
    await fs.mkdir(this.recordsDirectory, { recursive: true, mode: 0o700 });
    await fs.chmod(this.root, 0o700).catch(() => {});
    await fs.chmod(this.recordsDirectory, 0o700).catch(() => {});
  }

  async status() {
    let initialized = false;
    try {
      const stat = await fs.stat(this.manifestPath);
      initialized = stat.isFile();
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const seal = await this.seal();
    return {
      initialized,
      unlocked: Boolean(this.key),
      formatVersion: initialized ? FORMAT_VERSION : null,
      algorithm: 'aes-256-gcm',
      kdf: 'scrypt',
      guarantee: 'owner-held-passphrase',
      records: seal.records,
      chain: seal.chain
    };
  }

  async initialize(passphrase) {
    assertPassphrase(passphrase);
    await this.ensureDirectories();
    try {
      await fs.stat(this.manifestPath);
      return this.unlock(passphrase);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    const salt = crypto.randomBytes(16);
    const key = await this.deriveKey(passphrase, salt, KDF);
    const verification = encrypt(key, VERIFY_TEXT, 'novasvaul:verification:v1');
    const manifest = { version: FORMAT_VERSION, kdf: { ...KDF, salt: encode(salt) }, verification };
    try {
      await atomicWrite(this.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      this.replaceKey(key);
      return this.status();
    } catch (error) {
      key.fill(0);
      throw error;
    }
  }

  async unlock(passphrase) {
    assertPassphrase(passphrase);
    const manifest = await this.readManifest();
    const salt = decode(manifest.kdf.salt, 'KDF salt');
    const key = await this.deriveKey(passphrase, salt, manifest.kdf);
    try {
      const plaintext = decrypt(key, manifest.verification, 'novasvaul:verification:v1');
      if (plaintext.length !== VERIFY_TEXT.length || !crypto.timingSafeEqual(plaintext, VERIFY_TEXT)) {
        throw new Error('Invalid vault credentials.');
      }
    } catch {
      key.fill(0);
      throw new Error('Unable to unlock vault. Check the passphrase or vault integrity.');
    }
    this.replaceKey(key);
    return this.status();
  }

  lock() {
    if (this.key) this.key.fill(0);
    this.key = null;
    return { unlocked: false };
  }

  async write(id, data, options = {}) {
    assertRecordId(id);
    const key = this.requireKey();
    const bytes = Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(String(data), 'utf8');
    if (bytes.length > this.maxRecordBytes) throw new RangeError(`Vault records are limited to ${this.maxRecordBytes} bytes.`);
    const kind = typeof options.kind === 'string' && /^[a-z0-9][a-z0-9.+-]{0,63}\/[a-z0-9][a-z0-9.+-]{0,63}$/i.test(options.kind) ? options.kind : 'application/octet-stream';
    const payload = Buffer.from(JSON.stringify({ id, kind, updatedAt: new Date().toISOString(), data: encode(bytes) }), 'utf8');
    const envelope = encrypt(key, payload, this.recordAad(id));
    const target = this.recordPath(id);
    await this.enqueueWrite(() => atomicWrite(target, `${JSON.stringify(envelope)}\n`));
    return { id, kind, size: bytes.length };
  }

  async read(id) {
    assertRecordId(id);
    const key = this.requireKey();
    let envelope;
    try {
      envelope = JSON.parse(await fs.readFile(this.recordPath(id), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw new Error(`Vault record ${id} could not be read.`);
    }
    try {
      const payload = JSON.parse(decrypt(key, envelope, this.recordAad(id)).toString('utf8'));
      if (payload.id !== id || typeof payload.data !== 'string') throw new Error('Record identity mismatch.');
      const data = decode(payload.data, 'record data');
      if (data.length > this.maxRecordBytes) throw new Error('Record exceeds configured size limit.');
      return { id, kind: payload.kind, updatedAt: payload.updatedAt, size: data.length, data };
    } catch {
      throw new Error(`Vault record ${id} failed authentication.`);
    }
  }

  async delete(id) {
    assertRecordId(id);
    this.requireKey();
    return this.enqueueWrite(async () => {
      try {
        await fs.unlink(this.recordPath(id));
        return true;
      } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
      }
    });
  }

  async list() {
    this.requireKey();
    await this.ensureDirectories();
    const files = await fs.readdir(this.recordsDirectory);
    const records = [];
    for (const file of files.filter((name) => name.endsWith('.nvault'))) {
      let envelope;
      try {
        envelope = JSON.parse(await fs.readFile(path.join(this.recordsDirectory, file), 'utf8'));
        const payload = JSON.parse(decrypt(this.requireKey(), envelope, this.storageAad(path.basename(file, '.nvault'))).toString('utf8'));
        assertRecordId(payload.id);
        if (path.basename(this.recordPath(payload.id)) !== file) throw new Error('Record path mismatch.');
        records.push({ id: payload.id, kind: payload.kind, updatedAt: payload.updatedAt, size: decode(payload.data, 'record data').length });
      } catch {
        records.push({ id: null, corrupt: true, storageId: path.basename(file, '.nvault') });
      }
    }
    return records.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }

  async saveRuntimeState(state) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new TypeError('Runtime state must be an object.');
    return this.write('runtime-state', JSON.stringify(state), { kind: 'application/vnd.novasvaul.runtime+json' });
  }

  async loadRuntimeState(fallback = {}) {
    const record = await this.read('runtime-state');
    if (!record) return fallback;
    try {
      const value = JSON.parse(record.data.toString('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid runtime state.');
      return value;
    } catch {
      throw new Error('Encrypted runtime state is invalid.');
    }
  }

  async seal() {
    let files = [];
    try {
      files = await fs.readdir(this.recordsDirectory);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const items = [];
    for (const file of files.filter((name) => name.endsWith('.nvault')).sort()) {
      const bytes = await fs.readFile(path.join(this.recordsDirectory, file));
      items.push({
        file,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.length
      });
    }
    const chain = crypto.createHash('sha256').update(items.map((item) => item.sha256).join('\n')).digest('hex');
    return { records: items.length, chain, items };
  }

  async exportExit() {
    const status = await this.status();
    if (!status.initialized) throw new Error('Vault has not been initialized.');
    const seal = await this.seal();
    const records = [];
    for (const item of seal.items) {
      records.push({
        file: item.file,
        sha256: item.sha256,
        envelope: await fs.readFile(path.join(this.recordsDirectory, item.file), 'utf8')
      });
    }
    return {
      product: 'NOVASVAUL',
      guarantee: 'The passphrase derives the only key. This bundle is ciphertext. It has no recovery backdoor.',
      algorithm: 'aes-256-gcm',
      kdf: 'scrypt',
      chain: seal.chain,
      manifest: await fs.readFile(this.manifestPath, 'utf8'),
      records
    };
  }

  async exportCapsule() {
    const exit = await this.exportExit();
    const records = exit.records.map(({ file, sha256, envelope }) => ({ file, sha256, envelope }));
    const contentHash = capsuleContentHash(exit.manifest, records);
    const createdAt = new Date().toISOString();
    const capsuleId = `nv${contentHash.slice(0, 30)}`;
    return {
      schema: 'capsule.contract.v1',
      capsule: { id: capsuleId, mode: 'sealed-transfer', parent_hash: null, created_at: createdAt },
      source: {
        product: 'NOVASVAUL',
        instance_id: crypto.createHash('sha256').update(exit.manifest).digest('hex'),
        version: '0.1.0'
      },
      manifest: {
        content_hash: contentHash,
        records: records.length,
        format: 'novasvaul-encrypted-records-v1'
      },
      sealed_state: {
        ciphertext_only: true,
        vault_manifest: exit.manifest,
        records
      },
      permissions: {
        default: 'deny',
        filesystem: {},
        network: {},
        process: {},
        wallet: {},
        secrets: {}
      },
      runtime: {
        engine: 'NOVASVAUL',
        entrypoint: 'nova://workspace',
        state: 'resumable',
        compatibility: {}
      },
      receipts: [{
        type: 'export',
        capsule_id: capsuleId,
        operation: 'vaul.export.capsula',
        content_hash: contentHash,
        created_at: createdAt
      }]
    };
  }

  async readManifest() {
    let manifest;
    try {
      manifest = JSON.parse(await fs.readFile(this.manifestPath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error('Vault has not been initialized.');
      throw new Error('Vault metadata is invalid.');
    }
    const kdf = manifest && manifest.kdf;
    if (manifest.version !== FORMAT_VERSION || !kdf || kdf.name !== 'scrypt' || kdf.N !== KDF.N || kdf.r !== KDF.r || kdf.p !== KDF.p || kdf.keyLength !== KDF.keyLength) {
      throw new Error('Unsupported vault metadata format.');
    }
    return manifest;
  }

  deriveKey(passphrase, salt, parameters) {
    return scrypt(passphrase, salt, parameters.keyLength, { N: parameters.N, r: parameters.r, p: parameters.p, maxmem: 128 * 1024 * 1024 });
  }

  storageId(id) {
    return crypto.createHmac('sha256', this.requireKey()).update(id).digest('hex');
  }

  recordPath(id) {
    return path.join(this.recordsDirectory, `${this.storageId(id)}.nvault`);
  }

  recordAad(id) {
    return this.storageAad(this.storageId(id));
  }

  storageAad(storageId) {
    return `novasvaul:record:v1:${storageId}`;
  }

  requireKey() {
    if (!this.key) throw new Error('Vault is locked.');
    return this.key;
  }

  replaceKey(key) {
    if (this.key) this.key.fill(0);
    this.key = key;
  }

  enqueueWrite(operation) {
    const pending = this.writeQueue.then(operation, operation);
    this.writeQueue = pending.catch(() => {});
    return pending;
  }
}

module.exports = { VaultStore, FORMAT_VERSION, MAX_RECORD_BYTES };
