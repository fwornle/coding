/**
 * The Cluster tab's host-side routes (lib/cluster/cluster-routes.mjs), mounted on obs-api.
 *
 * Pinned: /api/cluster answers from the cluster poller (peek polls nothing); /api/routing
 * reads the token database read-only and says "not available" — not an error — when there
 * is no database yet.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

import { registerClusterRoutes, clusterHome } from '../../lib/cluster/cluster-routes.mjs';
import { openDb } from '../../lib/proxy/proxy-paths.cjs';

async function serve(app) {
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { get: async (p) => { const r = await fetch(base + p); return { status: r.status, body: await r.json() }; }, close: () => server.close() };
}

test('/api/cluster answers from the poller; peek=1 does not poll', async () => {
  const calls = [];
  const cluster = { peek: () => { calls.push('peek'); return { configured: true }; }, read: async () => { calls.push('read'); return { configured: true, nodes: [] }; } };
  const app = express();
  registerClusterRoutes(app, { cluster, dbPath: () => '/nonexistent' });
  const s = await serve(app);
  try {
    assert.deepEqual((await s.get('/api/cluster?peek=1')).body, { configured: true });
    assert.deepEqual((await s.get('/api/cluster')).body, { configured: true, nodes: [] });
    assert.deepEqual(calls, ['peek', 'read']);
  } finally { s.close(); }
});

test('/api/routing: no token database yet is "not available", not an error', async () => {
  const app = express();
  registerClusterRoutes(app, { cluster: { peek: () => ({}), read: async () => ({}) }, dbPath: () => path.join(os.tmpdir(), 'no-such-token-usage.db') });
  const s = await serve(app);
  try {
    const r = await s.get('/api/routing?hours=24');
    assert.equal(r.status, 200);
    assert.equal(r.body.available, false);
    assert.deepEqual(r.body.rows, []);
  } finally { s.close(); }
});

test('/api/routing reads the routing rows of the token database', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cluster-routes-'));
  const file = path.join(dir, 'token-usage.db');
  const db = openDb(file);
  db.exec(`CREATE TABLE token_usage (timestamp TEXT, agent TEXT, task_id TEXT, provider TEXT, model TEXT, upstream TEXT,
    route_key TEXT, route_band TEXT, band_source TEXT, offloaded_from TEXT, attempt_trail TEXT,
    input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER, latency_ms INTEGER)`);
  db.prepare(`INSERT INTO token_usage VALUES (?, 'opencode', 't1', 'local', 'qwen3.8-27b-dual', 'http://10.143.242.222:8000/v1',
    'fg-chat/opencode', 'small', 'caller', 'gh-copilot', '', 100, 20, 0, 0, 900)`).run(new Date().toISOString());
  db.close();

  const app = express();
  registerClusterRoutes(app, { cluster: { peek: () => ({}), read: async () => ({}) }, dbPath: () => file });
  const s = await serve(app);
  try {
    const r = await s.get('/api/routing?hours=24');
    assert.equal(r.body.available, true);
    assert.equal(r.body.rows.length, 1);
    assert.equal(r.body.rows[0].outcome, 'offloaded');
    assert.equal(r.body.rows[0].host, '10.143.242.222');
  } finally { s.close(); }
});

test('the cluster is configured where glass keeps it, GLASS_HOME moving it', () => {
  assert.equal(clusterHome({ GLASS_HOME: '/x/glass' }), '/x/glass');
  assert.equal(clusterHome({}), path.join(os.homedir(), '.glass'));
});
