/**
 * Tool calls the CLI rejected because the model's arguments failed the tool's own schema.
 *
 * WHY THIS IS COUNTED. opencode rejected 5.9% of its bash calls across the coding-v1-x2
 * sessions — 35 of 589, every one of them the same omission of the required `description`
 * parameter. Exactly ONE reached a benchmark row. `stderr` is persisted as `slice(-300)`, so
 * the only occurrence that survived was the one that happened to land last in its cell; the
 * other 34 were inside the truncated prefix. A 6% rate that appears in the record once looks
 * like a curiosity, which is how it went uncosted through a whole 384-cell run.
 *
 * WHAT IT IS NOT. It is not a harness defect and not a retrieval result. opencode's schema is
 * correct — `required: ['command','description']`, read off the wire from a captured
 * /v1/chat/completions body — and the component rejecting the call is opencode's own
 * validator. It is a fact about one agent+model pairing that claude and copilot do not pay,
 * and a per-agent comparison that leaves it unstated charges a CLI's schema-adherence rate to
 * whichever retrieval arm was underneath it.
 *
 * These tests pin the counter against the exact bytes of the surviving x2 row, because the
 * message wraps mid-sentence and a line-oriented matcher silently returns zero on it.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { toolArgErrors, runAgent } from '../../lib/kgbench/runner.mjs';
import { provenanceOf, aggregate, renderMarkdown } from '../../lib/kgbench/report.mjs';
import { ANSWER_FILE } from '../../lib/kgbench/agents.mjs';

const META = { set: 'coding-v1', questionCount: 1, reps: 1, model: 'claude-sonnet-5', generatedAt: 'now' };

const ESC = '';

/** The surviving x2 row's stderr, byte-for-byte: ANSI reset, the wrap, the recovery line. */
const X2_STDERR = [
  `${ESC}[0m`,
  '✗ grep -rn "CODEGRAPH_MAX_DEPTH" . 2>/dev/null failed',
  'Error: The bash tool was called with invalid arguments: SchemaError(Missing key',
  '  at ["description"]).',
  'Please rewrite the input so it satisfies the expected schema.',
  '✱ Grep "CODEGRAPH_MAX_DEPTH" 2 matches',
].join('\n');

describe('toolArgErrors — the real thing', () => {
  it('counts the x2 rejection and names the argument that was missing', () => {
    expect(toolArgErrors(X2_STDERR)).toEqual({ count: 1, detail: { 'bash:description': 1 } });
  });

  it('survives the mid-sentence wrap that a line-oriented matcher would miss', () => {
    // `Missing key` and `at ["description"]` are on DIFFERENT lines. Matching per-line finds
    // the first half and reports the key as unknown, or finds nothing at all.
    const oneLine = X2_STDERR.replace('Missing key\n  at', 'Missing key at');
    expect(toolArgErrors(oneLine).detail).toEqual({ 'bash:description': 1 });
    expect(toolArgErrors(X2_STDERR).detail).toEqual(toolArgErrors(oneLine).detail);
  });

  it('accumulates repeats — the count is a rate, not a flag', () => {
    // The whole point of reading the full stderr is that a cell can pay this more than once.
    expect(toolArgErrors(`${X2_STDERR}\n${X2_STDERR}`)).toEqual({
      count: 2, detail: { 'bash:description': 2 },
    });
  });

  it('keys by tool AND argument, so two different failures do not merge', () => {
    const mixed = [
      'Error: The bash tool was called with invalid arguments: SchemaError(Missing key',
      '  at ["description"]).',
      'Error: The read tool was called with invalid arguments: SchemaError(Missing key',
      '  at ["filePath"]).',
    ].join('\n');
    expect(toolArgErrors(mixed)).toEqual({
      count: 2, detail: { 'bash:description': 1, 'read:filePath': 1 },
    });
  });
});

describe('toolArgErrors — never manufactures a tax', () => {
  it('reports zero for ordinary stderr', () => {
    // Every claude cell takes this path. A false positive here would invent a per-agent
    // penalty out of a warning line, which is the failure mode this counter exists to fix.
    expect(toolArgErrors('kgbench: WARNING — working tree is dirty')).toEqual({ count: 0, detail: {} });
    expect(toolArgErrors('✗ grep failed\n✱ Grep 2 matches')).toEqual({ count: 0, detail: {} });
  });

  it('is total over junk input rather than throwing', () => {
    // It runs inside finish(), which resolves the cell. An exception here would convert a
    // recorded failure into a lost one.
    for (const junk of [null, undefined, '', 0, {}, []]) {
      expect(() => toolArgErrors(junk)).not.toThrow();
      expect(toolArgErrors(junk).count).toBe(0);
    }
  });

  it('still counts a rejection whose reason it cannot parse', () => {
    // Undercounting is the failure that matters — an unrecognised SchemaError variant must
    // not vanish just because the key could not be extracted.
    const r = toolArgErrors('Error: The webfetch tool was called with invalid arguments: something new');
    expect(r.count).toBe(1);
    expect(r.detail).toEqual({ 'webfetch:unknown': 1 });
  });
});

