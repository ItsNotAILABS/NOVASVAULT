const state = { currentPath: '', homePath: '', history: [], future: [], entries: [], selected: null, view: 'list', location: 'home', searchMode: false };
const $ = (id) => document.getElementById(id);
const icons = { folder: '▰', md: '≡', json: '{}', js: 'JS', ts: 'TS', pdf: 'PDF', png: '▧', jpg: '▧', zip: '▤', default: '·' };
const locations = {};

function formatSize(size) { if (size === null) return '—'; if (size < 1024) return `${size} B`; if (size < 1048576) return `${Math.round(size / 102.4) / 10} KB`; return `${Math.round(size / 104857.6) / 10} MB`; }
function formatDate(value) { return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value)); }
function iconFor(entry) { if (entry.kind === 'folder') return entry.name.toLowerCase().includes('vault') ? '◆' : '▰'; return icons[entry.extension] || icons.default; }
function setToast(message) { const toast = $('toast'); toast.textContent = message; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2200); }

function renderBreadcrumbs() {
  const root = document.createElement('button'); root.className = 'crumb'; root.textContent = 'Home'; root.onclick = () => openPath(state.homePath, false); $('breadcrumbs').replaceChildren(root);
  const relative = state.currentPath.slice(state.homePath.length).split(/[\\/]/).filter(Boolean); let built = state.homePath;
  for (const piece of relative) { built += `\\${piece}`; const sep = document.createElement('span'); sep.className = 'crumb-sep'; sep.textContent = '›'; const crumb = document.createElement('button'); crumb.className = 'crumb'; crumb.textContent = piece; const target = built; crumb.onclick = () => openPath(target, false); $('breadcrumbs').append(sep, crumb); }
}

function renderFiles() {
  const view = $('file-view'); view.innerHTML = '';
  if (!state.entries.length) { view.innerHTML = '<div class="empty-state"><div style="font-size:28px;color:#b4c1cd">⌁</div><p>No files found in this view.</p></div>'; return; }
  if (state.view === 'grid') { const grid = document.createElement('div'); grid.className = 'grid-mode'; state.entries.forEach((entry) => grid.append(makeCard(entry))); view.append(grid); return; }
  const table = document.createElement('table'); table.className = 'file-table'; table.innerHTML = '<thead><tr><th style="width:48%">Name</th><th>Type</th><th>Date modified</th><th>Size</th><th></th></tr></thead>'; const body = document.createElement('tbody'); state.entries.forEach((entry) => body.append(makeRow(entry))); table.append(body); view.append(table);
}
function selectEntry(entry, element) { document.querySelectorAll('.selected').forEach((node) => node.classList.remove('selected')); element.classList.add('selected'); state.selected = entry; $('status-selection').textContent = `${entry.name} selected`; preview(entry); }
function makeRow(entry) { const row = document.createElement('tr'); row.innerHTML = `<td><div class="file-name"><span class="file-icon ${entry.kind === 'folder' ? 'folder' : entry.name.toLowerCase().includes('vault') ? 'vault' : ''}">${iconFor(entry)}</span><span>${entry.name}</span></div></td><td>${entry.kind === 'folder' ? 'File folder' : (entry.extension || 'File').toUpperCase()}</td><td>${formatDate(entry.modified)}</td><td>${formatSize(entry.size)}</td><td>${entry.name.toLowerCase().includes('vault') ? '<span class="tag">SOVEREIGN</span>' : ''}</td>`; row.ondblclick = () => entry.kind === 'folder' ? openPath(entry.path) : window.nova.open(entry.path); row.onclick = () => selectEntry(entry, row); return row; }
function makeCard(entry) { const card = document.createElement('div'); card.className = 'file-card'; card.innerHTML = `<span class="file-icon ${entry.kind === 'folder' ? 'folder' : ''}">${iconFor(entry)}</span><span class="file-name-text">${entry.name}</span><small>${entry.kind === 'folder' ? 'Folder' : formatSize(entry.size)}</small>`; card.ondblclick = () => entry.kind === 'folder' ? openPath(entry.path) : window.nova.open(entry.path); card.onclick = () => selectEntry(entry, card); return card; }

async function preview(entry) { const panel = document.querySelector('.runtime-panel'); if (!entry) return; if (entry.kind === 'folder') { setToast(`${entry.name} · folder selected`); return; } try { const result = await window.nova.preview(entry.path); setToast(result.mode === 'text' ? `Preview ready: ${entry.name}` : result.message); } catch (error) { setToast(error.message); } }
async function openPath(directory, push = true, label = null) { try { const entries = await window.nova.list(directory); if (push && state.currentPath) { state.history.push(state.currentPath); state.future = []; } state.currentPath = directory; state.entries = entries; state.selected = null; state.location = label || 'custom'; renderBreadcrumbs(); renderFiles(); $('view-title').textContent = label || directory.split(/[\\/]/).filter(Boolean).pop() || 'Home'; $('view-eyebrow').textContent = label === 'Nova Vault' ? 'SOVEREIGN STORAGE' : 'LOCAL FILES'; $('item-count').textContent = `${entries.length} ${entries.length === 1 ? 'item' : 'items'}`; $('status-text').textContent = 'Ready'; } catch (error) { setToast(error.message); } }
async function goLocation(location) { if (location === 'home') return openPath(state.homePath, true, 'Home'); if (location === 'vault') { $('vault-panel').scrollIntoView(); return openPath(await window.nova.ensureVault(), true, 'Nova Vault'); } if (locations[location]) return openPath(locations[location], true, location[0].toUpperCase() + location.slice(1)); setToast('This location is not available on the local machine.'); }

