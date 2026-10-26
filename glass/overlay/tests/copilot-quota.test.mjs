// tests/copilot-quota.test.mjs — GitHub's month-to-date Copilot count: which host
// is asked, what a reply turns into, and that a failure is a status, never a zero.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { createCopilotQuota, githubHostOf, parseQuota, ghDoctorLines, ghEnvIn } = await import('../lib/glass/copilot-quota.mjs');

// The shape of a Business account on token-based billing (2026-10-25), trimmed.
const REPLY = {
  copilot_plan: 'business',
  quota_reset_date: '2026-11-01',
  token_based_billing: true,
  quota_snapshots: {
    chat: { unlimited: true, entitlement: 0, credits_used: 0 },
    premium_interactions: {
      credits_used: 25000, entitlement: 100000, remaining: 75000, overage_count: 0,
      overage_permitted: true, unlimited: false, token_based_billing: true, timestamp_utc: '2026-10-25T06:27:29.755Z',
    },
  },
};

const statePath = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glass-quota-')), 'copilot-quota.json');

test('the GitHub host behind a Copilot API host', () => {
  assert.equal(githubHostOf('copilot-api.acme.ghe.com'), 'acme.ghe.com');
  assert.equal(githubHostOf('api.githubcopilot.com'), 'github.com');
  assert.equal(githubHostOf('api.business.githubcopilot.com'), 'github.com');
  assert.equal(githubHostOf('api.openai.com'), '');
});

test('a metered reply becomes credits, dollars and a share of the entitlement', () => {
  assert.deepEqual(parseQuota(REPLY), {
    plan: 'business', tokenBased: true, creditsUsed: 25000, entitlement: 100000, usedUsd: 250,
    percentUsed: 25, overageCount: 0, overagePermitted: true, resetDate: '2026-11-01', asOf: '2026-10-25T06:27:29.755Z',
  });
});

test('no metered quota, or a shape glass does not know, is no figure at all', () => {
  assert.equal(parseQuota({ quota_snapshots: { premium_interactions: { unlimited: true } } }), null);
  // A personal plan without Copilot credits is not "GitHub reports $0".
  assert.equal(parseQuota({ copilot_plan: 'individual', quota_snapshots: { premium_interactions: { credits_used: 0, entitlement: 0, unlimited: false } } }), null);
  assert.equal(parseQuota({}), null);
  assert.equal(parseQuota(null), null);
});

test('asks gh for the host seen on the wire, then caches the answer', async () => {
  const calls = [];
  const run = async (args) => { calls.push(args); return { ok: true, stdout: JSON.stringify(REPLY) }; };
  let t = 1_000_000;
  const q = createCopilotQuota({ statePath: statePath(), env: () => ({}), run, now: () => t });
  q.noteApiHost('copilot-api.acme.ghe.com');
  const v = await q.refresh();
  assert.deepEqual(calls, [['api', '--hostname', 'acme.ghe.com', '/copilot_internal/user']]);
  assert.equal(v.host, 'acme.ghe.com');
  assert.equal(v.quota.usedUsd, 250);
  assert.equal(v.error, '');
  t += 60_000;
  await q.refresh();
  assert.equal(calls.length, 1, 'within 15 min the cached answer is served');
  await q.refresh({ force: true });
  assert.equal(calls.length, 2, 'a forced refresh may ask again after a minute');
});

test("gh's own state goes under glass's run dir, not the user's home", async () => {
  let seen = null;
  const file = statePath();
  const q = createCopilotQuota({ statePath: file, env: () => ({ HOME: '/home/u', GH_HOST: 'acme.ghe.com' }), run: async (_a, e) => { seen = e; return { ok: true, stdout: JSON.stringify(REPLY) }; } });
  await q.refresh();
  const dir = path.join(path.dirname(file), 'gh');
  assert.equal(seen.XDG_STATE_HOME, path.join(dir, 'state'));
  assert.equal(seen.XDG_CACHE_HOME, path.join(dir, 'cache'));
  assert.equal(seen.XDG_CONFIG_HOME, undefined, 'the login stays where gh keeps it');
  assert.equal(seen.GH_NO_UPDATE_NOTIFIER, '1');
  assert.equal(seen.HOME, '/home/u');
});

test('githubHost in config wins; a failed call is reported, not read as zero use', async () => {
  const calls = [];
  const run = async (args) => { calls.push(args); return { ok: false, error: 'gh is not installed' }; };
  const q = createCopilotQuota({ statePath: statePath(), config: { githubHost: 'git.example.com' }, env: () => ({}), run });
  q.noteApiHost('copilot-api.acme.ghe.com');
  const v = await q.refresh();
  assert.deepEqual(calls[0], ['api', '--hostname', 'git.example.com', '/copilot_internal/user']);
  assert.equal(v.quota, null);
  assert.equal(v.error, 'gh is not installed');
});

