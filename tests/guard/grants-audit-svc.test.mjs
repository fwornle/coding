/**
 * The host guard's pure parts: signed grants (lib/guard/grants.mjs), the
 * hash-chained audit log (lib/guard/audit.mjs) and the `coding svc` vocabulary
 * (lib/guard/svc.mjs). Plan: .planning/guardrail-hardening.md, Phase 1 item 2.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { signGrant, verifyGrant, grantCovers, canonicalJson, expiryFor, CALL_TTL_MS } from '../../lib/guard/grants.mjs';
import { appendAudit, verifyAudit } from '../../lib/guard/audit.mjs';
import { svcPlan, parsePrograms, resolveProgram, SvcError } from '../../lib/guard/svc.mjs';
import { exposesGuardHome } from '../../lib/guard/home.mjs';

const pair = () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { priv: privateKey.export({ type: 'pkcs8', format: 'pem' }), pub: publicKey.export({ type: 'spki', format: 'pem' }) };
};
const host = pair();
const request = { id: 'r1', rule: 'no-console-log', session: 'coding-box-claude-7', file: '/w/a.js' };
const NOW = 1_800_000_000_000;

describe('grants', () => {
  test('a signed grant verifies with the host public key', () => {
    const g = signGrant(request, { scope: 'call', privatePem: host.priv, now: NOW });
    assert.equal(verifyGrant(g, host.pub), true);
    assert.equal(g.payload.exp, NOW + CALL_TTL_MS);
  });

  test('any edit of the payload breaks the signature', () => {
    const g = signGrant(request, { scope: 'call', privatePem: host.priv, now: NOW });
    for (const edit of [{ rule: 'other' }, { session: 'x' }, { exp: NOW * 2 }, { scope: 'session' }, { file: null }]) {
      assert.equal(verifyGrant({ ...g, payload: { ...g.payload, ...edit } }, host.pub), false, JSON.stringify(edit));
    }
  });

  test('a grant signed with any other key is refused — the box cannot mint one', () => {
    const forged = signGrant(request, { scope: 'session', privatePem: pair().priv, now: NOW });
    assert.equal(verifyGrant(forged, host.pub), false);
  });

  test('malformed grants are refused, not thrown', () => {
    for (const g of [null, {}, { payload: {} }, { payload: { v: 1, scope: 'call', exp: 1 }, sig: '!!' }]) {
      assert.equal(verifyGrant(g, host.pub), false);
    }
  });

  test('covers: same rule + session, file match or any-file, before expiry', () => {
    const g = signGrant(request, { scope: 'minutes', minutes: 5, privatePem: host.priv, now: NOW });
    const call = { rule: 'no-console-log', session: 'coding-box-claude-7', file: '/w/a.js', now: NOW + 1000 };
    assert.equal(grantCovers(g, call), true);
    assert.equal(grantCovers(g, { ...call, file: '/w/b.js' }), false);
    assert.equal(grantCovers(g, { ...call, session: 'coding-box-claude-8' }), false);
    assert.equal(grantCovers(g, { ...call, rule: 'no-secrets' }), false);
    assert.equal(grantCovers(g, { ...call, now: NOW + 5 * 60_000 }), false);
    const anyFile = signGrant({ ...request, file: null }, { scope: 'call', privatePem: host.priv, now: NOW });
    assert.equal(grantCovers(anyFile, { ...call, file: '/w/b.js' }), true);
  });

  test('scope durations are bounded', () => {
    assert.throws(() => expiryFor('minutes', { minutes: 0 }), /minutes/);
    assert.throws(() => expiryFor('minutes', { minutes: 241 }), /minutes/);
    assert.throws(() => expiryFor('forever'), /unknown scope/);
  });

  test('canonical JSON ignores key order', () => {
    assert.equal(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] }), canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }));
  });
});

describe('audit chain', () => {
  const file = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-audit-')), 'audit.jsonl');

  test('an untouched log verifies', () => {
    const f = file();
    for (let i = 0; i < 5; i++) appendAudit(f, { event: 'e', i });
    assert.deepEqual(verifyAudit(f), { ok: true, entries: 5, brokenAt: null });
  });

  test('editing, deleting or reordering a line is detected at that line', () => {
    const f = file();
    for (let i = 0; i < 5; i++) appendAudit(f, { event: 'e', i });
    const lines = fs.readFileSync(f, 'utf8').trim().split('\n');

    fs.writeFileSync(f, `${lines.map((l, i) => (i === 2 ? l.replace('"i":2', '"i":9') : l)).join('\n')}\n`);
    assert.equal(verifyAudit(f).brokenAt, 3);

    fs.writeFileSync(f, `${lines.filter((_, i) => i !== 1).join('\n')}\n`);
    assert.equal(verifyAudit(f).brokenAt, 2);

    fs.writeFileSync(f, `${[lines[1], lines[0], ...lines.slice(2)].join('\n')}\n`);
    assert.equal(verifyAudit(f).brokenAt, 1);
  });

  test('the log file is private to the user', { skip: process.platform === 'win32' }, () => {
    const f = file();
    appendAudit(f, { event: 'e' });
    assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  });
});

describe('svc vocabulary', () => {
  const programs = parsePrograms([
    'backend-services:graphify          RUNNING   pid 1, uptime 1:00:00',
    'web-services:health-dashboard      RUNNING   pid 2, uptime 1:00:00',
    'backend-services:semantic-analysis STOPPED   Nov 07 05:00 PM',
  ].join('\n'));
  const ctx = { programs, codingRepo: '/repo' };

  test('program names come out of supervisorctl status', () => {
    assert.deepEqual(programs, ['backend-services:graphify', 'web-services:health-dashboard', 'backend-services:semantic-analysis']);
    assert.equal(resolveProgram('graphify', programs), 'backend-services:graphify');
  });

  test('restart only names a known program, through supervisorctl', () => {
    assert.deepEqual(svcPlan('restart', ['health-dashboard'], ctx).steps,
      [['exec', 'coding-services', 'supervisorctl', 'restart', 'web-services:health-dashboard']]);
    assert.throws(() => svcPlan('restart', ['all'], ctx), SvcError);
    assert.throws(() => svcPlan('restart', ['graphify; rm -rf /'], ctx), SvcError);
  });

  test('logs: a known container or program, bounded line count', () => {
    assert.deepEqual(svcPlan('logs', ['coding-qdrant', '50'], ctx).steps, [['logs', '--tail', '50', 'coding-qdrant']]);
    assert.equal(svcPlan('logs', ['graphify'], ctx).steps[0][3], 'tail');
    assert.throws(() => svcPlan('logs', ['some-other-container'], ctx), SvcError);
    assert.throws(() => svcPlan('logs', ['coding-redis', '999999'], ctx), SvcError);
  });

  test('graphify: read/update verbs only', () => {
    assert.deepEqual(svcPlan('graphify', ['query', 'who calls X'], ctx).steps,
      [['exec', 'coding-services', 'graphify', 'query', 'who calls X']]);
    for (const sub of ['install', 'clone', 'add', 'watch', 'merge-driver', undefined]) {
      assert.throws(() => svcPlan('graphify', sub ? [sub] : [], ctx), SvcError, String(sub));
    }
  });

  test('up and rebuild are gated and take no arguments', () => {
    assert.equal(svcPlan('up', [], ctx).gated, true);
    assert.equal(svcPlan('rebuild', [], ctx).gated, true);
    assert.equal(svcPlan('status', [], ctx).gated, false);
    assert.throws(() => svcPlan('up', ['-v', '/:/host'], ctx), SvcError);
  });

  test('nothing outside the vocabulary — and no step ever mounts, runs an image or execs a shell', () => {
    for (const verb of ['run', 'exec', 'cp', 'build', 'compose']) assert.throws(() => svcPlan(verb, [], ctx), SvcError);
    for (const verb of ['status', 'up', 'rebuild']) {
      for (const argv of svcPlan(verb, [], ctx).steps) {
        assert.ok(!argv.includes('run') && !argv.includes('-v') && !argv.includes('sh') && !argv.includes('bash'), argv.join(' '));
      }
    }
  });
});

describe('guard home exposure', () => {
  test('a mount of the guard dir or any ancestor exposes it; siblings do not', () => {
    const g = '/Users/u/.coding/guard';
    for (const d of ['/Users/u', '/Users/u/.coding', g, '/']) assert.equal(exposesGuardHome(d, g), true, d);
    for (const d of ['/Users/u/proj', '/Users/u/.coding/data', '/Users/u/.coding/guardian']) assert.equal(exposesGuardHome(d, g), false, d);
  });
});
