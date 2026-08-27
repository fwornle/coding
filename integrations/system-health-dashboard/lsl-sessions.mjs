/**
 * Server-side model for the dashboard's Sessions tab.
 *
 * A "session" here is a CHAIN — one hourly tranche including all of its
 * rotation parts — not a single file. That is forced by the corpus: a legacy
 * `-N_` markdown part is a headerless fragment split mid-token and cannot be
 * read alone, and a pi-format part is chained to its predecessor via
 * `parentSession`. Presenting files would show the user fragments.
 *
 * Both formats are served, because the corpus is mixed until the backfill has
 * run everywhere. `.jsonl` parts are concatenated; `.md` chains are converted
 * IN MEMORY through the same parser and writer the backfill uses, so the
 * viewer renders a legacy tranche exactly as the backfill would convert it —
 * which makes this tab a live preview of the conversion, not just a reader.
 *
 * Rendering reuses pi's own exported HTML shell (assets/pi-export-shell.html,
 * refreshed by scripts/vendor-pi-export-shell.mjs). `pi` is a host tool and is
 * NOT installed in the coding-services container, so shelling out to
 * `pi --export` per request is not possible; substituting the base64 payload
 * into pi's own rendered output gives identical fidelity with no runtime
 * dependency.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  groupChains, concatChain, parseChain, partAt,
} from '../../src/live-logging/LslMarkdownParser.js';
import {
  sessionHeader, buildTrancheEntries, buildPromptSetEntries,
  serialize, makeIdGen, uuidFrom, entryId,
} from '../../src/live-logging/PiSessionWriter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHELL_PATH = path.join(__dirname, 'assets', 'pi-export-shell.html');
const PLACEHOLDER = '__LSL_SESSION_DATA__';

const isLsl = (n) => n.endsWith('.jsonl') || n.endsWith('.md');

/** Opaque, reversible id for a chain: "<project>/<yyyy>/<mm>/<chainKey>". */
export const chainId = (project, year, month, key) => `${project}/${year}/${month}/${key}`;

function parseChainId(id) {
  const m = String(id).match(/^([^/]+)\/(\d{4})\/(\d{2})\/(.+)$/);
  if (!m) return null;
  return { project: m[1], year: m[2], month: m[3], key: m[4] };
}

/**
 * Every project that has an LSL history tree.
 *
 * Sibling projects live next to the repo on the host, but inside the
 * coding-services container `codingRoot` is `/coding`, whose parent is `/` —
 * the siblings are bind-mounted at `/workspace` instead. Scanning both keeps
 * one code path working in either place; LSL_WORKSPACE_ROOT overrides.
 */
export function discoverProjects(codingRoot) {
  const roots = [path.resolve(codingRoot, '..')];
  const ws = process.env.LSL_WORKSPACE_ROOT || '/workspace';
  if (ws && fs.existsSync(ws) && !roots.includes(ws)) roots.push(ws);

  const siblings = roots.flatMap((base) => safeReaddir(base).map((n) => path.join(base, n)));
  const out = [];
  for (const dir of [codingRoot, ...siblings]) {
    const hist = path.join(dir, '.specstory', 'history');
    if (!fs.existsSync(hist)) continue;
    const name = path.basename(dir);
    if (!out.some((p) => p.project === name)) out.push({ project: name, history: hist });
  }
  return out;
}

const safeReaddir = (d) => { try { return fs.readdirSync(d); } catch { return []; } };

/** Transcript files only — never logs/classification or docs (see the backfill). */
function listTranscriptFiles(history, year, month) {
  const dir = path.join(history, year, month);
  return safeReaddir(dir).filter(isLsl).map((n) => path.join(dir, n));
}

function listMonths(history) {
  const months = [];
  for (const y of safeReaddir(history).filter((n) => /^\d{4}$/.test(n))) {
    for (const m of safeReaddir(path.join(history, y)).filter((n) => /^\d{2}$/.test(n))) {
      months.push({ year: y, month: m });
    }
  }
  return months.sort((a, b) => (b.year + b.month).localeCompare(a.year + a.month));
}

/**
 * List chains, newest first. Reads only each chain's first lines, so this stays
 * cheap over a corpus of ~20k files.
 */
