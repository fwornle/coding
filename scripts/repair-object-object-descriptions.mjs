#!/usr/bin/env node

/**
 * Repair entity descriptions corrupted to "[LLM] [object Object]".
 *
 * CAUSE: `SemanticAnalysisAgent.autoTagObservations` typed its input as
 * `string[]` but the parse site casts the model's JSON without validating it
 * (`let parsed: { observations?: string[] } = JSON.parse(...)`). A model that
 * answered with OBJECTS type-checked fine; `tagPattern.test(obj)` stringified
 * to "[object Object]", missed, and the tagger emitted the literal string.
 * Twelve wave-analysis entities ended up with a description that was nothing
 * but seven repetitions of it. Fixed at the source by normalizeObservation();
 * this repairs what is already stored.
 *
 * RECOVERY SOURCE: these entities carry `metadata.validated_file_path`
 * pointing at their insight document under knowledge-management/insights/.
 * Its opening block (before the first `#` heading after the title) is the
 * architecture-notes text the description should have held. The content was
 * never lost — only the copy written into the graph.
 *
 * Entities with no readable document are REPORTED, not blanked: a description
 * that is visibly broken beats one silently emptied.
 *
 * Usage:
 *   node scripts/repair-object-object-descriptions.mjs          # dry run
 *   node scripts/repair-object-object-descriptions.mjs --apply
 */

import { readFileSync, existsSync } from 'node:fs';

const OBS_API = process.env.OBS_API_URL || 'http://localhost:12436';
const APPLY = process.argv.includes('--apply');
const out = (m = '') => process.stdout.write(`${m}\n`);

const entities = await (async () => {
  const r = await fetch(`${OBS_API}/api/v1/entities?limit=10000`, { signal: AbortSignal.timeout(300_000) });
  if (!r.ok) throw new Error(`GET entities -> ${r.status}`);
  return (await r.json()).data;
})();

const broken = entities.filter((e) => String(e.description ?? '').includes('[object Object]'));
out(`entities with a corrupted description: ${broken.length}`);

/**
 * Pull the lead paragraph(s) out of an insight document: everything between
 * the "**Type:** X" line and the next markdown heading. That is where the
 * generator writes the [Architecture Notes] block the description mirrors.
 */
function leadFromDocument(md) {
  const afterType = md.split(/^\*\*Type:\*\*.*$/m)[1];
  if (!afterType) return null;
  const lead = afterType.split(/^#\s/m)[0];
  const text = lead.trim();
  return text.length > 40 ? text : null;
}

let repaired = 0; const unrecoverable = [];
for (const e of broken) {
  const docPath = (e.metadata ?? {}).validated_file_path;
  const doc = docPath && existsSync(docPath) ? readFileSync(docPath, 'utf8') : null;
  const lead = doc ? leadFromDocument(doc) : null;
  if (!lead) {
    unrecoverable.push(`${e.name} (${docPath ? 'document unreadable' : 'no validated_file_path'})`);
    continue;
  }
  out(`  ${APPLY ? 'repair' : 'would repair'}  ${(e.name ?? '').padEnd(32).slice(0, 32)}  ${lead.length} chars from ${docPath.split('/').pop()}`);
  repaired++;
  if (!APPLY) continue;

  const r = await fetch(`${OBS_API}/api/v1/entities/${e.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      description: lead,
      metadata: {
        ...(e.metadata ?? {}),
        descriptionRepairedAt: new Date().toISOString(),
        descriptionRepairedFrom: 'insight-document',
      },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) {
    out(`    FAILED ${r.status} ${(await r.text()).slice(0, 140)}`);
    repaired--;
  }
}

out('');
out(`${APPLY ? 'repaired' : 'would repair'}: ${repaired}`);
if (unrecoverable.length > 0) {
  out(`left visibly broken (no recovery source): ${unrecoverable.length}`);
  for (const u of unrecoverable) out(`  - ${u}`);
  out('  (re-run wave-analysis for these — a blanked description hides the problem)');
}
if (!APPLY) out('\nDry run. Re-run with --apply.');
