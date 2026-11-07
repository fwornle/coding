/**
 * The host guard daemon (scripts/coding-guard-daemon.mjs) over real HTTP, with a
 * temp guard home and a fake docker. What it must hold:
 *   - the box can ask, never approve (approver token, mounted nowhere)
 *   - what it signs verifies with the public key the box gets
 *   - gated `svc` verbs run only after an approval, one-call grants once
 *   - browsers and rebinding hosts are refused
 *   - keys and token are private files
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { createGuard } from '../../scripts/coding-guard-daemon.mjs';
import { guardPaths } from '../../lib/guard/home.mjs';
import { verifyGrant } from '../../lib/guard/grants.mjs';
import { verifyAudit, readAudit } from '../../lib/guard/audit.mjs';

const SESSION = 'coding-box-claude-42';
const COMPOSE = ['compose', '-f', '/repo/docker/docker-compose.yml'];
let server;
let base;
let paths;
let token;
const dockerCalls = [];

async function api(method, route, { body, auth, headers = {} } = {}) {
  const h = { 'content-type': 'application/json', ...headers };
  if (auth) h.authorization = `Bearer ${auth}`;
  const res = await fetch(`${base}${route}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json() };
}

before(async () => {
  paths = guardPaths(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-home-')));
  const guard = createGuard({
    paths,
    codingRepo: '/repo',
    runDocker: async (argv) => {
      dockerCalls.push(argv);
      if (argv.includes('status') && argv.includes('supervisorctl')) {
        return { code: 0, stdout: 'backend-services:graphify RUNNING pid 1\n', stderr: '' };
      }
      return { code: 0, stdout: `ran ${argv.join(' ')}\n`, stderr: '' };
    },
  });
  token = fs.readFileSync(paths.token, 'utf8').trim();
  server = http.createServer(guard.handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

describe('override requests and grants', () => {
  test('box asks → pending; without the token it cannot approve', async () => {
    const { status, data } = await api('POST', '/requests', { body: { rule: 'no-console-log', session: SESSION, agent: 'claude', file: '/w/a.js', reason: 'debug output', excerpt: 'print(x)' } });
    assert.equal(status, 201);
    assert.equal(data.request.status, 'pending');
    const id = data.request.id;

    assert.equal((await api('POST', `/requests/${id}/approve`, { body: { scope: 'session' } })).status, 401);
    assert.equal((await api('POST', `/requests/${id}/approve`, { body: { scope: 'session' }, auth: '0'.repeat(64) })).status, 401);
    assert.equal((await api('GET', `/requests/${id}`)).data.request.status, 'pending');
  });

  test('the host approves → a grant that verifies with the box\'s public key', async () => {
    const { data: { request } } = await api('POST', '/requests', { body: { rule: 'no-console-log', session: SESSION, file: '/w/a.js' } });
    const { status, data } = await api('POST', `/requests/${request.id}/approve`, { body: { scope: 'minutes', minutes: 15 }, auth: token });
    assert.equal(status, 200);
    const pub = fs.readFileSync(paths.publicKey, 'utf8');
    assert.equal(verifyGrant(data.grant, pub), true);
    assert.equal(data.grant.payload.rule, 'no-console-log');
    assert.equal(data.grant.payload.session, SESSION);

    const live = (await api('GET', `/grants?session=${SESSION}`)).data.grants;
    assert.ok(live.some((g) => g.payload.id === data.grant.payload.id));
    assert.equal((await api('GET', '/grants?session=someone-else')).data.grants.length, 0);
    assert.equal((await api('POST', `/requests/${request.id}/approve`, { body: {}, auth: token })).status, 409);
  });

  test('deny is final', async () => {
    const { data: { request } } = await api('POST', '/requests', { body: { rule: 'r', session: SESSION } });
    assert.equal((await api('POST', `/requests/${request.id}/deny`, { auth: token })).data.request.status, 'denied');
    assert.equal((await api('POST', `/requests/${request.id}/approve`, { body: {}, auth: token })).status, 409);
  });

  test('a one-call grant is gone once consumed', async () => {
    const { data: { request } } = await api('POST', '/requests', { body: { rule: 'one-shot', session: SESSION } });
    const { data: { grant } } = await api('POST', `/requests/${request.id}/approve`, { body: { scope: 'call' }, auth: token });
    assert.equal((await api('POST', `/grants/${grant.payload.id}/consume`, { body: { session: 'other' } })).status, 404);
    assert.equal((await api('POST', `/grants/${grant.payload.id}/consume`, { body: { session: SESSION } })).status, 200);
    const live = (await api('GET', `/grants?session=${SESSION}`)).data.grants;
    assert.ok(!live.some((g) => g.payload.id === grant.payload.id));
  });

  test('requests need a rule and a session; oversize fields are clipped', async () => {
    assert.equal((await api('POST', '/requests', { body: { session: SESSION } })).status, 400);
    const { data } = await api('POST', '/requests', { body: { rule: 'r', session: SESSION, excerpt: 'x'.repeat(10_000) } });
    assert.ok(data.request.excerpt.length <= 4001);
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
    assert.equal(dockerCalls.length, 0);

    await api('POST', `/requests/${first.data.request.id}/approve`, { body: { scope: 'call' }, auth: token });
    const second = await api('POST', '/svc', { body: { verb: 'rebuild', session: SESSION } });
    assert.equal(second.status, 200);
    assert.deepEqual(dockerCalls, [[...COMPOSE, 'build', 'coding-services'], [...COMPOSE, 'up', '-d', 'coding-services']]);

    assert.equal((await api('POST', '/svc', { body: { verb: 'rebuild', session: SESSION } })).status, 403);
  });
});

describe('exposure', () => {
  test('a browser cannot write, and approver routes refuse any Origin', async () => {
    assert.equal((await api('POST', '/requests', { body: { rule: 'r', session: SESSION }, headers: { origin: 'https://evil.example' } })).status, 403);
    const res = await fetch(`${base}/audit`, { headers: { authorization: `Bearer ${token}`, origin: 'http://localhost:3032' } });
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

describe('audit', () => {
  test('every decision is in the log, and the chain is intact', async () => {
    const { data } = await api('GET', '/audit?limit=500', { auth: token });
    assert.equal(data.chain.ok, true);
    const events = new Set(readAudit(paths.audit, { limit: 1000 }).map((e) => e.event));
    for (const e of ['request.created', 'request.approved', 'request.denied', 'grant.consumed', 'svc.run', 'svc.refused']) {
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
