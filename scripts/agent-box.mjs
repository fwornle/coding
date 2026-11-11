#!/usr/bin/env node
/**
 * coding agent box — build the box image and run an agent inside it.
 *
 *   node scripts/agent-box.mjs build             bake the COMMITTED guard + rules into the image
 *   node scripts/agent-box.mjs status            image present? built from the current guard?
 *   node scripts/agent-box.mjs run <agent> [-- args…]
 *
 * `bin/coding box …` and `coding --<agent> --box` call this. Node, not bash, so
 * the same code runs on macOS, Linux, WSL and native Windows.
 *
 * Trust: the image is built only by the user, on the host, from what is
 * COMMITTED (the superproject's pinned constraint-monitor SHA and the
 * committed rules). Inside the box the agent has no Docker socket and the
 * guard is root-owned, so nothing it edits in the mounted repo reaches the
 * guard it runs under; `run` warns when the image is older than the
 * committed guard but never rebuilds on its own.
 *
 * Plan: .planning/guardrail-hardening.md (Phase 1, item 1).
 */

import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { ROUTING_ENV_VARS } from '../lib/agents/proxy-routing.mjs';
import { guardHome, guardPaths, guardPort, exposesGuardHome, readToken } from '../lib/guard/home.mjs';
import opencodeDbs from '../lib/lsl/opencode-dbs.cjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const IMAGE = 'coding-agent-box:latest';
export const HOME_VOLUME = 'coding-box-home';
export const BOX_HOME = '/home/agent';
/** The guard's PUBLIC key directory inside the box (verifies grants, Phase 1 item 4). */
export const BOX_GUARD_KEYS = '/etc/coding-guard';
export const AGENT_COMMANDS = { claude: 'claude', copilot: 'copilot', opencode: 'opencode', pi: 'pi' };

/**
 * How each agent loads its guard (docker/agent-box/agents/), fixed on the
 * command line the agent cannot change. claude: the managed policy in
 * /etc/claude-code; opencode: its managed config in /etc/opencode — neither
 * needs an argument.
 */
export const AGENT_GUARD_ARGS = {
  copilot: ['--plugin-dir', '/opt/coding-guard/agents/copilot'],
  pi: ['-e', '/opt/coding-guard/agents/pi/guard.js'],
};

/**
 * Copilot reads repository settings that can switch every hook off
 * (`disableAllHooks`, in a folder the user trusted — and trust is stored in
 * a file the agent can write). The box mounts these directories read-only in
 * every directory from the workspace down to the cwd (any of them can become
 * the repository root). `.github` itself is re-mounted read-write so it cannot
 * be renamed away from under the read-only `.github/copilot`; a top-level
 * mount point cannot be renamed.
 */
export const COPILOT_CONFIG_DIRS = ['.github/copilot', '.claude'];
const COPILOT_SETTINGS = ['settings.json', 'settings.local.json'];

const GUARD_SUBMODULE = 'integrations/constraint-monitor';
const RULES = 'config/constraints/constraint-monitor.yaml';
const BOX_DIR = 'docker/agent-box';
/** The grant verifier the in-box hook imports (node:crypto only). */
const GRANTS_LIB = 'lib/guard/grants.mjs';

/**
 * Env passed into the box besides the routing set: terminal, locale, egress
 * proxy, and the agents' mouse switches. tmux-session-wrapper.sh exports
 * CLAUDE_CODE_DISABLE_MOUSE / OPENCODE_DISABLE_MOUSE so the agent never takes
 * the mouse (DECSET 1003) and tmux drag-select keeps working; without them the
 * boxed agent grabs the mouse and selection is lost.
 */
const EXTRA_ENV = ['TERM', 'COLORTERM', 'LANG', 'LC_ALL', 'TASK_ID', 'NODE_EXTRA_CA_CERTS',
  'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy',
  'CLAUDE_CODE_DISABLE_MOUSE', 'OPENCODE_DISABLE_MOUSE'];

/**
 * Routing vars that name a host directory the agent must see at the same path.
 * PI_CODING_AGENT_DIR is deliberately NOT one: pi loads extensions from it, so
 * a writable mount would let the box plant code the HOST pi runs, and its
 * models.json names loopback URLs the box cannot reach. The box gets a staged
 * copy instead (stageBoxPiDir), at BOX_PI_DIR.
 */
const PATH_ENV = ['PI_CODING_AGENT_SESSION_DIR'];
/** Where the staged pi config dir appears inside the box. */
export const BOX_PI_DIR = `${BOX_HOME}/.pi/agent`;
/**
 * Copilot's session store, relative to the home. Mounted from the host so
 * session logging (lib/lsl/adapters/copilot-events.mjs) sees boxed sessions —
 * the same reason the Claude transcripts are mounted. Session data only:
 * copilot loads no code from it.
 */
export const COPILOT_SESSIONS = path.join('.copilot', 'session-state');
/**
 * opencode's session database in the box: on the box's own Linux home volume,
 * written only by the boxed opencode. Its store is SQLite in WAL mode, which
 * must not be shared with the macOS host over VirtioFS, so the host never
 * mounts it — scripts/box-opencode-sync.mjs runs opencode and exports a
 * single-file snapshot to BOX_OPENCODE_EXPORT, a host directory
 * (lib/lsl/opencode-dbs.cjs) that session logging reads. Pinned with
 * OPENCODE_DB so a release-channel build cannot pick another file name.
 */
export const BOX_OPENCODE_DB = `${BOX_HOME}/.local/share/opencode/opencode.db`;
export const BOX_OPENCODE_EXPORT = '/var/lib/coding-box/opencode-export';

/** Web-proxy env the box would inherit from the host. */
const WEB_PROXY_ENV = ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy'];
/** The gate's allow-list CONNECT proxy, inside the box network. */
export const GATE_CONNECT_PORT = 3128;
/** Where the image keeps the gate (docker/agent-box/gate/). */
const GATE_DIR = '/opt/coding-box/gate';

/**
 * Box network mode: 'locked' (default) — the box reaches only the LLM proxy
 * and the guard, through a gate container — or 'open' (CODING_BOX_NETWORK=open:
 * the default bridge, as before; recorded in the guard audit log).
 */
export function boxNetworkMode(env = process.env) {
  return String(env.CODING_BOX_NETWORK || '').toLowerCase() === 'open' ? 'open' : 'locked';
}

/**
 * Strict box (`coding --strict-box`, or CODING_BOX_STRICT=true): the box sees
 * nothing of the host beyond what the work itself needs. The default box adds
 * view-only access to the host's web UIs (BOX_HOST_VIEWS) — which show other
 * repos' sessions, health and knowledge; strict leaves them out.
 */
export function boxStrict(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String(env.CODING_BOX_STRICT || '').trim());
}

/**
 * The host's web UIs a default (non-strict) box may LOOK at, through the
 * gate's view relay: GET/HEAD/OPTIONS only, no WebSocket, no cookies. Each at
 * its usual localhost port inside the box too (localhost-relay.mjs), because
 * the pages call each other at fixed localhost URLs.
 */
export const BOX_HOST_VIEWS = [
  { name: 'health dashboard', env: 'SYSTEM_HEALTH_DASHBOARD_PORT', port: 3032 },
  { name: 'health dashboard API', env: 'SYSTEM_HEALTH_API_PORT', port: 3033 },
  { name: 'knowledge viewer / observations API', env: 'OBSERVATIONS_API_PORT', port: 12436 },
];

/**
 * The view ports for this launch: none in strict mode; otherwise each UI's
 * port (env override first), minus any port the gate already serves another
 * way — a view relay must never shadow the LLM proxy or the guard.
 */
