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

The right-hand panel is the vault, not a pretend agent roster. It initializes or unlocks with a passphrase, lists sealed notes while unlocked, and exports an exit bundle of ciphertext. The chain shown in the panel is a SHA-256 over those ciphertext files. It moves when a record changes. It is not a chain transaction.

This app guarantees one thing: the passphrase derives the only AES-256-GCM key, with scrypt, and that key never reaches the renderer. It does not guarantee team memory, on-chain custody, hardware air-gap, or a recovery backdoor.

## Product direction

- Explorer: files, folders, search, and local previews inside the home boundary.
- Vault: passphrase unlock, sealed notes, and an exit bundle of ciphertext plus a local chain hash.
- Later, and not claimed here: team memory, on-chain custody, hardware air-gap, agent isolation.
- Documents: native-feeling document workspace and artifact history.
- Sovereign boundary: no cloud dependency is required for the base app.

## Encrypted persistence foundation

Encrypted records live under the hidden `.nova` directory inside the app-owned vault. The main process derives a 256-bit key from a passphrase with scrypt and retains it only while the vault is unlocked. AES-256-GCM authenticates record content and encrypted metadata. Record filenames are keyed HMAC-SHA-256 identifiers, writes use same-directory temporary files followed by rename, and restricted record IDs cannot traverse the storage directory. Runtime state uses the same encrypted record layer.

The frozen, context-isolated bridge exposes `nova.vault.status/initialize/unlock/lock/list/read/write/delete/seal/exportExit` and `nova.runtime.load/save`. The renderer never receives the derived key or private storage path. Records are capped at 16 MiB. Closing the window or quitting clears the main process's in-memory key buffer.

The unlock screen is in the app. There is still no passphrase recovery, key rotation, OS keychain, multi-process lock, or secure deletion. A wrong passphrase fails closed. Tampered ciphertext fails authentication. The exit file is the encrypted records and the KDF manifest, which a new machine needs in order to unlock with the same passphrase. It cannot protect data from malware running as the same OS user while the vault is unlocked.
