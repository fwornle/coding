/**
 * The dashboard build must fail on TypeScript errors.
 *
 * The build script was `tsc --noEmit 2>/dev/null; vite build`. The redirect
 * discarded tsc's output and the `;` discarded its exit code, so the build
 * passed no matter what the checker found. Seven errors had accumulated behind
 * it, including two that were only reachable because `store` was annotated
 * `any` — which silently erased AppDispatch typing across the whole app.
 *
 * A swallowed gate is worse than no gate: it reads like coverage while
 * providing none. These assertions pin the shape that actually fails.
 *
 * Runner: node --test tests/dashboard/build-typecheck-gate.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DASH = path.join(REPO_ROOT, 'integrations', 'system-health-dashboard');
const pkg = JSON.parse(readFileSync(path.join(DASH, 'package.json'), 'utf8'));
const store = readFileSync(path.join(DASH, 'src', 'store', 'index.ts'), 'utf8');

describe('dashboard build typecheck gate', () => {
  test('the build runs tsc', () => {
    assert.match(pkg.scripts.build, /tsc --noEmit/);
  });

  test('tsc output is not discarded', () => {
    // `2>/dev/null` is what hid the errors in the first place.
    assert.doesNotMatch(pkg.scripts.build, /tsc[^&|;]*2>\s*\/dev\/null/);
  });

  test('a tsc failure stops the build rather than being stepped over', () => {
    // `;` continues regardless of exit code; `&&` is the whole point.
    assert.match(pkg.scripts.build, /tsc --noEmit\s*&&\s*vite build/);
    assert.doesNotMatch(pkg.scripts.build, /tsc --noEmit\s*;/);
  });

  test('typecheck is runnable on its own', () => {
    assert.equal(pkg.scripts.typecheck, 'tsc --noEmit');
  });
});

describe('the store keeps its real type', () => {
  test('store is not annotated `any`', () => {
    // `export const store: any` makes AppDispatch = any, which silently turns
    // off dispatch typing everywhere and produced an implicit-any error that
    // looked unrelated (experiment-launcher.tsx TS7006).
    assert.doesNotMatch(store, /export const store\s*:\s*any\b/);
    assert.match(store, /export const store = configureStore\(/);
  });

  test('AppDispatch is still derived from the store', () => {
    assert.match(store, /export type AppDispatch = typeof store\.dispatch/);
  });
});
