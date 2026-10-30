// lib/glass/job-classes.mjs — job classes in glass, for machines without coding.
//
// What kind of job each human turn is (fix, build, ship, status, explain, …),
// labelled in the background while the turn runs, never in its way. The same
// tagger as coding's proxy (proxy-bridge/job-class.mjs) and the same read side
// (job-class-api.mjs), with three things of glass's own:
//
//   the model     the user's own Copilot account: the student labels every turn,
//                 the teacher re-checks a share of them. Called with the token of
//                 the user's `gh` login for the account's GitHub host (the host the
//                 Copilot quota uses), read from gh per use and never stored.
//   the switch    job-classes.json in GLASS_HOME, OFF until the user turns it on:
//                 off, glass makes no model call of its own for this.
//   the taxonomy  the shipped default (config/job-classes.yaml), or a team's,
//                 cloned from its learning repo (`job-classes/` only).
//
// Every glass session is bound to a task id of its own, so the task binding is
// no sign of an automated run here (skipTaskBound: false); headless `claude -p`
// still is, by its User-Agent.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

import { createJobClassTagger, loadTaxonomy, renderRequest, parseLabel } from '../../proxy/proxy-bridge/job-class.mjs';
import { handleJobClassRead } from '../../proxy/proxy-bridge/job-class-api.mjs';
import { runGh, loggedInHosts } from './copilot-quota.mjs';

export const STUDENT_PROCESS = 'job-class-student';
export const TEACHER_PROCESS = 'job-class-teacher';

const DEFAULTS = {
  enabled: false,
  studentModel: 'claude-haiku-5.5',
  teacherModel: 'claude-sonnet-5',
  // A quarter of the turns is enough for the gate within a few weeks of normal
  // use, at about a third more Copilot use than the student alone.
  teacherSamplePct: 0.25,
  maxInFlight: 2,
  team: null, // { url, dir } once `join` cloned a team's taxonomy
};

export function normalizeJobClassConfig(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const model = (v, d) => (typeof v === 'string' && /^[A-Za-z0-9._:-]{1,80}$/.test(v) ? v : d);
  const pct = Number(r.teacherSamplePct);
  const team = r.team && typeof r.team.url === 'string' && typeof r.team.dir === 'string' ? { url: r.team.url, dir: r.team.dir } : null;
  return {
    enabled: r.enabled === true,
    studentModel: model(r.studentModel, DEFAULTS.studentModel),
    teacherModel: model(r.teacherModel, DEFAULTS.teacherModel),
    teacherSamplePct: Number.isFinite(pct) ? Math.min(Math.max(pct, 0), 1) : DEFAULTS.teacherSamplePct,
    maxInFlight: Math.min(Math.max(Number(r.maxInFlight) || DEFAULTS.maxInFlight, 1), 8),
    team,
  };
}

/** job-classes.json in GLASS_HOME, read per call through an mtime check (a hand edit applies at once). */
export function createJobClassStore(home) {
  const file = path.join(home, 'job-classes.json');
  let cached = null;
  let cachedMtime = -1;
  const mtimeOf = () => { try { return fs.statSync(file).mtimeMs; } catch { return 0; } };

  function get() {
    const m = mtimeOf();
    if (cached && m === cachedMtime) return cached;
    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* none or unreadable → off */ }
    cached = normalizeJobClassConfig(raw);
    cachedMtime = m;
    return cached;
  }

  function update(patch) {
    const next = normalizeJobClassConfig({ ...get(), ...(patch && typeof patch === 'object' ? patch : {}) });
    fs.mkdirSync(home, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, file);
    cached = next;
    cachedMtime = mtimeOf();
    return next;
  }

  return { get, update, file };
}

/**
 * The Copilot chat endpoint for a GitHub host: github.com → api.githubcopilot.com,
 * a GHE.com tenant → copilot-api.<tenant>. A GitHub Enterprise Server host has no
 * Copilot API glass knows of: ''.
 */
export function copilotApiBase(host) {
  const h = String(host || '').toLowerCase();
  if (h === 'github.com') return 'https://api.githubcopilot.com';
  if (h.endsWith('.ghe.com')) return `https://copilot-api.${h}`;
  return '';
}

/**
 * complete({ process, messages }) → { content, provider, model, latencyMs } on the
 * user's Copilot account, the shape the tagger and the measurement expect.
 */
