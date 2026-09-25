const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { VaultStore } = require('./lib/vault-store.cjs');

let mainWindow;
const vaultRoot = path.join(app.getPath('userData'), 'vault');
const vaultStore = new VaultStore(vaultRoot);
const allowedRoots = new Set();

function registerRoots() {
  allowedRoots.clear();
  allowedRoots.add(path.resolve(os.homedir()).toLowerCase());
  allowedRoots.add(path.resolve(vaultRoot).toLowerCase());
}

function safePath(input) {
  const candidate = path.resolve(String(input || os.homedir()));
  const lower = candidate.toLowerCase();
  const allowed = [...allowedRoots].some((root) => lower === root || lower.startsWith(`${root}${path.sep}`));
  if (!allowed) throw new Error('Path is outside the NOVASVAUL workspace.');
  return candidate;
}

async function statEntry(fullPath) {
  const stat = await fs.stat(fullPath);
  return {
    name: path.basename(fullPath),
    path: fullPath,
    kind: stat.isDirectory() ? 'folder' : 'file',
    size: stat.isDirectory() ? null : stat.size,
    modified: stat.mtime.toISOString(),
    extension: stat.isDirectory() ? '' : path.extname(fullPath).slice(1).toLowerCase()
  };
}

async function listDirectory(input) {
  const directory = safePath(input);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    try { result.push(await statEntry(path.join(directory, entry.name))); } catch {}
  }
  return result.sort((a, b) => Number(b.kind === 'folder') - Number(a.kind === 'folder') || a.name.localeCompare(b.name));
}

async function searchFiles(query) {
  const root = safePath(os.homedir());
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return [];
  const found = [];
  const skip = new Set(['node_modules', '.git', 'AppData']);
  async function walk(directory, depth) {
    if (depth > 5 || found.length >= 80) return;
    let entries = [];
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (skip.has(entry.name) || entry.name.startsWith('.')) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.name.toLowerCase().includes(needle)) {
        try { found.push(await statEntry(fullPath)); } catch {}
      }
      if (entry.isDirectory()) await walk(fullPath, depth + 1);
      if (found.length >= 80) return;
    }
  }
  await walk(root, 0);
  return found;
}

async function previewFile(input) {
  const fullPath = safePath(input);
  const stat = await fs.stat(fullPath);
  if (!stat.isFile()) return { mode: 'folder' };
  if (stat.size > 1024 * 1024) return { mode: 'metadata', message: 'Preview unavailable for files over 1 MB.' };
  const ext = path.extname(fullPath).toLowerCase();
  const textExts = new Set(['.txt', '.md', '.json', '.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.css', '.html', '.xml', '.yaml', '.yml', '.csv', '.log']);
  if (!textExts.has(ext)) return { mode: 'metadata', message: 'Binary preview is not enabled yet.' };
  return { mode: 'text', content: await fs.readFile(fullPath, 'utf8') };
}

function fileHash(fullPath) {
  return fs.readFile(fullPath).then((data) => crypto.createHash('sha256').update(data).digest('hex'));
}

function registerIpc() {
  ipcMain.handle('nova:home', () => ({ path: os.homedir(), name: os.userInfo().username }));
  ipcMain.handle('nova:list', (_event, directory) => listDirectory(directory));
  ipcMain.handle('nova:search', (_event, query) => searchFiles(query));
  ipcMain.handle('nova:preview', (_event, file) => previewFile(file));
  ipcMain.handle('nova:hash', (_event, file) => fileHash(safePath(file)));
  ipcMain.handle('nova:open', async (_event, target) => { await shell.openPath(safePath(target)); return true; });
  ipcMain.handle('nova:choose-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('nova:ensure-vault', async () => { await fs.mkdir(vaultRoot, { recursive: true }); return vaultRoot; });
  ipcMain.handle('nova:vault-status', () => vaultStore.status());
  ipcMain.handle('nova:vault-initialize', (_event, passphrase) => vaultStore.initialize(passphrase));
  ipcMain.handle('nova:vault-unlock', (_event, passphrase) => vaultStore.unlock(passphrase));
  ipcMain.handle('nova:vault-lock', () => vaultStore.lock());
  ipcMain.handle('nova:vault-list', () => vaultStore.list());
  ipcMain.handle('nova:vault-read', async (_event, id) => {
    const record = await vaultStore.read(id);
    return record && { ...record, data: record.data.toString('utf8') };
  });
  ipcMain.handle('nova:vault-write', (_event, record) => {
    if (!record || typeof record !== 'object' || typeof record.data !== 'string') throw new TypeError('Invalid vault record.');
    return vaultStore.write(record.id, record.data, { kind: record.kind });
  });
  ipcMain.handle('nova:vault-delete', (_event, id) => vaultStore.delete(id));
  ipcMain.handle('nova:vault-seal', () => vaultStore.seal());
  ipcMain.handle('nova:vault-export', async () => {
    const bundle = await vaultStore.exportExit();
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: 'novasvaul-exit.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true, chain: bundle.chain };
    await fs.writeFile(result.filePath, `${JSON.stringify(bundle, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    return { ok: true, path: result.filePath, chain: bundle.chain };
  });
  ipcMain.handle('nova:runtime-load', () => vaultStore.loadRuntimeState({ version: 1, agents: [], kernels: [], queue: [] }));
  ipcMain.handle('nova:runtime-save', (_event, state) => vaultStore.saveRuntimeState(state));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1040, minHeight: 680,
    backgroundColor: '#f4f6f8',
    title: 'NOVASVAUL',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false }
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.on('closed', () => vaultStore.lock());
}

app.whenReady().then(async () => {
  registerRoots();
  await fs.mkdir(vaultRoot, { recursive: true });
  registerIpc();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => vaultStore.lock());
