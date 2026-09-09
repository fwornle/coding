/**
 * The judge's SECRET path — how the bearer token gets from disk into the
 * Authorization header, and the two ways it silently did not.
 *
 * ── What this file is defending ─────────────────────────────────────────────
 * config/prompt-classifier.yaml lets a backend name the variable it
 * authenticates with (`api_key_env: QWEN_LOCAL_API_KEY`), and askBackend()
 * reads `process.env[that]`. Nothing ever put it there. The launchd job
 * (com.coding.prompt-classifier) execs node directly with an
 * `EnvironmentVariables` block containing only PATH, and the service loaded no
 * .env — so the variable was structurally always undefined.
 *
 * Measured on the live service before the fix:
 *
 *     counts: { asked: 18, answered: 0, failed: 18 }
 *     qwen-local  lastError: "QWEN_LOCAL_API_KEY not set"
 *
 * The judge had never once returned a verdict. It failed open, which is the
 * designed behaviour and exactly why nobody noticed: every caller kept its own
 * band and the system looked fine, while the component that exists to correct
 * those bands contributed nothing at all. A silent no-op is the failure mode
 * worth a test, precisely because nothing else reports it.
 *
 * These assertions pin the whole chain end to end — .env on disk -> process.env
 * -> Authorization header on the wire — against a stub backend, because that is
 * the only claim that matters and every link in it has already been wrong.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SERVICE = path.join(REPO, 'scripts', 'prompt-classifier-service.mjs');

/** Ports well away from the real service (12437) so a live daemon is untouched. */
const STUB_PORT = 18191;
const NET_PORT = 18192;
const SVC_PORT = 18193;

const KEY = 'test-key-4f2a9c';

let tmp;

/** A backend that records the Authorization header it was handed. */
function startStub() {
  const state = { auth: undefined };
  const srv = http.createServer((req, res) => {
    state.auth = req.headers.authorization ?? null;
    // The body is drained rather than read: the request must be consumed before
    // responding, but nothing here asserts on the prompt.
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'small' } }] }));
    });
  });
  return { srv, state, listen: () => new Promise(r => srv.listen(STUB_PORT, '127.0.0.1', r)) };
}

/**
 * The proxy's /health, stubbed. The service takes the live network from there
 * and would otherwise sit on its 60s cache of a real (or absent) proxy.
 */
function startNetwork(mode = 'public') {
  const srv = http.createServer((_q, s) => {
    s.writeHead(200, { 'content-type': 'application/json' });
    s.end(JSON.stringify({ networkMode: mode }));
  });
  return { srv, listen: () => new Promise(r => srv.listen(NET_PORT, '127.0.0.1', r)) };
}

/**
 * Run the REAL service as a child, with `env` merged over a base that has the
 * key deliberately ABSENT — so anything that arrives can only have come from
 * the .env file under test.
 *
 * `env -u` is not enough here: the ambient shell on a developer machine may
 * export a stale QWEN_LOCAL_API_KEY (one did, during this work), and a test
 * that inherits it would pass while proving nothing.
 */