export function createCopilotCompleter({
  host, models, version = '', run = runGh, env = () => process.env, fetch = globalThis.fetch,
  timeoutMs = 30_000, now = Date.now,
}) {
  let cache = { host: '', token: '', at: 0 };

  async function token(h, fresh = false) {
    if (!fresh && cache.host === h && cache.token && now() - cache.at < 10 * 60_000) return cache.token;
    const r = await run(['auth', 'token', '--hostname', h], env());
    const t = r.ok ? String(r.stdout || '').trim() : '';
    if (!t) throw new Error(`gh has no login for ${h} (gh auth login --hostname ${h})`);
    cache = { host: h, token: t, at: now() };
    return t;
  }

  return async function complete({ process: proc, messages }) {
    const h = await host();
    if (!h) throw new Error('no GitHub host: gh is not logged in to any');
    const base = copilotApiBase(h);
    if (!base) throw new Error(`${h} has no Copilot API glass can call`);
    const m = models();
    const model = proc === TEACHER_PROCESS ? m.teacher : m.student;
    const started = now();
    const send = async (t) => fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json', 'user-agent': `glass/${version}` },
      // The answer is a few tokens, but the model may reason first and that counts
      // against the cap: at 40 it ran out before answering (an empty choices list).
      body: JSON.stringify({ model, messages, max_tokens: 1024, temperature: 0 }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    let r = await send(await token(h));
    if (r.status === 401) r = await send(await token(h, true));
    const j = await r.json().catch(() => null);
    if (!r.ok) {
      const code = j?.error?.code || '';
      if (code === 'model_not_supported') throw new Error(`Copilot on ${h} does not offer ${model} to this account`);
      throw new Error(`Copilot on ${h}: HTTP ${r.status}${j?.error?.message ? ` ${j.error.message}` : ''}`);
    }
    if (!j?.choices?.length) throw new Error(`Copilot on ${h} returned no answer (${j?.usage?.completion_tokens ?? '?'} tokens used)`);
    return { content: j.choices[0]?.message?.content ?? '', provider: 'github-copilot', model: j?.model || model, latencyMs: now() - started };
  };
}

const sh = (cmd, args, opts) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: 120_000, maxBuffer: 4 << 20, ...opts }, (err, stdout, stderr) => {
    resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || err?.message || '') });
  });
});

/** The team's taxonomy file inside a clone of its learning repo. */
export const teamTaxonomyFile = (dir) => path.join(dir, 'job-classes', 'taxonomy.yaml');

/**
 * Clone (or update) a team's learning repo, only its `job-classes/` folder, into
 * `dir`, and check the taxonomy can classify. `git` uses the user's own
 * credentials (gh as git's credential helper, or ssh).
 */
export async function syncTeamTaxonomy({ url, dir, git = sh }) {
  if (!/^(https:\/\/|git@|ssh:\/\/)/.test(String(url || ''))) throw new Error('the team repo must be an https:// or ssh git URL');
  if (fs.existsSync(path.join(dir, '.git'))) {
    const r = await git('git', ['-C', dir, 'pull', '--ff-only', '-q']);
    if (!r.ok) throw new Error(`git pull: ${r.stderr.trim().split('\n').pop()}`);
  } else {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    const c = await git('git', ['clone', '-q', '--depth', '1', '--filter=blob:none', '--sparse', url, dir]);
    if (!c.ok) throw new Error(`git clone: ${c.stderr.trim().split('\n').pop()}`);
    const s = await git('git', ['-C', dir, 'sparse-checkout', 'set', 'job-classes']);
    if (!s.ok) throw new Error(`git sparse-checkout: ${s.stderr.trim().split('\n').pop()}`);
  }
  const file = teamTaxonomyFile(dir);
  if (!fs.existsSync(file)) throw new Error('the repo has no job-classes/taxonomy.yaml (its first member runs `coding job-classes init`)');
  return loadTaxonomy(file);
}

/**
 * The tagger, its settings and its routes, for the daemon.
 *
 * @param {object} o
 * @param {string} o.home       GLASS_HOME (settings, the team clone)
 * @param {string} o.dataDir    glass's data dir (the measurement's reference sets)
 * @param {object|null} o.db    glass's token DB handle
 * @param {Function} o.redact   the daemon's raw-body redactor
 * @param {string} o.pkgRoot    the installed glass tree (its config/job-classes.yaml)
 * @param {Function} o.githubHost  () => the account's GitHub host (the Copilot quota's)
 * @param {Function} [o.fetch]  the daemon's egress fetch (a corporate proxy, when there is one)
 * @param {Function} [o.ghEnv]  () => the environment for `gh` (the same egress)
 */
