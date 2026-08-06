/**
 * Arm isolation contract.
 *
 * The first coding-v1 matrix compared nothing. `--allowedTools` is a permission-prompt
 * allowlist, and `--dangerously-skip-permissions` skips consulting it, so every arm
 * received the full default tool surface. Recorded from that run:
 *
 *   grep arm     Grep x144, Bash x59, Read x38, Glob x4, Agent x2, SendMessage, TaskStop
 *   graphify arm Bash x27, Read x4      <- not one graphify MCP tool
 *
 * Both arms were the same agent wearing different labels. It also breached the run
 * sandbox: an arm used Bash to run `git submodule update --init` inside the worktree,
 * checking out files the containment scan never saw, and then answered from them.
 *
 * These tests pin both halves of the fix — the deny list that constrains an arm, and
 * the post-hoc check that refuses to score a cell where an ungranted tool actually ran.
 */

import { denyListFor, toolViolations, DENYABLE_BUILTINS } from '../../lib/kgbench/runner.mjs';
import { loadArms, resolveArm, REPO_ROOT } from '../../lib/kgbench/arms.mjs';

const grepArm = { id: 'grep', allowedTools: ['Glob', 'Grep', 'Read'] };
const graphArm = {
  id: 'graphify',
  allowedTools: ['Read', 'mcp__graphify__query_graph', 'mcp__graphify__get_node'],
};

describe('denyListFor', () => {
  it('denies every built-in the arm was not granted', () => {
    const denied = denyListFor(grepArm);
    expect(denied).toContain('Bash');
    expect(denied).toContain('Agent');
    expect(denied).toContain('Task');
    expect(denied).toContain('WebFetch');
  });

  it('never denies a tool the arm IS granted', () => {
    const denied = denyListFor(grepArm);
    for (const t of grepArm.allowedTools) expect(denied).not.toContain(t);
  });

  it('denies Grep and Glob for a graph arm — that arm exists to not have them', () => {
    // If the graph arm can grep, "graph vs grep" is not being measured at all.
    const denied = denyListFor(graphArm);
    expect(denied).toContain('Grep');
    expect(denied).toContain('Glob');
    expect(denied).toContain('Bash');
    expect(denied).not.toContain('Read');
  });

  it('covers the tools actually observed escaping', () => {
    for (const t of ['Bash', 'Agent', 'SendMessage', 'TaskStop', 'ScheduleWakeup']) {
      expect(DENYABLE_BUILTINS).toContain(t);
    }
  });
});

describe('toolViolations', () => {
  it('flags exactly the ungranted tools, deduplicated', () => {
    // The real grep-arm tool trace from the voided run.
    expect(toolViolations(grepArm, ['Grep', 'Bash', 'Read', 'Agent', 'Bash']))
      .toEqual(['Bash', 'Agent']);
  });

  it('is clean when the arm stayed inside its surface', () => {
    expect(toolViolations(grepArm, ['Grep', 'Grep', 'Read'])).toEqual([]);
  });

  it('accepts the arm\'s MCP tools, which are not built-ins', () => {
    expect(toolViolations(graphArm, ['mcp__graphify__query_graph', 'Read'])).toEqual([]);
  });

  it('treats an empty trace as clean rather than throwing', () => {
    expect(toolViolations(grepArm, [])).toEqual([]);
    expect(toolViolations(grepArm, undefined)).toEqual([]);
  });
});

describe('MCP scope — server, not per-tool', () => {
  // graphify's server advertises ten tools; config/code-graph.json names six. Flagging
  // per-tool would void a cell for calling get_community, which is a graph query — the
  // exact strategy the arm exists to exercise. What must never happen is crossing to a
  // different strategy, and that is what --strict-mcp-config already bounds.
  const armWithServer = {
    id: 'graphify',
    allowedTools: ['Read', 'mcp__graphify__query_graph'],
    mcpConfig: { mcpServers: { graphify: { type: 'http', url: 'http://localhost:3851/mcp' } } },
  };

  it('accepts any tool from a server the arm is configured with', () => {
    expect(toolViolations(armWithServer, ['mcp__graphify__get_community', 'Read'])).toEqual([]);
  });

  it('still rejects a built-in outside the grant', () => {
    expect(toolViolations(armWithServer, ['Grep'])).toEqual(['Grep']);
    expect(toolViolations(armWithServer, ['Skill'])).toEqual(['Skill']);
  });

  it('rejects an MCP tool from a server the arm was never given', () => {
    expect(toolViolations(armWithServer, ['mcp__codegraph__codegraph_explore']))
      .toEqual(['mcp__codegraph__codegraph_explore']);
  });
});

describe('granted MCP tools must have a configured server', () => {
  // The failure this guards is silent in a way the deny list is not. --strict-mcp-config
  // means an unconfigured server's tools are ABSENT, not refused: the arm never errors,
  // never trips toolViolations, and simply answers using whatever it does have. The
  // hybrid arm shipped in exactly that shape — $allBackendTools granted every backend's
  // tools while mcpFrom named one — so it would have run as grep+graphify under a label
  // saying grep+graphify+codegraph, and produced a full column of publishable numbers.
  const armsDoc = () => loadArms(REPO_ROOT);

  it('derives the server list from the tool expansion when mcpFrom is absent', () => {
    const hybrid = resolveArm(armsDoc(), 'hybrid', { repoRoot: REPO_ROOT });
    const servers = Object.keys(hybrid.mcpConfig.mcpServers).sort();
    expect(servers).toEqual(['codegraph', 'graphify']);
    // Every granted MCP tool is reachable through one of them.
    for (const t of hybrid.allowedTools.filter((x) => x.startsWith('mcp__'))) {
      expect(servers).toContain(t.split('__')[1]);
    }
  });

  it('grants the hybrid arm both text search and every backend', () => {
    const hybrid = resolveArm(armsDoc(), 'hybrid', { repoRoot: REPO_ROOT });
    expect(hybrid.allowedTools).toEqual(expect.arrayContaining(['Glob', 'Grep', 'Read']));
    expect(hybrid.allowedTools).toEqual(expect.arrayContaining([
      'mcp__graphify__query_graph', 'mcp__codegraph__codegraph_explore',
    ]));
  });

  it('throws when mcpFrom omits a backend whose tools were granted', () => {
    const doc = armsDoc();
    doc.arms.__broken = {
      kind: 'agent',
      allowedTools: ['Read', '$allBackendTools'],
      mcpFrom: ['graphify'],          // the original defect, pinned
    };
    expect(() => resolveArm(doc, '__broken', { repoRoot: REPO_ROOT }))
      .toThrow(/server is not configured.*codegraph|codegraph.*server is not configured/s);
  });

  it('leaves a correctly scoped single-backend arm alone', () => {
    for (const id of ['graphify', 'codegraph']) {
      const arm = resolveArm(armsDoc(), id, { repoRoot: REPO_ROOT });
      expect(Object.keys(arm.mcpConfig.mcpServers)).toEqual([id]);
    }
  });
});
