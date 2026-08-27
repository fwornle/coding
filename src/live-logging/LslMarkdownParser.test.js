/**
 * Unit tests for LslMarkdownParser + PiSessionWriter (LSL → pi format).
 *
 * These lock the two defects the Phase 0 spike caught by measuring against
 * ground truth. Both were silent — they produced plausible output — so they
 * are exactly the regressions a refactor would reintroduce:
 *
 *   Test 5 — `### Step 1: …` prose headings must NOT start a block.
 *            45% of `### ` headings in the corpus are prose; splitting on
 *            every h3 invented ~16k phantom tool calls per month.
 *   Test 6 — a `<a name="ps_N">` anchor with NO `## Prompt Set` heading is
 *            still a prompt set. 521 of 2,525 August anchors have no heading;
 *            anchoring on the heading dropped 26% of sets.
 *
 * Test framework: node:test + node:assert/strict (no new deps, per CLAUDE.md).
 * Run via: node --test src/live-logging/LslMarkdownParser.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  groupChains, concatChain, partAt, detectDialect,
  splitPromptSets, splitBlocks, parseBlock, parseChain, parseHeader,
} from './LslMarkdownParser.js';

import {
  buildTrancheEntries, buildPromptSetEntries, removePromptSet,
  exchangesToBlocks, makeIdGen, serialize, sessionHeader,
} from './PiSessionWriter.js';

const HDR = `# WORK SESSION (1100-1200)

**Generated:** 2026-08-26T11:00:00.000Z
**Agent:** Claude
**Source Project:** /repo

---
`;

const toolBlock = (name, ts) => `### ${name} - ${ts} UTC [13:00:00 CEST]

**User Request:** do the thing

**Tool:** ${name}
**Input:** \`\`\`json
{
  "command": "ls -la"
}
\`\`\`

**Result:** ✅ Success
**Output:** \`\`\`
total 0
\`\`\`

---

`;

const psBlock = (id, ts, body) =>
  `<a name="${id}"></a>\n## Prompt Set (${id})\n\n**Time:** ${ts}\n**Duration:** 12ms\n**Tool Calls:** 1\n\n${body}`;

describe('groupChains / concatChain', () => {
  it('Test 1 — groups parts of one chain and sorts them numerically', () => {
    const chains = groupChains([
      '/h/2026-08-26_1100-1200-10_abc.md',
      '/h/2026-08-26_1100-1200-2_abc.md',
      '/h/2026-08-26_1100-1200-1_abc.md',
      '/h/2026-08-26_1200-1300-1_abc.md',
    ]);
    assert.equal(chains.size, 2);
    const c = chains.get('2026-08-26_1100-1200_abc');
    assert.deepEqual(c.parts.map((p) => p.index), [1, 2, 10]);
  });

  it('Test 2 — keeps redirect targets in separate chains', () => {
    const chains = groupChains([
      '/h/2026-08-26_1100-1200-1_abc.md',
      '/h/2026-08-26_1100-1200-1_abc_from-rec.md',
    ]);
    assert.equal(chains.size, 2);
  });

  it('Test 3 — records byte ranges and flags gaps from deleted parts', () => {
    const chain = { key: 'k', parts: [{ index: 1, path: 'a' }, { index: 5, path: 'b' }] };
    const { text, ranges } = concatChain(chain, { readFile: (p) => (p === 'a' ? 'AAAA' : 'BB') });
    assert.equal(text, 'AAAABB');
    assert.equal(ranges[0].gapBefore, false);
    assert.equal(ranges[1].gapBefore, true, 'part 5 after part 1 is a gap');
    assert.equal(partAt(ranges, 0).index, 1);
    assert.equal(partAt(ranges, 5).index, 5);
  });
});

describe('detectDialect', () => {
  it('Test 4 — distinguishes the three corpus dialects', () => {
    assert.equal(detectDialect(HDR), 'A');
    assert.equal(detectDialect('# Claude Code Session Log\n\n**Session:** x'), 'B');
    assert.equal(detectDialect('---\nsub_session_id: abc\n---\n# Sub-agent session — x'), 'C');
    // headerless rotation part -> treated as A, filename supplies metadata
    assert.equal(detectDialect('**Result:** ✅ Success\n'), 'A');
  });
});

describe('splitBlocks — prose headings must not start a block', () => {
  it('Test 5 — REGRESSION: `### Step 1:` prose is not an exchange block', () => {
    const body = toolBlock('Bash', '2026-08-26 11:00:00')
      + '### Step 1: Determine Current Project\n\nsome assistant prose\n\n'
      + '### Recent Work:\n\nmore prose\n\n'
      + toolBlock('Read', '2026-08-26 11:01:00');
    const ps = { body, offset: 0 };
    const blocks = splitBlocks(ps, 'A');
    assert.equal(blocks.length, 2, 'only the two timestamped headings start blocks');
    const parsed = blocks.map((b) => parseBlock(b, 'A'));
    assert.deepEqual(parsed.map((p) => p.toolName), ['Bash', 'Read']);
    assert.ok(parsed.every((p) => p.kind === 'tool'));
  });

  it('Test 6 — dialect B uses bare `### User` / `### Assistant`', () => {
    const body = '### User\n\nhello there\n\n### Assistant\n\nhi back\n\n### Total\n\nprose\n';
    const blocks = splitBlocks({ body, offset: 0 }, 'B');
    assert.equal(blocks.length, 2, '`### Total` is prose, not a block');
    const [u, a] = blocks.map((b) => parseBlock(b, 'B'));
    assert.equal(u.userText, 'hello there');
    // `### Total` is markdown INSIDE the assistant turn, so it stays in the
    // assistant's text — it just must not open a block of its own.
    assert.match(a.assistantText, /^hi back/);
    assert.match(a.assistantText, /### Total/);
  });
});

describe('splitPromptSets — anchor, not heading', () => {
  it('Test 7 — REGRESSION: an anchor with no `## Prompt Set` heading still counts', () => {
    // _removeExistingPromptSetBlock strips a body and leaves the bare anchor.
    const text = HDR
      + psBlock('ps_1', '2026-08-26T11:00:00.000Z', toolBlock('Bash', '2026-08-26 11:00:00'))
      + '<a name="ps_2"></a>\n\n'
      + toolBlock('Grep', '2026-08-26 11:05:00');
    const sets = splitPromptSets(text);
    assert.equal(sets.length, 2);
    assert.deepEqual(sets.map((s) => s.promptSetId), ['ps_1', 'ps_2']);
    // the heading-less set still carries its tool call
    const blocks = splitBlocks(sets[1], 'A');
    assert.equal(blocks.length, 1);
    assert.equal(parseBlock(blocks[0], 'A').toolName, 'Grep');
  });

  it('Test 8 — reads slice metadata from the heading when present', () => {
    const text = HDR + '<a name="ps_9"></a>\n## Prompt Set (ps_9) — slice 2/3\n\n**Time:** 2026-08-26T11:00:00.000Z\n**Duration:** 5ms\n**Tool Calls:** 0\n\n';
    const [s] = splitPromptSets(text);
    assert.equal(s.sliceIdx, 2);
    assert.equal(s.totalSlices, 3);
    assert.equal(s.durationMs, 5);
  });
});

describe('parseBlock', () => {
  it('Test 9 — extracts tool name, JSON input, result status and output', () => {
    const [b] = splitBlocks({ body: toolBlock('Bash', '2026-08-26 11:00:00'), offset: 0 }, 'A');
    const p = parseBlock(b, 'A');
    assert.equal(p.kind, 'tool');
    assert.equal(p.toolName, 'Bash');
    assert.equal(p.isError, false);
    assert.equal(JSON.parse(p.input).command, 'ls -la');
    assert.match(p.output, /total 0/);
    assert.equal(p.truncated, false);
  });

  it('Test 10 — flags a block cut by a deleted part (unterminated fence)', () => {
    const cut = '### Bash - 2026-08-26 11:00:00 UTC\n\n**Tool:** Bash\n**Input:** ```json\n{\n  "comm';
    const [b] = splitBlocks({ body: cut, offset: 0 }, 'A');
    const p = parseBlock(b, 'A');
    assert.equal(p.truncated, true, 'unterminated Input fence means the chain has a gap');
  });

  it('Test 11 — marks ❌ Error results as errors', () => {
    const err = '### Bash - 2026-08-26 11:00:00 UTC\n\n**Tool:** Bash\n**Result:** ❌ Error\n';
    const [b] = splitBlocks({ body: err, offset: 0 }, 'A');
    assert.equal(parseBlock(b, 'A').isError, true);
  });
});

describe('parseHeader / parseChain', () => {
  it('Test 12 — falls back to the chain key when part-1 was deleted', () => {
    const h = parseHeader('**Result:** ✅ Success\n', '2026-08-26_1100-1200_c197ef_from-rec', 'A');
    assert.equal(h.headerPresent, false);
    assert.equal(h.date, '2026-08-26');
    assert.equal(h.timeWindow, '1100-1200');
    assert.equal(h.fromProject, 'rec');
    assert.equal(h.redirected, true);
  });

  it('Test 13 — parseChain returns sets with their blocks', () => {
    const text = HDR + psBlock('ps_1', '2026-08-26T11:00:00.000Z', toolBlock('Bash', '2026-08-26 11:00:00'));
    const r = parseChain(text, '2026-08-26_1100-1200_abc');
    assert.equal(r.dialect, 'A');
    assert.equal(r.header.agent, 'Claude');
    assert.equal(r.promptSets.length, 1);
    assert.equal(r.promptSets[0].blocks.length, 1);
  });
});

describe('PiSessionWriter', () => {
  const meta = { timeWindow: '1100-1200', agent: 'Claude' };

  it('Test 14 — every prompt set parents off the spine, not the previous set', () => {
    const gen = makeIdGen('seed');
    const { entries: hdr, spineId } = buildTrancheEntries(meta, gen, '2026-08-26T11:00:00.000Z');
    const a = buildPromptSetEntries({ promptSetId: 'ps_1', spineId, idGen: gen,
      fallbackIso: '2026-08-26T11:00:00.000Z', meta: {},
      blocks: [{ kind: 'text', userText: 'hi', assistantText: 'yo' }] });
    const b = buildPromptSetEntries({ promptSetId: 'ps_2', spineId, idGen: gen,
      fallbackIso: '2026-08-26T11:00:00.000Z', meta: {},
      blocks: [{ kind: 'text', userText: 'again', assistantText: 'sure' }] });
    assert.equal(hdr.length, 2);
    assert.equal(a[0].parentId, spineId);
    assert.equal(b[0].parentId, spineId, 'sets are siblings — that is what makes removal a subtree drop');
  });

  it('Test 15 — removePromptSet drops the whole subtree and nothing else', () => {
    const gen = makeIdGen('seed');
    const { entries: hdr, spineId } = buildTrancheEntries(meta, gen, '2026-08-26T11:00:00.000Z');
    const mk = (id, text) => buildPromptSetEntries({ promptSetId: id, spineId, idGen: gen,
      fallbackIso: '2026-08-26T11:00:00.000Z', meta: {},
      blocks: [{ kind: 'tool', userText: text, toolName: 'Bash', input: { c: 1 }, output: 'ok' }] });
    const all = [sessionHeader({ id: 'u', timestamp: 'x', cwd: '/r' }), ...hdr, ...mk('ps_1', 'one'), ...mk('ps_2', 'two')];
    const before = serialize(all);

    const { text, removed } = removePromptSet(before, 'ps_1');
    assert.ok(removed > 0, 'ps_1 entries removed');
    assert.ok(!text.includes('"one"'), 'ps_1 content gone');
    assert.ok(text.includes('"two"'), 'ps_2 content survives');
    assert.ok(text.includes('lsl.tranche'), 'spine survives');

    const lines = text.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.filter((e) => e.customType === 'lsl.promptSet').length, 1);
  });

  it('Test 16 — removePromptSet is a no-op for an absent id', () => {
    const before = serialize([sessionHeader({ id: 'u', timestamp: 'x', cwd: '/r' })]);
    const { text, removed } = removePromptSet(before, 'ps_nope');
    assert.equal(removed, 0);
    assert.equal(text, before);
  });

  it('Test 17 — a repeated user request emits one user message, not one per tool', () => {
    const gen = makeIdGen('seed');
    const es = buildPromptSetEntries({ promptSetId: 'ps_1', spineId: 's', idGen: gen,
      fallbackIso: '2026-08-26T11:00:00.000Z', meta: {},
      blocks: [
        { kind: 'tool', userText: 'same', toolName: 'Bash', input: {}, output: 'a' },
        { kind: 'tool', userText: 'same', toolName: 'Read', input: {}, output: 'b' },
      ] });
    const users = es.filter((e) => e.type === 'message' && e.message.role === 'user');
    assert.equal(users.length, 1, 'markdown repeated it per tool block; pi should not');
    assert.equal(es.filter((e) => e.type === 'message' && e.message.role === 'toolResult').length, 2);
  });

  it('Test 18 — exchangesToBlocks expands one exchange into one block per tool call', () => {
    const blocks = exchangesToBlocks([{
      timestamp: '2026-08-26T11:00:00.000Z', userMessage: 'go',
      toolCalls: [{ id: 't1', name: 'Bash', input: { c: 'ls' } }, { id: 't2', name: 'Read', input: {} }],
      results: { t1: { content: 'out', is_error: false }, t2: { content: 'x', is_error: true } },
    }]);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].toolName, 'Bash');
    assert.equal(blocks[0].output, 'out');
    assert.equal(blocks[1].isError, true);
  });

  it('Test 19 — a toolless exchange becomes a single text block', () => {
    const blocks = exchangesToBlocks([{ timestamp: 't', userMessage: 'hi', assistantResponse: 'yo' }]);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].kind, 'text');
    assert.equal(blocks[0].assistantText, 'yo');
  });

  it('Test 20 — emitted entries are valid pi shapes', () => {
    const gen = makeIdGen('seed');
    const es = buildPromptSetEntries({ promptSetId: 'ps_1', spineId: 's', idGen: gen,
      fallbackIso: '2026-08-26T11:00:00.000Z', meta: { agent: 'Claude' },
      blocks: [{ kind: 'tool', userText: 'go', toolName: 'Bash', input: { c: 'ls' }, output: 'ok' }] });
    const call = es.find((e) => e.message?.content?.[0]?.type === 'toolCall');
    const res = es.find((e) => e.message?.role === 'toolResult');
    assert.equal(call.message.content[0].arguments.c, 'ls');
    assert.equal(res.message.toolCallId, call.message.content[0].id, 'result must reference its call');
    assert.equal(res.message.content[0].type, 'text');
    assert.ok(es.every((e) => typeof e.id === 'string' && 'parentId' in e && e.timestamp));
  });
});
