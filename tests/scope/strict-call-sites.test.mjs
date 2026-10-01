/**
 * `requireScope()` is called at the moment of persistence, never earlier.
 *
 * Strict resolution throws. Where it is CALLED therefore decides whether an
 * unscoped machine refuses one write or cannot start at all:
 *
 *   in a default-parameter position   every construction throws, including on
 *                                     read-only paths — `new CoordinatorAgent(repo)`
 *                                     would stop working
 *   at module top level               a long-lived daemon becomes unstartable.
 *                                     obs-api dying at import reads as "process
 *                                     died immediately" and degrades the whole
 *                                     service set; semantic-analysis hits
 *                                     supervisord's startretries and goes FATAL
 *
 * Both are invisible in review — the call looks identical to a correct one. So
 * they are tests, not a convention.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO = process.env.CODING_REPO || new URL('../..', import.meta.url).pathname;

const ROOTS = ['src', 'lib', 'scripts', 'bin'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'km-core']);

function walk(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(js|mjs|cjs|ts)$/.test(e.name) && !/\.test\.[a-z]+$/.test(e.name)) acc.push(p);
  }
  return acc;
}

/** Also pick up extensionless executables under bin/. */
function binFiles() {
  const dir = join(REPO, 'bin');
  const out = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isFile()) continue;
    const p = join(dir, e.name);
    if (statSync(p).size > 512 * 1024) continue;
    out.push(p);
  }
  return out;
}

const FILES = [
  ...ROOTS.flatMap((r) => walk(join(REPO, r))),
  ...binFiles(),
].filter((v, i, a) => a.indexOf(v) === i);

function scan(re, predicate) {
  const found = [];
  for (const f of FILES) {
    let text;
    try { text = readFileSync(f, 'utf8'); } catch { continue; }
    if (!text.includes('requireScope')) continue;
    text.split('\n').forEach((line, i) => {
      // Skip comments — the converted sites explain the rule they follow.
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      if (re.test(line) && (!predicate || predicate(line))) {
        found.push(`${relative(REPO, f)}:${i + 1}: ${t}`);
      }
    });
  }
  return found;
}

describe('requireScope is never resolved eagerly', () => {
  test('it never appears in a default-parameter position', () => {
    // `function f(team = requireScope())` throws for every caller, not just the
    // ones that write. Default to undefined and resolve in the body.
    const found = scan(/[=]\s*(?:await\s+)?requireScope\s*\(/, (line) =>
      // `const x = requireScope()` is a body statement, which is fine.
      !/^\s*(?:const|let|var|return)\b/.test(line) && !/\?\?\s*(?:await\s+)?requireScope/.test(line),
    );
    assert.deepEqual(found, [], `resolve in the body instead:\n${found.join('\n')}`);
  });

  test('it is never called at module top level', () => {
    // Indentation zero is the cheap, reliable signal: every legitimate call is
    // inside a function or a method.
    const found = scan(/^(?:const|let|var|await|requireScope)\b.*requireScope\s*\(/);
    assert.deepEqual(found, [], `a top-level throw makes the program unstartable:\n${found.join('\n')}`);
  });

  test('the long-lived daemons resolve nothing at import time', () => {
    // Named explicitly because these are the ones whose death is worst and
    // least obviously connected to a tenancy change.
    for (const rel of [
      'scripts/observations-api-server.mjs',
      'scripts/health-coordinator.js',
    ]) {
      let text;
      try { text = readFileSync(join(REPO, rel), 'utf8'); } catch { continue; }
      const bad = text.split('\n')
        .map((l, i) => [l, i + 1])
        .filter(([l]) => /requireScope\s*\(/.test(l) && /^\S/.test(l));
      assert.deepEqual(bad.map(([l, n]) => `${rel}:${n}: ${l.trim()}`), []);
    }
  });
});
