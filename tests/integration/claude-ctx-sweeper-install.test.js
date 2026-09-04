/**
 * The wiring around the status-line temp-file sweeper — the parts that cannot be tested by
 * running them on this machine.
 *
 * The sweeper's own behaviour is covered by tests/live-logging/claude-ctx-sweeper.test.mjs.
 * What is left is platform-shaped: a Windows Scheduled Task nobody can create on a Mac or a
 * Linux CI box, and a manifest whose whole job is to tell the user the truth about which
 * platform they are on. Both are asserted the way this repo already asserts installer
 * changes — `bash -n` plus structural regexes over the source, and, for the manifest, by
 * SOURCING install.sh into a throwaway HOME and calling one function.
 *
 * Precedent: tests/integration/sub-agent-launchd-install.test.js (bash -n at :152, source
 * regexes at :331) and tests/integration/mcp-converters.test.sh (the temp-HOME sourcing
 * harness). Nothing here mutates the machine.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const SCHTASKS_INSTALLER = path.join(REPO, 'scripts', 'install-claude-ctx-sweeper-schtasks.sh');
const SWEEPER = path.join(REPO, 'scripts', 'claude-ctx-sweeper.mjs');
const INSTALL_SH = path.join(REPO, 'install.sh');
const UNINSTALL_SH = path.join(REPO, 'uninstall.sh');
const BIN_CODING = path.join(REPO, 'bin', 'coding');
const TASK_NAME = String.raw`\coding\claude-ctx-sweeper`;

/**
 * Source install.sh in a throwaway HOME and run one function.
 *
 * install.sh guards `main "$@"` on SCRIPT_EXECUTED, so sourcing defines the functions
 * without installing anything. CODING_REPO is re-exported AFTER the source because
 * install.sh sets it unconditionally at source time — the same trap documented in
 * tests/integration/mcp-converters.test.sh.
 *
 * Explicitly `bash`, never the ambient shell: the manifest heredoc and `[[ ]]` are bash,
 * and sourcing it from zsh silently mangles both.
 */
function manifestFor(platform) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-sweeper-manifest-'));
  try {
    const r = spawnSync('bash', ['-c',
      `source ./install.sh >/dev/null 2>&1; export CODING_REPO="${home}/repo"; ` +
      `PLATFORM="${platform}"; print_impact_manifest 2>/dev/null`,
    ], { cwd: REPO, env: { ...process.env, HOME: home }, encoding: 'utf8' });
    // Strip SGR colour so the assertions match on text, not on styling. Matching the
    // ESC byte is the point here — the manifest is printed with colour, and stripping
    // only the visible '[0;35m' tail would leave the escape behind.
    // eslint-disable-next-line no-control-regex
    return (r.stdout || '').replace(/\x1b\[[0-9;]*m/g, '');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

describe('claude-ctx sweeper: install wiring', () => {
  test('the schtasks installer is syntax-clean and fails safe', () => {
    expect(spawnSync('bash', ['-n', SCHTASKS_INSTALLER], { encoding: 'utf8' }).status).toBe(0);
    const body = fs.readFileSync(SCHTASKS_INSTALLER, 'utf8');
    expect(body).toMatch(/set -euo pipefail/);
    // /F is what makes re-running idempotent, the way `bootout` before `bootstrap` does
    // for the launchd installers. Without it a second install fails on "task exists".
    expect(body).toMatch(/\/Create\s+\/F\s+\/SC\s+HOURLY/);
    expect(body).toMatch(/\/Delete\s+\/F/);
    // cygpath: schtasks is a native binary and does not understand /c/Users/... . Skipping
    // the translation creates a task that registers fine and fails at every run.
    expect(body).toMatch(/cygpath -w/);
  });

  test('the sweeper it schedules exists and is executable', () => {
    expect(fs.existsSync(SWEEPER)).toBe(true);
    expect(() => fs.accessSync(SWEEPER, fs.constants.X_OK)).not.toThrow();
  });

  test('on a non-Windows host the installer declines instead of half-installing', () => {
    // Guards the one thing a Mac/Linux CI box can actually observe: no schtasks means a
    // clean refusal that names the fallback, not a partial install or a stack trace.
    const r = spawnSync('bash', [SCHTASKS_INSTALLER, '--dry-run'], { encoding: 'utf8' });
    if (spawnSync('command', ['-v', 'schtasks'], { shell: true }).status === 0) return;
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Windows hosts only/);
    expect(r.stderr).toMatch(/agent launch/);
  });

  test('the sweep runs at agent launch, before the exec, and cannot fail a launch', () => {
    const body = fs.readFileSync(BIN_CODING, 'utf8');
    const sweepAt = body.indexOf('claude-ctx-sweeper.mjs');
    expect(sweepAt).toBeGreaterThan(-1);
    // Anything after `exec` never runs. This is the whole cross-platform guarantee, so it
    // is asserted positionally rather than by eye.
    expect(sweepAt).toBeLessThan(body.indexOf('exec "$AGENT_LAUNCHER"'));
    const line = body.slice(sweepAt - 200, sweepAt + 200);
    expect(line).toMatch(/--if-older-than=/);   // a burst of launches sweeps once
    expect(line).toMatch(/>\/dev\/null 2>&1 &/); // backgrounded and silenced
  });
});

describe('claude-ctx sweeper: the manifest tells the truth per platform', () => {
  // The manifest is the user's entire basis for consent, so a row shown on a platform that
  // cannot have it is not cosmetic — it is the document lying.
  test('the Scheduled Task row appears on Windows', () => {
    expect(manifestFor('windows')).toContain(TASK_NAME);
  });

  test.each(['macos', 'linux', 'wsl'])('the Scheduled Task row is hidden on %s', (platform) => {
    expect(manifestFor(platform)).not.toContain(TASK_NAME);
  });

  test('the platform arms it shares the filter with still work', () => {
    // The Windows arm was added to an existing `case`; these two prove it did not shadow
    // the arms that were already there.
    expect(manifestFor('macos')).toContain('LaunchAgents');
    expect(manifestFor('macos')).not.toContain('systemd/user');
    expect(manifestFor('linux')).toContain('systemd/user');
    expect(manifestFor('linux')).not.toContain('LaunchAgents');
  });
});

describe('claude-ctx sweeper: uninstall mirrors the manifest', () => {
  // uninstall.sh does not parse mutation_manifest(); it hand-mirrors it, and its own
  // comment admits that is a drift risk. This test is the thing that notices.
  test('uninstall.sh removes the task install.sh declares', () => {
    const body = fs.readFileSync(UNINSTALL_SH, 'utf8');
    expect(body).toContain(String.raw`\coding\claude-ctx-sweeper`);
    expect(body).toMatch(/\/Delete\s+\/F/);
  });

  test('install.sh and uninstall.sh name the same task', () => {
    const declared = fs.readFileSync(INSTALL_SH, 'utf8').includes(TASK_NAME);
    const removed = fs.readFileSync(UNINSTALL_SH, 'utf8').includes(TASK_NAME);
    expect(declared && removed).toBe(true);
  });
});
