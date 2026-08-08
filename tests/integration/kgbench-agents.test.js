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

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveAgent, armIsFaithful, KNOWN_AGENTS, ANSWER_FILE, _ADAPTERS } from '../../lib/kgbench/agents.mjs';
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

  it.each(['copilot', 'opencode', 'mastracode'])('%s reports built-ins as ungated', (agent) => {
    const e = resolveAgent(agent, { repoRoot: process.cwd() }).enforcement;
    expect(e.mcp_servers).toBe('enforced');
    expect(e.builtins).toBe('ungated');
    // The descriptor must never collapse to a single boolean; that would have to lie about
    // one of the two halves.
    expect(Object.keys(e)).toEqual(expect.arrayContaining(['mcp_servers', 'builtins', 'verified_by']));
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

  it('refuses arms that withhold built-in search on an ungated agent', () => {
    for (const arm of [codegraph, graphify]) {
      const r = armIsFaithful(arm, 'copilot');
      expect(r.faithful).toBe(false);
      expect(r.reason).toMatch(/withholding built-in search/i);
    }
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

  it('treats an empty answer file as no answer', async () => {
    const res = await runAgent({
      prompt: 'q', arm: ARM, cwd: dir,
      agent: stub(`: > ${ANSWER_FILE}`),
    });
    expect(res.outcome).toBe('no_result');
  });
});
