/**
 * Vendored copilot model ids — drift guard.
 *
 * `@rapid/llm-proxy` hardcodes its copilot tier models in a constructor
 * default, and it is installed from a GitHub release tarball rather than the
 * npm registry — so there is no clean baseline for patch-package to diff
 * against (attempting it produced a 148KB "patch" spanning 25 unrelated
 * files). The correction is therefore applied by
 * `integrations/semantic-analysis/scripts/align-copilot-model-ids.mjs`.
 *
 * That script has to run from TWO places, and this file is what stops either
 * from being dropped:
 *
 *   - the Dockerfile, explicitly, because the in-image `npm install` uses
 *     `--ignore-scripts` and would skip a postinstall hook
 *   - package.json `postinstall`, for host installs
 *
 * The failure it guards against is silent and expensive. A retired id makes
 * Copilot answer 400; `standard` is the tier `semantic_analysis` maps to, so
 * on 2026-09-20 every Wave 3 call fell through to `[llm] All providers failed`
 * and wrote a shallow ~600-char stub entity instead of a ~4400-char analysis.
 * Nothing in the logs named the model.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO = process.env.CODING_REPO || new URL('../..', import.meta.url).pathname;
const SA = join(REPO, 'integrations/semantic-analysis');
const SCRIPT = join(SA, 'scripts/align-copilot-model-ids.mjs');

/** Ids Copilot has retired — naming any of these earns a hard 400. */
const RETIRED = ['claude-sonnet-4.6', 'claude-opus-4.6'];

/**
 * Is the submodule actually on disk?
 *
 * `.github/workflows/tests.yml` checks out with `submodules: false` on
 * purpose — the `integrations/*` submodules are PRIVATE and unreachable from
 * the runner. An uninitialised submodule leaves an empty directory, so four
 * of the tests below read files that cannot exist in CI and failed there on
 * every push while passing locally.
 *
 * The gate is the submodule's own manifest, NOT each file under test. That
 * keeps the guard honest: where the submodule IS checked out and the
 * alignment script has been deleted or renamed, these still fail — which is
 * the drift this file exists to catch.
 */
const SA_CHECKED_OUT = existsSync(join(SA, 'package.json'));
const SKIP_REASON =
  'integrations/semantic-analysis is not checked out (tests.yml uses submodules: false — private submodule)';

describe('vendored copilot model ids', () => {
  test('the alignment script exists', (t) => {
    if (!SA_CHECKED_OUT) return t.skip(SKIP_REASON);
    assert.ok(existsSync(SCRIPT), `missing ${SCRIPT}`);
  });

  test('it covers every id known to be retired', (t) => {
    if (!SA_CHECKED_OUT) return t.skip(SKIP_REASON);
    const src = readFileSync(SCRIPT, 'utf8');
    for (const dead of RETIRED) {
      assert.ok(
        src.includes(`'${dead}'`),
        `${dead} is retired but the script does not rewrite it`,
      );
    }
  });

  test('its replacements never map onto another retired id', (t) => {
    if (!SA_CHECKED_OUT) return t.skip(SKIP_REASON);
    // A successor that is itself dead would swap one 400 for another.
    const src = readFileSync(SCRIPT, 'utf8');
    const pairs = [...src.matchAll(/\["'([^']+)'",\s*"'([^']+)'"\]/g)];
    assert.ok(pairs.length >= RETIRED.length, 'replacement table not parseable');
    for (const [, dead, live] of pairs) {
      assert.ok(RETIRED.includes(dead), `${dead} rewritten but not listed as retired`);
      assert.ok(!RETIRED.includes(live), `${dead} -> ${live}, but ${live} is also retired`);
    }
  });

  test('the Dockerfile runs it, and does not swallow its failure', () => {
    const df = readFileSync(join(REPO, 'docker/Dockerfile.coding-services'), 'utf8');
    const line = df.split('\n').find(l => l.includes('align-copilot-model-ids.mjs'));
    assert.ok(line, 'Dockerfile never runs the alignment script');
    assert.ok(
      !line.includes('|| true') && !line.includes('2>/dev/null'),
      'alignment failure must fail the build, not be swallowed',
    );
  });

  test('the Dockerfile runs it AFTER the install that would overwrite it', () => {
    const lines = readFileSync(join(REPO, 'docker/Dockerfile.coding-services'), 'utf8').split('\n');
    const install = lines.findLastIndex(
      l => l.startsWith('RUN cd integrations/semantic-analysis && npm install'),
    );
    const align = lines.findIndex(l => l.includes('align-copilot-model-ids.mjs'));
    assert.ok(install >= 0 && align >= 0, 'expected both steps present');
    assert.ok(align > install, 'alignment must run after the last npm install, or it is undone');
  });

  test('package.json wires it as postinstall for host installs', (t) => {
    if (!SA_CHECKED_OUT) return t.skip(SKIP_REASON);
    const pkg = JSON.parse(readFileSync(join(SA, 'package.json'), 'utf8'));
    assert.match(pkg.scripts?.postinstall ?? '', /align-copilot-model-ids\.mjs/);
  });

  test('the installed package carries no retired id', (t) => {
    const dist = join(SA, 'node_modules/@rapid/llm-proxy/dist/providers/copilot-provider.js');
    if (!existsSync(dist)) {
      t.skip('@rapid/llm-proxy not installed in this checkout');
      return;
    }
    const js = readFileSync(dist, 'utf8');
    for (const dead of RETIRED) {
      assert.ok(!js.includes(`'${dead}'`), `retired id ${dead} still live in ${dist}`);
    }
  });
});
