#!/usr/bin/env node
/**
 * strip-insight-overview-dump — remove the raw-observation blob that insight
 * documents used to open with.
 *
 * WHAT IT REMOVES. insight-generation-agent.buildDocument() pushed a "# Name /
 * **Type:** X / <overview>" header, where <overview> came from
 * synthesizeOverview() — which returned the LONGEST observation verbatim. The
 * longest observation is reliably the machine-tagged one, so 239 of 1264
 * documents opened with an unbroken paragraph like:
 *
 *   [Code References] lib/agent-api/hooks-api.js — `@typedef {Object}
 *   RegisteredHook` JSDoc block defining id/event/handler/priority/source;
 *   lib/agent-api/hooks-api.js — HooksManager constructor: `for (const event…
 *
 * …sitting between the title and the actual, well-written LLM document that
 * follows under its own `# Name — Technical Insight Document` heading.
 *
 * The generator no longer emits it. This repairs documents already on disk so
 * they do not have to wait for a ~50-minute regeneration run.
 *
 * WHAT IT KEEPS. Only the paragraph between the `**Type:**` line and the next
 * `# ` heading, and only when that paragraph starts with a `[Tag]` marker —
 * the machine signature. A document whose overview is ordinary prose is left
 * alone, and so is one with no second heading (nothing to fall back to).
 * WHERE THE EVIDENCE GOES. Checked after the fact rather than assumed: only 44
 * of the 240 repaired documents carry a `## Code Evidence` section, so it is
 * NOT true that every one keeps the same text further down. What is true is
 * that the observations remain on the entity in the knowledge graph (the
 * document is a rendering, not the record), and the code references themselves
 * survive in the document's prose — RegisteredHookLifecycle.md still names
 * hooks-api.js six times across its Architecture and Implementation sections.
 * What is removed is the unreadable verbatim dump, not the knowledge.
 *
 * Usage:
 *   node scripts/strip-insight-overview-dump.mjs           # dry run (default)
 *   node scripts/strip-insight-overview-dump.mjs --apply   # rewrite in place
 */

import fs from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');
const DIR = path.join(process.cwd(), 'knowledge-management', 'insights');
const out = (m = '') => process.stdout.write(`${m}\n`);

/** Machine-tag markers the generator emits at the head of an observation. */
const TAG = /^\[[A-Z][A-Za-z ]+\]/;

function repair(text) {
  const lines = text.split('\n');
  const typeIdx = lines.findIndex((l) => l.startsWith('**Type:**'));
  if (typeIdx === -1) return null;

  // First non-empty line after the **Type:** line.
  let start = typeIdx + 1;
  while (start < lines.length && lines[start].trim() === '') start += 1;
  if (start >= lines.length) return null;
  if (!TAG.test(lines[start].trim())) return null; // ordinary prose — leave it

  // The blob runs until the next markdown heading.
  let end = start;
  while (end < lines.length && !lines[end].startsWith('# ')) end += 1;
  if (end >= lines.length) return null; // no real document follows — keep it

  const kept = [...lines.slice(0, typeIdx + 1), '', ...lines.slice(end)];
  return kept.join('\n');
}

if (!fs.existsSync(DIR)) {
  out(`no insights directory at ${DIR}`);
  process.exit(1);
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.md'));
let changed = 0;
let skipped = 0;
let bytes = 0;

for (const f of files) {
  const p = path.join(DIR, f);
  const before = fs.readFileSync(p, 'utf8');
  const after = repair(before);
  if (after === null || after === before) { skipped += 1; continue; }
  changed += 1;
  bytes += before.length - after.length;
  if (changed <= 5) out(`  ${APPLY ? 'strip' : 'would strip'}  ${f}  (-${before.length - after.length} chars)`);
  if (APPLY) fs.writeFileSync(p, after, 'utf8');
}

if (changed > 5) out(`  … and ${changed - 5} more`);
out('');
out(`documents scanned : ${files.length}`);
out(`${APPLY ? 'stripped' : 'would strip'}          : ${changed}`);
out(`left alone        : ${skipped}`);
out(`prose removed     : ${bytes} chars`);
if (!APPLY) out('\nDry run. Re-run with --apply.');
