# NOVASVAUL

NOVASVAUL is a local-first sovereign file explorer and virtual-computer shell. It uses the familiar laptop pattern—title bar, navigation controls, address breadcrumbs, search, sidebar locations, list/grid files, details-oriented status bar—and adds a visible Nova Runtime for local agents, kernels, queues, and activity.

## Run it

```powershell
cd C:\Users\Medin\NOVASVAUL
npm install
npm start
```

Run the structural checks with `npm test`.

## Current boundary

The first runtime is intentionally local. Electron’s main process exposes only a small, context-isolated filesystem API to the renderer. File browsing is restricted to the user home directory and the app’s local vault directory; directory traversal outside that boundary is rejected. Text previews are capped at 1 MB. The vault folder is created under Electron’s per-user app data directory.

The visible agent and kernel panel is the runtime contract/UI surface. Encrypted storage primitives now exist behind the preload boundary; the unlock experience and broader key lifecycle are not wired into the visible UI yet. Agent process isolation, durable job scheduling, document editing, and signed workspace manifests remain future layers.

## Product direction

- Explorer: files, folders, recents, search, previews, tags, and local actions.
- Runtime: agents, kernels, task queue, console, logs, and governed capabilities.
- Vault: local encrypted storage, integrity receipts, import/export, and explicit ownership.
- Documents: native-feeling document workspace and artifact history.
- Sovereign boundary: no cloud dependency is required for the base app.

## Encrypted persistence foundation

Encrypted records live under the hidden `.nova` directory inside the app-owned vault. The main process derives a 256-bit key from a passphrase with scrypt and retains it only while the vault is unlocked. AES-256-GCM authenticates record content and encrypted metadata. Record filenames are keyed HMAC-SHA-256 identifiers, writes use same-directory temporary files followed by rename, and restricted record IDs cannot traverse the storage directory. Runtime state uses the same encrypted record layer.

The frozen, context-isolated bridge exposes `nova.vault.status/initialize/unlock/lock/list/read/write/delete` and `nova.runtime.load/save`. The renderer never receives the derived key or private storage path. Records are capped at 16 MiB, and runtime state must be a JSON object. Closing the window or quitting clears the main process's in-memory key buffer.

This is a storage foundation, not a complete secrets manager. It does not yet include an unlock UI, passphrase recovery, key rotation, OS credential-store integration, rollback detection, multi-process locking, backups, or secure deletion. It cannot protect data from malware running as the same OS user while the vault is unlocked. Agent process isolation, durable job execution, and signed workspace manifests remain separate production milestones.