export function hostViewPorts(env = process.env, taken = []) {
  if (boxStrict(env)) return [];
  const ports = BOX_HOST_VIEWS.map((v) => Number(env[v.env] || v.port))
    .filter((p) => Number.isInteger(p) && p > 0 && p < 65536 && !taken.includes(p));
  return [...new Set(ports)];
}

/** The host ports the gate forwards: the LLM proxy and the guard daemon. Nothing else. */
export function gatePorts(env = process.env, guardPortNum = guardPort(env)) {
  const proxy = Number(env.LLM_CLI_PROXY_PORT || 12435);
  return [...new Set([proxy, Number(guardPortNum)])];
}

/** The health coordinator's port on the host (the prompt hook asks it for /health/state). */
export function healthCoordinatorPort(env = process.env) {
  try {
    const u = new URL(env.HEALTH_COORDINATOR_URL);
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname) && u.port) return Number(u.port);
  } catch { /* unset or not a URL */ }
  return 3034;
}

/**
 * Read-only relays through the gate: GET of exactly these paths, nothing else
 * on that port. The coordinator also takes PUT /features, POST
 * /health/remediate, /experiments/run …, which a boxed agent must not reach.
 */
export function gateRelays(env = process.env) {
  return [{ port: healthCoordinatorPort(env), paths: ['/health/state'] }];
}

/**
 * MCP relays through the gate: the HTTP MCP servers in config/code-graph.json
 * (graphify), each with only the tools listed there. The box's mcp.json points
 * them at host.docker.internal, which in a locked box is the gate. A missing or
 * broken config → no relay, and the agent sees the server as unreachable.
 */
export function gateMcpRelays(env = process.env, repo = REPO, readFile = (f) => fs.readFileSync(f, 'utf8')) {
  let config;
  try { config = JSON.parse(readFile(path.join(repo, 'config', 'code-graph.json'))); } catch { return []; }
  const relays = [];
  for (const backend of Object.values(config.backends || {})) {
    const mcp = backend?.mcp;
    if (mcp?.transport !== 'http' || !Array.isArray(mcp.tools) || !mcp.tools.length) continue;
    // ${VAR:-default} as the host launcher expands it.
    const url = String(mcp.url || '').replace(/\$\{(\w+):-([^}]*)\}/g, (_, k, d) => env[k] || d);
    let u;
    try { u = new URL(url); } catch { continue; }
    if (!/^(localhost|127\.0\.0\.1)$/.test(u.hostname) || !u.port) continue;
    relays.push({ port: Number(u.port), path: u.pathname, tools: mcp.tools });
  }
  return relays;
}

/**
 * The coding project's own Claude hooks (build-claude-runtime-config.mjs), by
 * the name docker/agent-box/coding-hook.mjs runs them under, with the feature
 * that installs each on the host. The constraint guard is not here: in the box
 * it is the managed policy's own, fixed hook.
 */
export const BOX_CODING_HOOKS = { 'tool-interaction': 'lsl', 'health-prompt': 'health' };

/** The coding hooks whose feature is on — what a host Claude would run. Fails closed. */
export function boxCodingHooks(isEnabled) {
  return Object.entries(BOX_CODING_HOOKS).filter(([, feature]) => {
    try { return Boolean(isEnabled(feature)); } catch { return false; }
  }).map(([name]) => name);
}

/**
 * `docker run` argv for the gate of box `name`. Pure. It starts on the default
 * bridge (its way to the host); the caller then connects it to the box's
 * internal network. Runs as nobody, read-only, without capabilities. Not
 * --rm: a gate that dies keeps its log (why it died) and can be restarted in
 * place (watchGate); stopGate and the orphan sweep remove it.
 */
export function gateRunArgs({ name, agent, ports, network, upstream = null, relays = [], mcpRelays = [], views = [], platform = process.platform, image = IMAGE, pid = process.pid }) {
  const argv = ['run', '-d', '--name', `${name}-gate`,
    '--label', 'coding.box.gate=1', '--label', `coding.box.gate.for=${name}`, '--label', `coding.box.gate.network=${network}`, '--label', `coding.box.gate.pid=${pid}`,
    '--network', 'bridge', '--user', '65534:65534', '--read-only', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges', '--entrypoint', 'node'];
  if (platform === 'linux') argv.push('--add-host', 'host.docker.internal:host-gateway');
  argv.push(image, `${GATE_DIR}/gate.mjs`, '--target', 'host.docker.internal');
  for (const p of ports) argv.push('--forward', String(p));
  for (const r of relays) argv.push('--http-get', `${r.port}:${r.paths.join(',')}`);
  for (const r of mcpRelays) argv.push('--mcp', `${r.port}:${r.path}:${r.tools.join(',')}`);
  for (const p of views) argv.push('--view', String(p));
  argv.push('--connect', String(GATE_CONNECT_PORT), '--allow-file', `${GATE_DIR}/egress-allow.json`, '--agent', agent);
  if (upstream) argv.push('--upstream', upstream);
  return argv;
}

/** The host's web proxy as the gate sees it (localhost → host.docker.internal), or null. */
export function gateUpstream(env = process.env) {
  const v = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || '';
  return v ? toBoxUrl(v) : null;
}

/** Refusals from the gate's log lines (JSON per line): [{ dest, count }], most first. */
export function gateDenials(logText) {
  const counts = new Map();
  for (const line of String(logText || '').split('\n')) {
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o && typeof o.deny === 'string') counts.set(o.deny, (counts.get(o.deny) || 0) + 1);
  }
  return [...counts].map(([dest, count]) => ({ dest, count })).sort((a, b) => b.count - a.count);
}

/**
 * Where a boxed Claude finds its per-launch session files: settings.json,
 * mcp.json and claude-plugin/ (this repo's slash commands). The same three
 * things claude-mcp-launcher.sh hands a host Claude as --settings, --mcp-config
 * and --plugin-dir — without them a boxed Claude starts bare: no /sl or other
 * project commands, none of the user's settings, no MCP servers. Staged per
 * launch on the host (stageClaudeSession) and mounted read-only.
 */
export const BOX_CLAUDE_SESSION = '/opt/coding-box/claude-session';

/**
 * Settings that run a HOST command. Inside the box the command does not exist
 * (host node paths, host scripts), and hooks are the managed policy's alone
 * there (allowManagedHooksOnly), so these are dropped from the box's copy. The
 * policy runs the coding hooks itself (BOX_CODING_HOOKS); the coding status
 * bar is drawn by tmux on the host either way.
 */
export const HOST_COMMAND_SETTINGS = ['hooks', 'statusLine', 'apiKeyHelper', 'awsAuthRefresh', 'awsCredentialExport', 'otelHeadersHelper'];

/**
 * WHICH CLAUDE SESSION THE BOX IS RUNNING — for the host's tmux context gauge
 * ---------------------------------------------------------------------------
 * On the host, Claude's status-line command tells the gauge its session id
 * (scripts/claude-statusline.cjs → recordClaudeSession). The box drops that
 * command (HOST_COMMAND_SETTINGS), so for a boxed Claude nothing ever did, and
 * the gauge fell back to the project's newest transcript — another session's
 * number, or GAUGE_ZERO when that one had no bridge file. That was the "stuck
 * on 0%, then 25%, then 0% again" gauge.
 *
 * So the launcher fixes the id itself: a fresh session gets `--session-id
 * <uuid>`, and a `--resume <id>` / `--session-id <id>` is read back from the
 * args. `--continue`, a bare `--resume` (picker) and `--fork-session` leave the
 * id to Claude, so there is nothing to record and the gauge keeps today's
 * fallback. Pure, so tests can pin it.
 *
 * @returns {{ args: string[], sessionId: string|null }}
 */
