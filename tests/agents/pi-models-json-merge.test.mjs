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

// ── the one-time backup ──────────────────────────────────────────────────────
//
// models.json is rewritten on EVERY launch (the proxy port and the x-task-id
// header move), so a per-launch backup would litter the config dir. What is
// worth keeping is the original as it stood before this project first touched
// it — the same one-time-original approach install.sh takes with .coding-orig
// and build-claude-runtime-config.mjs with .coding-pre-global.

/** Run the writer and return the backup's contents, or null if absent. */
function backupOf(dir) {
  const p = path.join(dir, 'models.json.coding-orig');
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

test('the pre-existing file is backed up once', () => {
  withTempDir((dir) => {
    const original = JSON.stringify({ providers: { mine: { api: 'x' } }, userKey: 'original' });
    writeFileSync(path.join(dir, 'models.json'), original);
    writeModels(dir);
    assert.equal(JSON.parse(backupOf(dir)).userKey, 'original');
  });
});

test('a later launch does NOT overwrite the backup with the merged file', () => {
  withTempDir((dir) => {
    writeFileSync(path.join(dir, 'models.json'), JSON.stringify({ providers: {}, userKey: 'original' }));
    writeModels(dir);
    // Mutate the live file the way a later launch (or the user) would, then
    // launch again. A backup taken per-launch would now say "changed later" and
    // the true original would be gone — which is the whole thing it exists to
    // prevent.
    const live = JSON.parse(readFileSync(path.join(dir, 'models.json'), 'utf8'));
    live.userKey = 'changed later';
    writeFileSync(path.join(dir, 'models.json'), JSON.stringify(live));
    writeModels(dir);
    assert.equal(JSON.parse(backupOf(dir)).userKey, 'original');
  });
});

test('no backup is invented when there was nothing to back up', () => {
  withTempDir((dir) => {
    writeModels(dir);
    assert.equal(backupOf(dir), null);
  });
});

// ── the extension marker guard ───────────────────────────────────────────────
//
// Under global scope the extensions dir is ~/.pi/agent/extensions, which the
// user owns. Our sources carry a line-1 marker and the copy is verbatim, so the
// installer can tell a file it wrote from one the user authored — the same
// contract _pi_write_append_system keeps for APPEND_SYSTEM.md.

/** Run _pi_install_extensions against `cfgDir`. */
function installExtensions(cfgDir) {
  const script = `
_agent_log() { :; }
source "${PI_SH}"
_pi_install_extensions "${cfgDir}"
`;
  const result = spawnSync('bash', ['--norc', '--noprofile', '-c', script], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
      HOME: process.env.HOME || '/tmp',
      CODING_REPO: REPO_ROOT,
    },
  });
  assert.equal(result.status, 0, `installer failed: ${result.stderr}`);
}

test('extensions install into a fresh dir', () => {
  withTempDir((dir) => {
    installExtensions(dir);
    const files = readdirSync(path.join(dir, 'extensions'));
    assert.ok(files.length > 0, 'nothing installed');
    for (const f of files) {
      const head = readFileSync(path.join(dir, 'extensions', f), 'utf8').split('\n')[0];
      assert.match(head, /managed by coding\/config\/agents\/pi\.sh/, `${f} lacks the marker`);
    }
  });
});

test('a user-authored extension of the same name is left alone', () => {
  withTempDir((dir) => {
    installExtensions(dir);
    const [name] = readdirSync(path.join(dir, 'extensions'));
    const mine = '// my own extension, do not touch\n';
    writeFileSync(path.join(dir, 'extensions', name), mine);
    installExtensions(dir);
    assert.equal(readFileSync(path.join(dir, 'extensions', name), 'utf8'), mine);
  });
});

test('our own previously-installed extension IS refreshed', () => {
  // The guard must not freeze our own file: an outdated copy of an extension we
  // ship is exactly what the installer exists to replace.
  withTempDir((dir) => {
    installExtensions(dir);
    const [name] = readdirSync(path.join(dir, 'extensions'));
    const target = path.join(dir, 'extensions', name);
    const fresh = readFileSync(target, 'utf8');
    writeFileSync(target, '// managed by coding/config/agents/pi.sh\n// stale copy\n');
    installExtensions(dir);
    assert.equal(readFileSync(target, 'utf8'), fresh);
  });
});
