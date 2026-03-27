/**
 * Sentinel SDK — Application Type Definitions
 *
 * Three types of dVPN applications can be built on Sentinel.
 * Each type has different SDK functions, UI requirements, and user flows.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  STEP 1: Decide your app type.                                     │
 * │  STEP 2: Use ONLY the functions listed for that type.              │
 * │  STEP 3: Build ONLY the UI screens listed for that type.           │
 * │  Mixing types without understanding leads to confused UX.          │
 * └─────────────────────────────────────────────────────────────────────┘
 */

// ─── App Types ──────────────────────────────────────────────────────────────

/**
 * The three types of Sentinel dVPN applications.
 *
 * ASK THE BUILDER: "How do users pay for VPN access?"
 *
 * A) "Users pay nodes directly from their own wallet"
 *    → DIRECT_P2P — user browses nodes, picks pricing (GB or hour), pays per session.
 *
 * B) "I have a subscription plan — users connect through my plan"
 *    → WHITE_LABEL — operator pre-configures plan + fee grant, user clicks Connect.
 *
 * C) "Both — users can subscribe to plans AND connect directly"
 *    → ALL_IN_ONE — two modes in one app.
 */
export const APP_TYPES = Object.freeze({
  WHITE_LABEL: 'white_label',
  DIRECT_P2P: 'direct_p2p',
  ALL_IN_ONE: 'all_in_one',
});

// ─── Per-Type Configuration ─────────────────────────────────────────────────

/**
 * Configuration requirements per app type.
 * Use this to validate your app config at startup.
 */
export const APP_TYPE_CONFIG = Object.freeze({
  [APP_TYPES.WHITE_LABEL]: {
    description: 'White-label dVPN — branded app with pre-loaded plan',
    requiredConfig: ['planId', 'mnemonic'],
    optionalConfig: ['feeGranter', 'dns', 'countries'],
    connectFunction: 'connectViaPlan',
    userPaysGas: false,
    userPicksNode: false,
    userPicksDuration: false,
    userSeesPricing: false,
    screens: {
      welcome: true,
      planBrowser: false,
      nodeBrowser: false,
      durationPicker: false,
      pricingDisplay: false,
      connect: true,
      settings: true,
    },
    flow: [
      '1. User opens app → sees branded welcome screen',
      '2. User imports/creates wallet (or operator provides one)',
      '3. App auto-subscribes user to pre-configured plan (if not already)',
      '4. App queries plan nodes → picks best available',
      '5. User clicks "Connect" → one click, done',
      '6. Fee grant covers gas — user pays nothing (or pays operator off-chain)',
    ],
    sdkFunctions: [
      'connectViaPlan()',
      'connectAuto({ planId })',
      'subscribeToPlan()',
      'hasActiveSubscription()',
      'queryPlanNodes()',
      'broadcastWithFeeGrant()',
      'disconnect()',
    ],
  },

  [APP_TYPES.DIRECT_P2P]: {
    description: 'Direct P2P — users pay nodes directly per-GB or per-hour',
    requiredConfig: ['mnemonic'],
    optionalConfig: ['dns', 'countries', 'preferHourly'],
    connectFunction: 'connectDirect',
    userPaysGas: true,
    userPicksNode: true,
    userPicksDuration: true,
    userSeesPricing: true,
    screens: {
      welcome: true,
      planBrowser: false,
      nodeBrowser: true,
      durationPicker: true,
      pricingDisplay: true,
      connect: true,
      settings: true,
    },
    flow: [
      '1. User opens app → sees welcome screen',
      '2. User imports wallet with P2P tokens',
      '3. App loads node list with country flags + pricing',
      '4. User browses nodes → filters by country/protocol/price',
      '5. User selects a node → sees GB price AND hourly price',
      '6. User picks pricing model: "Pay per GB" or "Pay per Hour"',
      '7. User picks amount: e.g. 5 GB or 4 hours',
      '8. App shows cost estimate: "This will cost 0.20 P2P"',
      '9. User clicks "Connect" → pays from their wallet',
    ],
    sdkFunctions: [
      'connectDirect({ gigabytes, preferHourly })',
      'connectAuto({ countries })',
      'fetchAllNodes() + enrichNodes()',
      'getNodePrices()',
      'formatNodePricing()',
      'estimateSessionPrice()',
      'getBalance()',
      'disconnect()',
    ],
  },

  [APP_TYPES.ALL_IN_ONE]: {
    description: 'All-in-one — plan subscriptions + direct P2P access',
    requiredConfig: ['mnemonic'],
    optionalConfig: ['dns', 'countries', 'preferHourly'],
    connectFunction: 'connectViaPlan or connectDirect',
    userPaysGas: true,
    userPicksNode: true,
    userPicksDuration: true,
    userSeesPricing: true,
    screens: {
      welcome: true,
      planBrowser: true,
      nodeBrowser: true,
      durationPicker: true,
      pricingDisplay: true,
      connect: true,
      settings: true,
    },
    flow: [
      '1. User opens app → welcome screen',
      '2. User imports wallet',
      '3. App shows two tabs: "Plans" and "Direct Connect"',
      '',
      '── Plans Tab ──',
      '4a. App loads available plans via discoverPlans()',
      '5a. User browses plans → sees price, node count, features',
      '6a. User subscribes to a plan → subscribeToPlan()',
      '7a. App connects via plan → connectViaPlan({ planId })',
      '',
      '── Direct Connect Tab ──',
      '4b. App loads all nodes with enrichment',
      '5b. User browses nodes → filters by country/protocol/price',
      '6b. User selects pricing model + duration',
      '7b. User clicks Connect → connectDirect()',
    ],
    sdkFunctions: [
      '// Plan flow',
      'discoverPlans()',
      'getPlanStats()',
      'queryPlanNodes()',
      'subscribeToPlan()',
      'hasActiveSubscription()',
      'connectViaPlan()',
      '',
      '// Direct P2P flow',
      'connectDirect({ gigabytes, preferHourly })',
      'fetchAllNodes() + enrichNodes()',
      'getNodePrices()',
      'formatNodePricing()',
      'estimateSessionPrice()',
      '',
      '// Shared',
      'getBalance()',
      'disconnect()',
      'connectAuto()',
    ],
  },
});

