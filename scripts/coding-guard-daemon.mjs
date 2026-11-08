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
 *                                      (the same rule + session + file still
 *                                      pending → that request, not a new one)
 *   GET  /requests[?status=]           list;  GET /requests/:id  one
 *   GET  /approve/:id                  approval page (opened in the host browser)
 *   POST /approve/:id/options          { scope, minutes } → WebAuthn challenge
 *   POST /approve/:id/verify           { ceremony, response }       → grant
 *   POST /approve/:id/password         { scope, minutes, password } → grant
 *   POST /approve/:id/recovery         { scope, minutes, code }     → grant
 *   POST /requests/:id/deny            anyone may say no
 *   GET  /enroll                 [A#]  factor page (token in the URL fragment)
 *   GET  /factors                      what is enrolled (no secrets)
 *   POST /manage/options|verify|password   prove a factor → management ticket
 *   POST /enroll/options|verify  [A+T] add an authenticator (Touch ID, phone, key)
 *   POST /factors/password       [A+T] set the password
 *   POST /factors/:id/remove     [A+T] drop an authenticator
 *   POST /factors/recovery       [A+T] new recovery codes
 *   GET  /grants?session=              live signed grants for a box session
 *   POST /grants/:id/consume           spend a one-call grant
 *   POST /boxes                  [A]   { session } → { token }: register a box at launch
 *   POST /boxes/release          [A]   { session } — the box exited
 *   POST /svc                    [B]   { verb, args } — lib/guard/svc.mjs
 *   GET  /audit                  [A]   tail + chain check
 *   POST /note                   [A]   record a host-side event (e.g. --no-box)
 *
 * Approving needs one of the user's FACTORS (lib/guard/factors.mjs): a WebAuthn
 * authenticator — Touch ID / Windows Hello, a phone passkey via QR, a FIDO2 key
 * — or the password, or a one-time recovery code. The agent can request, never
 * approve: it holds no authenticator, and password / recovery attempts lock
 * out after 5 failures.
 *
 * [B] = the session is the one the box's token was registered for
 *       (`x-coding-box-token`, set by the launcher) — never a session the
 *       request names; a host caller with [A] may name one.
 * [A] = needs `Authorization: Bearer <approver.token>` (0600 in ~/.coding/guard,
 * mounted nowhere). [T] = and, once any factor exists, a management ticket from
 * proving one — so neither the token alone nor a stolen session can add a
 * factor of its own. The very first factor needs only the token.
 *
 * Plan: .planning/guardrail-hardening.md (Phase 1, items 2 and 3).
 */

import { execFile } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { guardPaths, ensureGuardHome, guardPort, writeGuardEndpoint } from '../lib/guard/home.mjs';
import { signGrant, SCOPES, expiryFor } from '../lib/guard/grants.mjs';
import { FactorStore } from '../lib/guard/factors.mjs';
import { Ceremonies } from '../lib/guard/ceremonies.mjs';
import { appendAudit, readAudit, verifyAudit } from '../lib/guard/audit.mjs';
import { svcPlan, parsePrograms, SvcError, SERVICES_CONTAINER } from '../lib/guard/svc.mjs';
import { listenLocal, isAllowedHost } from '../lib/network/local-only.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UI_DIR = path.join(REPO, 'lib', 'guard', 'ui');

/** Static files the pages load — a fixed map, nothing else is served from disk. */
const ASSETS = {
  '/assets/guard-ui.js': [path.join(UI_DIR, 'guard-ui.js'), 'text/javascript'],
  '/assets/guard.css': [path.join(UI_DIR, 'guard.css'), 'text/css'],
  '/assets/webauthn.js': [path.join(REPO, 'node_modules', '@simplewebauthn', 'browser', 'dist', 'bundle', 'index.umd.min.js'), 'text/javascript'],
};
const PAGES = { approve: path.join(UI_DIR, 'approve.html'), enroll: path.join(UI_DIR, 'enroll.html') };
/** No inline script, no framing, nothing from elsewhere: request text is agent-written. */
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

const MAX_BODY = 64 * 1024;
const MAX_PENDING = 100;
const MAX_NEW_PER_MINUTE = 30;
const REQUEST_TTL_MS = 24 * 60 * 60 * 1000;
/** A box token outlives any session; the launcher releases it on exit, this catches a crash. */
const BOX_TTL_MS = 30 * 24 * 60 * 60 * 1000;
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
export function createGuard({
  paths = guardPaths(), runDocker = dockerRunner, now = () => Date.now(), codingRepo = REPO, port = guardPort(),
} = {}) {
  const keys = ensureGuardHome(paths);
  writeGuardEndpoint(paths, port);
  const pageOrigin = `http://localhost:${port}`;
  const ownOrigins = new Set([pageOrigin, `http://127.0.0.1:${port}`, `http://[::1]:${port}`]);
  const factors = new FactorStore(paths.dir, { now });
  const ceremonies = new Ceremonies(factors, { origins: [pageOrigin], now });
  const fingerprint = createHash('sha256').update(keys.publicPem).digest('hex').slice(0, 16);
  const tokenBuf = Buffer.from(keys.token);
  let state = { requests: {}, grants: {}, boxes: {} };
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
    for (const [h, b] of Object.entries(state.boxes)) if (t - b.created > BOX_TTL_MS) delete state.boxes[h];
  };
  const tokenHash = (tok) => createHash('sha256').update(String(tok)).digest('hex');

  /** Approver token. `page`: the guard's own pages may send it (enrolment). */
  function authorize(req, { page = false } = {}) {
    if (req.headers.origin && !(page && ownOrigins.has(req.headers.origin))) {
      throw new HttpError(403, 'this route does not accept browser requests');
    }
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    const given = Buffer.from(m ? m[1].trim() : '');
    if (given.length !== tokenBuf.length || !timingSafeEqual(given, tokenBuf)) {
      throw new HttpError(401, 'approver token required (only the host user has it: coding guard approve …)');
    }
  }

  const isApprover = (req) => {
    try { authorize(req); return true; } catch { return false; }
  };

  /**
   * The session a `/svc` call acts for. From a box: the session its launcher
   * registered with the box's token — a box that could name a session could
   * spend another box's `svc:<verb>` grant. From the host (approver token): the
   * session it names, else its own.
   */
  function svcSession(req, body) {
    const tok = req.headers['x-coding-box-token'];
    if (tok) {
      const box = state.boxes[tokenHash(tok)];
      if (!box) throw new HttpError(401, 'unknown box token (the box was not registered, or has exited)');
      if (body.session && body.session !== box.session) {
        audit({ event: 'svc.refused', verb: clip(body.verb, 40), session: box.session, error: `named another session: ${clip(body.session, 80)}` });
        throw new HttpError(403, 'a box acts only for its own session');
      }
      return box.session;
    }
    if (isApprover(req)) return typeof body.session === 'string' && body.session ? body.session : 'host';
    throw new HttpError(401, 'box token required (set by the box launcher as CODING_GUARD_BOX_TOKEN)');
  }

  /** Token, plus — once anything is enrolled — a ticket from proving a factor. */
  function authorizeManage(req, body) {
    authorize(req, { page: true });
    if (factors.hasFactors() && !ceremonies.checkTicket(body.ticket)) {
      throw new HttpError(401, 'prove an enrolled factor first (management ticket missing or expired)');
    }
  }

  function pendingRequest(id) {
    const r = state.requests[id];
    if (!r) throw new HttpError(404, 'no such request');
    if (r.status !== 'pending') throw new HttpError(409, `request is already ${r.status}`);
    return r;
  }

  function checkScope(body) {
    const scope = body.scope || 'call';
    if (!SCOPES.includes(scope)) throw new HttpError(400, `scope must be one of: ${SCOPES.join(', ')}`);
    try {
      expiryFor(scope, { minutes: body.minutes });
    } catch (err) {
      throw new HttpError(400, err.message);
    }
    return { scope, minutes: scope === 'minutes' ? Number(body.minutes) : undefined };
  }

  /** The one place a grant is made — after a factor has been proven. */
  function approve(r, { scope, minutes }, via) {
    const grant = signGrant(r, { scope, minutes, privatePem: keys.privatePem, now: now() });
    state.grants[grant.payload.id] = grant;
    Object.assign(r, { status: 'approved', decided: now(), grant: grant.payload.id, via });
    save();
    audit({ event: 'request.approved', request: r.id, rule: r.rule, session: r.session, scope, grant: grant.payload.id, exp: grant.payload.exp, via });
    return { request: r, grant };
  }

  /** Password / recovery code: guessable, so locked out after repeated failures. */
  function secretFactor(kind, value, context) {
    let ok;
    try {
      ok = kind === 'password' ? factors.checkPassword(value) : factors.useRecoveryCode(value);
    } catch (err) {
      audit({ event: 'factor.locked', kind, ...context });
      throw new HttpError(429, err.message);
    }
    if (!ok) {
      audit({ event: 'factor.failed', kind, ...context });
      throw new HttpError(401, `wrong ${kind === 'password' ? 'password' : 'recovery code'}`);
    }
    if (kind === 'recovery') audit({ event: 'factor.recovery-used', left: factors.summary().recoveryLeft, ...context });
  }

  function newRequest(body, source = 'agent') {
    // A blocked agent retries; one decision per rule + session + file is enough.
    const file = clip(body.file, FIELD_LIMITS.file);
    const open = Object.values(state.requests).find((r) => r.status === 'pending'
      && r.rule === clip(body.rule, FIELD_LIMITS.rule) && r.session === clip(body.session, FIELD_LIMITS.session) && r.file === file);
    if (open) return open;
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
    const id = randomBytes(6).toString('hex');
    const r = { id, status: 'pending', created: t, source, approve: `${pageOrigin}/approve/${id}` };
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

  async function runSvc(body, session) {
    const { verb, args = [] } = body;
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
        throw new HttpError(403, `'${verb}' needs your approval: ${r.approve}`, { request: r });
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
      if (parts.length === 3 && m === 'POST' && parts[2] === 'deny') {
        const pending = pendingRequest(r.id);
        pending.status = 'denied';
        pending.decided = now();
        save();
        audit({ event: 'request.denied', request: r.id, rule: r.rule, session: r.session });
        return { request: pending };
      }
    }

    if (parts[0] === 'approve' && parts.length === 3 && m === 'POST') {
      const r = pendingRequest(parts[1]);
      const ctx = { request: r.id, rule: r.rule };
      if (parts[2] === 'options') {
        const scope = checkScope(body);
        try {
          return await ceremonies.authOptions({ kind: 'approve', request: r.id, ...scope });
        } catch (err) {
          throw new HttpError(400, err.message);
        }
      }
      if (parts[2] === 'verify') {
        let proof;
        try {
          proof = await ceremonies.authVerify(body.ceremony, body.response);
        } catch (err) {
          audit({ event: 'factor.failed', kind: 'webauthn', ...ctx, error: clip(err.message, 200) });
          throw new HttpError(401, err.message);
        }
        if (proof.purpose.kind !== 'approve' || proof.purpose.request !== r.id) {
          throw new HttpError(400, 'that proof was issued for something else');
        }
        return approve(r, proof.purpose, `webauthn:${proof.credential.slice(0, 12)}`);
      }
      if (parts[2] === 'password' || parts[2] === 'recovery') {
        if (parts[2] === 'password' && !factors.data.password) throw new HttpError(400, 'no password set');
        const scope = checkScope(body);
        secretFactor(parts[2], parts[2] === 'password' ? body.password : body.code, ctx);
        return approve(r, scope, parts[2]);
      }
    }

    if (m === 'GET' && url.pathname === '/factors') return { factors: factors.summary() };

    if (parts[0] === 'manage' && parts.length === 2 && m === 'POST') {
      if (parts[1] === 'options') {
        try {
          return await ceremonies.authOptions({ kind: 'manage' });
        } catch (err) {
          throw new HttpError(400, err.message);
        }
      }
      if (parts[1] === 'verify') {
        let proof;
        try {
          proof = await ceremonies.authVerify(body.ceremony, body.response);
        } catch (err) {
          audit({ event: 'factor.failed', kind: 'webauthn', purpose: 'manage', error: clip(err.message, 200) });
          throw new HttpError(401, err.message);
        }
        if (proof.purpose.kind !== 'manage') throw new HttpError(400, 'that proof was issued for something else');
        return { ticket: ceremonies.issueTicket() };
      }
      if (parts[1] === 'password' || parts[1] === 'recovery') {
        secretFactor(parts[1], parts[1] === 'password' ? body.password : body.code, { purpose: 'manage' });
        return { ticket: ceremonies.issueTicket() };
      }
    }

    if (parts[0] === 'enroll' && parts.length === 2 && m === 'POST') {
      authorizeManage(req, body);
      if (parts[1] === 'options') {
        return ceremonies.enrollOptions({ kind: body.kind, label: clip(body.label, 60) });
      }
      if (parts[1] === 'verify') {
        const first = !factors.hasFactors();
        let cred;
        try {
          cred = await ceremonies.enrollVerify(body.ceremony, body.response);
        } catch (err) {
          throw new HttpError(400, err.message);
        }
        audit({ event: 'factor.enrolled', kind: cred.kind, label: cred.label, credential: cred.id.slice(0, 12) });
        return { credential: { id: cred.id, kind: cred.kind, label: cred.label }, recoveryCodes: first ? firstRecovery() : undefined };
      }
    }

    if (parts[0] === 'factors' && m === 'POST') {
      authorizeManage(req, body);
      if (parts[1] === 'password' && parts.length === 2) {
        const first = !factors.hasFactors();
        try {
          factors.setPassword(body.password);
        } catch (err) {
          throw new HttpError(400, err.message);
        }
        audit({ event: 'factor.enrolled', kind: 'password' });
        return { password: true, recoveryCodes: first ? firstRecovery() : undefined };
      }
      if (parts[1] === 'recovery' && parts.length === 2) {
        audit({ event: 'factor.recovery-regenerated' });
        return { recoveryCodes: factors.newRecoveryCodes() };
      }
      if (parts.length === 3 && parts[2] === 'remove') {
        const remaining = factors.data.credentials.length - 1 + (factors.data.password ? 1 : 0);
        if (remaining < 1) throw new HttpError(409, 'refusing to remove the last factor — enrol another first');
        if (!factors.removeCredential(parts[1])) throw new HttpError(404, 'no such authenticator');
        audit({ event: 'factor.removed', credential: parts[1].slice(0, 12) });
        return { factors: factors.summary() };
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

    if (parts[0] === 'boxes' && m === 'POST') {
      authorize(req);
      const session = body.session;
      if (typeof session !== 'string' || !/^[A-Za-z0-9_.-]{1,120}$/.test(session)) throw new HttpError(400, 'session required');
      if (parts.length === 1) {
        const tok = randomBytes(32).toString('base64url');
        state.boxes[tokenHash(tok)] = { session, created: now() };
        save();
        audit({ event: 'box.registered', session });
        return { token: tok };
      }
      if (parts.length === 2 && parts[1] === 'release') {
        let released = 0;
        for (const [h, b] of Object.entries(state.boxes)) if (b.session === session) { delete state.boxes[h]; released++; }
        save();
        audit({ event: 'box.released', session, released });
        return { released };
      }
    }
    if (m === 'POST' && url.pathname === '/svc') return runSvc(body, svcSession(req, body));

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

  /** Recovery codes come with the FIRST factor, unless a set already exists. */
  function firstRecovery() {
    if (factors.summary().recoveryLeft > 0) return undefined;
    audit({ event: 'factor.recovery-regenerated' });
    return factors.newRecoveryCodes();
  }

  /** Pages and their assets. Returns true when it answered. */
  function servePage(req, res, url) {
    if (req.method !== 'GET') return false;
    let file;
    let type = 'text/html; charset=utf-8';
    if (ASSETS[url.pathname]) [file, type] = ASSETS[url.pathname];
    else if (/^\/approve\/[0-9a-f]{12}$/.test(url.pathname)) file = PAGES.approve;
    else if (url.pathname === '/enroll' || url.pathname === '/') file = PAGES.enroll;
    else return false;
    // WebAuthn needs a domain: 127.0.0.1 / [::1] page loads move to localhost.
    if (type.startsWith('text/html') && !/^localhost(:|$)/.test(req.headers.host || '')) {
      res.writeHead(302, { location: `${pageOrigin}${url.pathname}${url.search}` });
      res.end();
      return true;
    }
    res.writeHead(200, {
      'content-type': type, 'cache-control': 'no-store', 'content-security-policy': CSP,
      'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
    });
    res.end(fs.readFileSync(file));
    return true;
  }

  async function handler(req, res) {
    const send = (status, obj) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(obj));
    };
    try {
      if (!isAllowedHost(req.headers.host)) throw new HttpError(403, 'forbidden host');
      if (req.headers.origin && req.method !== 'GET' && !ownOrigins.has(req.headers.origin)) {
        throw new HttpError(403, 'forbidden origin');
      }
      const pageUrl = new URL(req.url, 'http://guard.local');
      if (servePage(req, res, pageUrl)) return;
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

  return { handler, fingerprint, audit, factors, ceremonies, pageOrigin };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = guardPort();
  const guard = createGuard({ port });
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