export function claudeGaugeSession(args = [], uuid = randomUUID) {
  let sessionId = null;
  let unknowable = false;
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i]);
    const eq = a.indexOf('=');
    const flag = a.startsWith('--') && eq > 0 ? a.slice(0, eq) : a;
    const inline = flag !== a ? a.slice(eq + 1) : null;
    const next = args[i + 1] != null && !String(args[i + 1]).startsWith('-') ? String(args[i + 1]) : null;
    if (flag === '--session-id') sessionId = inline ?? next;
    else if (flag === '--resume' || flag === '-r') {
      if (inline ?? next) sessionId = inline ?? next;
      else unknowable = true;
    } else if (flag === '--continue' || flag === '-c' || flag === '--fork-session') unknowable = true;
  }
  const uuidShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (unknowable) return { args, sessionId: null };
  if (sessionId) return { args, sessionId: uuidShape.test(sessionId) ? sessionId : null };
  const id = uuid();
  return { args: [...args, '--session-id', id], sessionId: id };
}

/** The model a boxed Claude starts on: `--model`, else the staged settings, else the env. */
export function claudeLaunchModel(args = [], settingsFile = null, env = process.env) {
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i]);
    if (a.startsWith('--model=')) return a.slice(8) || null;
    if (a === '--model' && args[i + 1]) return String(args[i + 1]);
  }
  if (settingsFile) {
    try {
      const m = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))?.model;
      if (typeof m === 'string' && m) return m;
    } catch { /* no staged settings */ }
  }
  return env.ANTHROPIC_MODEL || null;
}

/**
 * Tell the host gauge which session this tmux session is drawing, and keep
 * telling it: the record has a 24h TTL (context-gauge.cjs), and a boxed session
 * can outlive that. Returns a stop function; a no-op outside tmux.
 */