describe('the count reaches the row', () => {
  const ARM = { id: 'grep', model: 'm', allowedTools: ['Grep'], mcpConfig: { mcpServers: {} }, timeoutMs: 20000 };
  let dir;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'kgbench-argerr-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  // /bin/sh standing in for an agent, so the capture path runs without a model call.
  const stub = (script) => ({
    id: 'opencode', binary: '/bin/sh', model: 'm',
    elicitation: 'answer-file', answerFile: ANSWER_FILE,
    argv: () => ['-c', script],
  });

  const REJECTION = 'Error: The bash tool was called with invalid arguments: SchemaError(Missing key\\n  at [\\"description\\"]).\\n';

  it('records the tax on a cell that ANSWERED — the case a per-failure counter loses', () => {
    // This is the whole reason the counter lives in finish() rather than in the no_result
    // branch. The model reissues the rejected call, or falls back to another tool, and the
    // cell scores 1.00 having paid for a round trip that never ran a tool. Counting only
    // failed cells would report the tax as smaller the better the agent recovers.
    return runAgent({
      prompt: 'q', arm: ARM, cwd: dir,
      agent: stub(`printf '${REJECTION}' >&2; printf 'lib/foo.mjs' > ${ANSWER_FILE}`),
    }).then((res) => {
      expect(res.outcome).toBe('ok');
      expect(res.tool_arg_errors).toBe(1);
      expect(res.tool_arg_error_detail).toEqual({ 'bash:description': 1 });
      // And on this path the row carries no `stderr` AT ALL — an answered cell keeps its
      // answer, not its diagnostics. So before the counter there was no channel whatsoever
      // by which a rejection on a successful cell could be seen: not truncated, absent.
      expect(res.stderr).toBeUndefined();
    });
  });

  it('counts occurrences the persisted stderr no longer contains', async () => {
    // THE DEFECT, on the path where stderr IS kept. It is stored as slice(-300), so a
    // rejection followed by enough further output is gone from the row — which is how 34 of
    // x2's 35 were lost. The count is taken from the full buffer before truncation, so it
    // has to survive padding that evicts the text it was derived from.
    const pad = 'x'.repeat(600);
    const res = await runAgent({
      prompt: 'q', arm: ARM, cwd: dir,
      agent: stub(`printf '${REJECTION}' >&2; printf '${pad}' >&2`),   // no answer file
    });
    expect(res.outcome).toBe('no_result');
    expect(res.tool_arg_errors).toBe(1);
    expect(res.stderr).not.toContain('invalid arguments');   // evicted from the tail...
    expect(res.stderr.length).toBeLessThanOrEqual(300);      // ...because the tail is capped
  });

  it('is aggregated per agent and stated in the report', () => {
    const row = (o) => ({
      arm: 'grep', agent: 'opencode', id: 'L1', cls: 'lookup', rep: 1, outcome: 'ok', score: 1,
      elicitation: 'answer-file', enforcement: { builtins: 'ungated' }, ...o,
    });
    const p = provenanceOf([
      row({ tool_arg_errors: 1, tool_arg_error_detail: { 'bash:description': 1 } }),
      row({ tool_arg_errors: 2, tool_arg_error_detail: { 'bash:description': 2 } }),
      row({}),                                                       // clean opencode cell
      row({ agent: 'claude', elicitation: 'stream-json' }),          // an agent that never pays
    ]);
    // Cells and rejections are DIFFERENT numbers — one cell can be rejected more than once,
    // and a rate quoted per cell would understate the turns actually spent.
    expect(p.tool_arg_errors).toEqual({
      opencode: { cells: 2, rejections: 3, args: { 'bash:description': 3 } },
    });
    expect(p.tool_arg_errors.claude).toBeUndefined();

    const md = renderMarkdown({
      ...META, meta: META,
      ...aggregate([
        row({ tool_arg_errors: 1, tool_arg_error_detail: { 'bash:description': 1 } }),
      ], { arms: ['grep'], questions: [{ id: 'L1', cls: 'lookup' }] }),
    });
    expect(md).toContain('Tool calls rejected by the agent');
    expect(md).toContain('`bash:description`');
    // It must read as a confound, not a score — the whole point is that it belongs to the
    // agent rather than to the arm it was running.
    expect(md).toMatch(/not of the retrieval arm/i);
  });

  it('omits the key entirely when no row recorded one', () => {
    // Not `{}`. A published run re-rendered must reproduce byte-for-byte, and every run
    // before this counter existed has no such rows.
    const p = provenanceOf([{ arm: 'grep', agent: 'claude', outcome: 'ok', score: 1 }]);
    expect('tool_arg_errors' in p).toBe(false);
  });

  it('adds no keys at all to a clean cell', async () => {
    // Every claude cell and every clean opencode cell. Two always-empty columns on 384 rows
    // is noise in a file that is read by eye.
    const res = await runAgent({
      prompt: 'q', arm: ARM, cwd: dir,
      agent: stub(`printf 'ordinary warning\\n' >&2; printf 'a' > ${ANSWER_FILE}`),
    });
    expect(res.outcome).toBe('ok');
    expect('tool_arg_errors' in res).toBe(false);
    expect('tool_arg_error_detail' in res).toBe(false);
  });
});
