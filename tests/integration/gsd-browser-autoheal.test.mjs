/**
 * bin/gsd-browser — the self-healing shim in front of the gsd-browser CLI.
 *
 * The gsd-browser daemon and its headless Chrome can get out of step three
 * ways, and every one of them is permanent because nothing supervises the pair:
 *
 *   A. daemon alive, browser dead      -> "send failed because receiver is gone"
 *   B. stale SingletonLock, nothing up -> "daemon exited during startup"
 *   C. orphaned Chrome, no daemon      -> same as B, but the lock is VALID and
 *                                         naming a live pid, so clearing it
 *                                         without killing the browser is wrong
 *
 * The shim detects A and B's signatures, resets both halves, and retries once.
 * (C presents as B and is fixed by the same reset — killing the orphan is what
 * makes the lock removable.) All three were verified by hand against the live
 * daemon; what is pinned here is the decision logic, which is the part with
 * edge cases: retry exactly once, only on those signatures, never swallowing an
 * exit code or corrupting binary stdout.
 *
 * The destructive half of the reset is stubbed via GSD_BROWSER_RESET_HOOK — a
 * test must not SIGKILL a developer's live browser session merely by running.
 * The hook records that the reset was reached, so it is asserted rather than
 * skipped.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHIM = path.join(REPO_ROOT, 'bin', 'gsd-browser');

let tmp;
let stub;
let hook;
let countFile;
let hookFile;

/** A stand-in for the real binary whose behaviour the test dictates. */
const STUB = `#!/usr/bin/env bash
n=$(( $(cat "$STUB_COUNT" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$STUB_COUNT"
case "$STUB_MODE" in
  heal)
    if [[ "$n" == "1" ]]; then
      echo "Error: navigate failed: send failed because receiver is gone" >&2
      exit 1
    fi
    echo "OK-$n"; exit 0 ;;
  dead-daemon)
    if [[ "$n" == "1" ]]; then
      echo "Error: daemon exited during startup with status exit status: 1" >&2
      exit 1
    fi
    echo "OK-$n"; exit 0 ;;
  persist)
    echo "Error: eval error: send failed because receiver is gone" >&2; exit 1 ;;
  other)
    echo "Error: navigation failed: net::ERR_UNSAFE_PORT" >&2; exit 3 ;;
  binary)
    printf '\\x89PNG\\r\\n\\x1a\\n\\x00\\x01\\x02\\x03'; exit 0 ;;
  stop-ok)
    echo "Daemon stopped."; exit 0 ;;
esac
`;

const HOOK = `#!/usr/bin/env bash
echo reset >> "$HOOK_FILE"
`;

/** Run the shim; never throws, so exit codes can be asserted. */
function runShim(mode, args = ['navigate', 'x']) {
  fs.rmSync(countFile, { force: true });
  fs.rmSync(hookFile, { force: true });
  const env = {
    ...process.env,
    GSD_BROWSER_BIN: stub,
    GSD_BROWSER_RESET_HOOK: hook,
    STUB_MODE: mode,
    STUB_COUNT: countFile,
    HOOK_FILE: hookFile,
  };
  let stdout = Buffer.alloc(0);
  let status = 0;
  let stderr = '';
  try {
    stdout = execFileSync(SHIM, args, { env, encoding: 'buffer' });
  } catch (err) {
    stdout = err.stdout ?? Buffer.alloc(0);
    stderr = String(err.stderr ?? '');
    status = err.status ?? 1;
  }
  const calls = Number(fs.readFileSync(countFile, 'utf8').trim());
  const resets = fs.existsSync(hookFile)
    ? fs.readFileSync(hookFile, 'utf8').trim().split('\n').filter(Boolean).length
    : 0;
  return { stdout, stderr, status, calls, resets };
}

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-shim-'));
  stub = path.join(tmp, 'gsd-browser-stub');
  hook = path.join(tmp, 'reset-hook');
  countFile = path.join(tmp, 'calls');
  hookFile = path.join(tmp, 'resets');
  fs.writeFileSync(stub, STUB, { mode: 0o755 });
  fs.writeFileSync(hook, HOOK, { mode: 0o755 });
});

