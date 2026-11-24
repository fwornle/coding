/**
 * The team-pooled job-class gate, coding's side (.planning/shared-job-classes.md,
 * P6): publish this member's gate COUNTS into the team's package, as
 * `job-classes/gate/<pseudonym>.json`. Counts only, never a prompt; the format,
 * the pooling and the git steps are rapid-llm-proxy's proxy-bridge/gate-pool.mjs,
 * shared with glass.
 *
 * Where the package lives decides who pushes:
 *   linked  this member's own learning checkout — committed here, pushed only by
 *           `coding sync --push` (it also carries transcripts, so it asks first)
 *   shared  a pull-only clone of a teammate's repo under var/shared/ — members
 *           have write access (P6 decision), and the clone carries nothing else,
 *           so `--push` pushes it here, rebasing once over a teammate's push
 *
 * The first publish is the opt-in: `coding sync --push` re-publishes only for
 * teams this member has published to before (`hasPublished`).
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { gitRunner, teamPackage } from './evolve.mjs';

const require = createRequire(import.meta.url);
const { proxyDir, openDb } = require('../proxy/proxy-paths.cjs');
const dataHome = require('../paths/data-home.cjs');
const teamsConfig = require('../teams/config.cjs');

async function proxyModule(name) {
  const file = path.join(proxyDir(), 'proxy-bridge', name);
  if (!fs.existsSync(file)) throw new Error(`${file} is missing: update the rapid-llm-proxy checkout (team gate needs proxy-bridge/gate-pool.mjs)`);
  return import(pathToFileURL(file).href);
}

/** This member's pseudonym, by gate-pool's rule (the same hash as P3's memberId). */
export async function gateMember(opts = {}) {
  const gp = await proxyModule('gate-pool.mjs');
  return gp.memberId({ ...(opts.hostname ? { hostname: opts.hostname } : {}), ...(opts.user ? { user: opts.user } : {}) });
}

/** Teams bound to a job-class package on this machine. */
export function boundTeams(opts = {}) {
  const doc = opts.teamsDoc || teamsConfig.loadTeams(opts);
  return Object.entries(doc.teams || {}).filter(([, t]) => t?.jobClasses?.repo).map(([id]) => id).sort();
}

/** Whether this member has published to `team` before: its file is in the package. */
export async function hasPublished(team, opts = {}) {
  const gp = await proxyModule('gate-pool.mjs');
  const pkg = teamPackage(team, opts);
  const dir = gp.gateDirOf(pkg.file);
  return !!dir && fs.existsSync(path.join(dir, `${await gateMember(opts)}.json`));
}

/**
 * Write (and commit; with `push`, push a shared clone) this member's gate counts
 * for `team`.
 *
 * @param {{team: string, push?: boolean, tokenDb?: string, now?: Date}} o  (+ teams/paths opts)
 * @returns {Promise<{team: string, tag: string, member: string, state: string, pools: number,
 *   file: string, changed: boolean, committed: boolean, pushed: boolean, pushLater?: boolean, error?: string}>}
 */
export async function publishTeamGate({ team, push = false, ...opts }) {
  // `now` as the evolve fixtures pass it (a function) or a Date.
  const now = typeof opts.now === 'function' ? new Date(opts.now()) : opts.now instanceof Date ? opts.now : undefined;
  const id = String(team || '').toLowerCase();
  if (!id) throw new Error('--team <id> is required');
  const gp = await proxyModule('gate-pool.mjs');
  const jc = await proxyModule('job-class.mjs');
  const pkg = teamPackage(id, opts);
  if (pkg.state === 'missing') throw new Error(`team ${id}'s package is not on this machine (${pkg.dir}): coding sync pull`);
  const tax = jc.loadTaxonomy(pkg.file);
  const gateDir = gp.gateDirOf(pkg.file);
  const dbFile = opts.tokenDb || dataHome.tokenUsageDb(opts);
  if (!fs.existsSync(dbFile)) throw new Error(`no token DB at ${dbFile}: nothing labelled on this machine`);
  const db = openDb(dbFile, { readonly: true, fileMustExist: true });
  let pools;
  try { pools = gp.gateSnapshot({ db, tax, ...(now ? { now } : {}) }); } finally { try { db.close(); } catch { /* closed */ } }
  const member = await gateMember(opts);
  const pushHere = push && pkg.state === 'shared';
  const r = await gp.publishGate({ checkout: pkg.checkout, gateDir, member, pools, push: pushHere, git: gitRunner(pkg.checkout), ...(now ? { now } : {}) });
  return { team: id, tag: tax.tag, member, state: pkg.state, pools: pools.length, ...r, ...(push && pkg.state === 'linked' ? { pushLater: true } : {}) };
}

/**
 * `coding sync --push`: re-publish for every team this member has published to
 * before (the first publish, by hand, is the opt-in). Never throws: a gate that
 * cannot be published is reported, and the sync goes on.
 *
 * @returns {Promise<Array<{team: string, changed?: boolean, committed?: boolean, pushed?: boolean, error?: string}>>}
 */
export async function republishGates({ push = false, ...opts } = {}) {
  const out = [];
  let teams = [];
  try { teams = boundTeams(opts); } catch (err) { return [{ team: '*', error: err.message }]; }
  for (const team of teams) {
    try {
      if (!(await hasPublished(team, opts))) continue;
      out.push(await publishTeamGate({ team, push, ...opts }));
    } catch (err) {
      out.push({ team, error: err.message });
    }
  }
  return out;
}
