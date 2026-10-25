// lib/glass/copilot-quota.mjs
//
// GitHub's own count of the account's Copilot use this month — the figure VS
// Code's Copilot menu shows as "Credits n% used". It covers every client of the
// account (VS Code, the CLI agents, github.com, other machines, background jobs),
// so next to what glass measured it tells how much glass did not see, without the
// organisation's billing export, which most users never get.
//
// Read-only and out of every agent's path: one `gh api /copilot_internal/user`
// (the endpoint VS Code itself calls), at most every 15 minutes while the daemon
// runs. `gh` holds the login and sends it; glass never reads or stores a token.
// No gh, no login for the host, or an answer without a quota: the view says so
// and nothing else changes. ~/.glass/config.json { "copilotQuota": false } stops
// the read; { "githubHost": "<host>" } names the GitHub host when glass cannot
// tell it from the Copilot traffic it measured.
//
// The endpoint is internal to GitHub (undocumented): it may change, and a reply
// glass does not recognise reads as "unavailable", never as zero use.

import fs from 'node:fs';
import { execFile } from 'node:child_process';

export const QUOTA_REFRESH_MS = 15 * 60_000;
const MIN_FORCED_REFRESH_MS = 60_000;
/** GitHub bills Copilot in AI credits of $0.01. */
export const CREDIT_USD = 0.01;

/** The GitHub host a Copilot API host belongs to: copilot-api.acme.ghe.com → acme.ghe.com. */
export function githubHostOf(apiHost) {
  const h = String(apiHost || '').toLowerCase();
  const ghe = /^copilot-api\.(.+\.ghe\.com)$/.exec(h);
  if (ghe) return ghe[1];
  if (/(^|\.)githubcopilot\.com$/.test(h)) return 'github.com';
  return '';
}

/**
 * The parts of a /copilot_internal/user reply glass shows, or null when it carries
 * no metered quota (unlimited, or a shape glass does not know).
 */
export function parseQuota(body) {
  const snap = body?.quota_snapshots?.premium_interactions;
  if (!snap || typeof snap !== 'object' || snap.unlimited === true) return null;
  const used = Number(snap.credits_used ?? (Number(snap.entitlement) - Number(snap.remaining)));
  const entitlement = Number(snap.entitlement);
  if (!Number.isFinite(used) || !Number.isFinite(entitlement)) return null;
  return {
    plan: typeof body.copilot_plan === 'string' ? body.copilot_plan : '',
    tokenBased: body.token_based_billing === true || snap.token_based_billing === true,
    creditsUsed: used,
    entitlement,
    usedUsd: Math.round(used * CREDIT_USD * 100) / 100,
    percentUsed: entitlement > 0 ? Math.round((used / entitlement) * 1000) / 10 : null,
    overageCount: Number(snap.overage_count) || 0,
    overagePermitted: snap.overage_permitted === true,
    resetDate: typeof body.quota_reset_date === 'string' ? body.quota_reset_date : '',
    asOf: typeof snap.timestamp_utc === 'string' ? snap.timestamp_utc : '',
  };
}

/** `gh api` as a promise: { ok, stdout, error }. Never rejects. */
function ghApi(args, env, timeoutMs = 20_000) {
  return new Promise((resolve) => {
    execFile('gh', ['api', ...args], { env, timeout: timeoutMs, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
      if (err) {
        const missing = err.code === 'ENOENT';
        resolve({ ok: false, error: missing ? 'gh is not installed' : (String(stderr || err.message).trim().split('\n')[0] || 'gh failed') });
      } else resolve({ ok: true, stdout });
    });
  });
}

/**
 * @param {{ statePath: string, config?: object, env?: () => object, run?: typeof ghApi, now?: () => number, log?: Function }} deps
 */
export function createCopilotQuota({ statePath, config = {}, env = () => process.env, run = ghApi, now = Date.now, log = () => {} }) {
  const enabled = config.copilotQuota !== false;
  let state = { host: '', seenHost: '', fetchedAt: 0, quota: null, error: '' };
  try { state = { ...state, ...JSON.parse(fs.readFileSync(statePath, 'utf8')) }; } catch { /* first run */ }
  let inflight = null;

  const save = () => {
    try { fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`); } catch { /* best effort */ }
  };
  const hostToAsk = () => (typeof config.githubHost === 'string' && config.githubHost)
    || env().GH_HOST || state.seenHost || '';

  /** A Copilot API host glass just measured traffic to — the account's GitHub host. */
  function noteApiHost(apiHost) {
    const host = githubHostOf(apiHost);
    if (!host || host === state.seenHost) return;
    state.seenHost = host;
    save();
  }

  async function refresh({ force = false } = {}) {
    if (!enabled) return view();
    const age = now() - state.fetchedAt;
    if (inflight) return inflight;
    if (age < (force ? MIN_FORCED_REFRESH_MS : QUOTA_REFRESH_MS)) return view();
    inflight = (async () => {
      const host = hostToAsk();
      // No known host: gh's default one — shown with its host and plan, so a
      // personal github.com plan is never mistaken for the work account.
      const args = host ? ['--hostname', host, '/copilot_internal/user'] : ['/copilot_internal/user'];
      const r = await run(args, env());
      state.fetchedAt = now();
      state.host = host || 'gh default host';
      if (!r.ok) {
        state.error = r.error;
      } else {
        let body = null;
        try { body = JSON.parse(r.stdout); } catch { /* below */ }
        const quota = parseQuota(body);
        state.quota = quota;
        state.error = quota ? '' : 'no metered Copilot quota in the reply';
      }
      if (state.error) log(`copilot quota (${state.host}): ${state.error}`);
      save();
      return view();
    })().finally(() => { inflight = null; });
    return inflight;
  }

  function view() {
    return {
      enabled,
      host: state.host || hostToAsk() || '',
      fetchedAt: state.fetchedAt ? new Date(state.fetchedAt).toISOString() : null,
      quota: state.quota,
      error: enabled ? state.error : 'switched off (copilotQuota: false)',
    };
  }

  return { refresh, view, noteApiHost };
}
