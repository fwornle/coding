/**
 * The phantom store does not come back.
 *
 * Four openers each built their own GraphKMStore. Three addressed
 * `.data/knowledge-graph-migrated/` — a directory that exists nowhere: not in
 * the repo, not at the data home, not in the container. So the entity WRITER
 * (`create_ukb_entity_with_insight`) wrote where nothing reads, and
 * `refresh_entity` scored entities against an empty graph. Phase 42.2 Plan 05
 * collapsed that directory into the canonical one and reverted ONE opener's
 * path; the other three were missed for four months.
 *
 * These are source assertions rather than behavioural ones on purpose: the
 * failure mode is a path literal reappearing in a 3000-line file during an
 * unrelated edit, which no runtime test over a working store would catch.
 *
 * Comments are stripped before asserting, because the fixed sites quote the
 * idiom they removed in order to explain why — exactly the pattern
 * tests/features/lsl-redirect-gating.test.mjs uses.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO = process.env.CODING_REPO || new URL('../..', import.meta.url).pathname;
const SUBMODULE = join(REPO, 'integrations/semantic-analysis/src');

/** Every .ts under the submodule's src, excluding tests. */
function sources(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sources(p, acc);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) acc.push(p);
  }
  return acc;
}

/**
 * Lines with comments removed. Block comments are handled statefully because the
 * explanatory headers in these files are long and quote the removed code.
 *
 * LINE comments are stripped FIRST, and that order is load-bearing. These files
 * are full of prose like `// requests hitting /api/v1/* before the store opens`,
 * and a stripper that looks for `/*` first sees the one in `/api/v1/*`, finds no
 * closing `*&#47;` on the line, and swallows everything to the next one — which
 * silently hid the real sse-server.ts construction from this very suite until the
 * "exactly two places" assertion failed with only one.
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
    // Line comments first — see the note above.
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

function hits(files, re) {
  const found = [];
  for (const f of files) {
    for (const { n, text } of codeLines(f)) {
      if (re.test(text)) found.push(`${relative(REPO, f)}:${n}: ${text.trim()}`);
    }
  }
  return found;
}

// CI checks out without submodules (private; see .github/workflows/tests.yml):
// nothing to scan there, so the suite is skipped rather than crashing at import.
const CHECKED_OUT = existsSync(SUBMODULE);
const FILES = CHECKED_OUT ? sources(SUBMODULE) : [];

describe('the phantom store does not come back', { skip: !CHECKED_OUT && 'semantic-analysis submodule not checked out' }, () => {
  test('no source addresses .data/knowledge-graph-migrated', () => {
    const found = hits(FILES, /knowledge-graph-migrated/);
    assert.deepEqual(found, [], `that directory exists nowhere:\n${found.join('\n')}`);
  });

  test('no source falls back to process.cwd() for the repo root', () => {
    // In-container the semantic-analysis cwd is .../integrations/semantic-analysis,
    // so this put the LevelDB in the container's writable layer and pointed
    // ontologyDir at a directory that does not exist. Use repositoryRoot().
    const found = hits(FILES, /REPOSITORY_PATH\s*\|\|\s*process\.cwd\(\)/);
    assert.deepEqual(found, [], `use repositoryRoot() from data-paths:\n${found.join('\n')}`);
  });

  test('a GraphKMStore is constructed in exactly two places', () => {
    // sse-server owns the hosted store; km-store-host opens a private one when
    // there is no host. A third opener is a second LevelDB handle on one
    // directory, which means two in-memory graphs both rewriting the whole
    // graph on close.
    const found = hits(FILES, /new\s+(?:km\.)?GraphKMStore\s*\(/);
    const where = found.map((h) => h.split(':')[0]).sort();
    assert.deepEqual(
      [...new Set(where)],
      [
        'integrations/semantic-analysis/src/sse-server.ts',
        'integrations/semantic-analysis/src/storage/km-store-host.ts',
      ],
      `unexpected store construction:\n${found.join('\n')}`,
    );
  });

  test('adapter.close() is called only from km-store-host', () => {
    // THE landmine. `GraphKMStore.close()` persists the WHOLE graph
    // (persistOnClose defaults true) and then closes the LevelDB handle — the
    // adapter comment claiming it was a no-op was four months stale. Calling it
    // on a BORROWED store takes down the handle sse-server serves /api/v1 from.
    // AcquiredStore.release() knows whether the store is ours to close.
    const found = hits(FILES, /\badapter\s*\.\s*close\s*\(|\bacquired\.adapter\.close\s*\(/);
    const where = [...new Set(found.map((h) => h.split(':')[0]))];
    assert.deepEqual(
      where,
      ['integrations/semantic-analysis/src/storage/km-store-host.ts'],
      `go through AcquiredStore.release():\n${found.join('\n')}`,
    );
  });

  test('no source passes a tenant name as a km-core domain', () => {
    // `domains` is a TOPIC slot ('development-workflow', 'pattern-analysis').
    // A tenant there matched nothing, and it made the export FILENAME depend on
    // the scope — so every colleague got a permanently empty bucket.
    const found = hits(FILES, /domains\s*:\s*\[/);
    assert.deepEqual(found, [], `omit domains entirely:\n${found.join('\n')}`);
  });
});

describe('the curated ontology dir is a real superset', () => {
  test('every ontology in .data/ontologies is present under obs-api/', () => {
    // wave-controller's comment claimed this for months while it was false: the
    // dir was missing six ontologies, so a standalone run and an in-process run
    // read the same database through different vocabularies. km-core throws on
    // an unresolvable class, so this is load-bearing now that the tool handlers
    // borrow the hosted store.
    const parent = join(REPO, '.data/ontologies');
    const curated = join(parent, 'obs-api');
    const want = readdirSync(parent, { withFileTypes: true })
      .filter((e) => !e.isDirectory() && e.name.endsWith('.json'))
      .map((e) => e.name)
      .sort();
    const have = new Set(
      readdirSync(curated).filter((n) => n.endsWith('.json')),
    );
    const missing = want.filter((n) => !have.has(n));
    assert.deepEqual(missing, [], `missing from obs-api/: ${missing.join(', ')}`);
  });

  test('every curated entry is readable and parses', () => {
    const curated = join(REPO, '.data/ontologies/obs-api');
    for (const n of readdirSync(curated).filter((f) => f.endsWith('.json'))) {
      const p = join(curated, n);
      // statSync follows the symlink, so a dangling one throws here.
      assert.ok(statSync(p).isFile(), `${n} is not a readable file`);
      JSON.parse(readFileSync(p, 'utf8'));
    }
  });
});
