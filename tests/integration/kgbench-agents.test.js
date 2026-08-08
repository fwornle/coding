/**
 * Cross-agent contract for kgbench cells.
 *
 * The agent axis is the one place where kgbench's central guarantee does not hold: only
 * claude can be confined to a tool surface. These tests pin the consequences so they cannot
 * be lost quietly —
 *
 *   - the claude argv stays byte-identical, or cells stop being comparable with r6/r7
 *   - an arm defined by WITHHOLDING built-in search is refused on an ungated agent instead
 *     of running with more capability than its label claims
 *   - unmeasurable fields are null, never zero: a zero renders as "used no tools, cost
 *     nothing", which is plausible and false
 *   - a missing answer file is `no_result`, because the early-exit failure mode this
 *     elicitation exists to avoid must stay visible when it still happens
 */

import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveAgent, armIsFaithful, cellKey, KNOWN_AGENTS, ANSWER_FILE, _ADAPTERS } from '../../lib/kgbench/agents.mjs';
import { toCopilotMcp, toOpencodeMcp, prepareAgentMcp } from '../../lib/kgbench/agent-sandbox.mjs';
import { runAgent } from '../../lib/kgbench/runner.mjs';
import { resolveModelForAgent, parseModelRef } from '../../lib/experiments/model-resolve.mjs';

const ARM = {
  id: 'grep',
  model: 'claude-sonnet-5',
  allowedTools: ['Glob', 'Grep', 'Read'],
  mcpConfig: { mcpServers: {} },
  timeoutMs: 20000,
};

describe('claude argv is frozen', () => {
  it('emits exactly the flags the single-agent runner emitted', () => {
    const argv = _ADAPTERS.claude.argv({
      prompt: 'Q?', arm: ARM, model: ARM.model,
      mcpArg: JSON.stringify(ARM.mcpConfig), denyList: ['Bash', 'Edit'],
    });
    expect(argv).toEqual([
      '-p', 'Q?',
      '--model', 'claude-sonnet-5',
      '--output-format', 'stream-json', '--verbose',
      '--allowedTools', 'Glob,Grep,Read',
      '--disallowedTools', 'Bash,Edit',
      '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      '--dangerously-skip-permissions',
    ]);
  });

  it('omits --disallowedTools entirely when the deny list is empty', () => {
    const argv = _ADAPTERS.claude.argv({
      prompt: 'Q?', arm: ARM, model: ARM.model, mcpArg: '{}', denyList: [],
    });
    expect(argv).not.toContain('--disallowedTools');
  });
});

describe('non-claude agents are driven to write an answer file', () => {
  // An analysis-shaped prompt makes copilot exit in ~6s and opencode yield on its first
  // toolless step. The directive is the only thing that makes them act, so its presence is
  // a contract, not a detail.
  it.each(['copilot', 'opencode', 'mastracode'])('%s prompt carries the answer-file directive', (agent) => {
    const argv = _ADAPTERS[agent].argv({ prompt: 'Which file does X?', model: 'm', answerFile: ANSWER_FILE });
    const prompt = argv.find((a) => a.includes('Which file does X?'));
    expect(prompt).toBeDefined();
    expect(prompt).toContain(ANSWER_FILE);
    // It must also forbid touching the repo under measurement.
    expect(prompt).toMatch(/Do NOT modify any other file/i);
  });

  it('copilot runs in autopilot — plain -p exits on a toolless first turn', () => {
    const argv = _ADAPTERS.copilot.argv({ prompt: 'q', model: 'm', answerFile: ANSWER_FILE });
    expect(argv).toEqual(expect.arrayContaining(['--allow-all-tools', '--no-ask-user', '--mode', 'autopilot']));
  });

  it('opencode passes --dangerously-skip-permissions, without which run hangs headlessly', () => {
    const argv = _ADAPTERS.opencode.argv({ prompt: 'q', model: 'm', answerFile: ANSWER_FILE });
    expect(argv[0]).toBe('run');
    expect(argv).toContain('--dangerously-skip-permissions');
  });

  it('no non-claude adapter emits a claude-only gating flag', () => {
    for (const agent of ['copilot', 'opencode', 'mastracode']) {
      const argv = _ADAPTERS[agent].argv({ prompt: 'q', model: 'm', answerFile: ANSWER_FILE });
      expect(argv).not.toContain('--allowedTools');
      expect(argv).not.toContain('--disallowedTools');
      expect(argv).not.toContain('--strict-mcp-config');
    }
  });
});