export function listSessions(codingRoot, { project, limit = 100, months = 2 } = {}) {
  const projects = discoverProjects(codingRoot)
    .filter((p) => !project || p.project === project);
  const rows = [];

  for (const p of projects) {
    for (const { year, month } of listMonths(p.history).slice(0, months)) {
      const files = listTranscriptFiles(p.history, year, month);
      if (files.length === 0) continue;
      for (const chain of groupChains(files).values()) {
        const parts = chain.parts;
        let bytes = 0;
        let mtime = 0;
        for (const part of parts) {
          try {
            const st = fs.statSync(part.path);
            bytes += st.size;
            mtime = Math.max(mtime, st.mtimeMs);
          } catch { /* vanished mid-scan */ }
        }
        const format = parts.every((x) => x.path.endsWith('.jsonl')) ? 'pi'
          : parts.some((x) => x.path.endsWith('.jsonl')) ? 'mixed' : 'markdown';
        rows.push({
          id: chainId(p.project, year, month, chain.key),
          project: p.project,
          key: chain.key,
          ...describeKey(chain.key),
          parts: parts.length,
          format,
          bytes,
          mtime,
          ...peekMeta(parts),
        });
      }
    }
  }
  rows.sort((a, b) => b.key.localeCompare(a.key));
  return rows.slice(0, limit);
}

/** Pull date/window/redirect out of the chain key without opening a file. */
function describeKey(key) {
  const m = key.match(/^(\d{4}-\d{2}-\d{2})_(\d{4})-(\d{4})_(.+?)(?:_from-(.+))?$/);
  if (!m) return { date: null, window: null, from: null };
  return {
    date: m[1],
    window: `${m[2]}-${m[3]}`,
    from: m[5] || null,
    subAgent: /^S\d+-\d+-/.test(m[4]),
  };
}

/**
 * Agent + prompt-set count for a CHAIN.
 *
 * Must aggregate across every part, not sample the first one: a prompt set is
 * anchored wherever it starts, so a 12-part tranche whose first file holds 12
 * sets can hold 48 across the chain. Reporting the first part's count made the
 * listing disagree with the rendered session.
 *
 * Counting is done by scanning for markers rather than parsing, so it stays
 * proportional to bytes read and never builds an entry graph.
 */
function peekMeta(parts) {
  let agent = null;
  let sets = 0;
  for (const part of parts) {
    let text;
    try { text = fs.readFileSync(part.path, 'utf8'); } catch { continue; }
    if (part.path.endsWith('.jsonl')) {
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        // Cheap pre-filter — most lines are messages, not custom entries.
        if (line.indexOf('"custom"') === -1) continue;
        let e;
        try { e = JSON.parse(line); } catch { continue; }
        if (e.customType === 'lsl.tranche') agent = e.data?.agent ?? agent;
        else if (e.customType === 'lsl.promptSet') sets++;
      }
    } else {
      agent ??= text.match(/^\*\*Agent:\*\*\s*(.*)$/m)?.[1]?.trim() || null;
      sets += (text.match(/<a name="ps_\d+"><\/a>/g) || []).length;
    }
  }
  return { agent, promptSets: sets };
}

/** Locate a chain's part files from its id. */
function resolveChain(codingRoot, id) {
  const parsed = parseChainId(id);
  if (!parsed) return null;
  const proj = discoverProjects(codingRoot).find((p) => p.project === parsed.project);
  if (!proj) return null;
  const files = listTranscriptFiles(proj.history, parsed.year, parsed.month);
  const chain = groupChains(files).get(parsed.key);
  return chain ? { chain, ...parsed } : null;
}

/**
 * Entries for a chain, in pi session shape.
 *
 * `.jsonl` parts are concatenated in part order (each is already valid; the
 * headers of the later parts are dropped so the result reads as one session).
 * `.md` chains go through the backfill's own parser and writer, so what the
 * viewer shows is exactly what the conversion would produce.
 */
