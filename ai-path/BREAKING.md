# BREAKING — Changes That Require Explicit Approval

> These are recommendations that would improve the SDK but carry risk of breaking existing consumers, losing data, or requiring significant architectural changes. They are NOT implemented when the user says "do everything." They require separate, explicit approval.

---

## B-1: Encrypt mnemonic in CLI config with OS keyring

**Current:** `~/.sentinel/config.json` stores mnemonic as plaintext JSON (mode 0o600).
**Proposed:** Use OS keyring (Windows Credential Manager, macOS Keychain, Linux Secret Service) to encrypt the mnemonic at rest.
**Why breaking:** Requires platform-specific native dependencies (`keytar` or `node-keyring`). Changes the config loading path. Existing users' mnemonics would need migration. If keyring is unavailable (headless servers, CI), needs a fallback path.
**Risk:** HIGH — could lock users out of their wallets if keyring breaks.

---

## B-2: Remove `systemProxy: true` as default for V2Ray

**Current:** When V2Ray connects, Windows system proxy is set to the SOCKS5 port. This routes ALL system HTTP traffic through the VPN.
**Proposed:** Default to `systemProxy: false`. Users opt in explicitly.
**Why breaking:** Existing consumer apps (Handshake dVPN, Test2) may depend on `systemProxy: true` to route browser traffic. Changing the default silently stops routing system traffic through VPN.
**Risk:** MEDIUM — silent behavior change for all V2Ray consumers.

---

## B-3: Publish to npm as `sentinel-ai-connect` and `sentinel-dvpn-sdk`

**Current:** Both packages exist only as local directories. All imports use relative paths. External projects must use `pathToFileURL()` hacks.
**Proposed:** Publish both to npm with proper `package.json` exports map, `files` array, and `README.md`.
**Why breaking:** Requires deciding the public API surface. Some internal exports may need to be hidden. Dependencies must be declared (currently inherited from parent `node_modules`). Version numbers become meaningful. Publishing is irreversible — typos in published code are permanent.
**Risk:** HIGH — first publish defines the contract.

---

## B-4: Remove WireGuard config file after tunnel starts

**Current:** `wgsent0.conf` with private key persists on disk while the WireGuard service runs. The service reads it at startup.
**Proposed:** Delete the config file after the service starts (Windows Service Manager caches it internally).
**Why breaking:** Not verified that Windows Service Manager caches the config. If it re-reads the file on network change or service restart, deleting it would crash the tunnel. Needs testing on Windows 10 and 11.
**Risk:** HIGH — could break tunnel on network change.

---

## B-5: Change WireGuard default MTU from 1420 to 1280

**Current:** SDK defaults to `MTU = 1420` in `writeWgConfig()`. Node Tester uses 1280.
**Proposed:** Change default to 1280 (more compatible with restrictive networks and IPv6).
**Why breaking:** Existing consumer apps may have tuned for 1420. Lower MTU means more packets for the same data (slight overhead). Some nodes may perform worse at 1280.
**Risk:** LOW-MEDIUM — performance change, not a functional break.

---

## B-6: Implement `autoReconnect` as a real class

**Current:** `autoReconnect()` exists as a simple polling function. README and GUIDE document a more sophisticated API with backoff, callbacks, and `.stop()`.
**Proposed:** Rewrite as a proper class with the documented API.
**Why breaking:** Existing callers of `autoReconnect()` get a different return shape. The polling interval, retry logic, and event emission may change behavior.
**Risk:** MEDIUM — API shape change.

---

## B-7: Change `fullTunnel` default to `false` for V2Ray

**Current:** `fullTunnel` defaults to `true` for all protocols. For V2Ray, this sets the system proxy.
**Proposed:** V2Ray should default to `fullTunnel: false` (split tunnel — only proxied traffic through VPN). WireGuard stays `fullTunnel: true`.
**Why breaking:** All existing V2Ray consumers would stop routing system traffic through VPN by default. Any app relying on the system proxy being auto-set would break.
**Risk:** MEDIUM — behavior change for V2Ray consumers.

---

## How to Use This File

When the user says **"do everything"** or **"fix everything"** — implement all suggestions EXCEPT items listed in this file. These items require the user to explicitly say "do B-1" or "implement B-3" etc.

When the user says **"do everything including breaking"** — then implement these too, but confirm each one before proceeding.
