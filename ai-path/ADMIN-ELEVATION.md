# Admin Elevation Guide — Sentinel AI Path

## Why Admin is Required

WireGuard tunnel operations require system-level access:
- **Windows:** Installing/removing WireGuard tunnel services (wireguard.exe /installtunnelservice)
- **macOS:** Creating utun interfaces (wg-quick up)
- **Linux:** Creating WireGuard interfaces (ip link add wg0)

Without admin, you can only use V2Ray nodes (~70% of the network). With admin, you access 100% of nodes including the faster, more reliable WireGuard nodes.

**The SDK checks admin BEFORE payment.** If you're not admin and select a WireGuard node, the SDK rejects the connection before any P2P tokens are spent. No money is wasted.

## Windows — Using run-admin.vbs

The `run-admin.vbs` script triggers a single UAC prompt, then runs your Node.js script with full Administrator privileges. One prompt per session.

```bash
# Setup (downloads V2Ray + installs WireGuard silently)
cscript run-admin.vbs setup.js

# Connect via CLI
cscript run-admin.vbs cli.js connect

# Run any custom script
cscript run-admin.vbs my-agent.mjs

# Test WireGuard specifically
cscript run-admin.vbs test-wireguard.mjs
```

### How run-admin.vbs works
1. Calls `Shell.Application.ShellExecute` with verb `"runas"` → triggers UAC
2. Opens an elevated cmd.exe window
3. cd's to the script directory
4. Runs `node <your-script>`
5. Keeps the window open (so you can see output)

### For AI agents running unattended
If the AI agent runs as a Windows Service or scheduled task, configure it to run as a user with admin rights (e.g., SYSTEM or a dedicated admin account). No UAC prompt needed for services.

## macOS — Using sudo

```bash
sudo node setup.js              # Install WireGuard via brew
sudo node cli.js connect        # Connect with WireGuard access
sudo node my-agent.mjs          # Run agent elevated
```

For unattended agents, add to sudoers:
```
agent-user ALL=(ALL) NOPASSWD: /usr/local/bin/node
```

## Linux — Using sudo

```bash
sudo node setup.js              # Install wireguard-tools via apt/dnf
sudo node cli.js connect        # Connect with WireGuard access
sudo node my-agent.mjs          # Run agent elevated
```

For unattended agents in systemd:
```ini
[Service]
User=root
ExecStart=/usr/local/bin/node /path/to/my-agent.mjs
```

Or use capabilities instead of full root:
```bash
sudo setcap cap_net_admin+ep $(which node)
```

## V2Ray-Only Mode (No Admin Needed)

If admin is not available, the SDK automatically falls back to V2Ray nodes:

```js
const vpn = await connect({
  mnemonic: process.env.MNEMONIC,
  protocol: 'v2ray',  // Explicitly request V2Ray only
});
```

V2Ray runs as a userspace SOCKS5 proxy — no system-level access needed. It connects to ~630 nodes (70% of the network). This is the recommended mode for:
- CI/CD pipelines
- Docker containers without --privileged
- Cloud VMs where root is restricted
- Development/testing

## Detection in Code

The SDK exports `IS_ADMIN` for checking:

```js
import { IS_ADMIN, WG_AVAILABLE } from 'sentinel-dvpn-sdk';

if (WG_AVAILABLE && IS_ADMIN) {
  console.log('Full network access (WireGuard + V2Ray)');
} else if (WG_AVAILABLE && !IS_ADMIN) {
  console.log('WireGuard installed but not admin — V2Ray only');
  console.log('Run: cscript run-admin.vbs your-script.mjs');
} else {
  console.log('V2Ray only (WireGuard not installed)');
}
```

The `getEnvironment()` function reports this:
```js
import { getEnvironment } from 'sentinel-ai-connect';
const env = getEnvironment();
// env.admin: true/false
// env.capabilities: ['v2ray', 'wireguard'] or ['v2ray', 'wireguard-needs-admin'] or ['v2ray']
// env.recommended: ['run as admin to use WireGuard nodes (faster, more reliable)']
```
