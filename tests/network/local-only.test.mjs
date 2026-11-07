/**
 * Local-only exposure of the host services (lib/network/local-only.mjs).
 *
 * Pins the three doors it closes: listening on the LAN, DNS rebinding (foreign
 * Host header), and cross-site writes from a web page (foreign Origin) — and
 * that the legitimate callers (loopback browsers, containers via
 * host.docker.internal, Origin-less CLI clients) still get through.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import express from 'express';
import {
  listenAddresses,
  listenLocal,
  isAllowedHost,
  isAllowedOrigin,
  localOnly,
} from '../../lib/network/local-only.mjs';

describe('listenAddresses', () => {
  test('loopback in both families by default', () => {
    assert.deepStrictEqual(listenAddresses({ env: {}, interfaces: {} }), ['127.0.0.1', '::1']);
  });

  test('adds docker0 IPv4 (native Linux: host.docker.internal = docker0)', () => {
    const interfaces = { docker0: [{ family: 'IPv4', address: '172.17.0.1' }, { family: 'IPv6', address: 'fe80::1' }] };
    assert.deepStrictEqual(listenAddresses({ env: {}, interfaces }), ['127.0.0.1', '::1', '172.17.0.1']);
  });

  test('never an unspecified address unless explicitly asked for', () => {
    const addrs = listenAddresses({ env: {}, interfaces: { en0: [{ family: 'IPv4', address: '192.168.1.5' }] } });
    assert.ok(!addrs.includes('0.0.0.0') && !addrs.includes('::') && !addrs.includes('192.168.1.5'));
    assert.deepStrictEqual(listenAddresses({ env: { CODING_BIND_HOST: '0.0.0.0' }, interfaces: {} }), ['0.0.0.0']);
  });
});

describe('isAllowedHost', () => {
  for (const host of ['localhost:12436', '127.0.0.1:3034', '[::1]:12436', 'host.docker.internal:3034', '172.17.0.1:3034', 'localhost']) {
    test(`accepts ${host}`, () => assert.strictEqual(isAllowedHost(host, {}), true));
  }
  for (const host of ['evil.example:12436', 'rebind.attacker.test', '', undefined]) {
    test(`rejects ${host}`, () => assert.strictEqual(isAllowedHost(host, {}), false));
  }
  test('CODING_ALLOWED_HOSTS extends the list', () => {
    assert.strictEqual(isAllowedHost('devbox.lan:3034', { CODING_ALLOWED_HOSTS: 'devbox.lan' }), true);
  });
});

describe('isAllowedOrigin', () => {
  for (const origin of ['http://localhost:3032', 'http://127.0.0.1:5173', 'http://[::1]:12436', 'http://viewer.localhost:8080']) {
    test(`accepts ${origin}`, () => assert.strictEqual(isAllowedOrigin(origin, {}), true));
  }
  for (const origin of ['https://evil.example', 'http://localhost.evil.example', 'null', '', undefined]) {
    test(`rejects ${origin}`, () => assert.strictEqual(isAllowedOrigin(origin, {}), false));
  }
});

describe('localOnly middleware', () => {
  let server;
  let port;

  before(async () => {
    const app = express();
    app.use(localOnly({ env: {} }));
    app.all('/thing', (_req, res) => res.json({ ok: true }));
    server = await new Promise((resolve) => {
      const s = listenLocal(app, 0, () => resolve(s));
    });
    port = server.address().port;
  });

  after(() => server.close());

  const request = (method, headers = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/thing', method, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res));
    });
    req.on('error', reject);
    req.end();
  });

  test('listens on loopback only', () => {
    assert.strictEqual(server.address().address, '127.0.0.1');
  });

  test('Origin-less client (curl, ETM, container) can write', async () => {
    assert.strictEqual((await request('POST')).statusCode, 200);
  });

  test('loopback page can write and gets CORS headers for its origin', async () => {
    const res = await request('PUT', { origin: 'http://localhost:3032' });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['access-control-allow-origin'], 'http://localhost:3032');
  });

  test('foreign page cannot write', async () => {
    assert.strictEqual((await request('PUT', { origin: 'https://evil.example' })).statusCode, 403);
    assert.strictEqual((await request('POST', { origin: 'https://evil.example' })).statusCode, 403);
  });

  test('foreign page preflight is refused, and no wildcard is ever sent', async () => {
    const res = await request('OPTIONS', { origin: 'https://evil.example', 'access-control-request-method': 'PUT' });
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.headers['access-control-allow-origin'], undefined);
  });

  test('foreign page GET runs but its origin is not granted read access', async () => {
    const res = await request('GET', { origin: 'https://evil.example' });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['access-control-allow-origin'], undefined);
  });

  test('DNS-rebinding Host header is refused even for GET', async () => {
    assert.strictEqual((await request('GET', { host: `evil.example:${port}` })).statusCode, 403);
  });
});
