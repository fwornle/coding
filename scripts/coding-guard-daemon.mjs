#!/usr/bin/env node
/**
 * coding-guard — the host half of the agent-box guard (port 3035, loopback).
 *
 * Runs as the host user, OUTSIDE the box. It holds what the agent must never
 * hold — the grant signing key and the approver token (lib/guard/home.mjs) —
 * and keeps the audit log. The box reaches it on host.docker.internal:3035.
 *
 *   GET  /health                       liveness + public key fingerprint
 *   GET  /public-key                   PEM (also mounted ro into the box)
 *   POST /requests                     an agent asks for an override  → pending
 *   GET  /requests[?status=]           list;  GET /requests/:id  one
 *   POST /requests/:id/approve   [A]   { scope: call|minutes|session, minutes }
 *   POST /requests/:id/deny      [A]
 *   GET  /grants?session=              live signed grants for a box session
 *   POST /grants/:id/consume           spend a one-call grant
 *   POST /svc                          { verb, args, session } — lib/guard/svc.mjs
 *   GET  /audit                  [A]   tail + chain check
 *   POST /note                   [A]   record a host-side event (e.g. --no-box)
 *
 * [A] = needs `Authorization: Bearer <approver.token>`. The token file is 0600
 * in ~/.coding/guard, which is mounted nowhere, so a boxed agent can request
 * but never approve. Interactive approval (WebAuthn, password) replaces the
 * CLI-held token in Phase 1 item 3; approver routes refuse any browser Origin
 * until then.
 *
 * Plan: .planning/guardrail-hardening.md (Phase 1, item 2).
 */

import { execFile } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { guardPaths, ensureGuardHome, guardPort } from '../lib/guard/home.mjs';
import { signGrant, SCOPES } from '../lib/guard/grants.mjs';
import { appendAudit, readAudit, verifyAudit } from '../lib/guard/audit.mjs';
import { svcPlan, parsePrograms, SvcError, SERVICES_CONTAINER } from '../lib/guard/svc.mjs';
import { listenLocal, isAllowedHost } from '../lib/network/local-only.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MAX_BODY = 64 * 1024;
const MAX_PENDING = 100;
const MAX_NEW_PER_MINUTE = 30;
const REQUEST_TTL_MS = 24 * 60 * 60 * 1000;
const FIELD_LIMITS = { rule: 200, session: 200, agent: 40, tool: 80, file: 1000, excerpt: 4000, reason: 2000 };

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function clip(value, max) {
  if (value === undefined || value === null) return null;
  const s = String(value);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Default docker runner: argv only, never a shell. */
function dockerRunner(argv, { timeout = 60_000 } = {}) {
  return new Promise((resolve) => {
    execFile('docker', argv, { timeout, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr });
    });
  });
}

/**
 * The request handler, with every side effect injected so tests can drive it
 * against a temp guard home and a fake docker.
 */
