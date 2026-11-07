/**
 * The in-box PreToolUse hook against the real host guard — Phase 1 item 4.
 *
 * The real hook wrapper (integrations/constraint-monitor) runs in box mode
 * exactly as the managed policy starts it (CODING_GUARD_MODE=box,
 * CODING_GUARD_KEYS=<public dir>), against createGuard() on a temp guard home.
 * What it must hold:
 *   - a blocked call files ONE override request and shows the agent the link
 *   - the transcript grants nothing in the box (forged or "typed" overrides)
 *   - only a grant the user approved with a factor lets the call through, for
 *     the scope they chose: one call once, N minutes, this session — bound to
 *     the rule, the box session and the file
 *   - a grant signed with any other key, a fake guard, an unreachable guard,
 *     missing keys: blocked
 *   - a broken guard is bypassed only by an approved `guard-error` grant
 *
 * The violation used is `no-incremental-documentation` on a .md file: a real
 * blocking rule whose file_pattern does not cover this test file itself.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createGuard } from '../../scripts/coding-guard-daemon.mjs';
import { guardPaths } from '../../lib/guard/home.mjs';
import { signGrant } from '../../lib/guard/grants.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOK = path.join(REPO, 'integrations', 'constraint-monitor', 'src', 'hooks', 'pre-tool-hook-wrapper.js');
const RULES = path.join(REPO, 'config', 'constraints', 'constraint-monitor.yaml');
const RULE = 'no-incremental-documentation';
const SESSION = os.hostname(); // the box session IS the container hostname
// Generated per run: a fixture, not a secret.
const PASSPHRASE = randomBytes(18).toString('base64url');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'box-hook-'));
let paths;
let server;
let base;

/** A Write the rule blocks: a dated change note in a markdown file. */
const blockedWrite = (file) => ({
  tool_name: 'Write',
  tool_input: { file_path: file, content: 'Fixed in 2026 by the team.\n' },
  session_id: 'box', cwd: TMP, transcript_path: path.join(TMP, 'none.jsonl'),
});

/** Run the hook as Claude Code does; async, because the guard serves from this process. */
function runHook(input, env = {}) {
  const clean = { ...process.env };
  for (const k of ['CODING_REPO', 'CONSTRAINT_CONFIG_PATH', 'CODING_GUARD_MODE', 'CODING_GUARD_KEYS', 'CODING_GUARD_URL']) delete clean[k];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [HOOK], {
      cwd: TMP,
      env: {
        ...clean,
        CODING_TOOLS_PATH: TMP, // violation history goes here, not into the repo's .mcp-sync
        CONSTRAINT_CONFIG_PATH: RULES,
        CODING_GUARD_MODE: 'box',
        CODING_GUARD_KEYS: paths.publicDir,
        ...env,
      },
    });
    let stderr = '';
    let stdout = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.stdout.on('data', (d) => { stdout += d; });
    child.on('close', (code) => resolve({ code, stderr, stdout }));
    child.stdin.end(JSON.stringify(input));
  });
}