export function createGlassJobClasses({
  home, dataDir, db, redact, pkgRoot, githubHost, version = '', log = () => {}, logErr = () => {},
  complete = null, git = sh, startedAt = Date.now(), fetch = globalThis.fetch, ghEnv = () => process.env, run = runGh,
}) {
  const store = createJobClassStore(home);
  // The account's GitHub host: the Copilot quota's when it has one, else the
  // first host gh is logged in to (enterprise hosts first, as the quota orders them).
  let ghHost = '';
  const host = async () => {
    const known = githubHost();
    if (known) return known;
    if (!ghHost) {
      const r = await run(['auth', 'status', '--json', 'hosts'], ghEnv());
      ghHost = r.ok ? loggedInHosts(r.stdout)[0] || '' : '';
    }
    return ghHost;
  };
  const defaultTaxonomy = path.join(pkgRoot, 'config', 'job-classes.yaml');
  const taxonomyPath = () => {
    const t = store.get().team;
    return t && fs.existsSync(teamTaxonomyFile(t.dir)) ? teamTaxonomyFile(t.dir) : defaultTaxonomy;
  };
  const ask = complete || createCopilotCompleter({
    host, version, fetch, env: ghEnv, run,
    models: () => ({ student: store.get().studentModel, teacher: store.get().teacherModel }),
  });
  const taggerConfig = () => {
    const c = store.get();
    return {
      enabled: c.enabled, taxonomyPath: taxonomyPath(), bindingsPath: '',
      studentProcess: STUDENT_PROCESS, teacherProcess: TEACHER_PROCESS,
      teacherSamplePct: c.teacherSamplePct, maxInFlight: c.maxInFlight, skipTaskBound: false,
    };
  };
  const tagger = createJobClassTagger({ getConfig: taggerConfig, complete: ask, db, redact, log, logErr });

  const view = async () => {
    const h = await host();
    return { config: store.get(), host: h, copilotApi: copilotApiBase(h), taxonomy: taggerConfig().taxonomyPath, shipped: defaultTaxonomy };
  };

  /** One student call on a made-up prompt: is the account able to label at all? */
  async function test() {
    const tax = loadTaxonomy(taxonomyPath());
    const started = Date.now();
    try {
      const r = await ask({ process: STUDENT_PROCESS, messages: renderRequest(tax, 'Commit this and push.') });
      return { ok: true, label: parseLabel(tax, r.content), model: r.model, ms: Date.now() - started };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  }

  /**
   * The daemon's routes. Reads from anyone on the loopback, changes only from
   * glass's own UI or CLI (`writeAllowed`). Returns true when it answered.
   */
  async function handle(req, res, { json, readJson, writeAllowed }) {
    const url = (req.url || '').split('?')[0];
    if (!url.startsWith('/api/job-classes')) return false;
    if (url === '/api/job-classes/settings' && req.method === 'GET') { json(res, 200, await view()); return true; }
    if (req.method === 'GET' && handleJobClassRead(req, res, {
      tagger, db, referenceDir: path.join(dataDir, 'job-classes'), config: () => taggerConfig(), sinceBootMs: () => Date.now() - startedAt,
    })) return true;
    if (req.method === 'GET') return false;
    if (!writeAllowed(req)) { json(res, 403, { error: 'job-class settings change only from the glass UI or CLI' }); return true; }
    const body = (await readJson(req)) || {};
    if (url === '/api/job-classes/settings' && req.method === 'PATCH') {
      const before = store.get();
      const next = store.update(body);
      if (before.enabled !== next.enabled) log(`job classes: labelling ${next.enabled ? 'on' : 'off'} (student ${next.studentModel}, teacher ${Math.round(next.teacherSamplePct * 100)} % of turns)`);
      json(res, 200, await view());
      return true;
    }
    if (url === '/api/job-classes/test' && req.method === 'POST') { json(res, 200, await test()); return true; }
    if (url === '/api/job-classes/team' && req.method === 'PUT') {
      const dir = path.join(home, 'job-classes', 'team');
      try {
        if (store.get().team?.url !== body.url) fs.rmSync(dir, { recursive: true, force: true });
        const tax = await syncTeamTaxonomy({ url: body.url, dir, git });
        store.update({ team: { url: body.url, dir } });
        log(`job classes: team taxonomy ${tax.tag} from ${body.url}`);
        json(res, 200, { ...(await view()), tag: tax.tag });
      } catch (err) {
        json(res, 400, { error: err?.message || String(err) });
      }
      return true;
    }
    if (url === '/api/job-classes/team/pull' && req.method === 'POST') {
      const t = store.get().team;
      if (!t) { json(res, 400, { error: 'no team taxonomy: join one first' }); return true; }
      try {
        const tax = await syncTeamTaxonomy({ url: t.url, dir: t.dir, git });
        json(res, 200, { ...(await view()), tag: tax.tag });
      } catch (err) {
        json(res, 400, { error: err?.message || String(err) });
      }
      return true;
    }
    if (url === '/api/job-classes/team' && req.method === 'DELETE') {
      const t = store.get().team;
      if (t) fs.rmSync(t.dir, { recursive: true, force: true });
      store.update({ team: null });
      json(res, 200, await view());
      return true;
    }
    json(res, 404, { error: `no route for ${req.method} ${url}` });
    return true;
  }

  return { tagger, store, handle, test, view, onTurn: (t) => tagger.observe(t), taxonomyPath };
}
