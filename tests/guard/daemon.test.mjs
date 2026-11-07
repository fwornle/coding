/**
 * The host guard daemon (scripts/coding-guard-daemon.mjs) over real HTTP, with a
 * temp guard home, a fake docker and a software WebAuthn authenticator. What it
 * must hold:
 *   - the box can ask, never approve: approving needs a FACTOR (an enrolled
 *     authenticator, the password, a recovery code) — the token alone is not one
 *   - enrolling needs the host-only token, and once anything is enrolled also a
 *     proven factor
 *   - WebAuthn proofs are single-use, bound to one request + scope, and need
 *     user verification; guessable factors lock out
 *   - what it signs verifies with the public key the box gets
 *   - gated `svc` verbs run only after an approval, one-call grants once
 *   - browsers and rebinding hosts are refused; pages carry a strict CSP
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { createGuard } from '../../scripts/coding-guard-daemon.mjs';
import { guardPaths } from '../../lib/guard/home.mjs';
import { verifyGrant } from '../../lib/guard/grants.mjs';
import { verifyAudit, readAudit } from '../../lib/guard/audit.mjs';
import { SoftAuthenticator } from './helpers/soft-authenticator.mjs';

const SESSION = 'coding-box-claude-42';
const COMPOSE = ['compose', '-f', '/repo/docker/docker-compose.yml'];
// Generated per run: a fixture, not a secret, and never the same twice.
const PASSPHRASE = randomBytes(18).toString('base64url');
const TOO_SHORT = randomBytes(4).toString('hex');
let server;
let base;
let origin;
let paths;
let token;
let key;
let recoveryCodes;
const dockerCalls = [];

async function api(method, route, { body, auth, headers = {} } = {}) {
  const h = { 'content-type': 'application/json', ...headers };
  if (auth) h.authorization = `Bearer ${auth}`;
  const res = await fetch(`${base}${route}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => ({})), headers: res.headers };
}

const newRequest = async (extra = {}) => (await api('POST', '/requests', { body: { rule: 'no-console-log', session: SESSION, ...extra } })).data.request;

/** Approve request `id` with an authenticator; returns the verify response. */
async function approveWith(authenticator, id, scope = { scope: 'call' }, opts = {}) {
  const { data } = await api('POST', `/approve/${id}/options`, { body: scope });
  return api('POST', `/approve/${id}/verify`, { body: { ceremony: data.ceremony, response: authenticator.assert(data.options, opts) } });
}

async function ticketWith(authenticator) {
  const { data } = await api('POST', '/manage/options');
  return (await api('POST', '/manage/verify', { body: { ceremony: data.ceremony, response: authenticator.assert(data.options) } })).data.ticket;
}

