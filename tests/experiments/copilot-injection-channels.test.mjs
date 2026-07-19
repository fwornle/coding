// tests/experiments/copilot-injection-channels.test.mjs
//
// End-to-end mechanics of the multi-channel Copilot injector
// (src/hooks/knowledge-injection-copilot-posttool.js). Deterministic: retrieval is a LOCAL
// stub bound on an ephemeral port (via CODING_RETRIEVAL_PORT), so no live service needed.
// Run: node --test <file>.
//
// What this locks (the "inject once, upgrade-safe" contract):
//   - 1.0.72-1  → uPS-only plan: prompt injects, postToolUse no-ops (single injection).
//   - 1.0.71    → postToolUse-only plan: prompt stashes, first tool injects, second deduped.
//   - unknown   → fail-safe: BOTH channels inject (dup tolerated to guarantee delivery).
//   - invalid prompts (short / slash) never inject.
//   - retrieval runs AT MOST ONCE per turn (stub hit-count asserted).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const INJ = path.join(REPO, 'src', 'hooks', 'knowledge-injection-copilot-posttool.js');

let server;
let port = 0;
let hits = 0;

before(async () => {
  server = http.createServer((req, res) => {
    hits += 1;
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ markdown: '## Insights\n- STUB-KB-CONTENT', meta: { results_count: 1 } }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  port = server.address().port;
});

after(async () => { await new Promise((r) => server.close(r)); });

function run(mode, { version, sessionId, prompt }) {
  return new Promise((resolve) => {
    const env = { ...process.env, CODING_RETRIEVAL_PORT: String(port) };
    if (version) env.COPILOT_VERSION = version; else delete env.COPILOT_VERSION;
    delete env.COPILOT_KB_CHANNELS;
    delete env.CODING_KNOWLEDGE_INJECTION;
    const ch = spawn('node', [INJ, mode], { env });
    let out = '';
    ch.stdout.on('data', (d) => (out += d));
    ch.on('close', () => { try { resolve(JSON.parse(out)); } catch { resolve({ __raw: out }); } });
    ch.stdin.write(JSON.stringify({ sessionId, prompt: prompt ?? '', cwd: REPO }));
    ch.stdin.end();
  });
}
const injects = (o) => typeof o.additionalContext === 'string' && o.additionalContext.includes('STUB-KB-CONTENT');
const P = 'a substantive multi word prompt that should trigger retrieval and injection';

test('1.0.72-1: uPS-only — prompt injects once, tool no-ops, retrieval hit once', async () => {
  hits = 0;
  const sid = 'u172-' + Date.now();
  const p = await run('prompt', { version: '1.0.72-1', sessionId: sid, prompt: P });
  const t = await run('tool', { version: '1.0.72-1', sessionId: sid });
  assert.ok(injects(p), 'prompt(uPS) should inject');
  assert.ok(!injects(t), 'tool(postToolUse) should no-op (uPS owns turn)');
  assert.equal(hits, 1, 'retrieval should run exactly once for the turn');
});

test('1.0.71: postToolUse-only — prompt stashes, first tool injects, second deduped', async () => {
  hits = 0;
  const sid = 'u171-' + Date.now();
  const p = await run('prompt', { version: '1.0.71', sessionId: sid, prompt: P });
  const t1 = await run('tool', { version: '1.0.71', sessionId: sid });
  const t2 = await run('tool', { version: '1.0.71', sessionId: sid });
  assert.ok(!injects(p), 'prompt(uPS) should no-op on 1.0.71 (just stash)');
  assert.ok(injects(t1), 'first tool should inject');
  assert.ok(!injects(t2), 'second tool should be deduped');
  assert.equal(hits, 1, 'retrieval should run exactly once (no retrieval on the stash, one on first tool)');
});

test('unknown newer version: fail-safe injects on BOTH channels, retrieval still once', async () => {
  hits = 0;
  const sid = 'u110-' + Date.now();
  const p = await run('prompt', { version: '1.1.0', sessionId: sid, prompt: P });
  const t = await run('tool', { version: '1.1.0', sessionId: sid });
  assert.ok(injects(p), 'prompt(uPS) should inject under fail-safe');
  assert.ok(injects(t), 'tool(postToolUse) should also inject under fail-safe');
  assert.equal(hits, 1, 'block is cached after prompt-mode retrieval; tool reuses it (no 2nd HTTP)');
});

test('invalid prompts never inject', async () => {
  const sidShort = 'short-' + Date.now();
  const pShort = await run('prompt', { version: '1.0.72-1', sessionId: sidShort, prompt: 'hi' });
  const tShort = await run('tool', { version: '1.0.71', sessionId: sidShort });
  assert.ok(!injects(pShort), 'short prompt should not inject');
  assert.ok(!injects(tShort), 'tool should no-op when stash is marked invalid');

  const sidSlash = 'slash-' + Date.now();
  const pSlash = await run('prompt', { version: '1.0.72-1', sessionId: sidSlash, prompt: '/clear the whole context' });
  assert.ok(!injects(pSlash), 'slash command should not inject');
});

test('CODING_KNOWLEDGE_INJECTION=0 disables injection on every channel', async () => {
  const sid = 'off-' + Date.now();
  const env = { CODING_KNOWLEDGE_INJECTION: '0' };
  const runOff = (mode) => new Promise((resolve) => {
    const ch = spawn('node', [INJ, mode], { env: { ...process.env, ...env, CODING_RETRIEVAL_PORT: String(port), COPILOT_VERSION: '1.0.72-1' } });
    let out = ''; ch.stdout.on('data', (d) => (out += d));
    ch.on('close', () => { try { resolve(JSON.parse(out)); } catch { resolve({ __raw: out }); } });
    ch.stdin.write(JSON.stringify({ sessionId: sid, prompt: P, cwd: REPO })); ch.stdin.end();
  });
  assert.ok(!injects(await runOff('prompt')), 'prompt should no-op when disabled');
  assert.ok(!injects(await runOff('tool')), 'tool should no-op when disabled');
});
