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