test('no host known: every host gh is logged in to, enterprise first, until a metered account answers', async () => {
  const calls = [];
  const run = async (args) => {
    calls.push(args.join(' '));
    if (args[0] === 'auth') {
      return { ok: true, stdout: JSON.stringify({ hosts: { 'github.com': [{ state: 'success' }], 'broken.example': [{ state: 'error' }], 'acme.ghe.com': [{ state: 'success' }] } }) };
    }
    return { ok: true, stdout: JSON.stringify(args.includes('acme.ghe.com') ? REPLY : { copilot_plan: 'individual' }) };
  };
  const file = statePath();
  const q = createCopilotQuota({ statePath: file, env: () => ({}), run });
  const v = await q.refresh();
  assert.deepEqual(calls, ['auth status --json hosts', 'api --hostname acme.ghe.com /copilot_internal/user']);
  assert.equal(v.host, 'acme.ghe.com');
  assert.equal(v.quota.creditsUsed, 25000);
  // The next daemon asks it directly.
  const again = createCopilotQuota({ statePath: file, env: () => ({}), run, now: () => Date.now() + 3_600_000 });
  calls.length = 0;
  await again.refresh();
  assert.deepEqual(calls, ['api --hostname acme.ghe.com /copilot_internal/user']);
});

test('copilotQuota: false makes no call', async () => {
  let called = false;
  const q = createCopilotQuota({ statePath: statePath(), config: { copilotQuota: false }, env: () => ({}), run: async () => { called = true; return { ok: true, stdout: '{}' }; } });
  const v = await q.refresh({ force: true });
  assert.equal(called, false);
  assert.equal(v.enabled, false);
});

test('glass doctor: no gh is a warning that names what is missing', () => {
  const lines = ghDoctorLines({ ghPath: null, host: 'acme.ghe.com' });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^ {2}! gh: not installed — GitHub's own Copilot figure \(Cost tab\) and glass update are unavailable/);
  assert.match(lines[0], /gh auth login --hostname acme\.ghe\.com$/);
});

test('glass doctor: gh without a login, with a login, and a login it cannot read', () => {
  const none = ghDoctorLines({ ghPath: '/bin/gh', auth: { ok: true, stdout: JSON.stringify({ hosts: { 'acme.ghe.com': [{ state: 'error' }] } }) }, host: 'acme.ghe.com' });
  assert.match(none[0], /^ {2}! gh: \/bin\/gh — not logged in to any GitHub host/);
  const ok = ghDoctorLines({ ghPath: '/bin/gh', auth: { ok: true, stdout: JSON.stringify({ hosts: { 'github.com': [{ state: 'success' }], 'acme.ghe.com': [{ state: 'success' }] } }) }, host: 'acme.ghe.com' });
  assert.deepEqual(ok, ['  ✓ gh: /bin/gh (logged in: acme.ghe.com, github.com)']);
  const old = ghDoctorLines({ ghPath: '/bin/gh', auth: { ok: false, error: 'unknown flag: --json' }, host: 'acme.ghe.com' });
  assert.match(old[0], /could not read its logins \(unknown flag: --json\)/);
});

test("glass doctor: what became of the daemon's last read", () => {
  const auth = { ok: true, stdout: JSON.stringify({ hosts: { 'acme.ghe.com': [{ state: 'success' }] } }) };
  const read = ghDoctorLines({ ghPath: '/bin/gh', auth, host: 'h', view: { host: 'acme.ghe.com', fetchedAt: '2026-10-26T08:00:00.000Z', quota: parseQuota(REPLY), error: '' } });
  assert.equal(read[1], "    GitHub's own Copilot figure: read from acme.ghe.com at 2026-10-26T08:00:00.000Z");
  assert.ok(!read.join('\n').includes('25000'), 'no usage figure on the console');
  const failed = ghDoctorLines({ ghPath: '/bin/gh', auth, host: 'h', view: { host: 'acme.ghe.com', quota: null, error: 'no metered Copilot quota for the account on acme.ghe.com' } });
  assert.match(failed[1], /^ {4}! GitHub's own Copilot figure unavailable \(acme\.ghe\.com\): no metered/);
  const off = ghDoctorLines({ ghPath: '/bin/gh', auth, host: 'h', config: { copilotQuota: false }, view: { enabled: false, error: 'switched off' } });
  assert.equal(off[1], "    GitHub's own Copilot figure: switched off (copilotQuota: false)");
});

test("gh's state for glass stays in the glass home; its login does not move", () => {
  const e = ghEnvIn('/g/run/gh', { PATH: '/bin', XDG_CONFIG_HOME: '/u/.config' });
  assert.equal(e.XDG_STATE_HOME, path.join('/g/run/gh', 'state'));
  assert.equal(e.XDG_CACHE_HOME, path.join('/g/run/gh', 'cache'));
  assert.equal(e.XDG_CONFIG_HOME, '/u/.config');
  assert.equal(e.GH_PROMPT_DISABLED, '1');
});