after(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe('gsd-browser shim heals a wedged daemon', () => {
  it('retries once after "receiver is gone" and succeeds', () => {
    const r = runShim('heal');
    assert.equal(r.status, 0);
    assert.equal(r.calls, 2, 'should invoke the real binary exactly twice');
    assert.equal(r.resets, 1, 'should reset the daemon between attempts');
    assert.match(r.stdout.toString(), /OK-2/);
  });

  it('retries on the stale-lock signature too', () => {
    // Wedge B reports a different message entirely — a shim keyed only on
    // "receiver is gone" leaves the state a SIGKILLed Chrome produces, which is
    // the state the standard `pkill -f chromiumoxide-runner` fix CREATES.
    const r = runShim('dead-daemon');
    assert.equal(r.status, 0);
    assert.equal(r.calls, 2);
    assert.equal(r.resets, 1);
  });

  it('gives up after one retry rather than looping', () => {
    const r = runShim('persist', ['eval', 'x']);
    assert.notEqual(r.status, 0);
    assert.equal(r.calls, 2, 'exactly one retry, not a loop');
    assert.match(r.stderr, /receiver is gone/, 'the real error must still surface');
  });

  it('does not retry an unrelated failure, and preserves its exit code', () => {
    // A blanket retry would turn every genuine "no" — bad selector, unreachable
    // URL — into a slow one, and mask real breakage behind a daemon restart.
    const r = runShim('other');
    assert.equal(r.status, 3, 'exit code passes through unchanged');
    assert.equal(r.calls, 1, 'must not retry');
    assert.equal(r.resets, 0, 'must not touch the daemon');
  });

  it('passes binary stdout through byte-exact', () => {
    // screenshot and page-source emit raw bytes. Only stderr is captured for
    // signature matching; routing stdout through a shell variable would corrupt
    // and buffer it.
    const r = runShim('binary', ['screenshot']);
    assert.equal(r.status, 0);
    assert.deepEqual(
      r.stdout,
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03]),
    );
  });

  it('passes straight through when auto-heal is opted out', () => {
    fs.rmSync(countFile, { force: true });
    fs.rmSync(hookFile, { force: true });
    let status = 0;
    try {
      execFileSync(SHIM, ['navigate', 'x'], {
        env: {
          ...process.env,
          GSD_BROWSER_BIN: stub,
          GSD_BROWSER_RESET_HOOK: hook,
          GSD_BROWSER_NO_AUTOHEAL: '1',
          STUB_MODE: 'heal',
          STUB_COUNT: countFile,
          HOOK_FILE: hookFile,
        },
        stdio: 'pipe',
      });
    } catch (err) {
      status = err.status ?? 1;
    }
    assert.equal(status, 1, 'the first failure is returned as-is');
    assert.equal(Number(fs.readFileSync(countFile, 'utf8').trim()), 1, 'no retry');
    assert.equal(fs.existsSync(hookFile), false, 'no reset');
  });
});

