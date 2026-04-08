/**
 * Sentinel SDK — Settings & App Configuration Types
 *
 * Types for app settings persistence, app type definitions,
 * DNS presets, and app configuration validation.
 */

// ─── App Settings ──────────────────────────────────────────────────────────

/**
 * Persisted app settings. Stored at ~/.sentinel-sdk/app-settings.json.
 * Every field has a sane default -- apps can use this out of the box.
 * Mutate the object, then call saveAppSettings() to persist.
 */
export interface AppSettings {
  // ── Network ──
  /** DNS preset: 'handshake' | 'google' | 'cloudflare' | 'custom' */
  dnsPreset: 'handshake' | 'google' | 'cloudflare' | 'custom';
  /** Custom DNS IPs, comma-separated (only used when dnsPreset is 'custom') */
  customDns: string;

  // ── Tunnel ──
  /** Route all traffic through VPN (default: true) */
  fullTunnel: boolean;
  /** Set OS SOCKS proxy for V2Ray (default: false) */
  systemProxy: boolean;
  /** Block all traffic if tunnel drops (default: false) */
  killSwitch: boolean;
  /** WireGuard MTU -- Sentinel nodes use 1280 (default: 1280) */
  wgMtu: number;
  /** WireGuard keepalive in seconds -- safe for all NAT routers (default: 15) */
  wgKeepalive: number;

  // ── Session ──
  /** Default GB amount for per-GB sessions (default: 1) */
  defaultGigabytes: number;
  /** Default hour amount for hourly sessions (default: 1) */
  defaultHours: number;
  /** Prefer hourly pricing when available (default: false) */
  preferHourly: boolean;
  /** Protocol preference: 'auto' picks best, 'wireguard'/'v2ray' forces one */
  protocolPreference: 'auto' | 'wireguard' | 'v2ray';

  // ── Polling intervals (seconds) ──
  /** Connection status check interval (default: 3) */
  statusPollSec: number;
  /** Public IP check interval (default: 60) */
  ipCheckSec: number;
  /** Wallet balance refresh interval (default: 300 = 5 min) */
  balanceCheckSec: number;
  /** Session allocation refresh interval (default: 120 = 2 min) */
  allocationCheckSec: number;

  // ── Plan ──
  /** Max plan ID to probe in discoverPlans (default: 500) */
  planProbeMax: number;

  // ── Favorites ──
  /** Array of sentnode1... addresses marked as favorite */
  favoriteNodes: string[];

  // ── Last connection ──
  /** Last connected node address for quick reconnect (null if none) */
  lastNodeAddress: string | null;
  /** Last service type used */
  lastServiceType: 'wireguard' | 'v2ray' | null;
}

// ─── DNS Presets ───────────────────────────────────────────────────────────

/** DNS server preset configuration. */
export interface DnsPreset {
  /** Display name (e.g. 'Handshake') */
  name: string;
  /** DNS server IP addresses */
  servers: string[];
  /** Human-readable description */
  description: string;
}

/** Available DNS preset names. */
export type DnsPresetName = 'handshake' | 'google' | 'cloudflare';

/** All DNS presets (frozen object). */
export type DnsPresets = Readonly<Record<DnsPresetName, DnsPreset>>;

// ─── App Types ─────────────────────────────────────────────────────────────

/**
 * The three types of Sentinel dVPN applications.
 * Choose based on how users pay for VPN access.
 */
export type AppType = 'white_label' | 'direct_p2p' | 'all_in_one';

/** App type string constants. */
export interface AppTypeConstants {
  /** Branded app with pre-loaded plan. Users click "Connect", done. */
  readonly WHITE_LABEL: 'white_label';
  /** Users browse nodes, pick pricing, pay per session. */
  readonly DIRECT_P2P: 'direct_p2p';
  /** Plan subscriptions + direct P2P. Full flexibility. */
  readonly ALL_IN_ONE: 'all_in_one';
}

/** UI screens configuration for an app type. */
export interface AppTypeScreens {
  /** Welcome/onboarding screen */
  welcome: boolean;
  /** Browse available plans */
  planBrowser: boolean;
  /** Browse individual nodes */
  nodeBrowser: boolean;
  /** Duration/amount picker (GB or hours) */
  durationPicker: boolean;
  /** Price display before connecting */
  pricingDisplay: boolean;
  /** Main connect button */
  connect: boolean;
  /** Settings screen */
  settings: boolean;
}

/** Complete configuration requirements and flow for an app type. */
export interface AppTypeConfig {
  /** Human-readable description */
  description: string;
  /** Required configuration keys (must be non-null at startup) */
  requiredConfig: string[];
  /** Optional configuration keys */
  optionalConfig: string[];
  /** Recommended connect function name */
  connectFunction: string;
  /** Whether the user pays gas (false for white-label with fee grants) */
  userPaysGas: boolean;
  /** Whether the user picks a specific node */
  userPicksNode: boolean;
  /** Whether the user picks duration/amount */
  userPicksDuration: boolean;
  /** Whether pricing is shown to the user */
  userSeesPricing: boolean;
  /** Which UI screens to build */
  screens: AppTypeScreens;
  /** Step-by-step user flow description */
  flow: string[];
  /** SDK functions to use for this app type */
  sdkFunctions: string[];
}

// ─── App Config Validation ─────────────────────────────────────────────────

/** Result from validateAppConfig(). Run at app startup. */
export interface AppConfigValidation {
  /** Whether the config is valid (no errors) */
  valid: boolean;
  /** Critical errors that must be fixed */
  errors: string[];
  /** Non-critical warnings */
  warnings: string[];
  /** The resolved app type config (null if type is invalid) */
  type: AppTypeConfig | null;
}

// ─── VPN Settings (Legacy) ─────────────────────────────────────────────────

/**
 * Legacy VPN settings from loadVpnSettings() / saveVpnSettings().
 * Stored at ~/.sentinel-sdk/settings.json.
 * Use loadAppSettings() instead for new code.
 */
export type VpnSettings = Record<string, unknown>;

// ─── Disk Cache ────────────────────────────────────────────────────────────

/** Cache entry metadata from cacheInfo(). */
export interface CacheInfo {
  /** Age of the cached data in ms */
  ageMs: number;
  /** Whether there is data in the cache */
  hasData: boolean;
  /** Whether a fetch is currently in flight */
  inflight: boolean;
}

/** Disk cache load result from diskLoad(). */
export interface DiskCacheEntry<T = unknown> {
  /** The cached data */
  data: T;
  /** When the data was saved (Date.now() timestamp) */
  savedAt: number;
  /** Whether the data exceeds maxAgeMs */
  stale: boolean;
}
