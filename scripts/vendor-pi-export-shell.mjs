#!/usr/bin/env node
/**
 * Vendor pi's session-export shell for the dashboard's Sessions tab.
 *
 * WHY VENDOR AT ALL: `pi` is a host tool and is NOT installed in the
 * coding-services container, where the dashboard server runs. Rendering a
 * session therefore cannot shell out to `pi --export` at request time.
 *
 * WHY THE RENDERED SHELL RATHER THAN THE RAW TEMPLATE: pi's export is
 * template.html with {{CSS}}/{{JS}}/{{SESSION_DATA}}/{{MARKED_JS}}/
 * {{HIGHLIGHT_JS}} substituted, and the CSS itself carries resolved theme
 * variables produced by pi's theme engine. Vendoring the raw template would
 * mean reimplementing that engine. Instead we run the real `pi --export` once
 * on a minimal session and keep its OUTPUT, swapping only the base64 payload
 * for a placeholder. The result is byte-identical to pi's own rendering for
 * whatever version was vendored, with no reimplementation and no runtime
 * dependency.
 *
 * Re-run after upgrading pi. The version is stamped into the shell so the
 * dashboard can report which renderer it is serving.
 *
 * Usage: node scripts/vendor-pi-export-shell.mjs
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(REPO, 'integrations', 'system-health-dashboard', 'assets');
const OUT = path.join(OUT_DIR, 'pi-export-shell.html');
const PLACEHOLDER = '__LSL_SESSION_DATA__';

if (spawnSync('which', ['pi']).status !== 0) {
  process.stderr.write('pi is not on PATH — install it on the host to (re)vendor the shell.\n');
  process.exit(2);
}
const version = execFileSync('pi', ['--version'], { encoding: 'utf8' }).trim();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pishell-'));
const seed = path.join(tmp, 'seed.jsonl');
// A minimal but structurally complete session, so every branch of the
// template's renderer is exercised before we capture its output.
fs.writeFileSync(seed, [
  { type: 'session', version: 3, id: '00000000-0000-4000-8000-000000000000',
    timestamp: '2026-01-01T00:00:00.000Z', cwd: '/' },
  { type: 'message', id: 'a', parentId: null, timestamp: '2026-01-01T00:00:00.000Z',
    message: { role: 'user', content: [{ type: 'text', text: 'seed' }], timestamp: 0 } },
].map((e) => JSON.stringify(e)).join('\n') + '\n');

const html = path.join(tmp, 'seed.html');
execFileSync('pi', ['--export', seed, html], { stdio: 'ignore' });
let shell = fs.readFileSync(html, 'utf8');

// Swap the embedded payload for our placeholder.
const re = /(<script id="session-data" type="application\/json">)[^<]*(<\/script>)/;
if (!re.test(shell)) {
  process.stderr.write('could not find the session-data script tag — pi export format changed.\n');
  process.exit(1);
}
shell = shell.replace(re, `$1${PLACEHOLDER}$2`);
shell = shell.replace('</head>',
  `<meta name="lsl-pi-version" content="${version}">\n</head>`);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, shell);
fs.rmSync(tmp, { recursive: true, force: true });

process.stdout.write(`vendored pi ${version} export shell -> ${path.relative(REPO, OUT)}`
  + ` (${Math.round(shell.length / 1024)} KB)\n`);
