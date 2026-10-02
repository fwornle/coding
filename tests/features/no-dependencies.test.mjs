/**
 * lib/features must load with NO node_modules.
 *
 * install.sh resolves features before its npm step — for the --dry-run
 * manifest, to validate --features=…, and to decide which steps to skip. When
 * resolve.cjs required 'js-yaml' from node_modules, every profile failed
 * validation on a fresh clone and the installer silently installed everything;
 * every skip gate saw the all-on fallback. Found by tests/cleanroom.
 *
 * So: no bare package specifiers anywhere in lib/features (outside vendor/),
 * and bin/coding-features likewise.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = new URL('../..', import.meta.url).pathname;
const files = [
  ...readdirSync(join(REPO, 'lib/features'))
    .filter((f) => /\.(c|m)?js$/.test(f))
    .map((f) => join('lib/features', f)),
  'bin/coding-features',
];

test('lib/features and bin/coding-features import only node: builtins and relative paths', () => {
  const bare = [];
  for (const rel of files) {
    const src = readFileSync(join(REPO, rel), 'utf8');
    // Statement-level import/export…from, plus require()/import() calls —
    // a loose `from '…'` also matches prose inside strings.
    const specs = /^\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]|\b(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/gm;
    for (const m of src.matchAll(specs)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (spec.startsWith('node:') || spec.startsWith('.')) continue;
      bare.push(`${rel}: ${spec}`);
    }
  }
  assert.deepEqual(bare, [], 'these resolve from node_modules, which does not exist yet at install time');
});