describe('enforcement is described, not asserted', () => {
  it('claude gates both MCP servers and built-ins', () => {
    const e = resolveAgent('claude', { repoRoot: process.cwd() }).enforcement;
    expect(e).toMatchObject({ mcp_servers: 'enforced', builtins: 'enforced' });
  });

  // copilot is NOT simply "ungated". It ships --available-tools / --deny-tool, so it is
  // gateable; this harness just has no verified mapping from arm tool names to copilot's
  // naming yet. Recording that as `ungated` would understate the agent and make a fixable
  // gap look like a permanent capability limit.
  it('copilot is reported as gateable but not currently gated', () => {
    const e = resolveAgent('copilot', { repoRoot: process.cwd() }).enforcement;
    expect(e.mcp_servers).toBe('enforced');
    expect(e.builtins).toBe('not_enforced');
    expect(e.gateable).toBe(true);
    expect(e.note).toMatch(/available-tools/);
  });

  it.each(['opencode', 'mastracode'])('%s is reported as genuinely ungateable', (agent) => {
    const e = resolveAgent(agent, { repoRoot: process.cwd() }).enforcement;
    expect(e.mcp_servers).toBe('enforced');
    expect(e.builtins).toBe('ungated');
    expect(e.gateable).toBe(false);
  });

  it.each(['copilot', 'opencode', 'mastracode'])('%s never collapses to a single boolean', (agent) => {
    const e = resolveAgent(agent, { repoRoot: process.cwd() }).enforcement;
    // A `tool_enforced: true|false` would have to lie about one of the two halves.
    expect(Object.keys(e)).toEqual(expect.arrayContaining(['mcp_servers', 'builtins', 'verified_by']));
    expect(e.tool_enforced).toBeUndefined();
  });
});

describe('the resume key, once cells have an agent and a model', () => {
  // Getting this wrong fails SILENTLY in both directions — too coarse and a resume skips
  // cells that never ran, too fine and it re-runs cells that did.
  it('separates the same question run by different agents', () => {
    const base = { arm: 'grep', model: 'claude-sonnet-5', question: 'L1', rep: 1 };
    const keys = ['claude', 'copilot', 'opencode'].map((agent) => cellKey({ ...base, agent }));
    expect(new Set(keys).size).toBe(3);
  });

  it('separates the same cell run on different models', () => {
    const base = { arm: 'grep', agent: 'claude', question: 'L1', rep: 1 };
    expect(cellKey({ ...base, model: 'claude-sonnet-5' })).not.toBe(cellKey({ ...base, model: 'claude-opus-5' }));
  });

  it('matches a pre-axis row against its claude equivalent, so a resume does not re-run r6/r7', () => {
    // Rows written before the agent axis carry neither field. Treating them as unmatched
    // would have re-run every completed cell in the existing runs from scratch.
    const legacy = cellKey({ arm: 'grep', question: 'L1', rep: 1, armModel: 'claude-sonnet-5' });
    const current = cellKey({ arm: 'grep', agent: 'claude', model: 'claude-sonnet-5', question: 'L1', rep: 1 });
    expect(legacy).toBe(current);
  });
});

