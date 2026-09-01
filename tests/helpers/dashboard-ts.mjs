/**
 * Import a dashboard TypeScript module from a node:test suite.
 *
 * The dashboard's `src/components/llm-routing/*.ts` files are the only copy of
 * the offload-gate mirror, the ladder layout and the recorded-call selection.
 * Testing them means transpiling them, because node's ESM loader does not read
 * TypeScript and the dashboard's own build emits a bundle, not per-module ESM.
 *
 * ── Why this is shared rather than inlined ──────────────────────────────────
 * Four suites had grown their own copy of the same twelve lines, and the copies
 * had already drifted into two different bugs:
 *
 *   1. Three of them resolved esbuild as
 *      `require(path.join(ROOT, 'integrations/system-health-dashboard/node_modules/esbuild'))`.
 *      That directory is gitignored and nothing installs it on a hosted runner,
 *      so all three died at module evaluation — exit 1, no subtests, ~35ms —
 *      and CI was red from 2026-08-30 until this was factored out. Locally they
 *      passed, because a developer has run `npm install` in the dashboard.
 *
 *   2. offload-gates-contract.test.mjs resolved it from the ABSOLUTE path
 *      `/Users/Q284340/Agentic/coding/...`. It never crashed, which is worse:
 *      its require sits inside a try/catch that maps any failure to "proxy not
 *      reachable", so on every machine but one it reported a clean SKIP while
 *      testing nothing at all.
 *
 * esbuild is now a root devDependency, so plain `require('esbuild')` finds it
 * via normal resolution — in CI after `npm ci`, and on a dev machine too. The
 * dashboard's own copy is kept as a fallback so a partially-installed checkout
 * still works.
 *
 * ── Why the caller uses top-level await ─────────────────────────────────────
 * Callers `await` this at module scope rather than inside a `before` hook, and
 * that is deliberate (see the note in recent-call-selection.test.mjs): with
 * `describe`, a root-level async `before` does not gate the suites in this node
 * version — every test reports `cancelled`, which run-node-tests counts as
 * neither pass nor fail, so the file goes GREEN in CI while executing nothing.
 * An import the module graph itself waits on cannot do that. Do not "fix" a
 * caller by moving this into a hook.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const ROOT = path.resolve(import.meta.dirname, '..', '..');

/** Where the modules under test live. */
export const ROUTING_SRC = path.join(
  ROOT, 'integrations/system-health-dashboard/src/components/llm-routing');

/**
 * esbuild, from the root install or the dashboard's.
 *
 * Root first: it is the one `npm ci` guarantees. The dashboard fallback covers
 * a checkout where the root install has not been refreshed since esbuild was
 * added. Throws with both paths named rather than returning null — a caller
 * that cannot transpile cannot meaningfully skip either (see the note above
 * about suites that go green while running nothing).
 */
export function resolveEsbuild() {
  const attempts = [
    'esbuild',
    path.join(ROOT, 'integrations/system-health-dashboard/node_modules/esbuild'),
  ];
  const errors = [];
  for (const spec of attempts) {
    try {
      return require(spec);
    } catch (e) {
      errors.push(`  ${spec}: ${e.code || e.message}`);
    }
  }
  throw new Error(
    'esbuild could not be resolved, so the dashboard TS modules cannot be '
    + 'transpiled for this suite. It is a root devDependency — run `npm ci`.\n'
    + errors.join('\n'));
}

/**
 * Transpile `names` from the llm-routing source dir into one temp directory and
 * import `entry` out of it.
 *
 * All names land in the same directory so their relative imports of each other
 * resolve. Each bare `./<name>` specifier is rewritten to `./<name>.mjs`:
 * TypeScript resolves extensionless imports, node's ESM loader does not. The
 * quote class is matched loosely because esbuild normalises quotes — getting
 * that wrong is silent until resolution, since the file writes fine and only
 * the import throws.
 *
 * @param {object} o
 * @param {string[]} o.names  Module basenames, without extension. Must include
 *   `entry` and everything it imports from this directory.
 * @param {string} o.entry    Which of `names` to import and return.
 * @param {string} o.prefix   mkdtemp prefix, for legible temp dirs.
 * @returns {Promise<object>} The imported module namespace.
 */
export async function loadRoutingModules({ names, entry, prefix }) {
  if (!names.includes(entry)) {
    throw new Error(`entry "${entry}" is not among names [${names.join(', ')}]`);
  }
  const esbuild = resolveEsbuild();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));

  for (const name of names) {
    const ts = fs.readFileSync(path.join(ROUTING_SRC, `${name}.ts`), 'utf8');
    let { code } = esbuild.transformSync(ts, { loader: 'ts', format: 'esm' });
    for (const sibling of names) {
      code = code.replace(
        new RegExp(`(['"])\\./${sibling}\\1`, 'g'), `"./${sibling}.mjs"`);
    }
    fs.writeFileSync(path.join(dir, `${name}.mjs`), code);
  }

  return import(path.join(dir, `${entry}.mjs`));
}