async function refreshVault() {
  const status = await window.nova.vault.status();
  $('vault-pill').textContent = !status.initialized ? 'NEW' : status.unlocked ? 'UNLOCKED' : 'LOCKED';
  $('vault-primary').textContent = status.initialized ? 'Unlock' : 'Initialize';
  $('vault-chain').textContent = status.chain || '—';
  const list = $('vault-records');
  list.replaceChildren();
  if (!status.unlocked) {
    const item = document.createElement('li');
    item.textContent = status.initialized ? `${status.records} sealed records. Unlock to read names.` : 'No vault yet.';
    list.append(item);
    return status;
  }
  const records = await window.nova.vault.list();
  if (!records.length) {
    const item = document.createElement('li');
    item.textContent = 'No sealed notes yet.';
    list.append(item);
    return status;
  }
  records.forEach((record) => {
    const item = document.createElement('li');
    item.textContent = record.corrupt ? 'Unreadable ciphertext' : `${record.id} · ${record.size} B`;
    list.append(item);
  });
  return status;
}
async function doSearch(query) { if (!query.trim()) return openPath(state.currentPath, false); $('status-text').textContent = 'Searching local workspace…'; const entries = await window.nova.search(query); state.entries = entries; state.searchMode = true; renderFiles(); $('view-eyebrow').textContent = 'SEARCH RESULTS'; $('view-title').textContent = query; $('item-count').textContent = `${entries.length} matches`; $('status-text').textContent = 'Search complete'; }

async function init() { const home = await window.nova.home(); state.homePath = home.path; state.currentPath = home.path; $('machine-name').textContent = home.name.toUpperCase(); locations.desktop = `${home.path}\\Desktop`; locations.documents = `${home.path}\\Documents`; locations.downloads = `${home.path}\\Downloads`; locations.pictures = `${home.path}\\Pictures`; await openPath(home.path, false, 'Home'); await refreshVault(); }
document.querySelectorAll('.nav-item, .quick-strip button').forEach((button) => button.addEventListener('click', () => goLocation(button.dataset.location)));
$('back').onclick = () => { const previous = state.history.pop(); if (previous) { state.future.push(state.currentPath); openPath(previous, false); } };
$('forward').onclick = () => { const next = state.future.pop(); if (next) { state.history.push(state.currentPath); openPath(next, false); } };
$('up').onclick = () => { const parent = state.currentPath.split(/[\\/]/).slice(0, -1).join('\\') || state.homePath; openPath(parent); };
$('refresh').onclick = () => openPath(state.currentPath, false);
$('view-list').onclick = () => { state.view = 'list'; $('view-list').classList.add('selected'); $('view-grid').classList.remove('selected'); renderFiles(); };
$('view-grid').onclick = () => { state.view = 'grid'; $('view-grid').classList.add('selected'); $('view-list').classList.remove('selected'); renderFiles(); };
$('search').oninput = (event) => { clearTimeout(window.searchTimer); window.searchTimer = setTimeout(() => doSearch(event.target.value), 260); };
$('search').onkeydown = (event) => { if (event.key === 'Escape') { event.target.value = ''; openPath(state.currentPath, false); } };
$('choose-folder').onclick = async () => { const folder = await window.nova.chooseFolder(); if (folder) openPath(folder, true, folder.split(/[\\/]/).pop()); };
$('new-folder').onclick = () => setToast('Folder creation stays outside the encrypted vault.');
$('vault-gate').onsubmit = async (event) => {
  event.preventDefault();
  const passphrase = $('vault-pass').value;
  $('vault-pass').value = '';
  try {
    const current = await window.nova.vault.status();
    await (current.initialized ? window.nova.vault.unlock(passphrase) : window.nova.vault.initialize(passphrase));
    await refreshVault();
    setToast(current.initialized ? 'Vault unlocked on this machine.' : 'Vault initialized. The key stays in the main process.');
  } catch (error) { setToast(error.message); }
};
$('vault-lock').onclick = async () => { await window.nova.vault.lock(); await refreshVault(); setToast('Vault locked. The key buffer was cleared.'); };
async function sealNote(event) {
  if (event) event.preventDefault();
  const id = $('note-id').value.trim();
  const data = $('note-body').value;
  if (!id || !data) { $('note-id').focus(); return; }
  try {
    await window.nova.vault.write({ id, data, kind: 'text/plain' });
    $('note-body').value = '';
    await refreshVault();
    setToast(`Sealed ${id}.`);
  } catch (error) { setToast(error.message); }
}
$('note-form').onsubmit = sealNote;
$('quick-note').onclick = () => { $('note-id').focus(); };
$('focus-notes').onclick = () => $('note-id').focus();
async function exportExit() {
  try {
    const result = await window.nova.vault.exportCapsule();
    if (result.canceled) return;
    setToast('Export to CAPSULA saved.');
  } catch (error) { setToast(error.message); }
}
function sayGuarantee() {
  const chain = ($('vault-chain').textContent || '').trim();
  const pill = $('vault-pill').textContent || 'LOCKED';
  const spoken = `${$('vault-statement').innerText} This vault is ${pill}. The chain hash is ${chain}.`;
  if (!window.speechSynthesis) { setToast(spoken); return; }
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(spoken);
  utter.rate = 1;
  window.speechSynthesis.speak(utter);
  setToast('Saying the guarantee.');
}
$('say-guarantee').onclick = sayGuarantee;
$('vault-export').onclick = exportExit;
$('quick-exit').onclick = exportExit;
$('focus-exit').onclick = exportExit;
document.addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('search').focus(); } });
init().catch((error) => setToast(error.message));