describe('armIsFaithful refuses combinations whose label would misdescribe the cell', () => {
  const codegraph = { id: 'codegraph', allowedTools: ['Read', 'mcp__codegraph__codegraph_explore'] };
  const graphify = { id: 'graphify', allowedTools: ['Read', 'mcp__graphify__query_graph'] };
  const hybrid = { id: 'hybrid', allowedTools: ['Glob', 'Grep', 'Read', 'mcp__graphify__query_graph'] };

  it('allows every arm on claude, which can be gated', () => {
    for (const arm of [ARM, codegraph, graphify, hybrid]) {
      expect(armIsFaithful(arm, 'claude').faithful).toBe(true);
    }
  });

  it('refuses arms that withhold built-in search on an agent this harness does not gate', () => {
    for (const arm of [codegraph, graphify]) {
      for (const agent of ['copilot', 'opencode']) {
        const r = armIsFaithful(arm, agent);
        expect(r.faithful).toBe(false);
        expect(r.reason).toMatch(/withholding built-in search/i);
      }
    }
  });

  it('says WHY differently for copilot (unfinished) than opencode (impossible)', () => {
    // Collapsing these would make a fixable gap look like a permanent capability limit.
    expect(armIsFaithful(codegraph, 'copilot').reason).toMatch(/copilot CAN gate tools/i);
    expect(armIsFaithful(codegraph, 'opencode').reason).toMatch(/exposes no tool allowlist/i);
  });

  it('allows grep and hybrid, whose restriction is MCP-only and therefore enforceable', () => {
    expect(armIsFaithful(ARM, 'copilot').faithful).toBe(true);
    expect(armIsFaithful(hybrid, 'opencode').faithful).toBe(true);
  });
});

describe('model ids are resolved per agent, including the minor-less Claude 5 generation', () => {
  it('resolves claude-opus-5, which has no minor version', () => {
    expect(parseModelRef('claude-opus-5')).toEqual({ family: 'opus', major: '5', minor: null });
    expect(resolveModelForAgent('claude', 'claude-opus-5')).toBe('claude-opus-5');
    expect(resolveModelForAgent('opencode', 'claude-opus-5')).toBe('rapid-proxy/claude-opus-5');
    expect(resolveModelForAgent('copilot', 'claude-opus-5')).toBe('claude-opus-5');
  });

  it('still resolves the minor-bearing spellings unchanged', () => {
    expect(resolveModelForAgent('claude', 'claude-sonnet-4.6')).toBe('claude-sonnet-4-6');
    expect(resolveModelForAgent('opencode', 'claude-sonnet-4.6')).toBe('rapid-proxy/claude-sonnet-4.6');
  });

  it('keeps a dated snapshot on the major.minor branch rather than reading the date as a version', () => {
    expect(parseModelRef('claude-haiku-4-5-20251001')).toEqual({ family: 'haiku', major: '4', minor: '5' });
  });

  it('returns null for a non-Claude ref so the caller keeps its raw value', () => {
    expect(resolveModelForAgent('claude', 'gpt-4o')).toBeNull();
  });

  it('rejects an unknown agent loudly instead of guessing', () => {
    expect(() => resolveAgent('cursor', { repoRoot: process.cwd() })).toThrow(/unknown agent/i);
    expect(KNOWN_AGENTS).toEqual(['claude', 'copilot', 'opencode', 'mastracode']);
  });
});