export function createGuard({ paths = guardPaths(), runDocker = dockerRunner, now = () => Date.now(), codingRepo = REPO } = {}) {
  const keys = ensureGuardHome(paths);
  const fingerprint = createHash('sha256').update(keys.publicPem).digest('hex').slice(0, 16);
  const tokenBuf = Buffer.from(keys.token);
  let state = { requests: {}, grants: {} };
  try {
    state = { ...state, ...JSON.parse(fs.readFileSync(paths.state, 'utf8')) };
  } catch { /* first start, or unreadable: start empty — grants are re-requestable */ }
  const recent = [];

  const audit = (event) => appendAudit(paths.audit, event, { now: now() });
  const save = () => {
    const tmp = `${paths.state}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, paths.state);
  };
  const prune = () => {
    const t = now();
    for (const [id, g] of Object.entries(state.grants)) if (g.payload.exp <= t || g.consumed) delete state.grants[id];
    for (const [id, r] of Object.entries(state.requests)) if (t - r.created > REQUEST_TTL_MS) delete state.requests[id];
  };

  function authorize(req) {
    if (req.headers.origin) throw new HttpError(403, 'approver routes do not accept browser requests');
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    const given = Buffer.from(m ? m[1].trim() : '');
    if (given.length !== tokenBuf.length || !timingSafeEqual(given, tokenBuf)) {
      throw new HttpError(401, 'approver token required (only the host user has it: coding guard approve …)');
    }
  }

  function newRequest(body, source = 'agent') {
    const t = now();
    while (recent.length && t - recent[0] > 60_000) recent.shift();
    const pending = Object.values(state.requests).filter((r) => r.status === 'pending').length;
    if (recent.length >= MAX_NEW_PER_MINUTE || pending >= MAX_PENDING) {
      throw new HttpError(429, 'too many override requests');
    }
    for (const key of ['rule', 'session']) {
      if (typeof body[key] !== 'string' || !body[key].trim()) throw new HttpError(400, `${key} required`);
    }
    recent.push(t);
    const r = { id: randomBytes(6).toString('hex'), status: 'pending', created: t, source };
    for (const [key, max] of Object.entries(FIELD_LIMITS)) r[key] = clip(body[key], max);
    state.requests[r.id] = r;
    save();
    audit({ event: 'request.created', request: r.id, rule: r.rule, session: r.session, agent: r.agent, file: r.file, reason: r.reason });
    return r;
  }

  function liveGrants(session) {
    prune();
    return Object.values(state.grants).filter((g) => g.payload.session === session);
  }

  async function runSvc(body) {
    const { verb, args = [], session } = body;
    if (typeof session !== 'string' || !session) throw new HttpError(400, 'session required');
    let programs = [];
    if (verb === 'logs' || verb === 'restart') {
      const res = await runDocker(['exec', SERVICES_CONTAINER, 'supervisorctl', 'status']);
      programs = parsePrograms(res.stdout || '');
    }
    let plan;
    try {
      plan = svcPlan(verb, args, { programs, codingRepo });
    } catch (err) {
      if (err instanceof SvcError) {
        audit({ event: 'svc.refused', verb: clip(verb, 40), args: args.map?.((a) => clip(a, 200)), session, error: err.message });
        throw new HttpError(400, err.message);
      }
      throw err;
    }
    if (plan.gated) {
      const rule = `svc:${verb}`;
      const grant = liveGrants(session).find((g) => g.payload.rule === rule);
      if (!grant) {
        const r = newRequest({ rule, session, agent: body.agent, tool: 'svc', reason: body.reason ?? `coding svc ${verb}` });
        throw new HttpError(403, `'${verb}' needs your approval: coding guard approve ${r.id}`, { request: r });
      }
      if (grant.payload.scope === 'call') grant.consumed = now();
      save();
    }
    const results = [];
    for (const argv of plan.steps) {
      const res = await runDocker(argv, { timeout: verb === 'rebuild' ? 15 * 60_000 : 60_000 });
      results.push({ argv: ['docker', ...argv], ...res });
      if (res.code !== 0) break;
    }
    const code = results.find((r) => r.code !== 0)?.code ?? 0;
    audit({ event: 'svc.run', verb, args, session, code });
    return { verb, code, results };
  }

  async function route(req, url, body) {
    const parts = url.pathname.split('/').filter(Boolean);
    const m = req.method;

    if (m === 'GET' && url.pathname === '/health') return { ok: true, fingerprint, pid: process.pid };
    if (m === 'GET' && url.pathname === '/public-key') return { pem: keys.publicPem, fingerprint };

    if (parts[0] === 'requests') {
      if (parts.length === 1 && m === 'POST') return { request: newRequest(body) };
      if (parts.length === 1 && m === 'GET') {
        prune();
        const status = url.searchParams.get('status');
        return { requests: Object.values(state.requests).filter((r) => !status || r.status === status) };
      }
      const r = state.requests[parts[1]];
      if (!r) throw new HttpError(404, 'no such request');
      if (parts.length === 2 && m === 'GET') {
        return { request: r, grant: r.grant ? state.grants[r.grant] ?? null : null };
      }
      if (parts.length === 3 && m === 'POST' && (parts[2] === 'approve' || parts[2] === 'deny')) {
        authorize(req);
        if (r.status !== 'pending') throw new HttpError(409, `request is already ${r.status}`);
        if (parts[2] === 'deny') {
          r.status = 'denied';
          r.decided = now();
          save();
          audit({ event: 'request.denied', request: r.id, rule: r.rule, session: r.session });
          return { request: r };
        }
        const scope = body.scope || 'call';
        if (!SCOPES.includes(scope)) throw new HttpError(400, `scope must be one of: ${SCOPES.join(', ')}`);
        let grant;
        try {
          grant = signGrant(r, { scope, minutes: body.minutes, privatePem: keys.privatePem, now: now() });
        } catch (err) {
          throw new HttpError(400, err.message);
        }
        state.grants[grant.payload.id] = grant;
        Object.assign(r, { status: 'approved', decided: now(), grant: grant.payload.id });
        save();
        audit({ event: 'request.approved', request: r.id, rule: r.rule, session: r.session, scope, grant: grant.payload.id, exp: grant.payload.exp });
        return { request: r, grant };
      }
    }

    if (parts[0] === 'grants') {
      if (parts.length === 1 && m === 'GET') {
        const session = url.searchParams.get('session');
        if (!session) throw new HttpError(400, 'session required');
        return { grants: liveGrants(session) };
      }
      if (parts.length === 3 && parts[2] === 'consume' && m === 'POST') {
        const g = state.grants[parts[1]];
        if (!g || g.payload.session !== body.session) throw new HttpError(404, 'no such grant for this session');
        if (g.payload.scope === 'call') {
          g.consumed = now();
          save();
          audit({ event: 'grant.consumed', grant: g.payload.id, rule: g.payload.rule, session: g.payload.session });
        }
        return { grant: g };
      }
    }

    if (m === 'POST' && url.pathname === '/svc') return runSvc(body);

    if (m === 'GET' && url.pathname === '/audit') {
      authorize(req);
      const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 1000);
      return { chain: verifyAudit(paths.audit), entries: readAudit(paths.audit, { limit }) };
    }
    if (m === 'POST' && url.pathname === '/note') {
      authorize(req);
      if (typeof body.event !== 'string' || !/^[a-z][a-z0-9.-]{0,60}$/.test(body.event)) throw new HttpError(400, 'event required');
      const fields = {};
      for (const [k, v] of Object.entries(body)) if (k !== 'event') fields[k] = clip(v, 1000);
      return { entry: audit({ ...fields, event: `host.${body.event}` }) };
    }

    throw new HttpError(404, 'not found');
  }

  async function handler(req, res) {
    const send = (status, obj) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(obj));
    };
    try {
      if (!isAllowedHost(req.headers.host)) throw new HttpError(403, 'forbidden host');
      if (req.headers.origin && req.method !== 'GET') throw new HttpError(403, 'forbidden origin');
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > MAX_BODY) throw new HttpError(413, 'body too large');
      }
      let body = {};
      if (raw) {
        try { body = JSON.parse(raw); } catch { throw new HttpError(400, 'invalid JSON'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'JSON object expected');
      }
      const url = new URL(req.url, 'http://guard.local');
      const status = req.method === 'POST' && url.pathname === '/requests' ? 201 : 200;
      send(status, await route(req, url, body));
    } catch (err) {
      if (err instanceof HttpError) send(err.status, { error: err.message, ...err.extra });
      else send(500, { error: 'internal error' });
    }
  }

  return { handler, fingerprint, audit };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = guardPort();
  const guard = createGuard();
  const server = listenLocal(guard.handler, port, (addrs) => {
    guard.audit({ event: 'daemon.start', pid: process.pid, port, fingerprint: guard.fingerprint });
    process.stdout.write(`coding-guard listening on ${addrs.join(', ')}:${port} (key ${guard.fingerprint})\n`);
  });
  server.on('error', (err) => {
    process.stderr.write(`coding-guard: ${err.message}\n`);
    process.exit(1);
  });
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => server.close(() => process.exit(0)));
  }
}
