/**
 * Multi-Agent Startup & Operations Contract Tests
 * tests/integration/agent-startup-contract.test.js
 *
 * Validates that all FOUR supported coding agents — claude (default), copilot,
 * opencode, pi — share a sound startup contract and that the cross-cutting
 * "basic operations" wiring is intact:
 *
 *   1. Agent definition       — config/agents/<agent>.sh present + well-formed
 *   2. Hook wiring            — each agent's hooks expressed in ITS OWN native
 *                               schema, with every referenced script resolvable
 *                               and (for copilot) actually executable
 *   3. MCP servers            — exactly the expected set (graphify only;
 *                               semantic-analysis/constraint-monitor are now
 *                               CLIs, not MCP servers)
 *   4. Constraints            — .constraint-monitor.yaml parses, non-empty
 *   5. Online learning        — observations → digests → insights pipeline has
 *                               data (export files; obs-api as a live soft-check)
 *
 * REGRESSION ANCHOR (2026-06-18): the copilot `preToolUse` hook failed with
 * `spawn bash ENOENT` because `.github/hooks/copilot-coding.json` used
 * `cwd: "$CODING_REPO"` (Copilot does not env-expand `cwd`) and pointed at a
 * `scripts/copilot-hooks/*.sh` tree that never existed. Because Copilot's
 * preToolUse is FAIL-CLOSED, every tool call was denied and the CLI was bricked.
 * The "copilot native hooks" block below is the specific guard against that
 * class of bug — it would have failed before the fix.
 *
 * These tests are deterministic (static contract). Live-service assertions
 * (obs-api) degrade to soft warnings when the service is not running, so the
 * suite is safe in CI but meaningful on a live dev box.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, accessSync, mkdtempSync, constants as fsConstants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');

const AGENTS = ['claude', 'copilot', 'opencode', 'pi'];

// semantic-analysis and constraint-monitor were removed as MCP servers (see
// claude-code-mcp.json's _comment): they are now CLIs (bin/semantic,
// bin/constraints) with /semantic and /constraints skills, not MCP tool
// schemas. graphify remains the one MCP server, whichever code-graph backend
// the registry says is active. Derived rather than frozen: pinning the
// literal set meant every backend switch broke this test for the wrong
// reason.
const STATIC_MCP_SERVERS = [];
const CODE_GRAPH_SERVER = (() => {
  try {
    const reg = JSON.parse(readFileSync(path.join(REPO, 'config/code-graph.json'), 'utf8'));
    return reg.backends[reg.active].mcp.serverName;
  } catch {
    return 'graphify'; // registry unreadable — assert the shipped default
  }
})();
const EXPECTED_MCP_SERVERS = [...STATIC_MCP_SERVERS, CODE_GRAPH_SERVER];

// Integration dir to assert on disk, for stdio servers we ship ourselves. Servers
// launched through `docker exec` have no such dir, which is why this is a lookup
// with an explicit "no dir expected" case rather than an unconditional deref.
const SERVER_INTEGRATION_DIRS = {
  'semantic-analysis': 'integrations/mcp-server-semantic-analysis',
  'constraint-monitor': 'integrations/mcp-constraint-monitor',
};

const readText = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const readJson = (rel) => JSON.parse(readText(rel));
const isExecutable = (abs) => {
  try { accessSync(abs, fsConstants.X_OK); return true; } catch { return false; }
};

// ---------------------------------------------------------------------------
// 1. Agent definition contract
// ---------------------------------------------------------------------------
describe('Agent definition contract — config/agents/<agent>.sh', () => {
  it.each(AGENTS)('%s has a well-formed agent definition', (agent) => {
    const rel = `config/agents/${agent}.sh`;
    expect(existsSync(path.join(REPO, rel))).toBe(true);

    const src = readText(rel);
    // Required identity fields the unified launcher (launch-agent-common.sh) reads.
    expect(src).toMatch(/^AGENT_NAME=/m);
    expect(src).toMatch(/^AGENT_COMMAND=/m);
    // The launcher dispatches to agent_check_requirements before launch.
    expect(src).toMatch(/agent_check_requirements\s*\(\)/);

    // AGENT_NAME must match the filename so `coding --agent <name>` resolves.
    const nameMatch = src.match(/^AGENT_NAME="?([a-z]+)"?/m);
    expect(nameMatch && nameMatch[1]).toBe(agent);
  });

  it('the unified launcher can resolve a launcher for every agent', () => {
    // bin/coding execs scripts/launch-<agent>.sh if present, else launch-generic.sh.
    for (const agent of AGENTS) {
      const specific = path.join(REPO, `scripts/launch-${agent}.sh`);
      const generic = path.join(REPO, 'scripts/launch-generic.sh');
      expect(existsSync(specific) || existsSync(generic)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 2a. Hook wiring — COPILOT native hooks (regression guard for the ENOENT bug)
// ---------------------------------------------------------------------------
describe('Hook wiring — copilot native (.github/hooks)', () => {
  const HOOKS_DIR_REL = '.github/hooks';
  const COPILOT_EVENTS = [
    'sessionStart', 'userPromptSubmitted', 'preToolUse',
    'postToolUse', 'sessionEnd', 'errorOccurred',
  ];

  it('hooks.json uses Copilot CLI v1 schema (version + hooks object, NOT command/args)', () => {
    const cfg = readJson(`${HOOKS_DIR_REL}/hooks.json`);
    expect(cfg.version).toBe(1);
    expect(typeof cfg.hooks).toBe('object');
    expect(Array.isArray(cfg.hooks)).toBe(false);

    for (const event of COPILOT_EVENTS) {
      expect(Array.isArray(cfg.hooks[event])).toBe(true);
      for (const entry of cfg.hooks[event]) {
        expect(entry.type).toBe('command');
        expect(typeof entry.bash).toBe('string');
        expect(entry.bash.length).toBeGreaterThan(0);
        // The pre-1.0.63 schema (command/args) is rejected wholesale by Copilot.
        expect(entry).not.toHaveProperty('command');
        expect(entry).not.toHaveProperty('args');
      }
    }
  });

  it('no hook entry hides an env-var in cwd (the spawn-ENOENT trap)', () => {
    const cfg = readJson(`${HOOKS_DIR_REL}/hooks.json`);
    for (const entries of Object.values(cfg.hooks)) {
      for (const entry of entries) {
        if (entry.cwd !== undefined) {
          // Copilot does NOT expand $VARS in cwd → a literal "$X" dir → ENOENT.
          expect(entry.cwd).not.toMatch(/\$/);
          const abs = path.resolve(REPO, entry.cwd);
          expect(existsSync(abs)).toBe(true);
        }
      }
    }
  });

  it('every script referenced by every .github/hooks/*.json exists & is executable', () => {
    // Guards against reintroducing an orphan config (e.g. copilot-coding.json)
    // that points at a script tree that was never created.
    const dir = path.join(REPO, HOOKS_DIR_REL);
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files).toContain('hooks.json');

    for (const file of files) {
      const cfg = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
      const buckets = cfg.hooks ? Object.values(cfg.hooks) : [];
      for (const entries of buckets) {
        for (const entry of [].concat(entries)) {
          const script = String(entry.bash || entry.command || '').trim().split(/\s+/)[0];
          if (!script || script.startsWith('echo') || !script.includes('/')) continue;
          // Resolve relative (./lib/...) against the launch cwd (= repo root).
          const abs = script.includes('$')
            ? null // an env-var path is itself a smell; flagged by the cwd test
            : path.resolve(REPO, script.replace(/^\.\//, ''));
          if (abs) {
            expect(existsSync(abs)).toBe(true);
            expect(isExecutable(abs)).toBe(true);
          }
        }
      }
    }
  });

  it('preToolUse hook executes exactly as Copilot runs it → exit 0, non-denying JSON', () => {
    // Faithful simulation: Copilot runs the `bash` string via bash -c with
    // cwd = repo root and WITHOUT CODING_REPO in the environment. Pre-fix this
    // threw `spawn bash ENOENT`; fail-closed → every tool denied.
    const cfg = readJson(`${HOOKS_DIR_REL}/hooks.json`);
    const bashField = cfg.hooks.preToolUse[0].bash;

    const env = { ...process.env };
    delete env.CODING_REPO; // prove the bridge self-locates from its own path

    let out;
    expect(() => {
      out = execFileSync('bash', ['-c', bashField], {
        cwd: REPO,
        env,
        input: JSON.stringify({ tool: { name: 'shell' } }),
        encoding: 'utf8',
        timeout: 15000,
      });
    }).not.toThrow();

    const result = JSON.parse(out.trim());
    expect(result).toHaveProperty('continue');
    expect(result.continue).not.toBe(false); // must NOT fail-closed/deny
  });
});

// ---------------------------------------------------------------------------
// 2b. Hook wiring — CLAUDE (unified module handlers)
// ---------------------------------------------------------------------------
describe('Hook wiring — claude (unified hook config)', () => {
  it('config/hooks-config.json is structurally valid (every handler has id/type/path)', () => {
    const cfg = readJson('config/hooks-config.json');
    expect(typeof cfg.hooks).toBe('object');
    for (const handlers of Object.values(cfg.hooks)) {
      expect(Array.isArray(handlers)).toBe(true);
      for (const h of handlers) {
        // Schema that hook-config.js validateConfig() enforces.
        expect(typeof h.id).toBe('string');
        expect(typeof h.type).toBe('string');
        expect(typeof h.path).toBe('string');
      }
    }
  });

  it('[drift soft-check] module handler files referenced by the config exist', () => {
    // hook-config.js tolerates missing handlers (validateConfig only WARNS and
    // the loader silently skips them), so this is a non-fatal drift check — it
    // surfaces config-vs-reality gaps without bricking the suite, unlike the
    // fail-closed copilot preToolUse hook which is asserted hard above.
    const cfg = readJson('config/hooks-config.json');
    const missing = [];
    for (const [event, handlers] of Object.entries(cfg.hooks)) {
      for (const h of handlers) {
        if (h.type === 'module' && h.path) {
          const abs = path.resolve(REPO, h.path.replace(/^\.\//, ''));
          if (!existsSync(abs)) missing.push(`${event}/${h.id} -> ${h.path}`);
        }
      }
    }
    if (missing.length) {
      console.warn(
        `[drift] ${missing.length} claude hook handler(s) referenced but absent ` +
        `(silently skipped at runtime):\n  - ${missing.join('\n  - ')}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 2c. Session capture — pi (native session JSONL, no hooks to install)
// ---------------------------------------------------------------------------
// There is nothing here about hook wiring because pi needs none. mastra, which
// this replaces, had no readable transcript, so its config generated a Python
// hook script and registered it against six lifecycle events — and the contract
// test had to assert that generator existed. pi persists its own sessions, so
// what matters instead is that the launcher PINS where they land.
describe('Session capture — pi (native session JSONL)', () => {
  it('the agent config pins the session directory rather than generating hooks', () => {
    const src = readText('config/agents/pi.sh');
    expect(src).toMatch(/PI_CODING_AGENT_SESSION_DIR/);
    expect(src).toMatch(/pi-sessions/);
    // No hook generation, and nothing written into the user's config root.
    expect(src).not.toMatch(/hooks\.json/);
  });

  it('the config dir is wrapper-scoped so a bare `pi` is unaffected', () => {
    const src = readText('config/agents/pi.sh');
    expect(src).toMatch(/PI_CODING_AGENT_DIR/);
    expect(src).toMatch(/\.pi-agent/);
  });

  // REGRESSION ANCHOR (2026-08-18): models.json declared `"x-task-id": "$TASK_ID"`
  // unconditionally. An interactive `coding --pi` has no TASK_ID, and pi's header
  // interpolation (dist/core/resolve-config-value.js) has NO default-value form and
  // treats empty as missing, so resolveHeadersOrThrow aborted the whole provider:
  //   "API key auth failed for provider rapid-proxy-pi: Failed to resolve provider
  //    "rapid-proxy-pi" header "x-task-id" from environment variable: TASK_ID"
  // Every interactive prompt failed on the first keystroke with no LLM call made.
  //
  // Executes the generator rather than grepping it: the bug was in WHICH BRANCH ran,
  // which a source grep for "x-task-id" passes either way.
  describe('models.json task binding', () => {
    const generate = (env) => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'pi-models-'));
      execFileSync('bash', ['-c',
        `_agent_log() { :; }; source "${path.join(REPO, 'config/agents/pi.sh')}"; ` +
        `_pi_write_models_json "${dir}"`,
      ], { cwd: REPO, env: { ...process.env, ...env }, encoding: 'utf8' });
      return JSON.parse(readFileSync(path.join(dir, 'models.json'), 'utf8'))
        .providers['rapid-proxy-pi'];
    };

    it('omits x-task-id when there is no task, so interactive launches work', () => {
      const { TASK_ID: _drop, ...envWithoutTaskId } = process.env;
      const provider = generate({ ...envWithoutTaskId, TASK_ID: undefined });
      expect(provider.headers['x-agent']).toBe('pi');
      // Absent, NOT empty: pi treats an empty value as unresolvable too.
      expect(provider.headers).not.toHaveProperty('x-task-id');
    });

    it('keeps the $TASK_ID reference when a measured run binds a cell', () => {
      const provider = generate({ TASK_ID: 'exp-cell-42' });
      expect(provider.headers['x-agent']).toBe('pi');
      // The literal reference, not the resolved value: ONE static file serves every
      // cell because pi re-interpolates it per process (agent-routing.mjs sets TASK_ID
      // per cell, and the harness does not rewrite this file).
      expect(provider.headers['x-task-id']).toBe('$TASK_ID');
    });
  });
});

// ---------------------------------------------------------------------------
// 2d. Hook wiring — OPENCODE (pipe capture, no .github hooks)
// ---------------------------------------------------------------------------
describe('Hook wiring — opencode (live pipe capture)', () => {
  it('config enables pipe capture and the live-capture sub-agent exists', () => {
    const src = readText('config/agents/opencode.sh');
    expect(src).toMatch(/AGENT_ENABLE_PIPE_CAPTURE=true/);
    expect(existsSync(path.join(REPO, 'scripts/sub-agent-live-opencode.mjs'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. MCP servers — exactly the expected set (graphify only)
// ---------------------------------------------------------------------------
describe('MCP servers — expected set', () => {
  it('claude-code-mcp.json declares exactly the expected servers', () => {
    const servers = readJson('claude-code-mcp.json').mcpServers;
    expect(Object.keys(servers).sort()).toEqual([...EXPECTED_MCP_SERVERS].sort());
  });

  it('each MCP server is well-formed (command+dir for local, url for http)', () => {
    const servers = readJson('claude-code-mcp.json').mcpServers;
    for (const name of EXPECTED_MCP_SERVERS) {
      const s = servers[name];
      expect(s).toBeDefined();
      if (s.type === 'http') {
        // Served over HTTP from the coding-services container: url, no command.
        expect(typeof s.url).toBe('string');
        expect(s.url.length).toBeGreaterThan(0);
      } else {
        expect(typeof s.command).toBe('string');
        expect(s.command.length).toBeGreaterThan(0);
        expect(Array.isArray(s.args)).toBe(true);
        // Only assert an integration dir for servers we ship in-tree. A stdio
        // backend reached via `docker exec` lives in the image, not the repo.
        const dir = SERVER_INTEGRATION_DIRS[name];
        if (dir) expect(existsSync(path.join(REPO, dir))).toBe(true);
      }
    }
  });

  it('the active code-graph backend is registered and enabled', () => {
    const servers = readJson('claude-code-mcp.json').mcpServers;
    expect(Object.keys(servers)).toContain(CODE_GRAPH_SERVER);

    const reg = JSON.parse(readFileSync(path.join(REPO, 'config/code-graph.json'), 'utf8'));
    // An active-but-disabled backend would leave agents pointed at a server
    // nothing starts, which is the exact failure the registry exists to prevent.
    expect(reg.backends[reg.active].enabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Constraints
// ---------------------------------------------------------------------------
describe('Constraints — .constraint-monitor.yaml', () => {
  it('parses as YAML and declares a non-empty constraint set', () => {
    const cfg = yaml.load(readText('.constraint-monitor.yaml'));
    expect(cfg).toBeTruthy();
    expect(Array.isArray(cfg.constraints)).toBe(true);
    expect(cfg.constraints.length).toBeGreaterThan(0);
  });

  it('the constraint engine ships as the constraints CLI (bin/constraints), not an MCP server', () => {
    expect(existsSync(path.join(REPO, 'bin/constraints'))).toBe(true);
    expect(EXPECTED_MCP_SERVERS).not.toContain('constraint-monitor');
  });
});

// ---------------------------------------------------------------------------
// 5. Online learning — observations → digests → insights
// ---------------------------------------------------------------------------
describe('Online learning — observations / digests / insights', () => {
  const EXPORT_DIR_REL = '.data/observation-export';
  const arrayLen = (json) => {
    if (Array.isArray(json)) return json.length;
    const arr = Object.values(json).find(Array.isArray);
    return Array.isArray(arr) ? arr.length : -1;
  };

  it.each(['observations', 'digests', 'insights'])(
    'export contains a non-empty %s set',
    (kind) => {
      const rel = `${EXPORT_DIR_REL}/${kind}.json`;
      if (!existsSync(path.join(REPO, rel))) {
        console.warn(`[skip] ${rel} not present (pipeline has not exported yet)`);
        return;
      }
      const len = arrayLen(readJson(rel));
      expect(len).toBeGreaterThan(0);
    },
  );

  it('[live soft-check] obs-api /api/v1/stats reports a populated graph', async () => {
    let res;
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 2000);
      res = await fetch('http://localhost:12436/api/v1/stats', { signal: controller.signal });
      clearTimeout(t);
    } catch {
      console.warn('[skip] obs-api not reachable on :12436 (service not running)');
      return;
    }
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.nodeCount).toBeGreaterThan(0);
  });
});
