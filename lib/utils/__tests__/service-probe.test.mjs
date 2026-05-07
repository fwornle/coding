/**
 * Service-probe unit tests — Phase 33 G1 closure (plan 33-09 Task 1).
 *
 * Asserts the probeHttpHealth + probeTcpPort contract documented in the plan:
 *   - HTTP 2xx/3xx → 'running'
 *   - HTTP 5xx → 'stopped' (with 'HTTP 500' error message)
 *   - bad URL → 'unknown' (NEVER 'healthy' — SPEC R6)
 *   - TCP connect to listening port → 'running'
 *   - TCP connect to closed port → 'stopped'
 *   - TCP connect timeout → 'stopped' with 'timeout'
 *
 * Pattern: matches scripts/__tests__/health-coordinator/rules-schema.test.mjs (node:test).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { probeHttpHealth, probeTcpPort } from '../service-probe.js';

/**
 * Spin up an ephemeral HTTP server on a random port that responds with `code`.
 * Returns { port, close } for the caller to tear down.
 */
function makeHttpServer(code = 200, body = 'ok') {
  const srv = http.createServer((_req, res) => {
    res.writeHead(code, { 'Content-Type': 'text/plain' });
    res.end(body);
  });
  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      resolve({
        port,
        close: () => new Promise((r) => srv.close(() => r()))
      });
    });
  });
}

/**
 * Spin up an ephemeral TCP server that accepts connections but sends no data.
 * Returns { port, close } for the caller to tear down.
 */
function makeTcpServer() {
  const srv = net.createServer(() => { /* accept and hold */ });
  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      resolve({
        port,
        close: () => new Promise((r) => srv.close(() => r()))
      });
    });
  });
}

test('probeHttpHealth: 200 OK on live endpoint → running with latency', async () => {
  const srv = await makeHttpServer(200);
  try {
    const r = await probeHttpHealth(`http://127.0.0.1:${srv.port}/health`, 3000);
    assert.equal(r.status, 'running');
    assert.equal(typeof r.latency_ms, 'number');
    assert.ok(r.latency_ms >= 0);
    assert.equal(r.error, null);
  } finally {
    await srv.close();
  }
});

test('probeHttpHealth: HTTP 500 → stopped with HTTP 500 error', async () => {
  const srv = await makeHttpServer(500);
  try {
    const r = await probeHttpHealth(`http://127.0.0.1:${srv.port}/`, 3000);
    assert.equal(r.status, 'stopped');
    assert.equal(typeof r.latency_ms, 'number');
    assert.equal(r.error, 'HTTP 500');
  } finally {
    await srv.close();
  }
});

test('probeHttpHealth: connection refused → stopped (NEVER healthy)', async () => {
  // Port 1 is reserved (TCPMUX) and effectively never listening on localhost
  const r = await probeHttpHealth('http://127.0.0.1:1/nope', 500);
  assert.equal(r.status, 'stopped');
  assert.notEqual(r.status, 'healthy');
  assert.equal(r.latency_ms, null);
  assert.ok(r.error, 'error message present');
});

test('probeHttpHealth: malformed URL → unknown (NEVER healthy — SPEC R6)', async () => {
  const r = await probeHttpHealth('not-a-url', 500);
  assert.equal(r.status, 'unknown');
  assert.notEqual(r.status, 'healthy');
  assert.equal(r.latency_ms, null);
  assert.ok(r.error, 'error message present');
});

test('probeHttpHealth: empty/null endpoint → unknown', async () => {
  const r1 = await probeHttpHealth('', 500);
  assert.equal(r1.status, 'unknown');
  const r2 = await probeHttpHealth(null, 500);
  assert.equal(r2.status, 'unknown');
});

test('probeTcpPort: connect to listening port → running with latency', async () => {
  const srv = await makeTcpServer();
  try {
    const r = await probeTcpPort('127.0.0.1', srv.port, 1000);
    assert.equal(r.status, 'running');
    assert.equal(typeof r.latency_ms, 'number');
    assert.ok(r.latency_ms >= 0);
    assert.equal(r.error, null);
  } finally {
    await srv.close();
  }
});

test('probeTcpPort: connect to closed port → stopped (NEVER healthy)', async () => {
  // Port 1 is effectively always closed on localhost
  const r = await probeTcpPort('127.0.0.1', 1, 500);
  assert.equal(r.status, 'stopped');
  assert.notEqual(r.status, 'healthy');
  assert.equal(r.latency_ms, null);
  assert.ok(r.error, 'error message present (e.g. ECONNREFUSED)');
});

test('probeTcpPort: invalid port → unknown', async () => {
  const r1 = await probeTcpPort('127.0.0.1', 0, 500);
  assert.equal(r1.status, 'unknown');
  const r2 = await probeTcpPort('127.0.0.1', 99999, 500);
  assert.equal(r2.status, 'unknown');
  const r3 = await probeTcpPort('', 1234, 500);
  assert.equal(r3.status, 'unknown');
});

test('probeTcpPort: timeout → stopped with timeout error', async () => {
  // 10.255.255.1 is non-routable per RFC 5737-ish (private space, but
  // typically no route on dev laptops) — connection should hang and time out.
  // Use a very short timeout to keep test fast.
  const r = await probeTcpPort('10.255.255.1', 12345, 200);
  assert.equal(r.status, 'stopped');
  assert.notEqual(r.status, 'healthy');
  // error may be 'timeout' or 'EHOSTUNREACH' / 'ENETUNREACH' depending on platform routing
  assert.ok(r.error, 'error message present');
});
