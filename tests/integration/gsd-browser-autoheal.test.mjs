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
