/**
 * Sentinel CLI — Configuration Management
 *
 * Reads/writes ~/.sentinel/config.json for persistent CLI settings.
 * Prompts for mnemonic on first run if not configured.
 *
 * No external dependencies — uses Node.js built-ins only.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { createInterface } from 'readline';

// ─── Paths ───────────────────────────────────────────────────────────────────

const CONFIG_DIR = join(homedir(), '.sentinel');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  mnemonic: '',
  rpc: 'https://rpc.sentinel.co:443',
  lcd: 'https://lcd.sentinel.co',
  gigabytes: 1,
  denom: 'udvpn',
};

// ─── Read/Write ──────────────────────────────────────────────────────────────

/**
 * Load config from ~/.sentinel/config.json.
 * Returns defaults merged with any saved values.
 * @returns {object}
 */
export function loadConfig() {
  try {
    if (existsSync(CONFIG_FILE)) {
      const raw = readFileSync(CONFIG_FILE, 'utf8');
      const saved = JSON.parse(raw);
      return { ...DEFAULT_CONFIG, ...saved };
    }
  } catch {
    // Corrupted config — fall back to defaults
  }
  return { ...DEFAULT_CONFIG };
}

/**
 * Save config to ~/.sentinel/config.json.
 * Creates ~/.sentinel/ directory if it does not exist.
 * @param {object} config
 */
export function saveConfig(config) {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
}

/**
 * Get a single config value, with CLI flag override.
 * Priority: flag > config file > default.
 * @param {string} key
 * @param {*} flagValue - Value from CLI flag (undefined if not set)
 * @returns {*}
 */
export function getConfigValue(key, flagValue) {
  if (flagValue !== undefined && flagValue !== null) return flagValue;
  const config = loadConfig();
  return config[key] ?? DEFAULT_CONFIG[key];
}

// ─── Interactive Prompt ──────────────────────────────────────────────────────

/**
 * Prompt user for input on stdin. Used for first-run mnemonic setup.
 * @param {string} question
 * @param {boolean} [hidden=false] - If true, input is not echoed (for secrets)
 * @returns {Promise<string>}
 */
export function prompt(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
    });

    if (hidden) {
      process.stderr.write(question);
      const onData = (char) => {
        const c = char.toString();
        if (c === '\n' || c === '\r') {
          process.stdin.removeListener('data', onData);
          process.stderr.write('\n');
          rl.close();
          resolve(rl.line || '');
          return;
        }
        // Suppress echo by not writing back
      };
      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      process.stdin.on('data', onData);
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

/**
 * Ensure mnemonic is available. Checks config, then prompts user.
 * Saves to config on first entry so subsequent runs skip the prompt.
 * @returns {Promise<string>}
 */
export async function ensureMnemonic() {
  const config = loadConfig();
  if (config.mnemonic) return config.mnemonic;

  // Check environment variable as fallback
  if (process.env.MNEMONIC) return process.env.MNEMONIC;

  process.stderr.write('\n  No mnemonic configured.\n');
  process.stderr.write('  Enter your BIP39 mnemonic to get started.\n');
  process.stderr.write('  It will be saved to ~/.sentinel/config.json\n\n');

  const mnemonic = await prompt('  Mnemonic: ', true); // hidden=true: suppress echo
  if (!mnemonic) {
    process.stderr.write('  No mnemonic provided. Exiting.\n');
    process.exit(1);
  }

  config.mnemonic = mnemonic;
  saveConfig(config);
  process.stderr.write('  Saved.\n\n');
  return mnemonic;
}

// ─── Config Path Export ──────────────────────────────────────────────────────

export { CONFIG_DIR, CONFIG_FILE, DEFAULT_CONFIG };
