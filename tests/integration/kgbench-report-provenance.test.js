/**
 * Provenance markers in the report.
 *
 * The agent axis makes cells that look alike mean different things. A `grep` cell on claude
 * was CONFINED to Glob/Grep/Read by `--disallowedTools`; the same cell on opencode was merely
 * CONFIGURED with no MCP servers and kept every built-in it ships with. Both land in the
 * results file as `arm: "grep"`, and pooling them produces a median of two different
 * experiments — 96k tokens on copilot and 1k on claude have no meaningful midpoint.
 *
 * These tests pin that the report never presents such a number as though it were one
 * measurement, and that a single-agent claude run is completely unaffected.
 */

import { aggregate, renderMarkdown, provenanceOf } from '../../lib/kgbench/report.mjs';

const QUESTIONS = [{ id: 'L1', cls: 'lookup' }];
const META = { set: 'coding-v1', questionCount: 1, reps: 1, model: 'claude-sonnet-4.6', generatedAt: 'now' };

const claudeRow = (o = {}) => ({
  arm: 'grep', agent: 'claude', id: 'L1', cls: 'lookup', rep: 1, outcome: 'ok', score: 1,
  total_tokens: 1000, content_tokens: 200, tool_calls: 3, wall_s: 20,
  elicitation: 'stream-json', enforcement: { builtins: 'enforced' }, token_source: 'stream-json', ...o,
});
const opencodeRow = (o = {}) => ({
  arm: 'grep', agent: 'opencode', id: 'L1', cls: 'lookup', rep: 1, outcome: 'ok', score: 1,
  total_tokens: 118341, content_tokens: 9000, tool_calls: null, wall_s: 24,
  elicitation: 'answer-file', enforcement: { builtins: 'ungated' }, token_source: 'proxy-db-window', ...o,
});

const render = (rows) => renderMarkdown({ ...META, meta: META, ...aggregate(rows, { arms: ['grep'], questions: QUESTIONS }) });

const renderMeta = (rows, extra) => {
  const meta = { ...META, ...extra };
  return renderMarkdown({ ...meta, meta, ...aggregate(rows, { arms: ['grep'], questions: QUESTIONS }) });
};

describe('a partially void run says so before it shows a number', () => {
  // x2: 192 claude cells valid, 192 copilot/opencode cells read a previous cell's stale
  // answer file. The subset is publishable; the run as a whole is not. What makes that
  // safe to publish is the header saying which axis was dropped — without it, every count
  // below reads as a count over the full run.
  const md = renderMeta([claudeRow()], {
    agentFilter: {
      kept: ['claude'],
      excluded: ['copilot', 'opencode'],
      rowsExcluded: 192,
      reason: 'stale answer files — see PARTIAL-VOID.md',
    },
  });

  it('names the kept agent, the excluded agents, and the count', () => {
    expect(md).toContain('only `claude` cells are reported here');
    expect(md).toContain('192 cell(s) from `copilot`, `opencode` are excluded');
  });

  it('gives the reason rather than just asserting an exclusion', () => {
    expect(md).toContain('stale answer files — see PARTIAL-VOID.md');
  });

  it('warns ABOVE the first table, so no number is read as a full-run number', () => {
    const warnIdx = md.indexOf('Partial run:');
    const tableIdx = md.indexOf('| Arm | ranked |');
    expect(warnIdx).toBeGreaterThan(-1);
    expect(warnIdx).toBeLessThan(tableIdx);
  });

  it('stays silent for an ordinary whole run — the warning is not boilerplate', () => {
    expect(render([claudeRow()])).not.toContain('Partial run:');
  });
});

