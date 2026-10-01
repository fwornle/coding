/**
 * The tenant literal does not come back to the files that were converted.
 *
 * Production code answered "which tenant am I?" with the literal `'coding'` in
 * ~156 places. About half were real tenancy; those were converted to resolve the
 * install scope. This guards the converted files specifically — a repo-wide ban
 * would be wrong, because `'coding'` is also a legitimate display label, a
 * stop-word, and the name of this repo.
 *
 * Scoped to a CONSUMERS list rather than a glob, for the same reason
 * tests/features/lsl-redirect-gating.test.mjs is: the list is the statement of
 * what has been cleaned, and a new file is not retroactively in scope.
 *
 * Comments are stripped first — every converted site explains the idiom it
 * replaced, and those explanations quote it.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO = process.env.CODING_REPO || new URL('../..', import.meta.url).pathname;

/** Files whose tenancy was converted. Add a file here when you convert it. */
const CONSUMERS = [
  'src/retrieval/working-memory.js',
  'src/knowledge-management/KnowledgeQueryService.js',
  'src/knowledge-management/UKBDatabaseWriter.js',
  'lib/fallbacks/memory-fallback.js',
  'scripts/sync-graph-to-qdrant.js',
  'scripts/migrate-sqlite-to-kmcore.mjs',
  'integrations/semantic-analysis/src/tools.ts',
  'integrations/semantic-analysis/src/agents/coordinator.ts',
  'integrations/semantic-analysis/src/agents/wave-controller.ts',
  'integrations/semantic-analysis/src/sse-server.ts',
  'integrations/semantic-analysis/src/workflow-runner.ts',
  'integrations/semantic-analysis/src/agents/content-validation-agent.ts',
  'integrations/semantic-analysis/src/storage/km-store-host.ts',
];

/**
 * Lines with comments removed.
 *
 * Line comments are stripped BEFORE block comments. Prose like
 * `// requests hitting /api/v1/* before the store opens` contains `/*`, and a
 * stripper that looks for block comments first swallows the rest of the file —
 * which silently hid a real finding from tests/scope/phantom-store.test.mjs
 * until an assertion counted one site instead of two.
 */
function codeLines(file) {
  const out = [];
  let inBlock = false;
  readFileSync(file, 'utf8').split('\n').forEach((raw, i) => {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end === -1) return;
      line = line.slice(end + 2);
      inBlock = false;
    }
    const slash = line.indexOf('//');
    if (slash !== -1) line = line.slice(0, slash);
    for (;;) {
      const start = line.indexOf('/*');
      if (start === -1) break;
      const end = line.indexOf('*/', start + 2);
      if (end === -1) { line = line.slice(0, start); inBlock = true; break; }
      line = line.slice(0, start) + line.slice(end + 2);
    }
    if (line.trim()) out.push({ n: i + 1, text: line });
  });
  return out;
}

/**
 * Lines that keep the literal on purpose, each with the reason.
 *
 * Allowlisted by FILE plus a matching substring rather than by line number: a
 * line number rots on the first unrelated edit above it, and silently stops
 * guarding whatever moved into its place.
 */
const ALLOWED = [
  {
    file: 'integrations/semantic-analysis/src/tools.ts',
    match: "team: 'coding',",
    why:
      'getOntologyConfigManager default: this selects a shipped ONTOLOGY SCHEMA ' +
      '(.data/ontologies/lower/<team>-ontology.json), not a tenant tag on data. ' +
      'Only coding/raas/resi/ui ship one, so resolving it from the scope would ' +
      'point an arbitrary tenant at a file that does not exist and fail ' +
      'validation outright. The schema axis is a separate question from the ' +
      'data-tagging axis this suite guards.',
  },
];

function allowed(rel, text) {
  return ALLOWED.some((a) => a.file === rel && text.includes(a.match));
}

function hits(re) {
  const found = [];
  for (const rel of CONSUMERS) {
    const p = join(REPO, rel);
    if (!existsSync(p)) continue;
    for (const { n, text } of codeLines(p)) {
      if (re.test(text) && !allowed(rel, text)) found.push(`${rel}:${n}: ${text.trim()}`);
    }
  }
  return found;
}

describe('the tenant literal does not come back', () => {
  test('every CONSUMERS entry still exists', () => {
    // A renamed or deleted file must not silently drop out of the guard.
    const missing = CONSUMERS.filter((r) => !existsSync(join(REPO, r)));
    assert.deepEqual(missing, [], `update CONSUMERS: ${missing.join(', ')}`);
  });

  test('no `team: \'coding\'` or `team = \'coding\'`', () => {
    const found = hits(/\bteam\s*[:=]\s*['"]coding['"]/);
    assert.deepEqual(found, [], `resolve the scope instead:\n${found.join('\n')}`);
  });

  test('no `|| \'coding\'` / `?? \'coding\'` fallback', () => {
    const found = hits(/(?:\|\||\?\?)\s*['"]coding['"]/);
    assert.deepEqual(found, [], `resolve the scope instead:\n${found.join('\n')}`);
  });

  test('no constructor default of the tenant', () => {
    const found = hits(/\bteam\s*\??\s*:\s*string\s*=\s*['"]coding['"]/);
    assert.deepEqual(found, [], `take \`team?: string\` and resolve lazily:\n${found.join('\n')}`);
  });

  test('no wildcard coerced to the tenant', () => {
    // `team === '*' ? 'coding' : team` conflated "all tenants" with "one
    // specific one", which is how refresh_entity swept a single team while
    // reporting that it swept them all.
    const found = hits(/===\s*['"]\*['"]\s*\?\s*['"]coding['"]/);
    assert.deepEqual(found, [], `split the filter from the write tenant:\n${found.join('\n')}`);
  });

  test('no placeholder coerced to the tenant', () => {
    // The inverse, and the worse one: `=== 'default' ? 'coding'` TRANSLATED the
    // inert placeholder into this repo's tenant, so an unscoped install read and
    // wrote somebody else's knowledge base.
    const found = hits(/===\s*['"]default['"]\s*\?\s*['"]coding['"]/);
    assert.deepEqual(found, [], `let the placeholder stay itself:\n${found.join('\n')}`);
  });

  test('no tenant name passed as a km-core domain', () => {
    const found = hits(/domains\s*:\s*\[/);
    assert.deepEqual(found, [], `omit domains entirely — it is a topic slot:\n${found.join('\n')}`);
  });

  test('every allowlist entry still matches something', () => {
    // An allowlist entry whose line is gone is no longer documenting a decision,
    // it is just dead text that would silently permit a future reintroduction.
    for (const a of ALLOWED) {
      const p = join(REPO, a.file);
      assert.ok(existsSync(p), `allowlisted file missing: ${a.file}`);
      const found = codeLines(p).some(({ text }) => text.includes(a.match));
      assert.ok(found, `allowlist entry no longer matches — remove it: ${a.file} / ${a.match}`);
    }
  });
});
