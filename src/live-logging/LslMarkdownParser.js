/**
 * LslMarkdownParser - faithful parser for the legacy LSL markdown corpus.
 *
 * Converts ETM-written LSL markdown into a neutral intermediate representation
 * that PiSessionWriter turns into pi session entries. Used by the backfill
 * (scripts/backfill-lsl-to-pi.mjs) and by the read path for not-yet-converted
 * files.
 *
 * Deliberately NOT TranscriptNormalizer.parseLslTranche(): that parser is lossy
 * BY DESIGN — it collapses every tool call in a prompt set into a single
 * 4000-char synthesis string, which is right for feeding an observation
 * summarizer and useless for reconstructing a transcript. This one keeps every
 * tool call with its full input and output.
 *
 * THE PARSE UNIT IS A CHAIN, NOT A FILE
 * -------------------------------------
 * 57% of the LSL corpus (10,569 of 18,482 files in 2026) are headerless
 * rotation parts, and rotation splits MID-TOKEN: part 186 of one chain ends
 * inside an `**Input:**` JSON fence and part 187 opens with its continuation.
 * There are ZERO unsuffixed files — every LSL file is `-N_`, and only `-1_`
 * carries a header. So callers must groupChains() + concatChain() first and
 * hand the joined text to parseChain(). Parsing a part file alone is not
 * merely lossy, it is impossible.
 *
 * Chains are also GAPPED: cleanupLowValueLSLFiles() deletes low-value parts
 * mid-chain (one 293-part chain retains 198 files), and ~4,000 chains have lost
 * part-1 entirely, so header metadata falls back to the filename.
 *
 * THREE DIALECTS
 * --------------
 *   A  `# WORK SESSION (HHMM-HHMM)`        6,779 files - current ETM format
 *   B  `# Claude Code Session Log`           179 files - numbers its heading
 *                                                        (`## Prompt Set 1 (ps_N)`)
 *                                                        and uses bare
 *                                                        `### User`/`### Assistant`
 *   C  `# Sub-agent session — …`             800 files - YAML frontmatter, bare
 *                                                        `<a name>` anchors, no
 *                                                        `##` heading at all
 */

import fs from 'fs';
import path from 'path';

// Both extensions: `.jsonl` is the current pi format, `.md` the legacy corpus.
// The viewer groups chains across a MIXED directory, which is the steady state
// until the backfill has run everywhere.
/** `<date>_<window>[-<part>]_<hash>[_from-<project>].{jsonl,md}` */
const NAME_RE = /^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{4})(?:-(\d+))?_([^.]+?)(?:_from-(.+))?\.(?:jsonl|md)$/;
/** Sub-agent files: `<date>_<window>_S<n>-<n>-<hash>[-part<N>].{jsonl,md}` */
const SUB_RE = /^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{4})_(S\d+-\d+-[0-9A-Za-z]+)(?:-part(\d+))?\.(?:jsonl|md)$/;

/**
 * Group part files into chains keyed by (date, window, hash, redirect target).
 * @param {string[]} files - absolute paths to .md files
 * @returns {Map<string, {key: string, parts: Array<{index:number, path:string}>}>}
 */
export function groupChains(files) {
  const chains = new Map();
  for (const f of files) {
    const b = path.basename(f);
    let key;
    let index = 1;
    const sub = b.match(SUB_RE);
    if (sub) {
      key = `${sub[1]}_${sub[2]}_${sub[3]}`;
      index = sub[4] ? Number(sub[4]) : 0;
    } else {
      const m = b.match(NAME_RE);
      if (!m) {
        key = b.replace(/\.(?:jsonl|md)$/, '');
      } else {
        // The UNSUFFIXED file is the base tranche, written first; `-1_` is the
        // first ROTATION of it (see getActiveSessionFilePath). So the base is
        // part 0. Defaulting it to 1 collides with the real `-1_` part, and a
        // chain holding both then emits one part's entries into both files —
        // silently duplicating content. Both forms genuinely coexist, e.g.
        // 2026-08-02_1300-1400_c197ef.md (320 KB) alongside
        // 2026-08-02_1300-1400-1_c197ef.md (104 KB).
        index = m[3] ? Number(m[3]) : 0;
        key = `${m[1]}_${m[2]}_${m[4]}${m[5] ? `_from-${m[5]}` : ''}`;
      }
    }
    if (!chains.has(key)) chains.set(key, { key, parts: [] });
    chains.get(key).parts.push({ index, path: f });
  }
  for (const c of chains.values()) c.parts.sort((a, b) => a.index - b.index);
  return chains;
}

/**
 * Concatenate a chain's parts, recording each part's byte range in the result
 * so every parsed block can be attributed back to the part it STARTED in.
 * `gapBefore` marks a part whose predecessor was deleted by cleanup.
 */
