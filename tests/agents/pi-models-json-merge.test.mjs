// tests/agents/pi-models-json-merge.test.mjs
//
// _pi_write_models_json (config/agents/pi.sh) must MERGE into an existing
// models.json rather than replace it.
//
// Why this is a test and not a comment: under CODING_AGENT_SCOPE=global the
// config dir IS the user's own ~/.pi/agent, so the writer's target is a file
// the project does not own. It used to be a plain `cat > "$models_file"`, which
// silently destroyed any provider the user had authored there. The comment
// above agent_pre_launch asserted the opposite ("we never rewrite a
// user-authored ~/.pi/agent/models.json") and had been true only while wrapper
// was the only scope. Code and comment now agree; these tests are what keeps
// them agreeing.
//
// The contract, mirroring _pi_merge_settings for settings.json:
//   a. We own `rapid-proxy-pi` and `qwen-laptop` outright and rewrite them every
//      launch — the proxy port, the x-task-id header and the qwen base URL all
//      move between launches, so a stale entry is worse than no entry.
//   b. Every other provider, and every other top-level key, survives untouched.
//   c. An absent or unparseable file is not an error: we start from {}.
//   d. The scratch file the writer stages through is never left behind.
//
// Strategy: stub _agent_log, source pi.sh in a bash subprocess, call the writer
// against a temp dir, read the JSON back. Same harness as
// opencode-anthropic-native-splice.test.mjs, including --norc --noprofile — on
// macOS /bin/bash sources ~/.bashrc even for `bash -c`, which is how a
// developer's exported CODING_REPO leaks into an otherwise isolated env.
//
// Runner: node --test tests/agents/pi-models-json-merge.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PI_SH = path.resolve(REPO_ROOT, 'config', 'agents', 'pi.sh');

const OURS = ['rapid-proxy-pi', 'qwen-laptop'];

/** Run _pi_write_models_json against `cfgDir`. Returns the parsed models.json. */
function writeModels(cfgDir) {
  const script = `
_agent_log() { :; }
source "${PI_SH}"
_pi_write_models_json "${cfgDir}"
`;
  const result = spawnSync('bash', ['--norc', '--noprofile', '-c', script], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
      HOME: process.env.HOME || '/tmp',
    },
  });
  assert.equal(result.status, 0, `writer failed: ${result.stderr}`);
  return JSON.parse(readFileSync(path.join(cfgDir, 'models.json'), 'utf8'));
}

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pi-models-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('a fresh config dir gets exactly our two providers', () => {
  withTempDir((dir) => {
    const doc = writeModels(dir);
    assert.deepEqual(Object.keys(doc.providers).sort(), [...OURS].sort());
  });
});

test('a user-authored provider and top-level key survive the merge', () => {
  withTempDir((dir) => {
    writeFileSync(path.join(dir, 'models.json'), JSON.stringify({
      providers: {
        'my-own-ollama': {
          api: 'openai-completions',
          baseUrl: 'http://127.0.0.1:11434/v1',
          models: [{ id: 'llama3', name: 'hand-written', input: ['text'] }],
        },
      },
      userTopLevelKey: 'must survive',
    }, null, 2));

    const doc = writeModels(dir);

    // (b) — the foreign provider is untouched, not merely present.
    assert.equal(doc.providers['my-own-ollama'].models[0].name, 'hand-written');
    assert.equal(doc.providers['my-own-ollama'].baseUrl, 'http://127.0.0.1:11434/v1');
    assert.equal(doc.userTopLevelKey, 'must survive');
    // (a) — ours are there alongside it.
    for (const id of OURS) assert.ok(doc.providers[id], `${id} missing`);
  });
});

test('a stale entry under one of OUR ids is replaced, not merged into', () => {
  withTempDir((dir) => {
    writeFileSync(path.join(dir, 'models.json'), JSON.stringify({
      providers: {
        'rapid-proxy-pi': { api: 'STALE', baseUrl: 'http://127.0.0.1:9999/v1', models: [] },
      },
    }, null, 2));

    const doc = writeModels(dir);
    const ours = doc.providers['rapid-proxy-pi'];
    assert.equal(ours.api, 'openai-completions');
    assert.notEqual(ours.baseUrl, 'http://127.0.0.1:9999/v1');
    assert.ok(ours.models.length > 0, 'stale empty models[] survived');
  });
});

test('the proxy model declares image input, the direct-dial laptop model does not', () => {
  // The proxy's OpenAI shim preserves image_url parts on the OpenAI-native legs,
  // so pi may attach an image there — pi gates on this field in
  // core/tools/read.js (getNonVisionImageNote) and drops the image before the
  // request leaves when it is absent. qwen-laptop is dialled direct, never
  // through that shim, and the llama.cpp build serving it is not a vision model.
  withTempDir((dir) => {
    const doc = writeModels(dir);
    assert.deepEqual(doc.providers['rapid-proxy-pi'].models[0].input, ['text', 'image']);
    assert.deepEqual(doc.providers['qwen-laptop'].models[0].input, ['text']);
  });
});

test('an unparseable existing file is recovered from, not propagated', () => {
  withTempDir((dir) => {
    writeFileSync(path.join(dir, 'models.json'), 'not json at all {{{');
    const doc = writeModels(dir);
    assert.deepEqual(Object.keys(doc.providers).sort(), [...OURS].sort());
  });
});

test('a top-level JSON array is treated as absent rather than crashing', () => {
  withTempDir((dir) => {
    writeFileSync(path.join(dir, 'models.json'), '["not", "an", "object"]');
    const doc = writeModels(dir);
    assert.deepEqual(Object.keys(doc.providers).sort(), [...OURS].sort());
  });
});

test('no scratch or temp files are left behind', () => {
  withTempDir((dir) => {
    writeModels(dir);
    assert.deepEqual(readdirSync(dir), ['models.json']);
    assert.ok(!existsSync(path.join(dir, 'models.json.coding-ours')));
    assert.ok(!existsSync(path.join(dir, 'models.json.tmp')));
  });
});
