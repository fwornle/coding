/**
 * The Claude status-line wrapper: idempotent assertion, and the strip itself.
 *
 * Background. The tmux bar renders the context-window gauge for all four
 * agents, so Claude's own copy of that meter is a duplicate. It is removed by
 * wrapping whatever status-line command the user has configured
 * (scripts/claude-statusline.cjs) rather than by editing
 * ~/.claude/hooks/gsd-statusline.js, which is GSD-managed and would be
 * overwritten by the next `/gsd:update`.
 *
 * Two things have to hold for that to survive real installs:
 *
 *   1. ASSERTION IS IDEMPOTENT. Global scope re-asserts on every launch so a GSD
 *      reinstall (which rewrites statusLine back to gsd-statusline.js) is
 *      repaired automatically. Without recovering the original upstream, each
 *      assertion would wrap the previous wrapper —
 *      `CODING_UPSTREAM_STATUSLINE="CODING_UPSTREAM_STATUSLINE=..." node shim` —
 *      nesting one level per launch. That was a real bug, caught only because a
 *      second run reported a write when it should have reported a no-op.
 *
 *   2. THE STRIP IS SURGICAL. GSD's milestone progress bar uses the same ten
 *      glyphs and a percentage ("v7.6 [█████████░] 95%"). Removing it as well
 *      would silently delete information the user relies on.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const BUILDER = path.join(REPO_ROOT, 'scripts', 'build-claude-runtime-config.mjs');
const SHIM = path.join(REPO_ROOT, 'scripts', 'claude-statusline.cjs');

const GSD_CMD = 'node "/somewhere/.claude/hooks/gsd-statusline.js"';

/** Run the builder with an isolated HOME so the real settings file is untouched. */
function assertGlobal(home) {
  const res = spawnSync(process.execPath, [BUILDER, '--install-global'], {
    encoding: 'utf8',
    // CODING_RUNTIME_DIR keeps the derived artifacts inside this test's own
    // HOME. Without it this builder and the one in
    // tests/features/surface-gating.test.mjs write the same repo path
    // concurrently — a torn JSON that failed a different assertion each run —
    // and every test run wiped a live session's slash-command plugin dir.
    env: {
      ...process.env, HOME: home, CODING_REPO: REPO_ROOT, CODING_RUNTIME_DIR: path.join(home, '.coding'),
    },
  });
  assert.equal(res.status, 0, res.stderr);
  return res.stderr;
}

function makeHome(statusLine) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-sl-'));
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  const settings = { model: 'opus', permissions: { allow: ['Bash(ls:*)'] } };
  if (statusLine) settings.statusLine = statusLine;
  fs.writeFileSync(
    path.join(home, '.claude', 'settings.json'),
    JSON.stringify(settings, null, 2),
  );
  return home;
}

function readStatusLine(home) {
  const p = path.join(home, '.claude', 'settings.json');
  return JSON.parse(fs.readFileSync(p, 'utf8')).statusLine;
}

