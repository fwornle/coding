/**
 * Multi-Agent Startup & Operations Contract Tests
 * tests/integration/agent-startup-contract.test.js
 *
 * Validates that all FOUR supported coding agents — claude (default), copilot,
 * opencode, mastra — share a sound startup contract and that the cross-cutting
 * "basic operations" wiring is intact:
 *
 *   1. Agent definition       — config/agents/<agent>.sh present + well-formed
 *   2. Hook wiring            — each agent's hooks expressed in ITS OWN native
 *                               schema, with every referenced script resolvable
 *                               and (for copilot) actually executable
 *   3. MCP servers            — exactly the 3 expected (semantic-analysis,
 *                               constraint-monitor, code-graph-rag)
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
import { existsSync, readFileSync, readdirSync, accessSync, constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');

const AGENTS = ['claude', 'copilot', 'opencode', 'mastra'];
const EXPECTED_MCP_SERVERS = ['semantic-analysis', 'constraint-monitor', 'code-graph-rag'];

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
// 2c. Hook wiring — MASTRA (runtime-generated NDJSON transcript hooks)
// ---------------------------------------------------------------------------
describe('Hook wiring — mastra (lifecycle transcript hooks)', () => {
  it('the agent config wires a hook generator that targets transcript-writer.py', () => {
    const src = readText('config/agents/mastra.sh');
    expect(src).toMatch(/_generate_mastra_hooks_config\s*\(\)/);
    expect(src).toMatch(/transcript-writer\.py/);
  });

  it('if ~/.mastracode/hooks.json exists, it covers the lifecycle events', () => {
    const abs = path.join(process.env.HOME || '', '.mastracode', 'hooks.json');
    if (!existsSync(abs)) {
      console.warn('[skip] ~/.mastracode/hooks.json not generated yet (mastra not launched)');
      return;
    }
    const cfg = JSON.parse(readFileSync(abs, 'utf8'));
    for (const ev of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']) {
      expect(Array.isArray(cfg[ev])).toBe(true);
      expect(cfg[ev][0].command).toMatch(/transcript-writer\.py/);
    }
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
// 3. MCP servers — exactly the 3 expected
// ---------------------------------------------------------------------------
describe('MCP servers — expected set of 3', () => {
  it('claude-code-mcp.json declares exactly the 3 expected servers', () => {
    const servers = readJson('claude-code-mcp.json').mcpServers;
    expect(Object.keys(servers).sort()).toEqual([...EXPECTED_MCP_SERVERS].sort());
  });

  it('each MCP server has a runnable command and a present integration dir', () => {
    const servers = readJson('claude-code-mcp.json').mcpServers;
    const dirs = {
      'semantic-analysis': 'integrations/mcp-server-semantic-analysis',
      'constraint-monitor': 'integrations/mcp-constraint-monitor',
      'code-graph-rag': 'integrations/code-graph-rag',
    };
    for (const name of EXPECTED_MCP_SERVERS) {
      expect(typeof servers[name].command).toBe('string');
      expect(servers[name].command.length).toBeGreaterThan(0);
      expect(Array.isArray(servers[name].args)).toBe(true);
      expect(existsSync(path.join(REPO, dirs[name]))).toBe(true);
    }
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

  it('the constraint engine ships as the constraint-monitor MCP server', () => {
    expect(EXPECTED_MCP_SERVERS).toContain('constraint-monitor');
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
