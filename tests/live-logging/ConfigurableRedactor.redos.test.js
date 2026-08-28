/**
 * Guards the redaction patterns against catastrophic backtracking.
 *
 * WHY THIS EXISTS: `aws_secret_truncated` was written as
 *   [a-zA-Z0-9+/]{8,}\+[a-zA-Z0-9+/]*\.{2,3}
 * whose LEADING class contains `+` — the very character the literal `\+` in the
 * middle is meant to anchor on. Every position in a long base64-ish run becomes
 * an ambiguous split point, so the engine backtracks over all of them.
 *
 * That is not a slow regex, it is a cliff: 100 KB took 130 ms, 200 KB took
 * 239 ms, and 400 KB did not finish in 300 s. redact() runs on every exchange
 * the ETM writes, on the main thread. A session containing one long base64 run
 * (a git SHA blob, an embedded payload, a big tool output) pinned the ETM at
 * 96% CPU indefinitely. The process stayed ALIVE, so `ps` and the service
 * health checks looked fine — but the heartbeat stopped, the coordinator
 * inferred `stopped` after 15 s, and the statusline showed LSL red while
 * writing no session log for over an hour.
 *
 * The test is a time bound rather than a pattern assertion so it keeps holding
 * for patterns added later, which is where the next one of these will come from.
 *
 * Run via: node --test tests/live-logging/ConfigurableRedactor.redos.test.js
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import ConfigurableRedactor from '../../src/live-logging/ConfigurableRedactor.js';

const REPO = path.resolve(import.meta.dirname, '../..');

/** The shape that triggers it: a long unbroken base64-ish run, no terminator. */
const adversarial = (n) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let s = '';
  while (s.length < n) s += alphabet;
  return s.slice(0, n);
};

let redactor;

before(async () => {
  redactor = new ConfigurableRedactor({ projectPath: REPO });
  await redactor.initialize();
});

describe('ConfigurableRedactor — backtracking safety', () => {
  it('redacts a 400 KB base64-like run well inside the ETM heartbeat window', () => {
    // The coordinator infers `stopped` after 15 s of silence. Anything close to
    // that is already a production outage, so the budget is deliberately tight.
    const t0 = Date.now();
    redactor.redact(adversarial(400_000));
    const ms = Date.now() - t0;
    assert.ok(ms < 5000, `redact() took ${ms}ms on 400 KB; the old pattern never finished`);
  });

  it('scales roughly linearly rather than falling off a cliff', () => {
    const time = (n) => {
      const s = adversarial(n);
      const t0 = Date.now();
      redactor.redact(s);
      return Math.max(1, Date.now() - t0);
    };
    const small = time(100_000);
    const large = time(400_000);
    // 4x the input must not cost wildly more than 4x the time. The defect showed
    // as >1000x here.
    assert.ok(large / small < 40,
      `4x input cost ${(large / small).toFixed(1)}x time (${small}ms -> ${large}ms)`);
  });

  it('still redacts a genuine truncated AWS secret', () => {
    const out = redactor.redact('key=wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY...');
    assert.ok(!out.includes('bPxRfiCYEXAMPLEKEY'), `secret survived redaction: ${out}`);
  });

  /**
   * `aws_secret_standalone` was (?<![A-Za-z0-9+/])[A-Za-z0-9+/]{40}(?![A-Za-z0-9+/])
   * — ANY 40-character token. A git SHA is exactly 40 hex characters, so every
   * commit id in the corpus was rewritten to <AWS_SECRET_REDACTED> at WRITE
   * time; this repo's LSL still contains `<AWS_SECRET_REDACTED>\trefs/heads/main`
   * where an ls-remote result used to be.
   *
   * Narrowed by excluding pure lowercase hex, which is what git emits. An AWS
   * secret key is 40 base64 characters, so the odds of a real one being all
   * lowercase hex are (16/62)^40 — the exclusion costs no realistic coverage.
   * Uppercase hex is deliberately still redacted: git does not produce it.
   */
  it('does not redact a plain git SHA', () => {
    const sha = '3d579b5c512f41bf8ce4806d4e57e69454b0a50e';
    assert.ok(redactor.redact(`commit ${sha}`).includes(sha), 'false positive on a git SHA');
  });

  it('still redacts a 40-char AWS secret key', () => {
    for (const key of ['wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEYab',
      'wJal+XUtnFEMI/K7MDENGbPxRfiCYEXAMPLEKEYa']) {
      assert.ok(!redactor.redact(`key=${key}`).includes(key), `secret survived: ${key}`);
    }
  });
});