describe('MCP restriction is written where each agent actually reads it', () => {
  let dir;
  const httpArm = { id: 'graphify', mcpConfig: { mcpServers: { graphify: { type: 'http', url: 'http://localhost:3851/mcp' } } } };
  const stdioArm = { id: 'codegraph', mcpConfig: { mcpServers: { codegraph: { command: 'docker', args: ['exec', 'x'], env: { A: '1' } } } } };
  const bareArm = { id: 'grep', mcpConfig: { mcpServers: {} } };

  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'kgbench-mcp-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('converts an http server to each agent\'s own shape', () => {
    expect(toCopilotMcp(httpArm.mcpConfig)).toEqual({ servers: { graphify: { type: 'http', url: 'http://localhost:3851/mcp' } } });
    expect(toOpencodeMcp(httpArm.mcpConfig)).toEqual({ mcp: { graphify: { type: 'remote', url: 'http://localhost:3851/mcp', enabled: true } } });
  });

  it('converts a stdio server, folding args and env the way each agent expects', () => {
    expect(toCopilotMcp(stdioArm.mcpConfig)).toEqual({ servers: { codegraph: { type: 'stdio', command: 'docker', args: ['exec', 'x'], env: { A: '1' } } } });
    expect(toOpencodeMcp(stdioArm.mcpConfig)).toEqual({ mcp: { codegraph: { type: 'local', command: ['docker', 'exec', 'x'], enabled: true, environment: { A: '1' } } } });
  });

  it('emits an EMPTY server map rather than omitting the key', () => {
    // A missing key can fall back to a global config; an explicit empty map cannot be read
    // as "unspecified". For an arm whose whole identity is having no MCP servers, that
    // difference is the restriction.
    expect(toCopilotMcp(bareArm.mcpConfig)).toEqual({ servers: {} });
    expect(toOpencodeMcp(bareArm.mcpConfig)).toEqual({ mcp: {} });
  });

  it('writes copilot config INSIDE the sandbox worktree, needing no env override', () => {
    const p = prepareAgentMcp({ agent: 'copilot', arm: httpArm, cwd: dir, runDir: dir });
    const written = path.join(dir, '.vscode', 'mcp.json');
    expect(p.wrote).toEqual([written]);
    expect(JSON.parse(readFileSync(written, 'utf8'))).toEqual({ servers: { graphify: { type: 'http', url: 'http://localhost:3851/mcp' } } });
    expect(p.env.XDG_CONFIG_HOME).toBeUndefined();
  });

  it('pins only opencode CONFIG home, leaving auth (XDG_DATA_HOME) untouched', () => {
    const p = prepareAgentMcp({ agent: 'opencode', arm: httpArm, cwd: dir, runDir: dir });
    expect(p.env.XDG_CONFIG_HOME).toBe(path.join(dir, 'agent-config', 'graphify'));
    // Pinning HOME instead would strip the token at ~/.local/share/opencode/auth.json and
    // fail every cell. XDG_DATA_HOME must be left alone.
    expect(p.env.XDG_DATA_HOME).toBeUndefined();
    expect(p.env.HOME).toBeUndefined();
    expect(JSON.parse(readFileSync(p.wrote[0], 'utf8')).mcp.graphify.type).toBe('remote');
  });

  it('cleans up the file it planted in the measured tree', () => {
    const p = prepareAgentMcp({ agent: 'copilot', arm: httpArm, cwd: dir, runDir: dir });
    expect(existsSync(p.wrote[0])).toBe(true);
    p.cleanup();
    // Left behind, it would be a file the run itself created sitting inside the tree the
    // next cell's containment check inspects.
    expect(existsSync(p.wrote[0])).toBe(false);
  });

  it('records the mechanism and the allowed server list, not just a verdict', () => {
    const p = prepareAgentMcp({ agent: 'opencode', arm: httpArm, cwd: dir, runDir: dir });
    expect(p.enforcement.mechanism).toMatch(/XDG_CONFIG_HOME/);
    expect(p.enforcement.allowed_servers).toEqual(['graphify']);
    expect(p.enforcement.builtins).toBe('ungated');
  });

  it('is a no-op for claude, which takes its servers on the command line', () => {
    const p = prepareAgentMcp({ agent: 'claude', arm: httpArm, cwd: dir, runDir: dir });
    expect(p.wrote).toEqual([]);
    expect(p.env.XDG_CONFIG_HOME).toBeUndefined();
    expect(p.enforcement.builtins).toBe('enforced');
  });
});