export function readSession(codingRoot, id) {
  const found = resolveChain(codingRoot, id);
  if (!found) return null;
  const { chain, project } = found;

  const jsonlParts = chain.parts.filter((p) => p.path.endsWith('.jsonl'));
  const mdParts = chain.parts.filter((p) => p.path.endsWith('.md'));

  let header = null;
  const entries = [];

  for (const part of jsonlParts) {
    for (const line of fs.readFileSync(part.path, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      if (e.type === 'session') { header ??= e; continue; }
      entries.push(e);
    }
  }

  if (mdParts.length > 0) {
    const cat = concatChain({ key: chain.key, parts: mdParts });
    const parsed = parseChain(cat.text, chain.key);
    const idGen = makeIdGen(chain.key);
    const firstIso = parsed.promptSets[0]?.time
      || (parsed.header.date ? `${parsed.header.date}T00:00:00.000Z` : new Date(0).toISOString());
    const { entries: hdr, spineId } = buildTrancheEntries(
      { ...parsed.header, chainKey: chain.key, converted: 'preview' }, idGen, firstIso);
    entries.push(...hdr);
    for (const ps of parsed.promptSets) {
      entries.push(...buildPromptSetEntries({
        promptSetId: ps.promptSetId,
        spineId,
        idGen,
        fallbackIso: firstIso,
        meta: { time: ps.time, durationMs: ps.durationMs, toolCalls: ps.toolCallCount,
                sliceIdx: ps.sliceIdx, totalSlices: ps.totalSlices, agent: parsed.header.agent },
        blocks: ps.blocks.map((b) => ({ ...b, part: partAt(cat.ranges, b.offset).index })),
      }));
    }
    header ??= sessionHeader({
      id: uuidFrom(chain.key), timestamp: firstIso, cwd: project,
    });
  }

  if (!header) return null;
  return { header, entries, leafId: entries.length ? entries[entries.length - 1].id : null };
}

/**
 * Tool names pi's template renders natively, keyed by the agent's own name.
 *
 * pi switches on a lowercase name, so Claude's `Bash` falls through to the
 * generic JSON dump — a wall of `{"command": ...}` instead of `$ ls -la`. The
 * argument shapes already line up: pi's `read`/`write`/`edit` read
 * `args.file_path ?? args.path` and `bash` reads `args.command`, which are
 * exactly Claude's keys, so this is a naming difference and nothing more.
 *
 * Applied at RENDER time only. The stored entries keep the agent's real tool
 * name, because that is what the agent actually called.
 *
 * Deliberately omits Glob -> find: the names differ because the semantics do,
 * and mapping it would render one tool as another.
 */
const RENDER_TOOL_ALIASES = {
  Bash: 'bash', Read: 'read', Write: 'write', Edit: 'edit', LS: 'ls', Grep: 'grep',
};

/** Rewrite tool names for display only, leaving the source data untouched. */
function aliasToolNames(entries) {
  return entries.map((e) => {
    const msg = e.message;
    if (!msg) return e;
    if (msg.role === 'toolResult' && RENDER_TOOL_ALIASES[msg.toolName]) {
      return { ...e, message: { ...msg, toolName: RENDER_TOOL_ALIASES[msg.toolName] } };
    }
    if (msg.role === 'assistant' && Array.isArray(msg.content)
        && msg.content.some((c) => c.type === 'toolCall' && RENDER_TOOL_ALIASES[c.name])) {
      return {
        ...e,
        message: {
          ...msg,
          content: msg.content.map((c) => (c.type === 'toolCall' && RENDER_TOOL_ALIASES[c.name]
            ? { ...c, name: RENDER_TOOL_ALIASES[c.name] } : c)),
        },
      };
    }
    return e;
  });
}

/** Render a chain using pi's own export shell. */
export function renderSessionHtml(codingRoot, id) {
  const data = readSession(codingRoot, id);
  if (!data) return null;
  if (!fs.existsSync(SHELL_PATH)) {
    throw new Error('pi export shell missing — run scripts/vendor-pi-export-shell.mjs');
  }
  const shell = fs.readFileSync(SHELL_PATH, 'utf8');
  const forDisplay = { ...data, entries: aliasToolNames(data.entries) };
  const payload = Buffer.from(JSON.stringify(forDisplay)).toString('base64');
  return shell.replace(PLACEHOLDER, payload);
}

/**
 * Every slice of one prompt set, across tranches and projects.
 *
 * This is the query markdown could only answer with `grep -l ps_X *.md`: a set
 * that spans hourly tranches or rotation parts carries the same promptSetId in
 * each, so the fragments can be stitched back into one conversation.
 */
export function findPromptSet(codingRoot, promptSetId, { months = 6 } = {}) {
  const hits = [];
  for (const p of discoverProjects(codingRoot)) {
    for (const { year, month } of listMonths(p.history).slice(0, months)) {
      for (const file of listTranscriptFiles(p.history, year, month)) {
        let text;
        try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
        if (!text.includes(promptSetId)) continue;
        const key = [...groupChains([file]).keys()][0];
        hits.push({
          project: p.project,
          file: path.basename(file),
          id: chainId(p.project, year, month, key),
          format: file.endsWith('.jsonl') ? 'pi' : 'markdown',
        });
      }
    }
  }
  return hits;
}

export const SESSION_DATA_PLACEHOLDER = PLACEHOLDER;
