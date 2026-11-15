// tests/routing.test.mjs — the routing history: token_usage rows the offload router
// wrote, read back as decisions (offloaded / failed / kept), on a DB of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const { routingHistory, routingRowOf, hostPortOf } = await import('../lib/glass/routing.mjs');

function db({ routing = true } = {}) {
  const d = new DatabaseSync(':memory:');
  d.exec(`CREATE TABLE token_usage (
    timestamp TEXT, agent TEXT, task_id TEXT, provider TEXT, model TEXT, upstream TEXT,
    input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER, latency_ms INTEGER
    ${routing ? ", route_key TEXT NOT NULL DEFAULT '', route_band TEXT NOT NULL DEFAULT '', band_source TEXT NOT NULL DEFAULT '', offloaded_from TEXT NOT NULL DEFAULT '', attempt_trail TEXT NOT NULL DEFAULT ''" : ''})`);
  return d;
}
const insert = (d, r) => {
  const cols = Object.keys(r);
  d.prepare(`INSERT INTO token_usage (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => r[c]));
};
const NOW = Date.parse('2026-11-15T12:00:00Z');
const ago = (min) => new Date(NOW - min * 60_000).toISOString();

function fixture() {
  const d = db();
  // offloaded: the endpoint answered
  insert(d, { timestamp: ago(1), agent: 'opencode', task_id: 't1', provider: 'team-box', model: 'm-small', upstream: 'http://192.0.2.1:8000/v1',
    input_tokens: 900, output_tokens: 40, cache_read_tokens: 0, cache_write_tokens: 0, latency_ms: 812,
    route_key: 'fg-chat/opencode', route_band: 'small', band_source: 'classifier', offloaded_from: 'github-copilot', attempt_trail: '' });
  // failed: tried the endpoint, fell back
  insert(d, { timestamp: ago(2), agent: 'pi', task_id: 't2', provider: 'github-copilot', model: 'gpt-x', upstream: 'https://api.githubcopilot.com',
    input_tokens: 500, output_tokens: 10, cache_read_tokens: 100, cache_write_tokens: 0, latency_ms: 2400,
    route_key: 'fg-chat/pi', route_band: 'small', band_source: 'caller', offloaded_from: '',
    attempt_trail: JSON.stringify({ attempts: [{ provider: 'team-box', model: 'm-small', error: 'timeout', ms: 2000 }] }) });
  // kept: the router looked and left it
  insert(d, { timestamp: ago(3), agent: 'opencode', task_id: 't1', provider: 'github-copilot', model: 'gpt-x', upstream: 'api.githubcopilot.com',
    input_tokens: 40000, output_tokens: 300, cache_read_tokens: 0, cache_write_tokens: 0, latency_ms: 5000,
    route_key: 'fg-chat/opencode', route_band: 'high', band_source: 'caller', offloaded_from: '',
    attempt_trail: JSON.stringify({ offloadSkipped: 'band high is not offloaded', classifier: 'not eligible: tool results' }) });
  // not a routing row at all
  insert(d, { timestamp: ago(4), agent: 'claude', task_id: 't3', provider: 'anthropic', model: 'claude-x', upstream: 'https://api.anthropic.com',
    input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, latency_ms: 10 });
  // outside a 1 h window
  insert(d, { timestamp: ago(180), agent: 'pi', task_id: 't4', provider: 'team-box', model: 'm-small', upstream: '192.0.2.2:8000',
    input_tokens: 10, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, latency_ms: 300,
    route_key: 'fg-chat/pi', route_band: 'small', band_source: 'caller', offloaded_from: 'github-copilot', attempt_trail: '' });
  return d;
}

test('hostPortOf: URLs and bare host:port alike', () => {
  assert.equal(hostPortOf('http://192.0.2.1:8000/v1'), '192.0.2.1:8000');
  assert.equal(hostPortOf('192.0.2.1:8000'), '192.0.2.1:8000');
  assert.equal(hostPortOf('https://api.githubcopilot.com'), 'api.githubcopilot.com');
  assert.equal(hostPortOf(''), '');
});

test('decisions in a window, newest first, each with its outcome and reason', () => {
  const h = routingHistory(fixture(), { hours: 1, now: NOW });
  assert.equal(h.available, true);
  assert.deepEqual(h.rows.map((r) => r.outcome), ['offloaded', 'failed', 'kept'], 'the non-routing row and the old one are left out');
  assert.deepEqual(h.counts, { offloaded: 1, failed: 1, kept: 1, routed: 0 });

  const [off, failed, kept] = h.rows;
  assert.equal(off.upstream, '192.0.2.1:8000');
  assert.equal(off.host, '192.0.2.1', 'the node a call was served by is matched on this');
  assert.equal(off.from, 'github-copilot');
  assert.equal(off.band, 'small');
  assert.equal(off.bandSource, 'classifier');
  assert.equal(off.latencyMs, 812);
  assert.deepEqual(off.tokens, { input: 900, output: 40, cacheRead: 0, cacheWrite: 0 });

  assert.deepEqual(failed.attempts, [{ provider: 'team-box', model: 'm-small', error: 'timeout', ms: 2000 }]);
  assert.equal(failed.provider, 'github-copilot', 'who answered after the fallback');

  assert.equal(kept.reason, 'band high is not offloaded');
  assert.equal(kept.classifier, 'not eligible: tool results');
});

test('all time and the limit', () => {
  const all = routingHistory(fixture(), { hours: 0, now: NOW });
  assert.equal(all.rows.length, 4);
  const two = routingHistory(fixture(), { hours: 0, limit: 2, now: NOW });
  assert.equal(two.rows.length, 2);
  assert.equal(two.truncated, true);
});

test('a DB from before the routing columns has nothing to show, and says so', () => {
  const h = routingHistory(db({ routing: false }), { hours: 24, now: NOW });
  assert.equal(h.available, false);
  assert.deepEqual(h.rows, []);
  assert.equal(routingHistory(null).available, false);
});

test('a malformed trail is no trail, not an error', () => {
  const r = routingRowOf({ timestamp: ago(0), route_key: 'fg-chat/pi', attempt_trail: '{oops', offloaded_from: '' });
  assert.equal(r.outcome, 'routed');
  assert.deepEqual(r.attempts, []);
});