describe('answer-file elicitation', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'kgbench-agents-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  // A stub "agent": /bin/sh writing the answer file, so the elicitation path is exercised
  // without spending a real model call.
  const stub = (script) => ({
    id: 'copilot', binary: '/bin/sh', model: 'm',
    elicitation: 'answer-file', answerFile: ANSWER_FILE,
    argv: () => ['-c', script],
  });

  it('reads the answer the agent wrote and reports ok', async () => {
    const res = await runAgent({
      prompt: 'q', arm: ARM, cwd: dir,
      agent: stub(`printf 'the answer is lib/foo.mjs' > ${ANSWER_FILE}`),
    });
    expect(res.outcome).toBe('ok');
    expect(res.answer).toBe('the answer is lib/foo.mjs');
  });

  it('never reads a previous cell\'s answer — cells share one worktree and one filename', async () => {
    // THE DEFECT THIS PINS. Cells reuse the worktree and the answer file has a fixed name, so
    // an agent that exits without writing left the PREVIOUS cell's answer in place — and the
    // reader, which only asked "is it non-empty?", reported it as this cell's answer. The cell
    // recorded `ok` and was graded against the wrong question.
    //
    // It inverted the elicitation's whole purpose: the answer file exists so an early exit
    // surfaces as `no_result` rather than a false success. Staleness turned every early exit
    // back into a false success WITH A PLAUSIBLE ANSWER ATTACHED. In run coding-v1-x2 a single
    // opencode answer was scored against eleven different questions and the agent's median
    // read 0.00 — indistinguishable from a capability finding.
    const first = await runAgent({
      prompt: 'q1', arm: ARM, cwd: dir,
      agent: stub(`printf 'answer to the FIRST question' > ${ANSWER_FILE}`),
    });
    expect(first.answer).toBe('answer to the FIRST question');

    const second = await runAgent({ prompt: 'q2', arm: ARM, cwd: dir, agent: stub('exit 0') });
    expect(second.outcome).toBe('no_result');
    expect(second.answer).toBeUndefined();
  });

  it('rejects an answer file older than the spawn, even if the pre-delete failed', async () => {
    // Second line of defence: the delete can fail on a locked or read-only path, and a crashed
    // prior process can leave a file behind. A file that predates the spawn was not written by
    // this cell, whatever else is true.
    const stale = path.join(dir, ANSWER_FILE);
    writeFileSync(stale, 'an answer from some earlier run');
    const old = Date.now() / 1000 - 3600;
    utimesSync(stale, old, old);
    const res = await runAgent({
      prompt: 'q', arm: ARM, cwd: dir,
      // A stub that neither writes nor deletes: it recreates the stale file post-delete.
      agent: {
        id: 'copilot', binary: '/bin/sh', model: 'm',
        elicitation: 'answer-file', answerFile: ANSWER_FILE,
        argv: () => ['-c', `printf 'an answer from some earlier run' > ${ANSWER_FILE}; touch -t 202001010000 ${ANSWER_FILE}`],
      },
    });
    expect(res.outcome).toBe('no_result');
    expect(res.stale_answer_file).toBe(true);
    expect(res.error).toMatch(/stale/i);
  });

  it('reports no_result when the agent exits without writing — the failure mode this avoids', async () => {
    const res = await runAgent({ prompt: 'q', arm: ARM, cwd: dir, agent: stub('exit 0') });
    expect(res.outcome).toBe('no_result');
    expect(res.error).toMatch(/wrote no/i);
  });

  it('leaves unmeasurable fields null, never zero', async () => {
    const res = await runAgent({
      prompt: 'q', arm: ARM, cwd: dir,
      agent: stub(`printf 'x' > ${ANSWER_FILE}`),
    });
    // A zero here would render as "this agent used no tools and cost nothing" — plausible
    // and false. Null says "not measured on this CLI".
    for (const k of ['tool_calls', 'total_tokens', 'in_tokens', 'out_tokens', 'tools_executed']) {
      expect(res[k]).toBeNull();
    }
  });

  it('pins PWD to the sandbox and drops OLDPWD — the sandbox-escape regression', async () => {
    // spawn({cwd}) changes the child's directory but leaves PWD pointing at the runner's
    // cwd, the real repo. In the first cross-agent smoke run opencode read $PWD, grepped
    // correctly, and wrote its answer into the LIVE repository. Every later cell would then
    // have been measuring a tree the benchmark contaminated itself.
    const res = await runAgent({
      prompt: 'q', arm: ARM, cwd: dir,
      env: { ...process.env, OLDPWD: '/somewhere/else' },
      agent: stub(`printf "PWD=$PWD OLDPWD=[$OLDPWD]" > ${ANSWER_FILE}`),
    });
    expect(res.outcome).toBe('ok');
    expect(res.answer).toContain(`PWD=${dir}`);
    expect(res.answer).toContain('OLDPWD=[]');
  });

  it('treats an empty answer file as no answer', async () => {
    const res = await runAgent({
      prompt: 'q', arm: ARM, cwd: dir,
      agent: stub(`: > ${ANSWER_FILE}`),
    });
    expect(res.outcome).toBe('no_result');
  });
});