describe('a single-agent claude run is untouched by the agent axis', () => {
  const md = render([claudeRow(), claudeRow({ id: 'L1', rep: 2 })]);

  it('prints no dagger, no per-agent table and no provenance section', () => {
    expect(md).not.toContain('†');
    expect(md).not.toContain('## Per agent');
    expect(md).not.toContain('## Measurement provenance');
  });

  it('leaves byArmAgent null so nothing downstream has to special-case it', () => {
    const rep = aggregate([claudeRow()], { arms: ['grep'], questions: QUESTIONS });
    expect(rep.byArmAgent).toBeNull();
    expect(rep.agents).toEqual(['claude']);
  });
});

describe('an unenforced arm is marked where its numbers appear, not only at the bottom', () => {
  const md = render([claudeRow(), opencodeRow()]);

  it('daggers the arm in both the Overall and Reliability tables', () => {
    const overall = md.slice(md.indexOf('## Overall'), md.indexOf('## Per agent'));
    const reliability = md.slice(md.indexOf('## Reliability'), md.indexOf('## Measurement provenance'));
    expect(overall).toContain('| grep † |');
    expect(reliability).toContain('| grep † |');
  });

  it('warns ABOVE the pooled table, before the reader meets the number', () => {
    const overallIdx = md.indexOf('## Overall');
    const warnIdx = md.indexOf('Pooled across 2 agents');
    const tableIdx = md.indexOf('| Arm | ranked |');
    expect(warnIdx).toBeGreaterThan(overallIdx);
    expect(warnIdx).toBeLessThan(tableIdx);
  });

  it('splits the real numbers out per agent', () => {
    expect(md).toContain('## Per agent');
    expect(md).toMatch(/\| grep \| claude \|.*enforced \| stream-json \|/);
    expect(md).toMatch(/\| grep \| opencode \|.*ungated \| answer-file \|/);
  });

  it('renders a missing tool trace as a dash and says a dash is not a zero', () => {
    expect(md).toMatch(/\| grep \| opencode \|[^\n]*\| — \|/);
    expect(md).toContain('a dash there means **not measured**, not zero');
  });
});

describe('token provenance is stated per source', () => {
  it('tabulates which cells came from where', () => {
    const md = render([claudeRow(), opencodeRow()]);
    expect(md).toContain('| `stream-json` | 1 |');
    expect(md).toContain('| `proxy-db-window` | 1 |');
    expect(md).toContain('a time join, weaker than a tag');
  });

  it('surfaces an ambiguous window as a blockquote warning', () => {
    const md = render([claudeRow(), opencodeRow({ token_ambiguous: true })]);
    expect(md).toContain('had more than one session of the same agent inside their window');
  });

  it('says unmeasured cells still rank on correctness', () => {
    const md = render([claudeRow(), opencodeRow({ token_source: 'unmeasured', total_tokens: null, content_tokens: null })]);
    expect(md).toContain('| `unmeasured` | 1 |');
    expect(md).toContain('still ranks on correctness');
  });
});

describe('provenanceOf', () => {
  it('reports enforced only when EVERY row was — one ungated cell makes the label over-claim', () => {
    expect(provenanceOf([claudeRow()]).builtins_enforced).toBe(true);
    expect(provenanceOf([claudeRow(), opencodeRow()]).builtins_enforced).toBe(false);
  });

  it('infers the pre-axis default for rows written before agents existed', () => {
    // r6/r7 rows carry no `agent`, `elicitation` or `enforcement` — they were all claude.
    const legacy = { arm: 'grep', id: 'L1', cls: 'lookup', rep: 1, outcome: 'ok', score: 1, total_tokens: 900 };
    const p = provenanceOf([legacy]);
    expect(p.agents).toEqual(['claude']);
    expect(p.builtins_enforced).toBe(true);
    expect(p.token_sources).toEqual({ 'stream-json': 1 });
  });

  it('counts a row with no tokens at all as unmeasured, not as a zero-token cell', () => {
    const p = provenanceOf([{ arm: 'grep', agent: 'copilot', outcome: 'ok', total_tokens: null }]);
    expect(p.token_sources).toEqual({ unmeasured: 1 });
  });
});