function recordBoxedClaudeForGauge({ sessionId, model, cwd }) {
  if (!sessionId || !process.env.TMUX || !process.env.TMUX_PANE) return () => {};
  let tmuxSession;
  try {
    tmuxSession = execFileSync('tmux', ['display-message', '-p', '-t', process.env.TMUX_PANE, '#{session_name}'],
      { encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return () => {}; }
  if (!tmuxSession) return () => {};
  let gauge;
  try {
    gauge = createRequire(import.meta.url)(path.join(REPO, 'lib', 'statusline', 'context-gauge.cjs'));
  } catch { return () => {}; }
  const write = () => { try { gauge.recordClaudeSession({ tmuxSession, sessionId, cwd, model }); } catch { /* best effort */ } };
  write();
  const timer = setInterval(write, 60 * 60 * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}

function git(args, cwd = REPO) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/**
 * Where a host path appears inside the box. POSIX paths keep their exact path —
 * Claude names its transcript folder after the cwd, so the host's session
 * logging finds box transcripts where it expects them. A Windows path has no
 * POSIX equivalent and lands under /host/<drive>/….
 */
export function boxPath(hostPath, platform = process.platform) {
  if (platform !== 'win32') return hostPath;
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(hostPath);
  if (!m) return hostPath.replace(/\\/g, '/');
  return `/host/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`;
}

/** localhost in a URL on the host is host.docker.internal from inside the box. */
export function toBoxUrl(value) {
  return value.replace(/\b(localhost|127\.0\.0\.1)\b|\[::1\]/g, 'host.docker.internal');
}

/**
 * Identity of the guard a build would bake in: the constraint-monitor SHA the
 * superproject pins, the committed rules blob, the committed box files and the
 * committed grant verifier. Working-tree edits never count.
 */
export function guardSource(repo = REPO) {
  const submodule = git(['rev-parse', `HEAD:${GUARD_SUBMODULE}`], repo);
  const rules = git(['rev-parse', `HEAD:${RULES}`], repo);
  const box = git(['rev-parse', `HEAD:${BOX_DIR}`], repo);
  const grants = git(['rev-parse', `HEAD:${GRANTS_LIB}`], repo);
  const digest = createHash('sha256').update(`${submodule}|${rules}|${box}|${grants}`).digest('hex').slice(0, 16);
  return { submodule, rules, box, grants, digest };
}

/** Uncommitted guard changes — they are NOT in the image, so say so. */
function uncommittedGuardChanges(repo = REPO) {
  const out = git(['status', '--porcelain', '--', GUARD_SUBMODULE, RULES, BOX_DIR, GRANTS_LIB], repo);
  return out ? out.split('\n') : [];
}

/** Write the docker build context (committed content only) into `dir`. */
export function stageContext(dir, src = guardSource(), repo = REPO) {
  const guardDir = path.join(dir, 'guard', GUARD_SUBMODULE);
  fs.mkdirSync(guardDir, { recursive: true });
  const tar = execFileSync('git', ['-C', path.join(repo, GUARD_SUBMODULE), 'archive', '--format=tar', src.submodule],
    { maxBuffer: 256 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', guardDir], { input: tar });

  const rulesOut = path.join(dir, 'guard', RULES);
  fs.mkdirSync(path.dirname(rulesOut), { recursive: true });
  fs.writeFileSync(rulesOut, execFileSync('git', ['cat-file', 'blob', src.rules], { cwd: repo }));

  // Same relative place as in the repo: the hook finds it at ../../../../lib/guard.
  const grantsOut = path.join(dir, 'guard', GRANTS_LIB);
  fs.mkdirSync(path.dirname(grantsOut), { recursive: true });
  fs.writeFileSync(grantsOut, execFileSync('git', ['cat-file', 'blob', src.grants], { cwd: repo }));

  // The box files as committed: Dockerfile, policy, entrypoint, agents/.
  const boxTar = execFileSync('git', ['archive', '--format=tar', `${src.box}`], { cwd: repo, maxBuffer: 64 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', dir], { input: boxTar });
}

/** The digest label of the built image, or null when there is no image. */
export function imageDigest(image = IMAGE) {
  const res = spawnSync('docker', ['image', 'inspect', image, '--format', '{{index .Config.Labels "coding.guard.digest"}}'],
    { encoding: 'utf8' });
  return res.status === 0 ? res.stdout.trim() || null : null;
}

/**
 * The full `docker run` argv for one agent session. Pure: everything it needs
 * comes in through the argument, so tests can pin it per platform.
 */
export function boxRunArgs({
  agent, args = [], env = process.env, cwd = process.cwd(), codingRepo = REPO,
  home = os.homedir(), platform = process.platform, uid, gid, tty = false,
  image = IMAGE, name = `coding-box-${agent}-${process.pid}`, exists = fs.existsSync,
  guardDir = guardHome(env, home), guardPortNum = guardPort(env), boxToken = null,
  piAgentDir = null, gate = null, claudeSessionDir = null, gitIdentity = null, codingHooks = [],
  hostViews = [], strict = false, opencodeExport = null,
}) {
  const command = AGENT_COMMANDS[agent];
  if (!command) throw new Error(`unknown agent '${agent}' (one of: ${Object.keys(AGENT_COMMANDS).join(', ')})`);

  const workspace = env.TARGET_PROJECT_DIR || cwd;
  const argv = ['run', '--rm', '-i'];
  const protectedDirs = agent === 'copilot' ? configRoots(workspace, cwd) : [];
  if (tty) argv.push('-t');
  // The hostname IS the guard session: grants are bound to it, and a non-root
  // process cannot change it (an env var could be set by a nested agent).
  argv.push('--name', name, '--hostname', name, '--label', 'coding.box=1', '--label', `coding.box.agent=${agent}`);
  argv.push('-e', `CODING_BOX_UID=${uid ?? 1000}`, '-e', `CODING_BOX_GID=${gid ?? 1000}`, '-e', 'CODING_BOX=1');
  if (gate) {
    // Locked network: an --internal network with no route out; the gate is the
    // only other container on it, and host.docker.internal IS the gate.
    argv.push('--network', gate.network, '--add-host', `host.docker.internal:${gate.ip}`);
  } else if (platform === 'linux') {
    argv.push('--add-host', 'host.docker.internal:host-gateway');
  }

  const mounts = new Map(); // box path → [host path, mode]
  const mount = (host, mode = 'rw') => {
    // The guard's signing key and approver token must never be visible in the box.
    if (exposesGuardHome(host, guardDir)) {
      throw new Error(`refusing to mount ${host}: it contains the guard's keys (${guardDir})`);
    }
    const target = boxPath(host, platform);
    if (!mounts.has(target)) mounts.set(target, [host, mode]);
  };
  mount(workspace, 'rw');
  for (const dir of protectedDirs) {
    mount(path.join(dir, '.github'), 'rw');
    for (const sub of COPILOT_CONFIG_DIRS) mount(path.join(dir, sub), 'ro');
  }
  const insideWorkspace = (p) => path.relative(workspace, p) === '' || !path.relative(workspace, p).startsWith('..');
  if (!insideWorkspace(codingRepo)) mount(codingRepo, 'ro'); // opencode plugins, pi extensions

  for (const key of [...ROUTING_ENV_VARS, ...EXTRA_ENV]) {
    const value = env[key];
    if (value === undefined || value === '') continue;
    if (key === 'PI_CODING_AGENT_DIR') continue; // never the host's: see PATH_ENV, set below from the staged copy
    if (gate && WEB_PROXY_ENV.includes(key)) continue; // locked: the gate's CONNECT proxy, set below
    let boxed = value;
    if (/^no_proxy$/i.test(key)) {
      boxed = `${value},host.docker.internal`;
    } else if (key === 'NODE_EXTRA_CA_CERTS') {
      if (exists(value)) mount(value, 'ro');
      boxed = boxPath(value, platform);
    } else if (PATH_ENV.includes(key)) {
      if (exists(value)) mount(value, 'rw');
      boxed = boxPath(value, platform);
    } else {
      boxed = toBoxUrl(value);
    }
    argv.push('-e', `${key}=${boxed}`);
  }

  if (gate) {
    // Web traffic goes to the gate's allow-list proxy (the agent's own login);
    // the LLM proxy and the guard are reached directly on the gate's forwards.
    const via = `http://host.docker.internal:${GATE_CONNECT_PORT}`;
    for (const k of WEB_PROXY_ENV) argv.push('-e', `${k}=${via}`);
    if (!env.NO_PROXY && !env.no_proxy) {
      argv.push('-e', 'NO_PROXY=host.docker.internal,localhost,127.0.0.1', '-e', 'no_proxy=host.docker.internal,localhost,127.0.0.1');
    }
  }

  // Host guard (scripts/coding-guard-daemon.mjs): where to ask, and who is asking.
  argv.push('-e', `CODING_GUARD_URL=http://host.docker.internal:${guardPortNum}`, '-e', `CODING_GUARD_SESSION=${name}`);
  // Binds `coding svc` to THIS box's session (registerBox); the agent may read it — it is only this box's.
  if (boxToken) argv.push('-e', `CODING_GUARD_BOX_TOKEN=${boxToken}`);
  // What claude-mcp-launcher.sh exports on the host: the slash commands find the
  // coding repo (and its knowledge exports) through these.
  const repoInBox = boxPath(codingRepo, platform);
  argv.push('-e', `CODING_REPO=${repoInBox}`, '-e', `CODING_TOOLS_PATH=${repoInBox}`,
    '-e', `CODING_KNOWLEDGE_BASE=${repoInBox}/.data/knowledge-graph`,
    '-e', `CODING_KNOWLEDGE_EXPORT=${repoInBox}/.data/knowledge-export`);
  // Who commits: the box has no ~/.gitconfig, so without these every commit
  // fails with "Author identity unknown".
  for (const [key, value] of Object.entries(gitIdentityEnv(gitIdentity))) argv.push('-e', `${key}=${value}`);
  // The image pins each agent's version (rebuilt by `coding box build`), and
  // its npm prefix is root-owned: a self-update can only fail, loudly, mid-session.
  argv.push('-e', 'DISABLE_AUTOUPDATER=1');
  // The coding hooks a host Claude runs (coding-hook.mjs in the image runs only
  // these), and where the health one asks: the gate's /health/state relay when
  // locked, the host itself when open.
  if (codingHooks.length) argv.push('-e', `CODING_BOX_HOOKS=${codingHooks.join(',')}`);
  argv.push('-e', `HEALTH_COORDINATOR_URL=http://host.docker.internal:${healthCoordinatorPort(env)}`);
  // Which protection level this box runs at, for the agent and its tools to read.
  argv.push('-e', `CODING_BOX_MODE=${strict ? 'strict' : 'box'}`);
  // The host's web UIs at localhost:<port> in the box (view-only via the gate);
  // the entrypoint starts the relay only when this is set — never when strict.
  if (!strict && hostViews.length) argv.push('-e', `CODING_BOX_HOST_VIEW=${hostViews.join(',')}`);

  argv.push('-v', `${HOME_VOLUME}:${BOX_HOME}`);
  // Claude transcripts on the host's disk, where session logging reads them.
  const projects = path.join(home, '.claude', 'projects');
  argv.push('-v', `${projects}:${BOX_HOME}/.claude/projects`);
  if (agent === 'copilot') {
    argv.push('-v', `${path.join(home, COPILOT_SESSIONS)}:${BOX_HOME}/${COPILOT_SESSIONS.split(path.sep).join('/')}`);
  }
  if (agent === 'pi' && piAgentDir) {
    if (exposesGuardHome(piAgentDir, guardDir)) {
      throw new Error(`refusing to mount ${piAgentDir}: it contains the guard's keys (${guardDir})`);
    }
    argv.push('-v', `${piAgentDir}:${BOX_PI_DIR}`, '-e', `PI_CODING_AGENT_DIR=${BOX_PI_DIR}`);
  }
  if (agent === 'opencode' && opencodeExport) {
    if (exposesGuardHome(opencodeExport, guardDir)) {
      throw new Error(`refusing to mount ${opencodeExport}: it contains the guard's keys (${guardDir})`);
    }
    argv.push('-v', `${opencodeExport}:${BOX_OPENCODE_EXPORT}`, '-e', `OPENCODE_DB=${BOX_OPENCODE_DB}`);
  }
  if (agent === 'claude' && claudeSessionDir) {
    if (exposesGuardHome(claudeSessionDir, guardDir)) {
      throw new Error(`refusing to mount ${claudeSessionDir}: it contains the guard's keys (${guardDir})`);
    }
    argv.push('-v', `${claudeSessionDir}:${BOX_CLAUDE_SESSION}:ro`);
  }
  for (const [target, [host, mode]] of mounts) argv.push('-v', `${host}:${target}${mode === 'ro' ? ':ro' : ''}`);
  // The directory, not the file: single-file bind mounts go stale on VirtioFS.
  const publicDir = guardPaths(guardDir).publicDir;
  if (exists(publicDir)) argv.push('-v', `${publicDir}:${BOX_GUARD_KEYS}:ro`);

  const agentArgv = [command, ...(AGENT_GUARD_ARGS[agent] ?? []), ...args];
  // opencode runs under the exporter so its sessions reach the host (see BOX_OPENCODE_DB).
  const wrapped = agent === 'opencode' && opencodeExport
    ? ['node', '--no-warnings', `${repoInBox}/scripts/box-opencode-sync.mjs`,
      '--db', BOX_OPENCODE_DB, '--out', BOX_OPENCODE_EXPORT, '--', ...agentArgv]
    : agentArgv;
  argv.push('-w', boxPath(cwd, platform), image, ...wrapped);
  return argv;
}

/**
 * Provider config an agent needs inside the box, as files to place in the
 * box home — generated COPIES with loopback URLs pointed at the host, never
 * mounts: `~/.pi/agent` mounted writable would let the box plant an extension
 * the HOST pi then loads. Returns [{ path (relative to the box home), content }];
 * a source that does not exist is skipped.
 */
export function boxAgentConfig(agent, { home = os.homedir(), readFile = (f) => fs.readFileSync(f, 'utf8') } = {}) {
  const sources = {
    opencode: ['.config/opencode/opencode.json'],
    pi: ['.pi/agent/models.json', '.pi/agent/settings.json'],
  }[agent] ?? [];
  const files = [];
  for (const rel of sources) {
    let text;
    try { text = readFile(path.join(home, rel)); } catch { continue; }
    files.push({ path: rel, content: toBoxUrl(text) });
  }
  return files;
}

/**
 * The host user's git identity, as git resolves it in `cwd` (repo config, then
 * global). Only the name and email reach the box, never ~/.gitconfig itself: it
 * can hold credential helpers, includes and aliases that run commands, which the
 * box must not inherit. Missing values come back null.
 */
export function hostGitIdentity(cwd = process.cwd(), run = spawnSync) {
  const get = (key) => {
    const res = run('git', ['config', '--get', key], { cwd, encoding: 'utf8' });
    const value = res.status === 0 ? String(res.stdout).trim() : '';
    return value || null;
  };
  return { name: get('user.name'), email: get('user.email') };
}

/**
 * The remote urls of the workspace repo and its submodules, read on the host
 * BEFORE the agent starts. The guard pins them: from inside the box, git push
 * and gh reach only these (lib/guard/vcs.mjs). Relative submodule urls are
 * resolved by the guard against `origin`, which comes first.
 */
export function hostRemotes(cwd = process.cwd(), run = spawnSync) {
  const lines = (args) => {
    const res = run('git', args, { cwd, encoding: 'utf8', timeout: 10_000 });
    return res.status === 0 ? String(res.stdout).split('\n').map((l) => l.trim()).filter(Boolean) : [];
  };
  const value = (l) => l.split(/\s+/).slice(1).join(' ');
  const origin = lines(['config', '--get', 'remote.origin.url']);
  return [...new Set([
    ...origin,
    ...lines(['config', '--get-regexp', '^remote\\..*\\.(push)?url$']).map(value),
    ...lines(['config', '-f', '.gitmodules', '--get-regexp', '^submodule\\..*\\.url$']).map(value),
    ...lines(['submodule', 'foreach', '--quiet', '--recursive', 'git config --get remote.origin.url || true']),
  ])].filter(Boolean);
}

/** GIT_AUTHOR_* / GIT_COMMITTER_* for an identity; unset parts are left out. */
export function gitIdentityEnv(identity) {
  const env = {};
  if (identity?.name) Object.assign(env, { GIT_AUTHOR_NAME: identity.name, GIT_COMMITTER_NAME: identity.name });
  if (identity?.email) Object.assign(env, { GIT_AUTHOR_EMAIL: identity.email, GIT_COMMITTER_EMAIL: identity.email });
  return env;
}

/** The box's copy of the derived Claude settings: everything except what runs a host command. */
export function boxClaudeSettings(derived) {
  const settings = { ...derived };
  for (const key of HOST_COMMAND_SETTINGS) delete settings[key];
  return settings;
}

/** The MCP config claude-mcp-launcher.sh would pick: the Docker one, then $MCP_CONFIG, then the processed default. */
export function claudeMcpConfigPath(repo = REPO, env = process.env, exists = fs.existsSync) {
  const candidates = [path.join(repo, 'claude-code-mcp-docker.json'), env.MCP_CONFIG, path.join(repo, 'claude-code-mcp-processed.json')];
  return candidates.find((f) => f && exists(f)) ?? null;
}

/**
 * Stage a boxed Claude's session files in `stageDir` and return the claude
 * arguments that load them from BOX_CLAUDE_SESSION — the box's counterpart of
 * the arguments claude-mcp-launcher.sh builds for a host Claude:
 *
 *   --settings      the derived settings (scripts/build-claude-runtime-config.mjs:
 *                   the user's own settings.json plus this project's), minus
 *                   whatever runs a host command (boxClaudeSettings)
 *   --plugin-dir    this repo's .claude/commands, filtered by feature, as a plugin
 *   --mcp-config    the same MCP config, loopback URLs pointed at the host
 *   --strict-mcp-config   unless CODING_MCP_STRICT=0, as on the host
 *
 * Copies, never the repo's own .coding/ files: those are regenerated (deleted
 * and rewritten) by every host launch, and the box must not be able to write
 * anything a host session later loads.
 */
export function stageClaudeSession(stageDir, { repo = REPO, env = process.env, run = spawnSync, fsImpl = fs } = {}) {
  const gen = path.join(stageDir, 'generated');
  const res = run(process.execPath, [path.join(repo, 'scripts', 'build-claude-runtime-config.mjs')], {
    env: { ...env, CODING_REPO: repo, CODING_RUNTIME_DIR: gen }, encoding: 'utf8',
  });
  if (res.status !== 0) throw new Error(`build-claude-runtime-config.mjs failed: ${(res.stderr || '').trim().split('\n').pop()}`);
  const [settingsFile, pluginDir] = String(res.stdout).trim().split('\n');
  const args = [];
  const derived = JSON.parse(fsImpl.readFileSync(settingsFile, 'utf8'));
  fsImpl.writeFileSync(path.join(stageDir, 'settings.json'), `${JSON.stringify(boxClaudeSettings(derived), null, 2)}\n`);
  args.push('--settings', `${BOX_CLAUDE_SESSION}/settings.json`);
  if (pluginDir && fsImpl.existsSync(pluginDir)) {
    fsImpl.renameSync(pluginDir, path.join(stageDir, 'claude-plugin'));
    args.push('--plugin-dir', `${BOX_CLAUDE_SESSION}/claude-plugin`);
  }
  fsImpl.rmSync(gen, { recursive: true, force: true });
  const mcp = claudeMcpConfigPath(repo, env, (f) => fsImpl.existsSync(f));
  if (mcp) {
    fsImpl.writeFileSync(path.join(stageDir, 'mcp.json'), toBoxUrl(fsImpl.readFileSync(mcp, 'utf8')));
    args.push('--mcp-config', `${BOX_CLAUDE_SESSION}/mcp.json`);
    if (env.CODING_MCP_STRICT !== '0') args.push('--strict-mcp-config');
  }
  return args;
}

/** The top-level files of pi's config dir a box session gets (never auth.json / models-store.json). */
export const PI_STAGED = ['models.json', 'settings.json', 'APPEND_SYSTEM.md'];

/**
 * pi's config dir for one box session: a COPY of the launch's dir (the
 * provider config agent_pre_launch just wrote, and the extensions pi.sh
 * installed) in `stageDir`, with loopback URLs pointed at the host. The box
 * may write to the copy; the host never loads it. Credentials (auth.json,
 * models-store.json) and old sessions stay behind. Returns the files copied.
 */
export function stageBoxPiDir(srcDir, stageDir, fsImpl = fs) {
  const copied = [];
  fsImpl.mkdirSync(stageDir, { recursive: true });
  for (const name of PI_STAGED) {
    let text;
    try { text = fsImpl.readFileSync(path.join(srcDir, name), 'utf8'); } catch { continue; }
    fsImpl.writeFileSync(path.join(stageDir, name), name.endsWith('.json') ? toBoxUrl(text) : text);
    copied.push(name);
  }
  const extSrc = path.join(srcDir, 'extensions');
  let entries = [];
  try { entries = fsImpl.readdirSync(extSrc, { withFileTypes: true }); } catch { /* no extensions */ }
  for (const e of entries) {
    if (!e.isFile()) continue; // pi loads extensions/*.ts; a subdirectory is not copied
    fsImpl.mkdirSync(path.join(stageDir, 'extensions'), { recursive: true });
    fsImpl.copyFileSync(path.join(extSrc, e.name), path.join(stageDir, 'extensions', e.name));
    copied.push(path.join('extensions', e.name));
  }
  return copied;
}

/**
 * What a box provider sends as its key to the LLM proxy, which does not
 * authenticate — the value pi's staged config uses (proxy-routing.mjs). Not a credential.
 */
export const PROXY_NO_AUTH = 'coding-local-proxy-no-auth';

/** opencode's file config on the host — the one OPENCODE_CONFIG_CONTENT is merged over. */
export function opencodeConfigFile(env = process.env, home = os.homedir()) {
  if (env.OPENCODE_CONFIG) return env.OPENCODE_CONFIG;
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'opencode', 'opencode.json');
}

/**
 * OPENCODE_CONFIG_CONTENT for a box session. The launcher's content
 * (opencodeConfigContent) holds only per-launch values and leans on the host's
 * file config for the providers themselves — npm package, baseURL, models — and
 * for the default model. The box has no such file (its home is a volume), so
 * opencode there had a rapid-proxy with no URL and failed every turn with
 * "Invalid URL". Carry over, from `hostText`, each ENABLED provider's
 * definition (the launch's own values win) and the default models when their
 * provider is enabled — never a host apiKey (a placeholder instead). Loopback
 * URLs are pointed at the host later (toBoxUrl).
 * Pure. Unparseable input → the content unchanged.
 */
export function boxOpencodeConfig(content, hostText) {
  let cfg;
  let host;
  try { cfg = JSON.parse(content || '{}'); host = JSON.parse(hostText); } catch { return content; }
  if (!host || typeof host !== 'object') return content;
  const enabled = Array.isArray(cfg.enabled_providers) ? cfg.enabled_providers : Object.keys(cfg.provider || {});
  cfg.provider = cfg.provider || {};
  for (const id of enabled) {
    const fromHost = host.provider?.[id];
    if (!fromHost) continue;
    const own = cfg.provider[id] || {};
    const models = { ...(fromHost.models || {}) };
    for (const [m, v] of Object.entries(own.models || {})) models[m] = { ...(models[m] || {}), ...v };
    // Never the host's key: the proxy does not authenticate, and a credential
    // has no business in the box.
    const { apiKey, ...hostOptions } = fromHost.options || {};
    const options = { ...hostOptions, ...(apiKey !== undefined ? { apiKey: PROXY_NO_AUTH } : {}), ...(own.options || {}) };
    if (fromHost.options?.headers || own.options?.headers) options.headers = { ...(fromHost.options?.headers || {}), ...(own.options?.headers || {}) };
    cfg.provider[id] = { ...fromHost, ...own, options, models };
  }
  const usable = (ref) => typeof ref === 'string' && enabled.includes(ref.split('/')[0]);
  for (const key of ['model', 'small_model']) {
    if (cfg[key] === undefined && usable(host[key])) cfg[key] = host[key];
  }
  return JSON.stringify(cfg);
}

/** The workspace and every directory below it down to `cwd`. */
export function configRoots(workspace, cwd) {
  const rel = path.relative(workspace, cwd);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return [workspace];
  const roots = [workspace];
  let dir = workspace;
  for (const part of rel.split(path.sep).filter(Boolean)) {
    dir = path.join(dir, part);
    roots.push(dir);
  }
  return roots;
}

/**
 * Before a copilot box starts: refuse when a repository settings file already
 * disables hooks (the guard would never run), and create the directories the
 * read-only mounts need — empty directories, which git does not track.
 */
export function prepareCopilotConfig(workspace, cwd, fsImpl = fs) {
  const roots = configRoots(workspace, cwd);
  for (const dir of roots) {
    for (const sub of COPILOT_CONFIG_DIRS) {
      for (const name of COPILOT_SETTINGS) {
        const file = path.join(dir, sub, name);
        let text;
        try { text = fsImpl.readFileSync(file, 'utf8'); } catch { continue; }
        if (/"disable(All)?Hooks"\s*:\s*true|"disabledHooks"\s*:\s*\[\s*"/.test(text)) {
          throw new Error(`${file} disables Copilot hooks, so the guard would not run. Remove that setting, or run copilot outside the box (--no-box).`);
        }
      }
      fsImpl.mkdirSync(path.join(dir, sub), { recursive: true });
    }
  }
  return roots;
}

/** Playwright default for the image, when the lockfile cannot say. */
export const PLAYWRIGHT_FALLBACK = '1.58.2';

/**
 * The Playwright version the coding repo locks: the box's Chromium must be the
 * revision that version looks for, or every launch fails with "Executable
 * doesn't exist". From package-lock.json; the fallback when it is unreadable.
 */
export function playwrightVersion(repo = REPO, readFile = (f) => fs.readFileSync(f, 'utf8')) {
  try {
    const v = JSON.parse(readFile(path.join(repo, 'package-lock.json'))).packages?.['node_modules/playwright']?.version;
    if (typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v)) return v;
  } catch { /* fall through */ }
  return PLAYWRIGHT_FALLBACK;
}

function build() {
  const changes = uncommittedGuardChanges();
  if (changes.length) {
    process.stderr.write(`agent-box: uncommitted guard changes are NOT built in (commit them first):\n  ${changes.join('\n  ')}\n`);
  }
  const src = guardSource();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-agent-box-'));
  try {
    stageContext(dir, src);
    process.stderr.write(`agent-box: building ${IMAGE} (guard ${src.digest}: constraint-monitor ${src.submodule.slice(0, 9)}, rules ${src.rules.slice(0, 9)})\n`);
    const res = spawnSync('docker', ['build', '-t', IMAGE,
      '--build-arg', `PLAYWRIGHT_VERSION=${playwrightVersion()}`,
      '--label', `coding.guard.digest=${src.digest}`,
      '--label', `coding.guard.submodule=${src.submodule}`,
      '--label', `coding.guard.rules=${src.rules}`,
      dir], { stdio: 'inherit' });
    return res.status ?? 1;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function status() {
  const built = imageDigest();
  const current = guardSource().digest;
  if (!built) {
    process.stdout.write(`no image — run: coding box build\n`);
    return 1;
  }
  process.stdout.write(built === current
    ? `${IMAGE} up to date (guard ${built})\n`
    : `${IMAGE} STALE: built from guard ${built}, committed guard is ${current} — run: coding box build\n`);
  return built === current ? 0 : 2;
}

/**
 * Register a box with the host guard (approver token, host-only) and get the
 * token that binds its `coding svc` calls to `session`; release it on exit.
 * No guard running → null, and the box starts without `coding svc`.
 */
export async function registerBox(session, { env = process.env, release = false, workspace = null, remotes = [] } = {}) {
  try {
    const res = await fetch(`http://127.0.0.1:${guardPort(env)}/boxes${release ? '/release' : ''}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${readToken(guardPaths(guardHome(env)))}` },
      body: JSON.stringify(release ? { session } : { session, workspace, remotes }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return release ? true : (await res.json()).token ?? null;
  } catch {
    return null;
  }
}

function docker(args, opts = {}) {
  return spawnSync('docker', args, { encoding: 'utf8', ...opts });
}

/** Is the launcher that owns a gate still running (on this host)? */
function launcherAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try { process.kill(n, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

/**
 * Gates and box networks whose LAUNCHER is gone (killed before its cleanup).
 * Judged by the launcher's pid, not by whether the box container exists yet:
 * a fresh gate lives a moment before its box starts, and a parallel launch
 * must not sweep it. Matched by label, never by name pattern.
 */
function sweepOrphanGates() {
  const gates = docker(['ps', '-a', '--filter', 'label=coding.box.gate=1', '--format', '{{.Names}}\t{{.Label "coding.box.gate.pid"}}\t{{.Label "coding.box.gate.network"}}']).stdout || '';
  for (const line of gates.split('\n').filter(Boolean)) {
    const [gateName, pid, network] = line.split('\t');
    if (launcherAlive(pid)) continue;
    docker(['rm', '-f', gateName]);
    if (network) docker(['network', 'rm', network]);
  }
  const nets = docker(['network', 'ls', '--filter', 'label=coding.box.network=1', '--format', '{{.Name}}\t{{.Label "coding.box.network.pid"}}']).stdout || '';
  for (const line of nets.split('\n').filter(Boolean)) {
    const [network, pid] = line.split('\t');
    if (!launcherAlive(pid)) docker(['network', 'rm', network]);
  }
}

/**
 * Locked network for box `name`: an --internal network plus its gate.
 * Returns { network, ip, gateName } — or throws, and leaves nothing behind.
 */
export function startGate({ name, agent, env = process.env, platform = process.platform, guardPortNum = guardPort(env) }) {
  sweepOrphanGates();
  const network = `${name}-net`;
  const gateName = `${name}-gate`;
  const fail = (what, res) => {
    docker(['rm', '-f', gateName]);
    docker(['network', 'rm', network]);
    throw new Error(`box network: ${what} failed: ${(res.stderr || res.stdout || '').trim()}`);
  };
  let res = docker(['network', 'create', '--internal', '--label', 'coding.box.network=1', '--label', `coding.box.network.for=${name}`, '--label', `coding.box.network.pid=${process.pid}`, network]);
  if (res.status !== 0) fail('creating the internal network', res);
  const ports = gatePorts(env, guardPortNum);
  const relays = gateRelays(env);
  const mcpRelays = gateMcpRelays(env);
  const taken = [...ports, ...relays.map((r) => r.port), ...mcpRelays.map((r) => r.port), GATE_CONNECT_PORT];
  res = docker(gateRunArgs({ name, agent, ports, network, upstream: gateUpstream(env), relays, mcpRelays, views: hostViewPorts(env, taken), platform }));
  if (res.status !== 0) fail('starting the gate', res);
  res = docker(['network', 'connect', network, gateName]);
  if (res.status !== 0) fail('connecting the gate', res);
  res = docker(['inspect', '-f', `{{(index .NetworkSettings.Networks "${network}").IPAddress}}`, gateName]);
  const ip = (res.stdout || '').trim();
  if (res.status !== 0 || !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) fail('reading the gate address', res);
  // Ready once it logs {"ready":true} — well under a second; ten is the cap.
  for (let i = 0; i < 100; i++) {
    const logs = docker(['logs', gateName]);
    if (/"ready":true/.test(logs.stdout)) return { network, ip, gateName };
    if (/"fatal"/.test(`${logs.stderr}${logs.stdout}`)) fail('the gate', logs);
    spawnSync('sleep', ['0.1']);
  }
  fail('waiting for the gate', { stderr: 'not ready after 10 s' });
  return null;
}

/**
 * Why a gate died, from its log: its {"fatal"} line, else the first error line
 * of a Node stack trace (an unhandled 'error' event), else null.
 */
export function gateExitReason(logText) {
  let reason = null;
  for (const line of String(logText || '').split('\n')) {
    try {
      const o = JSON.parse(line);
      if (o && typeof o.fatal === 'string') reason = o.fatal;
      continue;
    } catch { /* not a log line */ }
    if (!reason && /^\w*Error\b.*:/.test(line.trim())) reason = line.trim();
  }
  return reason;
}

/** How often watchGate restarts a dead gate before it gives up. */
export const GATE_MAX_RESTARTS = 3;

/**
 * Watch the gate while its box runs. The box reaches the host only through
 * the gate, at a fixed address (--add-host), so a dead gate leaves an agent
 * that retries ECONNREFUSED with nothing in its pane to say why. On a death:
 * say so, with the gate's own reason, and restart it in place — accepted only
 * if it comes back at the same address. Past `maxRestarts`, or at a new
 * address, say the box has no network and stop watching. Returns { stop() }.
 *
 * `ops` are the docker side (injectable for tests): wait(name) → { done:
 * Promise<exit code>, cancel() }, logs(name) → text, restart(name) → ip|null.
 */
export function watchGate(gate, { write = (s) => process.stderr.write(s), maxRestarts = GATE_MAX_RESTARTS, ops = gateOps(gate) } = {}) {
  let stopped = false;
  let current = null;
  let restarts = 0;
  const say = (s) => write(`\r\nagent-box: ${s}\r\n`);
  const loop = async () => {
    while (!stopped) {
      current = ops.wait(gate.gateName);
      const code = await current.done;
      if (stopped) return;
      const reason = gateExitReason(ops.logs(gate.gateName)) || `exit code ${code}`;
      if (restarts >= maxRestarts) {
        say(`the box network gate died again (${reason}); restarted ${restarts}× already — the box has NO network now. Quit and relaunch it.`);
        return;
      }
      restarts++;
      const ip = ops.restart(gate.gateName);
      if (ip !== gate.ip) {
        say(`the box network gate died (${reason}) and could not be restored${ip ? ` (new address ${ip}, the box expects ${gate.ip})` : ''} — the box has NO network now. Quit and relaunch it.`);
        return;
      }
      say(`the box network gate died (${reason}); restarted it (${restarts}/${maxRestarts}). Requests in flight were lost — retry them.`);
    }
  };
  const done = loop().catch((err) => say(`cannot watch the box network gate: ${err.message}`));
  return {
    done,
    stop() { stopped = true; current?.cancel(); },
  };
}

/** The docker side of watchGate. */
function gateOps({ network }) {
  return {
    wait(name) {
      const child = spawn('docker', ['wait', name], { stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      const done = new Promise((resolve) => {
        child.on('error', () => resolve(null));
        child.on('exit', () => resolve(out.trim() === '' ? null : Number(out.trim())));
      });
      return { done, cancel: () => child.kill() };
    },
    logs: (name) => { const r = docker(['logs', name]); return `${r.stdout || ''}${r.stderr || ''}`; },
    restart(name) {
      if (docker(['start', name]).status !== 0) return null;
      for (let i = 0; i < 100; i++) {
        const r = docker(['inspect', '-f', `{{.State.Running}} {{(index .NetworkSettings.Networks "${network}").IPAddress}}`, name]);
        const [running, ip] = (r.stdout || '').trim().split(' ');
        if (running === 'true' && /^\d+\.\d+\.\d+\.\d+$/.test(ip || '')) return ip;
        spawnSync('sleep', ['0.1']);
      }
      return null;
    },
  };
}

/** Stop the gate and its network; returns what the gate refused. */
export function stopGate({ network, gateName }) {
  const denials = gateDenials(docker(['logs', gateName]).stdout);
  docker(['rm', '-f', gateName]);
  docker(['network', 'rm', network]);
  return denials;
}

async function run(agent, args) {
  const built = imageDigest();
  if (!built) {
    process.stderr.write(`agent-box: no ${IMAGE} image — run: coding box build\n`);
    return 1;
  }
  const current = guardSource().digest;
  if (built !== current) {
    process.stderr.write(`agent-box: WARNING the box runs guard ${built}; the committed guard is ${current}. Run: coding box build\n`);
  }
  if (agent === 'copilot') {
    try {
      prepareCopilotConfig(process.env.TARGET_PROJECT_DIR || process.cwd(), process.cwd());
    } catch (err) {
      process.stderr.write(`agent-box: ${err.message}\n`);
      return 1;
    }
  }
  if (agent === 'copilot') {
    // Created here, as the user: docker would create a missing source as root.
    fs.mkdirSync(path.join(os.homedir(), COPILOT_SESSIONS), { recursive: true });
  }
  let opencodeExport = null;
  if (agent === 'opencode') {
    // Created here, as the user: docker would create a missing source as root.
    opencodeExport = opencodeDbs.boxOpencodeExportDir();
    fs.mkdirSync(opencodeExport, { recursive: true });
  }
  if (agent === 'opencode') {
    const file = opencodeConfigFile();
    let hostText = null;
    try { hostText = fs.readFileSync(file, 'utf8'); } catch { /* none */ }
    if (hostText === null) {
      process.stderr.write(`agent-box: no opencode config at ${file} — opencode in the box has only its built-in providers\n`);
    } else {
      process.env.OPENCODE_CONFIG_CONTENT = boxOpencodeConfig(process.env.OPENCODE_CONFIG_CONTENT, hostText);
    }
  }
  let piAgentDir = null;
  if (agent === 'pi') {
    piAgentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-box-pi-'));
    const src = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent');
    if (!stageBoxPiDir(src, piAgentDir).includes('models.json')) {
      process.stderr.write(`agent-box: no pi provider config in ${src} — pi in the box will have no model\n`);
    }
  }
  let claudeSessionDir = null;
  if (agent === 'claude') {
    claudeSessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-box-claude-'));
    try {
      args = [...stageClaudeSession(claudeSessionDir), ...args];
    } catch (err) {
      process.stderr.write(`agent-box: ${err.message} — Claude starts without this project's settings, slash commands and MCP servers\n`);
    }
  }
  let stopGaugeRecord = () => {};
  if (agent === 'claude') {
    const pinned = claudeGaugeSession(args);
    args = pinned.args;
    stopGaugeRecord = recordBoxedClaudeForGauge({
      sessionId: pinned.sessionId,
      model: claudeLaunchModel(args, claudeSessionDir && path.join(claudeSessionDir, 'settings.json')),
      cwd: process.env.TARGET_PROJECT_DIR || process.cwd(),
    });
  }
  let codingHooks = [];
  if (agent === 'claude') {
    try {
      codingHooks = boxCodingHooks((await import('../lib/features/index.mjs')).isEnabled);
    } catch (err) {
      process.stderr.write(`agent-box: cannot read the feature config (${err.message}) — no coding hooks in the box\n`);
    }
  }
  const name = `coding-box-${agent}-${process.pid}`;
  const strict = boxStrict();
  const viewTaken = [...gatePorts(), ...gateRelays().map((r) => r.port), ...gateMcpRelays().map((r) => r.port), GATE_CONNECT_PORT];
  const hostViews = hostViewPorts(process.env, viewTaken);
  process.stderr.write(strict
    ? 'agent-box: strict box — the host\'s web UIs (dashboard, viewer) stay hidden from the agent\n'
    : `agent-box: box — the agent can VIEW the host's web UIs at localhost:${hostViews.join(', ')} (read-only; --strict-box hides them)\n`);
  let gate = null;
  if (boxNetworkMode() === 'locked') {
    try {
      gate = startGate({ name, agent });
    } catch (err) {
      process.stderr.write(`agent-box: ${err.message}\nagent-box: refusing to start the box without its network lock (CODING_BOX_NETWORK=open runs it on the open bridge, recorded).\n`);
      if (piAgentDir) fs.rmSync(piAgentDir, { recursive: true, force: true });
      if (claudeSessionDir) fs.rmSync(claudeSessionDir, { recursive: true, force: true });
      stopGaugeRecord();
      return 1;
    }
  } else {
    process.stderr.write('agent-box: CODING_BOX_NETWORK=open — the box can reach every host service and the internet\n');
    spawnSync(process.execPath, [path.join(REPO, 'scripts', 'coding-guard.mjs'), 'note', 'box.network.open', `agent=${agent}`, `box=${name}`], { stdio: 'ignore' });
  }
  const workspace = process.env.TARGET_PROJECT_DIR || process.cwd();
  const boxToken = await registerBox(name, { workspace, remotes: hostRemotes(workspace) });
  if (!boxToken) process.stderr.write('agent-box: the host guard did not register this box — `coding svc` will be refused inside it\n');
  try {
    const argv = boxRunArgs({
      agent, args, name, boxToken, piAgentDir, gate, claudeSessionDir, opencodeExport,
      gitIdentity: hostGitIdentity(process.env.TARGET_PROJECT_DIR || process.cwd()), codingHooks,
      hostViews, strict,
      uid: process.getuid?.(), gid: process.getgid?.(),
      tty: Boolean(process.stdin.isTTY),
    });
    // Async, so the gate can be watched while the box runs.
    const box = spawn('docker', argv, { stdio: 'inherit' });
    const watcher = gate ? watchGate(gate) : null;
    const status = await new Promise((resolve) => {
      box.on('error', (err) => { process.stderr.write(`agent-box: docker: ${err.message}\n`); resolve(1); });
      box.on('exit', (code) => resolve(code ?? 1));
    });
    watcher?.stop();
    return status;
  } finally {
    stopGaugeRecord();
    if (boxToken) await registerBox(name, { release: true });
    if (piAgentDir) fs.rmSync(piAgentDir, { recursive: true, force: true });
    if (claudeSessionDir) fs.rmSync(claudeSessionDir, { recursive: true, force: true });
    if (gate) {
      const denied = stopGate(gate);
      if (denied.length) {
        const shown = denied.slice(0, 8).map((d) => `${d.dest}${d.count > 1 ? ` ×${d.count}` : ''}`).join(', ');
        process.stderr.write(`agent-box: the box network refused ${shown}${denied.length > 8 ? ', …' : ''} (allow-list: docker/agent-box/gate/egress-allow.json)\n`);
      }
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  let code;
  if (cmd === 'build') code = build();
  else if (cmd === 'status') code = status();
  else if (cmd === 'redteam') {
    code = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'redteam-box.mjs'), ...rest], { stdio: 'inherit' }).status ?? 1;
  }
  else if (cmd === 'run') {
    const [agent, ...more] = rest;
    code = await run(agent, more[0] === '--' ? more.slice(1) : more);
  } else {
    process.stderr.write('usage: agent-box.mjs build | status | redteam [options] | run <claude|copilot|opencode|pi> [-- args…]\n');
    code = 64;
  }
  process.exit(code);
}
