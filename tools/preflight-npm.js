#!/usr/bin/env node

/**
 * AI Pre-flight Check: Validates NPM package before publish.
 * Run before every `npm publish` to catch bloat, missing bins, and banned files.
 *
 * Usage: node tools/preflight-npm.js
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('Pre-flight Check: Validating NPM Package...');

const pkgPath = path.resolve(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const errors = [];

// 1. Validate CLI 'bin' entries and shebangs
if (pkg.bin) {
  for (const [cmd, binPath] of Object.entries(pkg.bin)) {
    const fullPath = path.resolve(__dirname, '..', binPath);

    if (!fs.existsSync(fullPath)) {
      errors.push(`BIN ERROR: Executable for '${cmd}' at '${binPath}' does not exist.`);
      continue;
    }

    const content = fs.readFileSync(fullPath, 'utf8');
    if (!content.startsWith('#!/usr/bin/env node')) {
      errors.push(`SHEBANG ERROR: '${binPath}' is missing '#!/usr/bin/env node' header.`);
    }
  }
}

// 2. Simulate pack and parse JSON output
try {
  const packOutput = execSync('npm pack --dry-run --json', {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'ignore'],
    cwd: path.resolve(__dirname, '..'),
  });
  const packData = JSON.parse(packOutput)[0];

  const MAX_FILE_SIZE_MB = 5;
  const BANNED_EXTENSIONS = ['.exe', '.dll', '.zip', '.tar.gz', '.env'];

  // 3. Audit the payload
  for (const file of packData.files) {
    const sizeMB = file.size / (1024 * 1024);

    if (sizeMB > MAX_FILE_SIZE_MB) {
      errors.push(`BLOAT: '${file.path}' is ${sizeMB.toFixed(2)}MB (limit: ${MAX_FILE_SIZE_MB}MB)`);
    }

    const ext = path.extname(file.path).toLowerCase();
    if (BANNED_EXTENSIONS.includes(ext)) {
      errors.push(`BANNED FILE: '${file.path}' should not be published to NPM.`);
    }
  }

  const totalSizeMB = packData.size / (1024 * 1024);
  console.log(`Tarball size: ${totalSizeMB.toFixed(2)}MB | ${packData.files.length} files`);

} catch (err) {
  errors.push(`PACK ERROR: Failed to simulate npm pack. ${err.message}`);
}

// 4. Check for secrets in source
const secretPatterns = [
  { name: 'Hardcoded wallet', regex: /sent1[a-z0-9]{38}/ },
  { name: 'Local path', regex: /C:\\Users\\[A-Za-z]/ },
];

function walkJs(dir) {
  const files = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'tools') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...walkJs(p));
    else if (p.endsWith('.js')) files.push(p);
  }
  return files;
}

const root = path.resolve(__dirname, '..');
for (const file of walkJs(root)) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    for (const p of secretPatterns) {
      if (p.regex.test(line)) {
        errors.push(`SECRET: ${p.name} in ${path.relative(root, file)}:${i + 1}`);
      }
    }
  }
}

// 5. Verdict
if (errors.length > 0) {
  console.error('\nPRE-FLIGHT FAILED. DO NOT PUBLISH.');
  for (const e of errors) console.error(' ', e);
  process.exit(1);
} else {
  console.log('\nAll checks passed. Safe to publish.');
  process.exit(0);
}