async function withService(env, fn) {
  const base = { ...process.env };
  delete base.QWEN_LOCAL_API_KEY;
  const child = spawn(process.execPath, [SERVICE], {
    env: {
      ...base,
      CLASSIFIER_SERVICE_PORT: String(SVC_PORT),
      CLASSIFIER_CONFIG: path.join(tmp, 'cfg.yaml'),
      CLASSIFIER_NETWORK_SOURCE: `http://127.0.0.1:${NET_PORT}/health`,
      CLASSIFIER_KEEPALIVE_MS: '0',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.resume();
  child.stderr.resume();
  try {
    await waitForHealth();
    return await fn();
  } finally {
    child.kill('SIGKILL');
  }
}

async function waitForHealth(attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${SVC_PORT}/health`);
      if (r.ok) return await r.json();
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('classifier service did not come up');
}

function classify(text = 'what is 2+2') {
  return fetch(`http://127.0.0.1:${SVC_PORT}/classify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  }).then(async r => ({ status: r.status, body: await r.json() }));
}

describe('the judge reads its bearer token from .env', () => {
  let stub;
  let net;

  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-secret-'));
    fs.writeFileSync(path.join(tmp, 'cfg.yaml'), [
      'backends:',
      '  - id: qwen-local',
      `    base_url: http://127.0.0.1:${STUB_PORT}/v1`,
      '    model: qwen3.8-27b-dual-fast',
      '    api_key_env: QWEN_LOCAL_API_KEY',
      '    require_network: public',
      '    enabled: true',
      '    timeout_ms: 5000',
      'strategy: llm',
      'knn:',
      '  model_path: .data/prompt-classifier/knn-model.json',
      '  cache_dir: .data/fastembed-cache',
      '  fallback_to_llm: true',
      'rubric: |',
      '  You route requests to a model tier. Answer with EXACTLY one word: small, medium, or high.',
      '  small  = trivial.',
      '  medium = ordinary.',
      '  high   = hard.',
      '',
    ].join('\n'));

    stub = startStub();
    net = startNetwork('public');
    await stub.listen();
    await net.listen();
  });

  after(() => {
    stub?.srv.close();
    net?.srv.close();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('THE REGRESSION: a key on disk reaches the wire, and a verdict comes back', async () => {
    const envFile = path.join(tmp, 'with-key.env');
    fs.writeFileSync(envFile, `QWEN_LOCAL_API_KEY=${KEY}\n`);
    stub.state.auth = undefined;

    await withService({ CLASSIFIER_ENV_FILE: envFile }, async () => {
      const { status, body } = await classify();
      // A verdict at all is the thing that was impossible before.
      assert.equal(status, 200);
      assert.equal(body.band, 'small');
      // And it is authenticated with the key from the FILE, not from anywhere else.
      assert.equal(stub.state.auth, `Bearer ${KEY}`);
    });
  });

  it('an explicitly exported key still outranks the file', async () => {
    // The file must fill a gap, never overwrite a deliberate choice — otherwise
    // a one-off override or a test harness could not steer the service.
    const envFile = path.join(tmp, 'with-key.env');
    fs.writeFileSync(envFile, `QWEN_LOCAL_API_KEY=${KEY}\n`);
    stub.state.auth = undefined;

    await withService(
      { CLASSIFIER_ENV_FILE: envFile, QWEN_LOCAL_API_KEY: 'explicit-wins' },
      async () => {
        await classify();
        assert.equal(stub.state.auth, 'Bearer explicit-wins');
      },
    );
  });

  it('an EMPTY exported key does not shadow the file', async () => {
    // process.loadEnvFile treats empty-but-set as set and will not replace it,
    // so `export QWEN_LOCAL_API_KEY=` — the usual shape of `export FOO="$FOO"`
    // on an unset FOO — silently defeated the whole mechanism, producing the
    // very same "not set" error as having no .env. Nothing wants an empty
    // bearer token; empty must mean absent.
    const envFile = path.join(tmp, 'with-key.env');
    fs.writeFileSync(envFile, `QWEN_LOCAL_API_KEY=${KEY}\n`);
    stub.state.auth = undefined;

    await withService(
      { CLASSIFIER_ENV_FILE: envFile, QWEN_LOCAL_API_KEY: '' },
      async () => {
        const { status } = await classify();
        assert.equal(status, 200);
        assert.equal(stub.state.auth, `Bearer ${KEY}`);
      },
    );
  });

  it('a missing .env is survivable, and /health says where it looked', async () => {
    // No .env is a normal development machine. The service must still boot and
    // still serve /health — the judge failing open is the designed behaviour.
    // What must NOT happen is the old state: unactionable "not set" with no way
    // to discover that nothing had loaded a .env at all.
    const absent = path.join(tmp, 'no-such.env');

    await withService({ CLASSIFIER_ENV_FILE: absent }, async () => {
      const health = await waitForHealth();
      assert.equal(health.status, 'ok');
      assert.equal(health.envFileLoaded, false);
      assert.equal(health.envFile, absent);

      const backend = health.backends.find(b => b.id === 'qwen-local');
      assert.equal(backend.apiKeyEnv, 'QWEN_LOCAL_API_KEY');
      // The field that turns "why is there no verdict" into one glance.
      assert.equal(backend.hasKey, false);

      const { status, body } = await classify();
      assert.equal(status, 502);
      assert.match(body.error, /QWEN_LOCAL_API_KEY not set/);
    });
  });

  it('/health reports whether the key arrived, and never the key itself', async () => {
    const envFile = path.join(tmp, 'with-key.env');
    fs.writeFileSync(envFile, `QWEN_LOCAL_API_KEY=${KEY}\n`);

    await withService({ CLASSIFIER_ENV_FILE: envFile }, async () => {
      const health = await waitForHealth();
      assert.equal(health.envFileLoaded, true);
      assert.equal(health.backends.find(b => b.id === 'qwen-local').hasKey, true);
      // A health endpoint that can leak a bearer token is a worse problem than
      // the one it diagnoses, so the whole payload is checked, not just the
      // fields that were meant to carry it.
      assert.ok(
        !JSON.stringify(health).includes(KEY),
        '/health must never serialise the secret',
      );
    });
  });
});
