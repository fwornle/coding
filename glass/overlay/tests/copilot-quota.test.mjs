// tests/copilot-quota.test.mjs — GitHub's month-to-date Copilot count: which host
// is asked, what a reply turns into, and that a failure is a status, never a zero.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { createCopilotQuota, githubHostOf, parseQuota } = await import('../lib/glass/copilot-quota.mjs');

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
  assert.deepEqual(calls, [['--hostname', 'acme.ghe.com', '/copilot_internal/user']]);
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
  assert.deepEqual(calls[0], ['--hostname', 'git.example.com', '/copilot_internal/user']);
  assert.equal(v.quota, null);
  assert.equal(v.error, 'gh is not installed');
});

test('copilotQuota: false makes no call', async () => {
  let called = false;
  const q = createCopilotQuota({ statePath: statePath(), config: { copilotQuota: false }, env: () => ({}), run: async () => { called = true; return { ok: true, stdout: '{}' }; } });
  const v = await q.refresh({ force: true });
  assert.equal(called, false);
  assert.equal(v.enabled, false);
});