before(async () => {
  paths = guardPaths(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-home-')));
  let handler = null;
  server = http.createServer((req, res) => handler(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  base = `http://127.0.0.1:${port}`;
  origin = `http://localhost:${port}`;
  ({ handler } = createGuard({
    paths,
    port,
    codingRepo: '/repo',
    runDocker: async (argv) => {
      dockerCalls.push(argv);
      if (argv.includes('status') && argv.includes('supervisorctl')) {
        return { code: 0, stdout: 'backend-services:graphify RUNNING pid 1\n', stderr: '' };
      }
      return { code: 0, stdout: `ran ${argv.join(' ')}\n`, stderr: '' };
    },
  }));
  token = fs.readFileSync(paths.token, 'utf8').trim();
  key = new SoftAuthenticator({ origin });
});

after(() => server?.close());

describe('enrolment', () => {
  test('nothing enrolled → nothing can approve', async () => {
    const r = await newRequest();
    assert.equal((await api('POST', `/approve/${r.id}/options`, { body: { scope: 'call' } })).status, 400);
    assert.equal((await api('POST', `/approve/${r.id}/password`, { body: { scope: 'call', password: PASSPHRASE } })).status, 400);
  });

  test('enrolling needs the approver token', async () => {
    assert.equal((await api('POST', '/enroll/options', { body: { kind: 'platform' } })).status, 401);
    assert.equal((await api('POST', '/factors/password', { body: { password: PASSPHRASE } })).status, 401);
  });

  test('the first authenticator needs only the token, and brings recovery codes', async () => {
    const { data } = await api('POST', '/enroll/options', { body: { kind: 'platform', label: 'Touch ID' }, auth: token });
    assert.equal(data.options.rp.id, 'localhost');
    assert.equal(data.options.authenticatorSelection.userVerification, 'required');
    const res = await api('POST', '/enroll/verify', { body: { ceremony: data.ceremony, response: key.register(data.options) }, auth: token });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.credential.kind, 'platform');
    assert.equal(res.data.recoveryCodes.length, 10);
    recoveryCodes = res.data.recoveryCodes;
  });

  test('after that, the token alone cannot add a factor — a proven factor is needed too', async () => {
    assert.equal((await api('POST', '/enroll/options', { body: { kind: 'hybrid' }, auth: token })).status, 401);
    assert.equal((await api('POST', '/factors/password', { body: { password: PASSPHRASE }, auth: token })).status, 401);
    const ticket = await ticketWith(key);
    assert.ok(ticket);

    const phone = new SoftAuthenticator({ origin });
    const { data } = await api('POST', '/enroll/options', { body: { kind: 'hybrid', label: 'Phone', ticket }, auth: token });
    assert.deepEqual(data.options.hints, ['hybrid']);
    const res = await api('POST', '/enroll/verify', { body: { ceremony: data.ceremony, response: phone.register(data.options), ticket }, auth: token });
    assert.equal(res.status, 200);
    assert.equal(res.data.recoveryCodes, undefined, 'recovery codes come only with the first factor');

    assert.equal((await api('POST', '/factors/password', { body: { password: TOO_SHORT, ticket }, auth: token })).status, 400);
    assert.equal((await api('POST', '/factors/password', { body: { password: PASSPHRASE, ticket }, auth: token })).status, 200);
    const { data: f } = await api('GET', '/factors');
    assert.equal(f.factors.credentials.length, 2);
    assert.equal(f.factors.password, true);
    assert.equal(JSON.stringify(f).includes('publicKey'), false, '/factors exposes no key material');
  });

  test('an enrolled authenticator is excluded from enrolling again', async () => {
    const ticket = await ticketWith(key);
    const { data } = await api('POST', '/enroll/options', { body: { kind: 'platform', ticket }, auth: token });
    assert.ok(data.options.excludeCredentials.some((c) => c.id === key.register(data.options).id));
  });

  test('factors file is private', { skip: process.platform === 'win32' }, () => {
    assert.equal(fs.statSync(path.join(paths.dir, 'factors.json')).mode & 0o777, 0o600);
  });
});

describe('approving', () => {
  test('box asks → pending; a token is not a factor', async () => {
    const r = await newRequest({ agent: 'claude', file: '/w/a.js', reason: 'debug output', excerpt: 'print(x)' });
    assert.equal(r.status, 'pending');
    assert.equal(r.approve, `${origin}/approve/${r.id}`);
    assert.equal((await api('POST', `/requests/${r.id}/approve`, { body: { scope: 'session' }, auth: token })).status, 404);
    assert.equal((await api('GET', `/requests/${r.id}`)).data.request.status, 'pending');
  });

  test('an enrolled authenticator approves → a grant the box\'s public key accepts', async () => {
    const r = await newRequest({ file: '/w/a.js' });
    const { status, data } = await approveWith(key, r.id, { scope: 'minutes', minutes: 15 });
    assert.equal(status, 200, JSON.stringify(data));
    assert.equal(verifyGrant(data.grant, fs.readFileSync(paths.publicKey, 'utf8')), true);
    assert.equal(data.grant.payload.scope, 'minutes');
    assert.equal(data.grant.payload.exp - data.grant.payload.iat, 15 * 60_000);
    assert.equal(data.request.via.startsWith('webauthn:'), true);
    const live = (await api('GET', `/grants?session=${SESSION}`)).data.grants;
    assert.ok(live.some((g) => g.payload.id === data.grant.payload.id));
    assert.equal((await api('POST', `/approve/${r.id}/options`, { body: { scope: 'call' } })).status, 409, 'an approved request stays approved');
  });

  test('an authenticator that was never enrolled is refused', async () => {
    const r = await newRequest();
    assert.equal((await approveWith(new SoftAuthenticator({ origin }), r.id)).status, 401);
  });

  test('presence without user verification (no fingerprint/PIN) is refused', async () => {
    const r = await newRequest();
    assert.equal((await approveWith(key, r.id, { scope: 'call' }, { userVerified: false })).status, 401);
  });

  test('a proof cannot be moved to another request, or replayed', async () => {
    const a = await newRequest();
    const b = await newRequest();
    const { data } = await api('POST', `/approve/${a.id}/options`, { body: { scope: 'session' } });
    const response = key.assert(data.options);
    assert.equal((await api('POST', `/approve/${b.id}/verify`, { body: { ceremony: data.ceremony, response } })).status, 400);
    // consumed by that attempt, so even the right request cannot use it now
    assert.equal((await api('POST', `/approve/${a.id}/verify`, { body: { ceremony: data.ceremony, response } })).status, 401);
  });

  test('a proof made for another origin is refused', async () => {
    const r = await newRequest();
    const { data } = await api('POST', `/approve/${r.id}/options`, { body: { scope: 'call' } });
    key.origin = 'http://localhost.evil.example';
    const response = key.assert(data.options);
    key.origin = origin;
    assert.equal((await api('POST', `/approve/${r.id}/verify`, { body: { ceremony: data.ceremony, response } })).status, 401);
  });

  test('scope is checked before any ceremony starts', async () => {
    const r = await newRequest();
    assert.equal((await api('POST', `/approve/${r.id}/options`, { body: { scope: 'forever' } })).status, 400);
    assert.equal((await api('POST', `/approve/${r.id}/options`, { body: { scope: 'minutes', minutes: 9999 } })).status, 400);
  });

  test('password approves; recovery codes approve once each', async () => {
    const r = await newRequest();
    assert.equal((await api('POST', `/approve/${r.id}/password`, { body: { scope: 'call', password: PASSPHRASE } })).data.request.via, 'password');
    const r2 = await newRequest();
    assert.equal((await api('POST', `/approve/${r2.id}/recovery`, { body: { scope: 'call', code: recoveryCodes[0] } })).status, 200);
    const r3 = await newRequest();
    assert.equal((await api('POST', `/approve/${r3.id}/recovery`, { body: { scope: 'call', code: recoveryCodes[0] } })).status, 401);
    assert.equal((await api('GET', '/factors')).data.factors.recoveryLeft, 9);
  });

  test('deny is final', async () => {
    const r = await newRequest();
    assert.equal((await api('POST', `/requests/${r.id}/deny`)).data.request.status, 'denied');
    assert.equal((await api('POST', `/approve/${r.id}/options`, { body: { scope: 'call' } })).status, 409);
  });

  test('a one-call grant is gone once consumed', async () => {
    const r = await newRequest({ rule: 'one-shot' });
    const { data: { grant } } = await approveWith(key, r.id, { scope: 'call' });
    assert.equal((await api('POST', `/grants/${grant.payload.id}/consume`, { body: { session: 'other' } })).status, 404);
    assert.equal((await api('POST', `/grants/${grant.payload.id}/consume`, { body: { session: SESSION } })).status, 200);
    const live = (await api('GET', `/grants?session=${SESSION}`)).data.grants;
    assert.ok(!live.some((g) => g.payload.id === grant.payload.id));
  });

  test('requests need a rule and a session; oversize fields are clipped', async () => {
    assert.equal((await api('POST', '/requests', { body: { session: SESSION } })).status, 400);
    const r = await newRequest({ excerpt: 'x'.repeat(10_000) });
    assert.ok(r.excerpt.length <= 4001);
  });
});

describe('svc broker', () => {
  test('ungated verbs run the fixed argv', async () => {
    dockerCalls.length = 0;
    const { status, data } = await api('POST', '/svc', { body: { verb: 'restart', args: ['graphify'], session: SESSION } });
    assert.equal(status, 200);
    assert.deepEqual(dockerCalls.at(-1), ['exec', 'coding-services', 'supervisorctl', 'restart', 'backend-services:graphify']);
    assert.equal(data.code, 0);
  });

  test('outside the vocabulary → 400, docker never called', async () => {
    dockerCalls.length = 0;
    assert.equal((await api('POST', '/svc', { body: { verb: 'run', args: ['-v', '/:/h', 'alpine'], session: SESSION } })).status, 400);
    assert.equal(dockerCalls.length, 0);
  });

  test('a gated verb asks first, runs after approval, and a one-call grant runs it once', async () => {
    dockerCalls.length = 0;
    const first = await api('POST', '/svc', { body: { verb: 'rebuild', session: SESSION } });
    assert.equal(first.status, 403);
    assert.equal(first.data.request.rule, 'svc:rebuild');
    assert.match(first.data.error, /\/approve\/[0-9a-f]{12}$/);
    assert.equal(dockerCalls.length, 0);

    assert.equal((await approveWith(key, first.data.request.id, { scope: 'call' })).status, 200);
    const second = await api('POST', '/svc', { body: { verb: 'rebuild', session: SESSION } });
    assert.equal(second.status, 200);
    assert.deepEqual(dockerCalls, [[...COMPOSE, 'build', 'coding-services'], [...COMPOSE, 'up', '-d', 'coding-services']]);

    assert.equal((await api('POST', '/svc', { body: { verb: 'rebuild', session: SESSION } })).status, 403);
  });
});

describe('pages and exposure', () => {
  test('pages load on localhost with a CSP that forbids inline script and framing', async () => {
    const r = await newRequest();
    const res = await fetch(`${base}/approve/${r.id}`, { headers: { host: new URL(origin).host } });
    assert.equal(res.status, 200);
    const csp = res.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.doesNotMatch(await res.text(), /<script>/, 'no inline script');
    assert.equal((await fetch(`${base}/assets/webauthn.js`)).status, 200);
  });

  test('127.0.0.1 page loads move to localhost (WebAuthn refuses IP origins)', async () => {
    const res = await fetch(`${base}/enroll`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), `${origin}/enroll`);
  });

  test('only the fixed asset map is served', async () => {
    for (const p of ['/assets/../factors.json', '/assets/approver.token', '/approve/../../etc/passwd', '/lib/guard/ui/guard-ui.js']) {
      assert.notEqual((await fetch(`${base}${p}`, { headers: { host: new URL(origin).host } })).status, 200, p);
    }
  });

  test('a foreign page cannot write; the guard\'s own page can', async () => {
    assert.equal((await api('POST', '/requests', { body: { rule: 'r', session: SESSION }, headers: { origin: 'https://evil.example' } })).status, 403);
    const r = await newRequest();
    assert.equal((await api('POST', `/requests/${r.id}/deny`, { headers: { origin } })).status, 200);
  });

  test('token routes other than enrolment refuse any browser Origin', async () => {
    const res = await fetch(`${base}/audit`, { headers: { authorization: `Bearer ${token}`, origin } });
    assert.equal(res.status, 403);
  });

  test('a DNS-rebinding Host is refused', async () => {
    const res = await new Promise((resolve) => {
      http.get(`${base}/health`, { headers: { host: 'evil.example' } }, resolve);
    });
    assert.equal(res.statusCode, 403);
    res.resume();
  });

  test('key and token are private; the public dir holds only the public key', { skip: process.platform === 'win32' }, () => {
    assert.equal(fs.statSync(paths.dir).mode & 0o777, 0o700);
    assert.equal(fs.statSync(paths.signingKey).mode & 0o777, 0o600);
    assert.equal(fs.statSync(paths.token).mode & 0o777, 0o600);
    assert.deepEqual(fs.readdirSync(paths.publicDir), ['guard-public.pem']);
    assert.match(fs.readFileSync(paths.publicKey, 'utf8'), /BEGIN PUBLIC KEY/);
  });
});

describe('lockout', () => {
  test('five wrong passwords lock password and recovery approval; an authenticator still works', async () => {
    // A success resets the counter, so earlier tests' failures do not count here.
    const warmup = await newRequest();
    assert.equal((await api('POST', `/approve/${warmup.id}/password`, { body: { scope: 'call', password: PASSPHRASE } })).status, 200);
    const r = await newRequest();
    for (let i = 0; i < 5; i++) {
      const guess = randomBytes(9).toString('hex');
      assert.equal((await api('POST', `/approve/${r.id}/password`, { body: { scope: 'call', password: guess } })).status, 401);
    }
    assert.equal((await api('POST', `/approve/${r.id}/password`, { body: { scope: 'call', password: PASSPHRASE } })).status, 429);
    assert.equal((await api('POST', `/approve/${r.id}/recovery`, { body: { scope: 'call', code: recoveryCodes[1] } })).status, 429);
    assert.equal((await api('GET', '/factors')).data.factors.locked, true);
    assert.equal((await approveWith(key, r.id)).status, 200);
  });
});

describe('audit', () => {
  test('every decision is in the log, and the chain is intact', async () => {
    const { data } = await api('GET', '/audit?limit=500', { auth: token });
    assert.equal(data.chain.ok, true);
    const events = new Set(readAudit(paths.audit, { limit: 1000 }).map((e) => e.event));
    for (const e of ['request.created', 'request.approved', 'request.denied', 'grant.consumed', 'svc.run', 'svc.refused',
      'factor.enrolled', 'factor.failed', 'factor.locked', 'factor.recovery-used']) {
      assert.ok(events.has(e), e);
    }
    assert.equal(verifyAudit(paths.audit).ok, true);
  });

  test('host notes need the token', async () => {
    assert.equal((await api('POST', '/note', { body: { event: 'box.bypass' } })).status, 401);
    const { data } = await api('POST', '/note', { body: { event: 'box.bypass', agent: 'claude', via: 'flag' }, auth: token });
    assert.equal(data.entry.event, 'host.box.bypass');
  });
});
