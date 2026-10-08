// tests/agents/proxy-routing-parity.test.mjs
//
// The agent → proxy wiring as the launcher really runs it: launch-agent-common.sh
// and config/agents/<agent>.sh sourced in bash, `agent_pre_launch` then
// `configure_proxy_routing`, exactly the order launch_agent uses. For every row
// of the matrix it records the routing env afterwards (value AND export flag,
// via `declare -p`), the launcher log, the exit code, and the pi config files
// written — and compares that to tests/fixtures/agents/proxy-routing-parity.json.
//
// The golden was recorded from the bash implementation BEFORE the wiring moved
// to lib/agents/proxy-routing.mjs, so this is the parity check for that port.
//
// Isolation: a sandbox HOME, a sandbox CODING_REPO holding only what the hooks
// read, a fake proxy (/health, /api/llm/routing/resolve) on a local port, and
// no-op `nohup`/`sleep` shims so copilot's adapter server never starts and the
// health retry does not wait. bash runs with --norc --noprofile (macOS bash
// sources ~/.bashrc even for `bash -c`).
//
// Re-record (only for an INTENDED behaviour change):
//   UPDATE_PARITY=1 node --test tests/agents/proxy-routing-parity.test.mjs

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const GOLDEN = path.join(REPO_ROOT, 'tests', 'fixtures', 'agents', 'proxy-routing-parity.json');
const UPDATE = process.env.UPDATE_PARITY === '1';

const ROUTING_VARS = [
  'ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS', 'ANTHROPIC_API_KEY', 'ANTHROPIC_ADMIN_API_KEY', 'ANTHROPIC_AUTH_TOKEN',
  'COPILOT_PROVIDER_BASE_URL', 'COPILOT_PROVIDER_TYPE', 'COPILOT_PROVIDER_API_KEY', 'COPILOT_MODEL', 'COPILOT_AUTO_UPDATE',
  'OPENCODE_CONFIG_CONTENT',
  'PI_CODING_AGENT_DIR', 'PI_CODING_AGENT_SESSION_DIR', 'PI_OFFLINE', 'PI_TELEMETRY', 'PI_SKIP_VERSION_CHECK',
  'TASK_ID', 'CODING_PROJECT_ID',
];
const PI_FILES = ['models.json', 'models.json.coding-orig', 'settings.json'];

let sandbox; let up; let garbage; let deadPort;