test('assertion wraps the configured command exactly once', () => {
  const home = makeHome({ type: 'command', command: GSD_CMD });
  try {
    assertGlobal(home);
    const sl = readStatusLine(home);
    assert.ok(sl.command.includes('claude-statusline.cjs'), sl.command);
    assert.ok(sl.command.includes(JSON.stringify(GSD_CMD)), sl.command);
    assert.equal(sl.command.split('CODING_UPSTREAM_STATUSLINE').length - 1, 1);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('re-asserting is a no-op — the wrapper never nests', () => {
  const home = makeHome({ type: 'command', command: GSD_CMD });
  try {
    assertGlobal(home);
    const first = readStatusLine(home).command;

    for (let i = 0; i < 3; i++) {
      const stderr = assertGlobal(home);
      assert.match(stderr, /already current/, `run ${i + 2} rewrote the file`);
    }
    assert.equal(readStatusLine(home).command, first, 'command drifted across runs');
    assert.equal(first.split('CODING_UPSTREAM_STATUSLINE').length - 1, 1, 'wrapper nested');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a GSD reinstall is repaired on the next assertion, then converges', () => {
  const home = makeHome({ type: 'command', command: GSD_CMD });
  const settingsPath = path.join(home, '.claude', 'settings.json');
  try {
    assertGlobal(home);

    // GSD reinstalls and points statusLine back at its own script.
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    s.statusLine = { type: 'command', command: GSD_CMD };
    fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2));

    assert.match(assertGlobal(home), /asserted in/, 'did not repair the clobbered statusLine');
    assert.ok(readStatusLine(home).command.includes('claude-statusline.cjs'));
    assert.match(assertGlobal(home), /already current/, 'did not converge after repair');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('no status line configured → none installed, so Claude keeps its default', () => {
  // Wrapping nothing would replace Claude Code's own default with the output of
  // a command that has nothing to wrap: a blank status line traded for a
  // duplicate gauge that was never there.
  const home = makeHome(null);
  try {
    assertGlobal(home);
    assert.equal(readStatusLine(home), undefined);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the user\'s other settings survive assertion', () => {
  const home = makeHome({ type: 'command', command: GSD_CMD });
  try {
    assertGlobal(home);
    const s = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
    assert.equal(s.model, 'opus');
    assert.deepEqual(s.permissions.allow, ['Bash(ls:*)']);
    assert.ok(s.hooks, 'coding hooks should have been merged in');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a one-time original is kept, and not replaced on later runs', () => {
  const home = makeHome({ type: 'command', command: GSD_CMD });
  const backup = path.join(home, '.claude', 'settings.json.coding-pre-global');
  try {
    assertGlobal(home);
    const original = fs.readFileSync(backup, 'utf8');
    assert.ok(original.includes('gsd-statusline.js'), 'backup must hold the PRE-wrap settings');

    // A per-run backup would litter the user's .claude directory; and a backup
    // overwritten on run 2 would capture the already-wrapped state, making it
    // useless as a way back.
    const s = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
    s.statusLine = { type: 'command', command: GSD_CMD };
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify(s, null, 2));
    assertGlobal(home);

    assert.equal(fs.readFileSync(backup, 'utf8'), original, 'backup was overwritten');
    const backups = fs.readdirSync(path.join(home, '.claude'))
      .filter((f) => f.includes('pre-global'));
    assert.equal(backups.length, 1, `expected one backup, got ${backups.join(', ')}`);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the shim strips the context meter but keeps the milestone bar', () => {
  const hookInput = JSON.stringify({
    model: { display_name: 'Opus 5' },
    workspace: { current_dir: REPO_ROOT },
    context_window: { remaining_percentage: 30, total_tokens: 1_000_000 },
    session_id: 'wrapper-unit-test',
  });

  // A stand-in upstream that emits both shapes: the context meter (glyphs
  // directly after the SGR) and GSD's milestone bar (glyphs inside brackets).
  //
  // The glyphs are literal UTF-8, not "█" escapes — `printf` does not
  // expand those, so an escaped fixture emits the text "█" and the shim
  // correctly finds nothing to strip, which looks exactly like the shim being
  // broken.
  // node rather than printf: printf treats "%" as a format specifier, so a
  // payload containing "50%" is silently truncated at the percent sign and the
  // fixture then proves nothing. node writes the bytes verbatim.
  const payload = '\\x1b[2mOpus 5\\x1b[0m \\x1b[32m█████░░░░░ 50%\\x1b[0m'
    + ' | \\x1b[2mv7.6 [█████████░] 95% · executing\\x1b[0m';
  const fake = `node -e "process.stdout.write('${payload}')"`;

  const res = spawnSync(process.execPath, [SHIM], {
    input: hookInput,
    encoding: 'utf8',
    // Pin the feature ON. The shim now goes quiet when `statusline` is off
    // (lib/statusline/feature-gate.cjs), and without this pin the test asserts
    // against whatever the developer's own ~/.coding/features.yaml happens to
    // say — it failed on exactly that. The env layer is last-wins, so this
    // holds regardless of repo or per-machine config. That the shim DOES go
    // quiet when off is covered in tests/features/surface-gating.test.mjs.
    env: { ...process.env, CODING_UPSTREAM_STATUSLINE: fake, CODING_FEATURE_STATUSLINE: 'on' },
  });
  assert.equal(res.status, 0, res.stderr);

  // ESC is the thing being matched — the meter is only identifiable by its SGR
  // prefix, which is exactly what distinguishes it from the bracketed milestone bar.
  // eslint-disable-next-line no-control-regex
  const meterRe = /\x1b\[\d+m[█░]{10}\s+\d+%/;
  assert.ok(!meterRe.test(res.stdout), `meter survived: ${res.stdout}`);
  assert.match(res.stdout, /\[[█░]{10}\] 95%/, `milestone bar was eaten: ${res.stdout}`);
  assert.match(res.stdout, /Opus 5/);
});