export function concatChain(chain, { readFile = (p) => fs.readFileSync(p, 'utf8') } = {}) {
  let text = '';
  const ranges = [];
  let prev = null;
  for (const p of chain.parts) {
    const start = text.length;
    text += readFile(p.path);
    ranges.push({ ...p, start, end: text.length, gapBefore: prev !== null && p.index !== prev + 1 });
    prev = p.index;
  }
  return { text, ranges };
}

/** Which part does this offset fall in? */
export function partAt(ranges, offset) {
  return ranges.find((r) => offset >= r.start && offset < r.end) || ranges[ranges.length - 1];
}

export function detectDialect(text) {
  const head = text.slice(0, 8192);
  if (/^# Sub-agent session/m.test(head) || /^sub_session_id:/m.test(head)) return 'C';
  if (/^# Claude Code Session Log/m.test(head)) return 'B';
  // A also covers headerless chains (part-1 cleaned up); the filename supplies
  // what the missing header would have.
  return 'A';
}

const field = (t, k) => {
  const m = t.match(new RegExp(`^\\*\\*${k}:\\*\\*\\s*(.*)$`, 'm'));
  return m ? m[1].trim() : null;
};

const fenced = (t, k) => {
  const m = t.match(new RegExp(`\\*\\*${k}:\\*\\*\\s*\`\`\`[a-z]*\\n([\\s\\S]*?)\\n?\`\`\``));
  return m ? m[1] : null;
};

/** Header metadata from the chain text where present, else from the chain key. */
export function parseHeader(text, chainKey, dialect) {
  const head = text.slice(0, 8192);
  const fm = head.match(/^---\n([\s\S]*?)\n---/);
  const fmv = (k) => (fm ? fm[1].match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1]?.trim() ?? null : null);
  const km = chainKey.match(/^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{4})_(.+?)(?:_from-(.+))?$/);
  const title = head.match(/^#\s+WORK SESSION\s*\(([^)]*)\)(?:\s*-\s*From\s+(.*))?$/m);
  return {
    dialect,
    date: km?.[1] ?? null,
    timeWindow: title?.[1]?.trim() ?? km?.[2] ?? null,
    userHash: km?.[3] ?? null,
    fromProject: title?.[2]?.trim() ?? km?.[4] ?? null,
    redirected: Boolean(title?.[2] || km?.[4]),
    generated: field(head, 'Generated') ?? fmv('captured_at'),
    agent: field(head, 'Agent') ?? fmv('agent'),
    focus: field(head, 'Focus'),
    sourceProject: field(head, 'Source Project'),
    parentSessionId: fmv('parent_session_id'),
    subIndex: fmv('sub_index'),
    headerPresent: /^#\s/m.test(head),
  };
}

/**
 * Split the chain into prompt sets.
 *
 * Anchors on `<a name="ps_N">`, NOT on the `## Prompt Set` heading, for every
 * dialect. Measured on August 2026: 2,525 anchors against only 1,865 headings —
 * 521 anchors have no heading at all, because _removeExistingPromptSetBlock()
 * strips a block's body and can leave the bare anchor behind. Anchoring on the
 * heading silently dropped 26% of prompt sets and the 16% of tool calls inside
 * them. The anchor is present in all three dialects; the heading is optional
 * and read only for its slice metadata.
 */
export function splitPromptSets(text, dialect = 'A') {
  const hits = [];
  const anchor = /<a name="(ps_\d+)"><\/a>/g;
  let m;
  while ((m = anchor.exec(text)) !== null) hits.push({ promptSetId: m[1], offset: m.index });
  if (hits.length === 0) {
    const hRe = /^##\s+Prompt Set(?:\s+\d+)?\s*\((ps_\d+)\)/gm;
    while ((m = hRe.exec(text)) !== null) hits.push({ promptSetId: m[1], offset: m.index });
  }
  if (hits.length === 0) return synthesizePromptSets(text, dialect);

  const sets = hits.map((h, i) => {
    const body = text.slice(h.offset, i + 1 < hits.length ? hits[i + 1].offset : text.length);
    const psHead = body.split(/^###\s+/m)[0];
    const slice = psHead.match(/^##\s+Prompt Set(?:\s+\d+)?\s*\(ps_\d+\)(?:\s*—\s*slice\s+(\d+)\/(\d+))?/m);
    return {
      ...h,
      body,
      sliceIdx: slice?.[1] ? Number(slice[1]) : null,
      totalSlices: slice?.[2] ? Number(slice[2]) : null,
      time: field(psHead, 'Time'),
      durationMs: Number((field(psHead, 'Duration') || '').replace(/ms$/, '')) || 0,
      toolCallCount: Number(field(psHead, 'Tool Calls')) || 0,
    };
  });

  // Blocks BEFORE the first anchor belong to no set and would be dropped
  // silently. Not hypothetical: one 34 MB chain carries its only anchor 23.5 MB
  // in, so 67% of it — 17,872 tool markers — parsed to nothing. Corpus-wide,
  // 17 chains lose 21,037 blocks and 25.5 MB this way. The lead region gets the
  // same inference the anchor-less path uses, and its ids are kept clear of the
  // anchors' so the two cannot seed identical entry ids in one file.
  const lead = hits[0].offset > 0
    ? synthesizePromptSets(text.slice(0, hits[0].offset), dialect,
      new Set(hits.map((h) => Number(h.promptSetId.slice(3)))))
    : [];
  return lead.length ? [...lead, ...sets] : sets;
}

/**
 * Recover prompt sets for chains that have no anchor and no `## Prompt Set`
 * heading — the oldest layout, where `### <Tool> - <date> UTC` blocks sit
 * directly under `## Key Activities`.
 *
 * WHY THIS EXISTS: without it such a chain parses to ZERO prompt sets and
 * therefore zero blocks, so the backfill emits no `.jsonl`, records the file as
 * `absorbedInto` a neighbour that never claimed it, and — with --write —
 * DELETES the markdown. Measured across the seven history repos: 256 chains,
 * 260 files, 6,200 exchange blocks and 6,747 tool calls, 95% of them in
 * agentic-ai-nano. The loss is silent, because "no prompt sets" is
 * indistinguishable from "empty file" to every counter downstream.
 *
 * GROUPING: the layout has no prompt-set boundaries to read, so they are
 * inferred from `**User Request:**` — the markdown writer repeated it on every
 * block belonging to one prompt. Consecutive blocks sharing a request become
 * one set; a block without one continues the current set. Chains with no
 * request text at all (182 of the 243 in agentic-ai-nano) yield a single set,
 * which preserves every block without inventing structure.
 *
 * Each synthesized set carries `synthesized: true`, which reaches the pi entry
 * as `data.synthesized`. The grouping is INFERRED, and the corpus should say so
 * rather than present it as something the markdown recorded.
 */
function synthesizePromptSets(text, dialect, taken = new Set()) {
  const re = blockHeadingRe(dialect);
  const starts = [];
  let m;
  while ((m = re.exec(text)) !== null) starts.push(m.index);
  if (starts.length === 0) return [];

  const groups = [];
  let current = null;
  for (let i = 0; i < starts.length; i++) {
    const body = text.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : text.length);
    const req = body.match(/^\*\*User Request:\*\*\s*(.*)$/m)?.[1]?.trim() || null;
    // A block with no request belongs to the set already open; only a NEW,
    // different request starts one.
    if (current && (req === null || req === current.req)) current.end = starts[i] + body.length;
    else groups.push(current = { req, offset: starts[i], end: starts[i] + body.length });
  }

  const used = new Set(taken);
  return groups.map((g) => {
    const head = text.slice(g.offset, g.end);
    const time = head.match(/^###[ \t]+.+?[ \t]+-[ \t]+(\d{4}-\d{2}-\d{2}[ \t]+\d{2}:\d{2}:\d{2})[ \t]+UTC/m)?.[1];
    const ms = time ? Date.parse(`${time.replace(/[ \t]+/, 'T')}Z`) : NaN;
    // Ids must keep the `ps_<digits>` shape the rest of the pipeline matches on,
    // and must be STABLE: the writer seeds entry ids from (file, promptSetId),
    // so a re-run has to reproduce them byte for byte. Derived from the block's
    // own timestamp, then bumped on collision (two blocks can share a second).
    let n = Number.isNaN(ms) ? g.offset : ms;
    while (used.has(n)) n += 1;
    used.add(n);
    return {
      promptSetId: `ps_${n}`,
      offset: g.offset,
      body: text.slice(g.offset, g.end),
      sliceIdx: null,
      totalSlices: null,
      time: Number.isNaN(ms) ? null : new Date(ms).toISOString(),
      durationMs: 0,
      toolCallCount: (text.slice(g.offset, g.end).match(/^\*\*Tool:\*\*/gm) || []).length,
      synthesized: true,
    };
  });
}

/**
 * The WRITER's block-heading grammar, per dialect.
 *
 * Shared with splitPromptSets() so the anchor-less fallback recognises exactly
 * the blocks splitBlocks() will go on to parse — two copies of this regex would
 * drift, and a fallback that found blocks the splitter then ignored would
 * produce empty prompt sets.
 *
 * Returns a fresh RegExp each call: these are /g and therefore stateful.
 */
function blockHeadingRe(dialect) {
  return dialect === 'B'
    ? /^###[ \t]+(?:User|Assistant)[ \t]*$/gm
    : /^###[ \t]+.+?[ \t]+-[ \t]+\d{4}-\d{2}-\d{2}[ \t]+\d{2}:\d{2}:\d{2}[ \t]+UTC.*$/gm;
}

/**
 * Split a prompt-set body into exchange blocks, preserving absolute offsets.
 *
 * Only a heading matching the WRITER's grammar starts a block. Measured on
 * August 2026: 36,376 `### ` headings but only 19,996 real ones — 45% are
 * markdown headings inside assistant prose (`### Step 1: …`). Splitting on
 * every h3 invented ~16k phantom tool calls per month, which rendered as
 * entries named `1. Docker Copilot Provider Fix` with `{}` arguments.
 */
export function splitBlocks(ps, dialect) {
  if (dialect === 'C') {
    // Sub-agent dialect has no `###` headings; runs are delimited by the
    // `**User Message:**` / `**Assistant:**` labels themselves.
    const out = [];
    const re = /^\*\*(User Message|Assistant|Claude Response|Tool)([^:]*):\*\*/gm;
    const hits = [];
    let m;
    while ((m = re.exec(ps.body)) !== null) hits.push({ kind: m[1], at: m.index });
    for (let i = 0; i < hits.length; i++) {
      const end = i + 1 < hits.length ? hits[i + 1].at : ps.body.length;
      out.push({ raw: ps.body.slice(hits[i].at, end), offset: ps.offset + hits[i].at, subKind: hits[i].kind });
    }
    return out;
  }
  const BLOCK_RE = blockHeadingRe(dialect);
  const hits = [];
  let m;
  while ((m = BLOCK_RE.exec(ps.body)) !== null) hits.push(m.index);
  return hits.map((at, i) => ({
    raw: ps.body.slice(at, i + 1 < hits.length ? hits[i + 1] : ps.body.length),
    offset: ps.offset + at,
  }));
}

export function parseBlock(b, dialect) {
  if (dialect === 'C') {
    const text = b.raw.replace(/^\*\*[^:]+:\*\*\s*/, '').trim();
    const isUser = b.subKind === 'User Message';
    return {
      kind: 'text', offset: b.offset, time: null,
      userText: isUser ? text || null : null,
      assistantText: isUser ? null : text || null,
    };
  }
  if (dialect === 'B') {
    const isUser = /^###[ \t]+User/.test(b.raw);
    const body = b.raw.replace(/^###[ \t]+\w+[ \t]*\n?/, '').trim();
    return {
      kind: 'text', offset: b.offset, time: null,
      userText: isUser ? body || null : null,
      assistantText: isUser ? null : body || null,
    };
  }
  const h = b.raw.match(/^###\s+(.+?)\s+-\s+(.+?)(\s+\(Redirected\))?\s*$/m);
  const rawName = h ? h[1].trim() : 'Unknown';
  const time = h ? h[2].trim() : null;
  const redirected = Boolean(h?.[3]);
  if (rawName === 'Text Exchange') {
    return {
      kind: 'text', offset: b.offset, time, redirected,
      userText: field(b.raw, 'User Message') || field(b.raw, 'User Request'),
      assistantText: field(b.raw, 'Assistant Response') || field(b.raw, 'Claude Response'),
    };
  }
  const result = field(b.raw, 'Result') || '';
  const input = fenced(b.raw, 'Input');
  return {
    kind: 'tool', offset: b.offset, time, redirected,
    toolName: field(b.raw, 'Tool') || rawName,
    userText: field(b.raw, 'User Request'),
    systemAction: /^\*\*System Action:\*\*/m.test(b.raw),
    input,
    isError: result.includes('❌'),
    output: fenced(b.raw, 'Output'),
    analysis: field(b.raw, 'AI Analysis'),
    // An unterminated fence means the block was cut by a part that cleanup
    // deleted. The data loss already happened; record it rather than hide it.
    truncated: /\*\*Input:\*\*\s*```/.test(b.raw) && input === null,
  };
}

/**
 * Parse a concatenated chain into the neutral intermediate representation.
 * @returns {{header: object, dialect: string, promptSets: Array}}
 */
export function parseChain(text, chainKey) {
  const dialect = detectDialect(text);
  const header = parseHeader(text, chainKey, dialect);
  const promptSets = splitPromptSets(text, dialect).map((ps) => ({
    promptSetId: ps.promptSetId,
    offset: ps.offset,
    time: ps.time,
    durationMs: ps.durationMs,
    toolCallCount: ps.toolCallCount,
    sliceIdx: ps.sliceIdx,
    totalSlices: ps.totalSlices,
    ...(ps.synthesized ? { synthesized: true } : {}),
    blocks: splitBlocks(ps, dialect).map((b) => parseBlock(b, dialect)),
  }));
  return { header, dialect, promptSets };
}