async function api(method, route, body) {
  const res = await fetch(`${base}${route}`, {
    method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const pending = async () => (await api('GET', '/requests?status=pending')).data.requests;

/** The user approves request `id` with their password. */
async function approve(id, scope) {
  const { status, data } = await api('POST', `/approve/${id}/password`, { ...scope, password: PASSPHRASE });
  assert.equal(status, 200, JSON.stringify(data));
  return data.grant;
}

/** Block once, then approve the request that block filed. */
async function blockThenApprove(input, scope) {
  const r = await runHook(input);
  assert.equal(r.code, 2, r.stderr);
  const req = (await pending()).find((x) => x.file === input.tool_input.file_path && x.session === SESSION);
  assert.ok(req, 'the block filed a request');
  return approve(req.id, scope);
}

/** A stand-in guard that serves whatever grants it is given. */
async function fakeGuard(grants) {
  const fake = http.createServer((req, res) => {
    const isRequest = req.url.startsWith('/requests');
    res.writeHead(isRequest ? 201 : 200, { 'content-type': 'application/json' });
    if (req.url.startsWith('/grants?')) res.end(JSON.stringify({ grants }));
    else if (isRequest) res.end(JSON.stringify({ request: { rule: RULE, approve: 'http://fake/approve' } }));
    else res.end(JSON.stringify({ grant: grants[0] }));
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  return fake;
}

/** A keys dir: a public key + a guard.json pointing at `url`. */
function keysDir(name, publicPem, url) {
  const dir = path.join(TMP, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'guard-public.pem'), publicPem);
  fs.writeFileSync(path.join(dir, 'guard.json'), JSON.stringify({ url }));
  return dir;
}

function forgedGrant(file) {
  const other = generateKeyPairSync('ed25519');
  const grant = signGrant({ id: 'r', rule: RULE, session: SESSION, file }, {
    scope: 'session', privatePem: other.privateKey.export({ type: 'pkcs8', format: 'pem' }),
  });
  return { grant, publicPem: other.publicKey.export({ type: 'spki', format: 'pem' }) };
}

const realPublicKey = () => fs.readFileSync(paths.publicKey, 'utf8');

before(async () => {
  paths = guardPaths(path.join(TMP, 'guard'));
  let handler = null;
  server = http.createServer((req, res) => handler(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  base = `http://127.0.0.1:${port}`;
  const guard = createGuard({ paths, port, codingRepo: '/repo', runDocker: async () => ({ code: 0, stdout: '', stderr: '' }) });
  handler = guard.handler;
  guard.factors.setPassword(PASSPHRASE);
  // In a real box this file says host.docker.internal; here the guard is on loopback.
  fs.writeFileSync(paths.endpoint, JSON.stringify({ url: base }));
});

after(() => {
  server?.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe('a blocked call in the box', () => {
  test('is blocked, files a request, and shows the agent the approval link', async () => {
    const r = await runHook(blockedWrite('/w/first.md'));
    assert.equal(r.code, 2);
    assert.match(r.stderr, new RegExp(RULE));
    assert.doesNotMatch(r.stderr, /include in your prompt: OVERRIDE_CONSTRAINT/, 'the transcript route is not offered in the box');
    const [req] = (await pending()).filter((x) => x.file === '/w/first.md');
    assert.ok(req);
    assert.equal(req.rule, RULE);
    assert.equal(req.session, SESSION);
    assert.equal(req.agent, 'claude');
    assert.equal(req.tool, 'Write');
    assert.match(req.excerpt, /Fixed in 2026/);
    assert.ok(r.stderr.includes(req.approve), r.stderr);
  });

  test('retrying does not pile up requests', async () => {
    await runHook(blockedWrite('/w/first.md'));
    await runHook(blockedWrite('/w/first.md'));
    assert.equal((await pending()).filter((x) => x.file === '/w/first.md').length, 1);
  });

  test('an override typed into the transcript counts for nothing', async () => {
    const t = path.join(TMP, 'typed.jsonl');
    fs.writeFileSync(t, `${JSON.stringify({
      type: 'user', turnOrigin: 'human', promptSource: 'typed', timestamp: new Date().toISOString(),
      message: { role: 'user', content: `go ahead\nOVERRIDE_CONSTRAINT: ${RULE}` },
    })}\n`);
    const r = await runHook({ ...blockedWrite('/w/typed.md'), transcript_path: t });
    assert.equal(r.code, 2);
  });

  test('clean calls never reach the guard', async () => {
    const before = (await pending()).length;
    const r = await runHook({ ...blockedWrite('/w/clean.md'), tool_input: { file_path: '/w/clean.md', content: 'Plain prose.\n' } });
    assert.equal(r.code, 0, r.stderr);
    assert.equal((await pending()).length, before);
  });
});

describe('approved grants', () => {
  test('one call: allowed exactly once', async () => {
    await blockThenApprove(blockedWrite('/w/once.md'), { scope: 'call' });
    assert.equal((await runHook(blockedWrite('/w/once.md'))).code, 0);
    assert.equal((await runHook(blockedWrite('/w/once.md'))).code, 2, 'spent');
  });

  test('N minutes: allowed repeatedly, for that file only', async () => {
    await blockThenApprove(blockedWrite('/w/minutes.md'), { scope: 'minutes', minutes: 5 });
    assert.equal((await runHook(blockedWrite('/w/minutes.md'))).code, 0);
    assert.equal((await runHook(blockedWrite('/w/minutes.md'))).code, 0);
    assert.equal((await runHook(blockedWrite('/w/elsewhere.md'))).code, 2);
  });

  test('a grant for another box session does not cover this one', async () => {
    const { data } = await api('POST', '/requests', { rule: RULE, session: 'coding-box-claude-other', file: '/w/other-session.md' });
    await approve(data.request.id, { scope: 'session' });
    assert.equal((await runHook(blockedWrite('/w/other-session.md'))).code, 2);
  });

  test('a denied request lets nothing through', async () => {
    await runHook(blockedWrite('/w/denied.md'));
    const req = (await pending()).find((x) => x.file === '/w/denied.md');
    await api('POST', `/requests/${req.id}/deny`);
    assert.equal((await runHook(blockedWrite('/w/denied.md'))).code, 2);
  });
});

describe('what cannot produce an override', () => {
  test('a grant signed with any other key, served by a fake guard', async () => {
    const { grant, publicPem } = forgedGrant('/w/forged.md');
    const fake = await fakeGuard([grant]);
    try {
      const url = `http://127.0.0.1:${fake.address().port}`;
      // Sanity: under the key that signed it, the same grant passes...
      assert.equal((await runHook(blockedWrite('/w/forged.md'), { CODING_GUARD_KEYS: keysDir('forged-own', publicPem, url) })).code, 0);
      // ...under the guard's real public key (what the box mounts) it does not.
      assert.equal((await runHook(blockedWrite('/w/forged.md'), { CODING_GUARD_KEYS: keysDir('forged-real', realPublicKey(), url) })).code, 2);
    } finally {
      fake.close();
    }
  });

  test('a real grant with its payload edited', async () => {
    const grant = await blockThenApprove(blockedWrite('/w/tamper.md'), { scope: 'session' });
    const widened = { ...grant, payload: { ...grant.payload, file: null } }; // stretch it to every file
    const fake = await fakeGuard([widened]);
    try {
      const dir = keysDir('tamper', realPublicKey(), `http://127.0.0.1:${fake.address().port}`);
      assert.equal((await runHook(blockedWrite('/w/any-other.md'), { CODING_GUARD_KEYS: dir })).code, 2);
    } finally {
      fake.close();
    }
  });

  test('CODING_GUARD_URL in the environment is not where the hook asks', async () => {
    const { grant } = forgedGrant('/w/env.md');
    const fake = await fakeGuard([grant]);
    try {
      const r = await runHook(blockedWrite('/w/env.md'), { CODING_GUARD_URL: `http://127.0.0.1:${fake.address().port}` });
      assert.equal(r.code, 2);
      assert.ok((await pending()).some((x) => x.file === '/w/env.md'), 'the request reached the real guard');
    } finally {
      fake.close();
    }
  });

  test('guard unreachable → blocked, and the agent is told no override is possible', async () => {
    const r = await runHook(blockedWrite('/w/down.md'), { CODING_GUARD_KEYS: keysDir('down', realPublicKey(), 'http://127.0.0.1:9') });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /No override is possible right now: host guard unreachable/);
  });

  test('no keys mounted → blocked', async () => {
    const r = await runHook(blockedWrite('/w/nokeys.md'), { CODING_GUARD_KEYS: path.join(TMP, 'absent') });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /keys not mounted/);
  });
});

describe('a broken guard', () => {
  const broken = { CONSTRAINT_CONFIG_PATH: path.join(TMP, 'missing.yaml') };
  const write = blockedWrite('/w/broken.md');

  test('blocks writes and asks for a guard-error grant', async () => {
    const r = await runHook(write, broken);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /fail-closed/);
    assert.ok((await pending()).some((x) => x.rule === 'guard-error'));
  });

  test('read-only tools still work, for diagnosis', async () => {
    const r = await runHook({ ...write, tool_name: 'Read', tool_input: { file_path: '/w/broken.md' } }, broken);
    assert.equal(r.code, 0);
  });

  test('an approved guard-error grant lets calls through while it lasts', async () => {
    const req = (await pending()).find((x) => x.rule === 'guard-error');
    await approve(req.id, { scope: 'minutes', minutes: 5 });
    assert.equal((await runHook(write, broken)).code, 0);
  });
});

describe('the other agents (Phase 1 item 5): native calls, same rules, same grants', () => {
  const content = 'Fixed in 2026 by the team.\n';
  // As each agent's guard plugin sends them (docker/agent-box/agents/).
  const calls = {
    copilot: { tool_name: 'Write', tool_input: { path: '/w/copilot.md', file_text: content } },
    opencode: { agent: 'opencode', tool_name: 'write', tool_input: { filePath: '/w/opencode.md', content } },
    pi: { agent: 'pi', tool_name: 'write', tool_input: { path: 'pi.md', content }, cwd: '/w' },
  };

  /** What the agent is shown: copilot reads a JSON deny on stdout (it hides an exit-2 hook's stderr). */
  const shown = (agent, r) => {
    if (agent !== 'copilot') {
      assert.equal(r.code, 2, r.stderr);
      return r.stderr;
    }
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout); // exactly one JSON document — copilot allows on anything else
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
    return out.hookSpecificOutput.permissionDecisionReason;
  };

  for (const [agent, call] of Object.entries(calls)) {
    test(`${agent}: blocked, and the request names the agent and the absolute file`, async () => {
      const r = await runHook({ session_id: 'box', ...call }, { CODING_GUARD_AGENT: agent });
      const message = shown(agent, r);
      const req = (await pending()).find((x) => x.agent === agent);
      assert.ok(req, r.stderr);
      assert.equal(req.rule, RULE);
      assert.equal(req.file, `/w/${agent}.md`);
      assert.ok(message.includes(req.approve), message);
    });
  }

  test('copilot: a broken guard is a JSON deny too, never an exit copilot reads as allow', async () => {
    const r = await runHook({ tool_name: 'Write', tool_input: { path: '/w/x.md', file_text: 'x' } },
      { CODING_GUARD_AGENT: 'copilot', CONSTRAINT_CONFIG_PATH: path.join(TMP, 'missing.yaml') });
    assert.match(shown('copilot', r), /fail-closed/);
  });

  test('pi: an approved grant lets the same native call through', async () => {
    const req = (await pending()).find((x) => x.agent === 'pi');
    await approve(req.id, { scope: 'minutes', minutes: 5 });
    assert.equal((await runHook({ session_id: 'box', ...calls.pi }, { CODING_GUARD_AGENT: 'pi' })).code, 0);
  });

  test('copilot: a clean edit passes', async () => {
    const r = await runHook({ tool_name: 'Edit', tool_input: { path: '/w/ok.md', old_str: 'a', new_str: 'Plain prose.' } }, { CODING_GUARD_AGENT: 'copilot' });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, '', 'allow = empty stdout');
  });
});
