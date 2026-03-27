/**
 * Sentinel CLI — Output Formatting
 *
 * Handles JSON vs human-readable output, colored text, and aligned tables.
 * No external dependencies — ANSI escape codes only.
 */

// ─── ANSI Color Codes ───────────────────────────────────────────────────────

const SUPPORTS_COLOR = process.stdout.isTTY && !process.env.NO_COLOR;

const CODES = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function c(code, text) {
  if (!SUPPORTS_COLOR) return text;
  return `${CODES[code]}${text}${CODES.reset}`;
}

// ─── Public Color Helpers ────────────────────────────────────────────────────

export const green = (t) => c('green', t);
export const red = (t) => c('red', t);
export const yellow = (t) => c('yellow', t);
export const cyan = (t) => c('cyan', t);
export const bold = (t) => c('bold', t);
export const dim = (t) => c('dim', t);
export const gray = (t) => c('gray', t);

// ─── Status Indicators ──────────────────────────────────────────────────────

export function pass(text) {
  return `${green('✓')} ${text}`;
}

export function fail(text) {
  return `${red('✗')} ${text}`;
}

export function warn(text) {
  return `${yellow('!')} ${text}`;
}

// ─── JSON Output ─────────────────────────────────────────────────────────────

/**
 * Print data as JSON. Handles BigInt serialization.
 * @param {*} data
 */
export function printJson(data) {
  const json = JSON.stringify(data, (key, val) => {
    if (typeof val === 'bigint') return val.toString();
    return val;
  }, 2);
  console.log(json);
}

// ─── Table Output ────────────────────────────────────────────────────────────

/**
 * Print an aligned table from rows of objects.
 * @param {string[]} headers - Column headers
 * @param {string[][]} rows - Array of row arrays (each row = array of cell strings)
 * @param {object} [opts] - Options
 * @param {number[]} [opts.align] - Per-column alignment: 0=left, 1=right
 */
export function printTable(headers, rows, opts = {}) {
  const align = opts.align || [];

  // Calculate column widths
  const widths = headers.map((h, i) => {
    let max = stripAnsi(h).length;
    for (const row of rows) {
      const cell = row[i] != null ? String(row[i]) : '';
      const len = stripAnsi(cell).length;
      if (len > max) max = len;
    }
    return max;
  });

  // Print header
  const headerLine = headers.map((h, i) => padCell(h, widths[i], align[i])).join('  ');
  console.log(bold(headerLine));
  console.log(dim('─'.repeat(widths.reduce((s, w) => s + w, 0) + (widths.length - 1) * 2)));

  // Print rows
  for (const row of rows) {
    const line = headers.map((_, i) => {
      const cell = row[i] != null ? String(row[i]) : '';
      return padCell(cell, widths[i], align[i]);
    }).join('  ');
    console.log(line);
  }
}

/**
 * Pad a cell to a given width, respecting ANSI codes.
 * @param {string} text
 * @param {number} width
 * @param {number} [alignment=0] - 0=left, 1=right
 * @returns {string}
 */
function padCell(text, width, alignment = 0) {
  const visibleLen = stripAnsi(text).length;
  const padding = Math.max(0, width - visibleLen);
  if (alignment === 1) return ' '.repeat(padding) + text;
  return text + ' '.repeat(padding);
}

/**
 * Strip ANSI escape codes from a string to get visible length.
 * @param {string} str
 * @returns {string}
 */
function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

// ─── Progress / Spinner ─────────────────────────────────────────────────────

/**
 * Print a progress step (for connect flow, etc).
 * @param {string} step - Step name
 * @param {string} detail - Detail text
 */
export function printStep(step, detail) {
  process.stderr.write(`  ${cyan('→')} ${bold(step)} ${detail}\n`);
}

/**
 * Print a section header.
 * @param {string} title
 */
export function printHeader(title) {
  console.log();
  console.log(bold(`  ${title}`));
  console.log(dim('  ' + '─'.repeat(title.length + 2)));
}

// ─── Error Output ────────────────────────────────────────────────────────────

/**
 * Print an error message to stderr and exit.
 * @param {string} msg
 * @param {number} [code=1]
 */
export function die(msg, code = 1) {
  process.stderr.write(`${red('Error:')} ${msg}\n`);
  process.exit(code);
}

// ─── Formatting Helpers ─────────────────────────────────────────────────────

/**
 * Format a number with locale separators (e.g. 1,234).
 * @param {number} n
 * @returns {string}
 */
export function fmtNum(n) {
  return Number(n).toLocaleString();
}

/**
 * Truncate an address for display: "sent1abc...xyz".
 * @param {string} addr
 * @param {number} [start=12]
 * @param {number} [end=6]
 * @returns {string}
 */
export function truncAddr(addr, start = 12, end = 6) {
  if (!addr || addr.length <= start + end + 3) return addr || '';
  return `${addr.slice(0, start)}...${addr.slice(-end)}`;
}
