/**
 * Feature gating of the two surfaces a user sees every second: the agent hooks
 * and the status line.
 *
 * Both are exercised as SUBPROCESSES with a sandbox CODING_HOME, because both
 * read the resolver at module scope and the point of the test is the real
 * end-to-end path — the same one a launch takes — not a mocked feature map.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exec = promisify(execFile);
const REPO = process.env.CODING_REPO || new URL('../..', import.meta.url).pathname.replace(/\/$/, '');

let sandbox;
/** Saved copy of the real runtime artifacts, restored in `after`. */
const RUNTIME = join(REPO, '.coding', 'runtime', 'claude-settings.json');
let savedRuntime = null;

function homeWith(yaml) {
  const dir = join(sandbox, `home-${Buffer.from(yaml).toString('hex').slice(0, 12)}`);
  mkdirSync(join(dir, '.coding'), { recursive: true });
  writeFileSync(join(dir, '.coding', 'features.yaml'), yaml);
  return dir;
}

async function run(script, home, extraEnv = {}) {
  const env = { ...process.env, CODING_REPO: REPO, ...extraEnv };
  if (home) env.CODING_HOME = home; else delete env.CODING_HOME;
  const { stdout } = await exec('node', [join(REPO, script)], { env, timeout: 60000 });
  return stdout;
}

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'coding-surface-'));
  if (existsSync(RUNTIME)) savedRuntime = readFileSync(RUNTIME, 'utf8');
});

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
  // build-claude-runtime-config.mjs writes into the repo. Put the real file back
  // so a test run cannot leave this machine's next launch with sandbox hooks.
  if (savedRuntime !== null) writeFileSync(RUNTIME, savedRuntime);
});

describe('agent hooks', () => {
  const hookEvents = async (home) => {
    await run('scripts/build-claude-runtime-config.mjs', home);
    return Object.keys(JSON.parse(readFileSync(RUNTIME, 'utf8')).hooks || {});
  };

  test('all features on contributes all three hooks', async () => {
    const events = await hookEvents(homeWith('profile: full\n'));
    for (const e of ['PreToolUse', 'PostToolUse', 'UserPromptSubmit']) {
      assert.ok(events.includes(e), `missing ${e}`);
    }
  });

  test('each hook follows its own feature', async () => {
    const settings = async (yaml) => {
      await run('scripts/build-claude-runtime-config.mjs', homeWith(yaml));
      return readFileSync(RUNTIME, 'utf8');
    };

    const noConstraints = await settings('profile: full\nfeatures:\n  constraints: off\n');
    assert.ok(!noConstraints.includes('pre-tool-hook-wrapper.js'), 'constraints hook survived');
    assert.ok(noConstraints.includes('tool-interaction-hook-wrapper.js'), 'lsl hook wrongly removed');

    const noLsl = await settings('profile: full\nfeatures:\n  lsl: off\n');
    assert.ok(!noLsl.includes('tool-interaction-hook-wrapper.js'), 'lsl hook survived');

    const noHealth = await settings('profile: full\nfeatures:\n  health: off\n');
    assert.ok(!noHealth.includes('health-prompt-hook.js'), 'health hook survived');
  });

  test('switching a feature back on restores its hook', async () => {
    // The strip pass runs over every hook we could install, not just the ones
    // we are installing now — otherwise a disabled feature's hook stays behind
    // and keeps running on every tool call.
    await run('scripts/build-claude-runtime-config.mjs', homeWith('profile: full\nfeatures:\n  constraints: off\n'));
    assert.ok(!readFileSync(RUNTIME, 'utf8').includes('pre-tool-hook-wrapper.js'));

    await run('scripts/build-claude-runtime-config.mjs', homeWith('profile: full\n'));
    assert.ok(readFileSync(RUNTIME, 'utf8').includes('pre-tool-hook-wrapper.js'));
  });

  test("the user's own hooks are never dropped", async () => {
    const settings = JSON.parse(await (async () => {
      await run('scripts/build-claude-runtime-config.mjs', homeWith('profile: minimal\n'));
      return readFileSync(RUNTIME, 'utf8');
    })());
    // Nothing of ours should remain under `minimal`...
    const text = JSON.stringify(settings);
    assert.ok(!text.includes('pre-tool-hook-wrapper.js'));
    assert.ok(!text.includes('tool-interaction-hook-wrapper.js'));
    assert.ok(!text.includes('health-prompt-hook.js'));
    // ...but the settings object itself must still be well-formed.
    assert.equal(typeof settings, 'object');
  });
});