// ─── App Type Validation ────────────────────────────────────────────────────

/**
 * Validate an app's configuration against its type requirements.
 * Call this at app startup to catch misconfigurations early.
 *
 * @param {'white_label'|'direct_p2p'|'all_in_one'} appType
 * @param {object} config - The app's configuration object
 * @returns {{ valid: boolean, errors: string[], warnings: string[], type: object }}
 *
 * @example
 * const result = validateAppConfig('white_label', { mnemonic: '...', planId: 42 });
 * if (!result.valid) console.error(result.errors);
 */
export function validateAppConfig(appType, config = {}) {
  const typeConfig = APP_TYPE_CONFIG[appType];
  if (!typeConfig) {
    return {
      valid: false,
      errors: [`Unknown app type: "${appType}". Use: ${Object.values(APP_TYPES).join(', ')}`],
      warnings: [],
      type: null,
    };
  }

  const errors = [];
  const warnings = [];

  for (const key of typeConfig.requiredConfig) {
    if (!config[key]) errors.push(`Missing required config: "${key}" (required for ${appType} apps)`);
  }

  if (appType === APP_TYPES.WHITE_LABEL) {
    if (!config.planId) errors.push('White-label apps MUST have a planId configured');
    if (!config.feeGranter) warnings.push('White-label apps should have a feeGranter so users don\'t pay gas. Without it, users need P2P tokens for gas fees.');
  }

  if (appType === APP_TYPES.DIRECT_P2P || appType === APP_TYPES.ALL_IN_ONE) {
    if (config.planId && appType === APP_TYPES.DIRECT_P2P) {
      warnings.push('planId is set but app type is direct_p2p — plan functions won\'t be used. Did you mean all_in_one?');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    type: typeConfig,
  };
}

// ─── Connect Helpers Per Type ───────────────────────────────────────────────

/**
 * Get the recommended connect options for an app type.
 * Returns a base config that you can spread into your connect call.
 *
 * @param {'white_label'|'direct_p2p'|'all_in_one'} appType
 * @param {object} appConfig - App-level config (planId, feeGranter, dns, etc.)
 * @returns {object} Base connect options for the given app type
 */
export function getConnectDefaults(appType, appConfig = {}) {
  const base = {
    dns: appConfig.dns || 'handshake',
    fullTunnel: appConfig.fullTunnel !== false,
    killSwitch: appConfig.killSwitch || false,
  };

  if (appType === APP_TYPES.WHITE_LABEL) {
    return {
      ...base,
      planId: appConfig.planId,
      feeGranter: appConfig.feeGranter || undefined,
    };
  }

  if (appType === APP_TYPES.DIRECT_P2P) {
    return {
      ...base,
      gigabytes: appConfig.defaultGigabytes || 1,
      preferHourly: appConfig.preferHourly || false,
    };
  }

  // ALL_IN_ONE — return base, caller decides per-connection
  return base;
}