describe('gsd-browser shim sweeps what `daemon stop` leaves behind', () => {
  // `daemon stop` prints "Daemon stopped." and exits 0 while stopping neither
  // half. Measured against the live install on 2026-09-05: 11 orphaned daemons
  // and 2 automation Chromes before the call, the identical 11 and 2 after it.
  // The manifest shows why it cannot do better — `daemonPid` is null, so stop
  // has no pid to signal, and `browserPid` is recorded and then never used.
  //
  // This matters beyond tidiness: an orphaned Chrome keeps a VALID SingletonLock
  // on the profile, which is exactly the state that refuses every future daemon
  // (wedge C). The thing the user asked to stop is what wedges the next start.

  it('sweeps after a successful `daemon stop`', () => {
    const r = runShim('stop-ok', ['daemon', 'stop']);
    assert.equal(r.status, 0);
    assert.equal(r.calls, 1, 'stop is not retried — it succeeded');
    assert.equal(r.resets, 1, 'the orphans stop leaves behind must be swept');
  });

  it('still sweeps when stop carries an option', () => {
    for (const args of [['--json', 'daemon', 'stop'], ['daemon', 'stop', '--json']]) {
      assert.equal(runShim('stop-ok', args).resets, 1, `should sweep: ${args.join(' ')}`);
    }
  });

  it('sweeps only `daemon stop`, not every successful command', () => {
    // The sweep SIGKILLs both halves. Firing it after `daemon start` would kill
    // the daemon that command just started.
    for (const args of [['daemon', 'start'], ['daemon', 'health'], ['navigate', 'x'], ['stop', 'daemon']]) {
      assert.equal(runShim('stop-ok', args).resets, 0, `must not sweep: ${args.join(' ')}`);
    }
  });

  it('does not sweep when the stop FAILED', () => {
    // A failed stop has not established that anything should be torn down, and
    // killing both halves would destroy the state needed to diagnose it.
    const r = runShim('other', ['daemon', 'stop']);
    assert.equal(r.status, 3, 'the real exit code must survive');
    assert.equal(r.resets, 0);
  });

  it('does not sweep a session or a browser the default manifest does not describe', () => {
    // `--session` has its own daemon and its own profile; `--cdp-url` is a
    // browser we attached to rather than launched. Sweeping the default profile
    // on either kills the wrong thing.
    for (const args of [
      ['--session', 'foo', 'daemon', 'stop'],
      ['daemon', '--session', 'foo', 'stop'],
      ['--cdp-url', 'ws://127.0.0.1:9222', 'daemon', 'stop'],
    ]) {
      assert.equal(runShim('stop-ok', args).resets, 0, `must not sweep: ${args.join(' ')}`);
    }
  });

  it('refuses to treat an option VALUE as the subcommand', () => {
    // `--browser-path /path/to/chrome daemon stop` puts a non-option token
    // first. The match fails and nothing is swept — the safe way to be wrong.
    const r = runShim('stop-ok', ['--browser-path', '/Applications/Chrome', 'daemon', 'stop']);
    assert.equal(r.resets, 0);
  });
});

describe('gsd-browser shim never SIGKILLs a browser that is not its own', () => {
  // The sweep's pattern is `user-data-dir=<profile>` read from the manifest.
  // When the daemon was told to ATTACH to a running Chrome (`--cdp-url`), that
  // profile is the USER'S — so the pkill, the SingletonLock removal and the
  // Preferences rewrite would all land on their real, logged-in session.
  //
  // The guard is asserted against the shipped source rather than a copy: the
  // function is extracted from bin/gsd-browser itself, so a rename or a change
  // of logic fails here instead of silently going untested.
  const guard = fs.readFileSync(SHIM, 'utf8')
    .split('\n')
    .reduce((acc, line) => {
      if (line.startsWith('browser_is_ours() {')) acc.on = true;
      if (acc.on) acc.out.push(line);
      if (acc.on && line === '}') acc.on = false;
      return acc;
    }, { on: false, out: [] }).out.join('\n');

  /** Ask the real guard whether it would kill this browser. */
  const wouldKill = (profile, launchMode) => {
    const script = `${guard}\nCHROME_PROFILE=$1 LAUNCH_MODE=$2\nbrowser_is_ours && echo KILL || echo SPARE`;
    return execFileSync('bash', ['-c', script, 'bash', profile, launchMode], { encoding: 'utf8' }).trim();
  };

  it('extracted the guard from the shim', () => {
    assert.match(guard, /^browser_is_ours\(\) \{/, 'guard not found in bin/gsd-browser');
  });

  it('kills a browser it launched into its own profile', () => {
    assert.equal(wouldKill(`${os.homedir()}/.gsd-browser/browser-profile`, 'launched'), 'KILL');
  });

  it('kills when launchMode is absent, so older installs still self-heal', () => {
    // Gating on the field being PRESENT would turn the autoheal reset into a
    // silent no-op on exactly the installs that predate it. The path decides;
    // launchMode only ever vetoes.
    assert.equal(wouldKill(`${os.homedir()}/.gsd-browser/browser-profile`, ''), 'KILL');
  });

  it("spares the user's real Chrome profile, whatever launchMode says", () => {
    const real = `${os.homedir()}/Library/Application Support/Google/Chrome`;
    for (const mode of ['attached', 'launched', '']) {
      assert.equal(wouldKill(real, mode), 'SPARE', `must spare the real profile (launchMode=${mode || 'absent'})`);
    }
  });

  it('spares an explicitly attached browser even inside its own tree', () => {
    assert.equal(wouldKill(`${os.homedir()}/.gsd-browser/browser-profile`, 'attached'), 'SPARE');
  });
});