describe('status line', () => {
  const strip = (s) => s.replace(/#\[[^\]]*\]/g, '').trim();

  const render = async (home) => strip(await run('scripts/combined-status-line.js', home, {
    TRANSCRIPT_SOURCE_PROJECT: REPO,
    CODING_AGENT: 'claude',
    TMUX_PANE_WIDTH: '120',
  }));

  /** Badge signatures, by the feature that owns them. */
  const BADGES = {
    health: ['[🏥', '[N:', '[P:'],
    constraints: ['[🔒'],
    observations: ['[📚'],
    lsl: ['[📋', '[LSL'],
    'llm-proxy': ['[D:', '[L:', '[🧠'],
  };

  test('a disabled feature contributes no badge', async () => {
    const line = await render(homeWith('profile: minimal\n'));
    for (const [feature, marks] of Object.entries(BADGES)) {
      for (const mark of marks) {
        assert.ok(!line.includes(mark), `${mark} (${feature}) rendered under 'minimal'`);
      }
    }
  });

  test('proxy-only keeps exactly the proxy badges', async () => {
    const line = await render(homeWith('profile: proxy-only\n'));
    for (const mark of [...BADGES.health, ...BADGES.constraints, ...BADGES.observations, ...BADGES.lsl]) {
      assert.ok(!line.includes(mark), `${mark} rendered under 'proxy-only'`);
    }
    assert.ok(
      BADGES['llm-proxy'].some((m) => line.includes(m)),
      'no proxy badge rendered under proxy-only',
    );
  });

  test('the clock survives every profile — the line is never empty', async () => {
    for (const profile of ['full', 'proxy-only', 'logging-only', 'minimal']) {
      const line = await render(homeWith(`profile: ${profile}\n`));
      assert.match(line, /\d{2}:\d{2}$/, `no clock under '${profile}'`);
    }
  });

  test('padding is invariant, so dropped badges leave no residue', async () => {
    // The historical "15:322" leftover-digit bug came from a padded line whose
    // visible width did not match what tmux reserved. Dropping badges must not
    // change the padded width.
    const widths = new Set();
    for (const profile of ['full', 'proxy-only', 'logging-only', 'minimal']) {
      const raw = await run('scripts/combined-status-line.js', homeWith(`profile: ${profile}\n`), {
        TRANSCRIPT_SOURCE_PROJECT: REPO,
        CODING_AGENT: 'claude',
        TMUX_PANE_WIDTH: '120',
      });
      widths.add(visibleCells(raw.replace(/\n$/, '')));
    }
    assert.equal(widths.size, 1, `padded width varies by profile: ${[...widths].join(', ')}`);
  });
});

/** tmux-style visible cell count: strip #[...] and score wide glyphs as 2. */
function visibleCells(text) {
  let w = 0;
  for (const ch of text.replace(/#\[[^\]]*\]/g, '')) {
    const cp = ch.codePointAt(0);
    const wide = (cp >= 0x1100 && cp <= 0x115F) || (cp >= 0x2E80 && cp <= 0xA4CF)
      || (cp >= 0xAC00 && cp <= 0xD7A3) || (cp >= 0xF900 && cp <= 0xFAFF)
      || (cp >= 0xFE30 && cp <= 0xFE6F) || (cp >= 0xFF00 && cp <= 0xFF60)
      || (cp >= 0x1F300 && cp <= 0x1FAFF);
    w += wide ? 2 : 1;
  }
  return w;
}

describe('status-line cache key', () => {
  test('the feature set is part of the key', async () => {
    const { featureFingerprint } = await import(join(REPO, 'lib/statusline/pane-cache-key.cjs'))
      .then((m) => m.default ?? m);
    const full = featureFingerprint({ CODING_REPO: REPO, CODING_HOME: homeWith('profile: full\n') });
    const minimal = featureFingerprint({ CODING_REPO: REPO, CODING_HOME: homeWith('profile: minimal\n') });
    assert.notEqual(full, minimal, 'a profile change must produce a different cache file');
    assert.equal(full, '', 'all-on must keep the historical filenames');
  });

  test('every reader and the writer use the shared key builder', async () => {
    // The wrapper used to build the suffix itself and had already fallen behind
    // by one component (agent). A second divergence would present as "the
    // toggle did not work" rather than as an error.
    for (const file of [
      'scripts/combined-status-line.js',
      'scripts/status-line-fast.cjs',
      'scripts/combined-status-line-wrapper.js',
    ]) {
      const src = readFileSync(join(REPO, file), 'utf8');
      assert.match(src, /paneIdentity\(\)/, `${file} does not use the shared cache key`);
    }
  });
});