function startServer(resolveBody) {
  const srv = http.createServer((req, res) => {
    if (req.url === '/health') { res.writeHead(200); return res.end('{"status":"ok"}'); }
    if (req.url.startsWith('/api/llm/routing/resolve')) { res.writeHead(200); return res.end(resolveBody); }
    res.writeHead(404); res.end();
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

before(async () => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-routing-parity-'));
  up = await startServer(JSON.stringify({ chain: [{ provider: 'gh-copilot', model: 'claude-sonnet-5' }, { provider: 'openai', model: 'gpt-4o' }] }));
  garbage = await startServer('not json');
  const s = await startServer('');
  deadPort = s.address().port;
  await new Promise((r) => s.close(r));
});

after(() => {
  up?.close(); garbage?.close();
  if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
});

// A sandbox CODING_REPO with only what the hooks read; HOME and the target
// project next to it. Fresh per row, so file writes never leak between rows.
function makeRow(name, row) {
  const dir = path.join(sandbox, `${Object.keys(MATRIX).indexOf(name)}-${name.replace(/[^a-z0-9]+/gi, '-')}`);
  const repo = path.join(dir, 'coding');
  const home = path.join(dir, 'home');
  const project = path.join(dir, 'project');
  const shims = path.join(dir, 'shims');
  for (const d of [repo, home, project, shims, path.join(repo, 'plugins', 'opencode'), path.join(repo, 'lib', 'adapters'),
    path.join(repo, 'config', 'agents'), path.join(repo, '.claude', 'commands')]) fs.mkdirSync(d, { recursive: true });
  if (row.plugins !== false) {
    for (const p of ['compaction-guard', 'knowledge-injection']) fs.writeFileSync(path.join(repo, 'plugins', 'opencode', `${p}.js`), '');
  }
  fs.writeFileSync(path.join(repo, 'lib', 'adapters', 'copilot-http-server.js'), '');
  fs.symlinkSync(path.join(REPO_ROOT, 'config', 'agents', 'pi-extensions'), path.join(repo, 'config', 'agents', 'pi-extensions'));
  fs.copyFileSync(path.join(REPO_ROOT, '.claude', 'commands', 'sl.md'), path.join(repo, '.claude', 'commands', 'sl.md'));
  if (row.dotenv) fs.writeFileSync(path.join(repo, '.env'), row.dotenv);
  for (const [rel, content] of Object.entries(row.seed || {})) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  // `sleep` returns at once; `nohup` (copilot's adapter server) stays alive
  // briefly so the hook's `kill -0` check always sees it running.
  fs.writeFileSync(path.join(shims, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(shims, 'nohup'), '#!/bin/sh\nexec /bin/sleep 3\n', { mode: 0o755 });
  return { dir, repo, home, project, shims };
}

async function runRow(name, row) {
  const box = makeRow(name, row);
  const agent = row.agent;
  const agentFile = path.join(REPO_ROOT, 'config', 'agents', `${agent}.sh`);
  const script = `
source "${REPO_ROOT}/scripts/launch-agent-common.sh"
validate_agent_connectivity() { return 0; }
__dump() {
  local rc=$?
  printf '\\n__STATE__\\n'
  for v in ${ROUTING_VARS.join(' ')}; do
    declare -p "$v" 2>/dev/null || printf 'unset %s\\n' "$v"
  done
  printf '__RC__=%s\\n' "$rc"
}
trap __dump EXIT
${fs.existsSync(agentFile) ? `source "${agentFile}"` : `AGENT_NAME="${agent}"`}
${fs.existsSync(agentFile) ? 'type agent_pre_launch >/dev/null 2>&1 && agent_pre_launch' : ''}
configure_proxy_routing
`;
  const env = {
    PATH: `${box.shims}:${process.env.PATH}`,
    HOME: box.home,
    CODING_REPO: box.repo,
    TARGET_PROJECT_DIR: box.project,
    LLM_PROXY_PORT: String(up.address().port),
    LLM_CLI_PROXY_PORT: String(up.address().port),
    ...Object.fromEntries(Object.entries(row.env || {}).map(([k, v]) => [k, v
      .replace('<up>', String(up.address().port))
      .replace('<garbage>', String(garbage.address().port))
      .replace('<dead>', String(deadPort))])),
  };
  // Async: the fake proxy lives in this process and must keep answering while bash runs.
  const r = await new Promise((resolve) => {
    const child = spawn('bash', ['--norc', '--noprofile', '-c', script], { env });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
  const norm = (s) => String(s)
    .split(box.dir).join('<box>')
    .split(fs.realpathSync(box.dir)).join('<box>')
    .split(String(up.address().port)).join('<up>')
    .split(String(garbage.address().port)).join('<garbage>')
    .split(String(deadPort)).join('<dead>')
    .replace(/\(PID: \d+\)/g, '(PID: <pid>)');
  const [log, state = ''] = r.stdout.split('\n__STATE__\n');
  const files = {};
  for (const cfg of [path.join(box.repo, '.pi-agent'), path.join(box.home, '.pi', 'agent')]) {
    if (!fs.existsSync(cfg)) continue;
    const rel = path.relative(box.dir, cfg);
    for (const f of PI_FILES) {
      const p = path.join(cfg, f);
      if (fs.existsSync(p)) files[`${rel}/${f}`] = norm(fs.readFileSync(p, 'utf8'));
    }
    const leftovers = fs.readdirSync(cfg).filter((f) => /\.(coding-ours|coding-preserved|tmp)$/.test(f));
    if (leftovers.length) files[`${rel}/<leftovers>`] = leftovers;
  }
  const sessions = path.join(box.project, '.observations', 'pi-sessions');
  return {
    row: name,
    rc: Number((state.match(/__RC__=(\d+)/) || [])[1] ?? r.status),
    log: norm(log).split('\n').filter(Boolean),
    env: norm(state.replace(/__RC__=\d+\n?/, '')).split('\n').filter(Boolean),
    files,
    piSessionsDir: fs.existsSync(sessions),
    stderr: norm(r.stderr).split('\n').filter(Boolean),
  };
}

const INHERITED_COPILOT = {
  COPILOT_PROVIDER_BASE_URL: 'http://elsewhere/v1', COPILOT_PROVIDER_TYPE: 'azure', COPILOT_PROVIDER_API_KEY: 'sk-inherited',
};
const FOREIGN_MODELS = JSON.stringify({ providers: { mine: { api: 'openai-completions', baseUrl: 'http://x/v1' }, 'rapid-proxy-pi': { stale: true } }, other: 1 }, null, 2);

export const MATRIX = {
  // ── claude ────────────────────────────────────────────────────────────────
  'claude interactive, no project': { agent: 'claude' },
  'claude task + project': { agent: 'claude', env: { TASK_ID: 'exp--claude-sonnet--r1', CODING_PROJECT_ID: 'glass' } },
  'claude inherited api keys are removed': { agent: 'claude', env: { ANTHROPIC_API_KEY: 'sk-a', ANTHROPIC_ADMIN_API_KEY: 'sk-b', ANTHROPIC_AUTH_TOKEN: 'tok' } },
  'claude CODING_PROXY_ROUTE=off': { agent: 'claude', env: { CODING_PROXY_ROUTE: 'off', ANTHROPIC_API_KEY: 'sk-a' } },
  'claude proxy down aborts': { agent: 'claude', env: { LLM_PROXY_PORT: '<dead>' } },
  // ── opencode ──────────────────────────────────────────────────────────────
  'opencode default (wrapper scope, plugins)': { agent: 'opencode' },
  'opencode task + project + anthropic native': { agent: 'opencode', env: { TASK_ID: 't-oc', CODING_PROJECT_ID: 'glass', OPENCODE_ANTHROPIC_NATIVE: '1' } },
  'opencode model override': { agent: 'opencode', env: { CODING_OPENCODE_MODEL: 'rapid-proxy/claude-haiku-4.5' } },
  'opencode global scope via env': { agent: 'opencode', env: { CODING_AGENT_SCOPE: 'global' } },
  'opencode global scope via .env': { agent: 'opencode', dotenv: 'FOO=1\nCODING_AGENT_SCOPE=global\n' },
  'opencode no plugin files': { agent: 'opencode', plugins: false },
  'opencode cli port differs from proxy port': { agent: 'opencode', env: { LLM_CLI_PROXY_PORT: '23456' } },
  'opencode CODING_PROXY_ROUTE=0': { agent: 'opencode', env: { CODING_PROXY_ROUTE: '0' } },
  // ── copilot ───────────────────────────────────────────────────────────────
  'copilot interactive, model from routing': { agent: 'copilot', env: { ...INHERITED_COPILOT } },
  'copilot task + band + project': { agent: 'copilot', env: { TASK_ID: 't-cp', CODING_COPILOT_BAND: 'small', CODING_PROJECT_ID: 'glass' } },
  'copilot invalid band ignored': { agent: 'copilot', env: { CODING_COPILOT_BAND: 'huge' } },
  'copilot preset model kept': { agent: 'copilot', env: { COPILOT_MODEL: 'gpt-4o', TASK_ID: 't-cp' } },
  'copilot ambient route off': { agent: 'copilot', env: { COPILOT_AMBIENT_ROUTE: '0', ...INHERITED_COPILOT } },
  'copilot unresolvable routing → empty model': { agent: 'copilot', env: { LLM_PROXY_PORT: '<garbage>' } },
  // ── pi ────────────────────────────────────────────────────────────────────
  'pi interactive, fresh config': { agent: 'pi', env: { ANTHROPIC_API_KEY: 'sk-a' } },
  'pi task + project, merges foreign provider and settings': {
    agent: 'pi', env: { TASK_ID: 't-pi', CODING_PROJECT_ID: 'glass' },
    seed: { 'coding/.pi-agent/models.json': FOREIGN_MODELS, 'coding/.pi-agent/settings.json': '{"theme":"dark","defaultModel":"x"}' },
  },
  'pi existing backup is kept': {
    agent: 'pi', seed: { 'coding/.pi-agent/models.json': '{"providers":{}}', 'coding/.pi-agent/models.json.coding-orig': 'ORIGINAL' },
  },
  'pi junk config files': { agent: 'pi', seed: { 'coding/.pi-agent/models.json': '[1,2', 'coding/.pi-agent/settings.json': '[]' } },
  'pi global scope': { agent: 'pi', env: { CODING_AGENT_SCOPE: 'global', QWEN_LAPTOP_API_BASE_URL: 'http://10.0.0.5:8081/v1' } },
  'pi cli port differs from proxy port': { agent: 'pi', env: { LLM_CLI_PROXY_PORT: '23456' } },
  // ── an agent with no rule ─────────────────────────────────────────────────
  'unknown agent': { agent: 'mystery' },
};

test('agent → proxy wiring matches the recorded bash behaviour', async () => {
  const observed = [];
  for (const [name, row] of Object.entries(MATRIX)) {
    const t0 = Date.now();
    const o = await runRow(name, row);
    if (process.env.PARITY_TIMING === '1') process.stderr.write(`${Date.now() - t0}ms ${name}\n`);
    observed.push(o);
  }
  if (UPDATE) {
    fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
    fs.writeFileSync(GOLDEN, `${JSON.stringify(observed, null, 2)}\n`);
    return;
  }
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  for (const [i, o] of observed.entries()) assert.deepEqual(o, golden[i], `row: ${o.row}`);
  assert.equal(observed.length, golden.length);
});
