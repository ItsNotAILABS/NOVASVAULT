const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nova', {
  home: () => ipcRenderer.invoke('nova:home'),
  list: (directory) => ipcRenderer.invoke('nova:list', directory),
  search: (query) => ipcRenderer.invoke('nova:search', query),
  preview: (file) => ipcRenderer.invoke('nova:preview', file),
  hash: (file) => ipcRenderer.invoke('nova:hash', file),
  open: (target) => ipcRenderer.invoke('nova:open', target),
  chooseFolder: () => ipcRenderer.invoke('nova:choose-folder'),
  ensureVault: () => ipcRenderer.invoke('nova:ensure-vault'),
  vault: Object.freeze({
    status: () => ipcRenderer.invoke('nova:vault-status'),
    initialize: (passphrase) => ipcRenderer.invoke('nova:vault-initialize', passphrase),
    unlock: (passphrase) => ipcRenderer.invoke('nova:vault-unlock', passphrase),
    lock: () => ipcRenderer.invoke('nova:vault-lock'),
    list: () => ipcRenderer.invoke('nova:vault-list'),
    read: (id) => ipcRenderer.invoke('nova:vault-read', id),
    write: (record) => ipcRenderer.invoke('nova:vault-write', record),
    delete: (id) => ipcRenderer.invoke('nova:vault-delete', id)
  }),
  runtime: Object.freeze({
    load: () => ipcRenderer.invoke('nova:runtime-load'),
    save: (state) => ipcRenderer.invoke('nova:runtime-save', state)
  })
});
