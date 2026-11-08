#!/usr/bin/env node
/**
 * `npm ci` that skips the install scripts of the named packages and runs all
 * the others, plus the project's own install lifecycle.
 *
 *   node scripts/ci/npm-ci-skip.mjs --skip sharp [--skip x …] [-- <npm ci args>]
 *
 * Why: sharp 0.32 (pulled in by @xenova/transformers) downloads libvips from
 * GitHub's release CDN in its install script. When that CDN answers 504 the
 * whole `npm ci` fails — in CI (tests #484/#485, 2026-11-08) and in the agent
 * box build the same morning. Nothing the suites run loads sharp, so its
 * binary is not needed; the other native modules (better-sqlite3,
 * classic-level, onnxruntime-node) are, and still get their scripts.
 *
 * npm has no per-package ignore-scripts, hence: install with --ignore-scripts,
 * then `npm rebuild` the packages that declare install scripts (which runs
 * them), then the root's preinstall/install/postinstall/prepare.
 *
 * Runs before node_modules exists, so it imports only node built-ins (the
 * Logger does too).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '../../lib/logging/Logger.js';

const logger = createLogger('npm-ci-skip', { timestamp: false, colors: false });

const argv = process.argv.slice(2);
const skip = new Set();
const npmArgs = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--skip') skip.add(argv[++i]);
  else if (argv[i] === '--') { npmArgs.push(...argv.slice(i + 1)); break; }
  else npmArgs.push(argv[i]);
}
if (skip.size === 0) {
  logger.error('name at least one --skip <package>');
  process.exit(2);
}

const run = (args) => {
  logger.info(`$ npm ${args.join(' ')}`);
  const r = spawnSync('npm', args, { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

const omitDev = npmArgs.some((a) => a === '--omit=dev' || a === '--production');
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));

run(['ci', '--ignore-scripts', ...npmArgs]);

// Packages with install scripts that this install actually put on disk
// (optional, platform-specific ones like fsevents are absent on Linux).
const names = new Set();
for (const [key, meta] of Object.entries(lock.packages ?? {})) {
  if (!key || !meta.hasInstallScript) continue;
  if (omitDev && meta.dev) continue;
  if (!fs.existsSync(path.join(key, 'package.json'))) continue;
  const name = meta.name ?? key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
  if (!skip.has(name)) names.add(name);
}
logger.info(`install scripts: ${[...names].join(', ') || 'none'}; skipped: ${[...skip].join(', ')}`);
if (names.size) run(['rebuild', ...names]);

for (const stage of ['preinstall', 'install', 'postinstall', 'prepare']) {
  run(['run', stage, '--if-present']);
}
