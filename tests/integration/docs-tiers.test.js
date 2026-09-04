/**
 * Structural guards for the 3-tier documentation pages.
 *
 * Long pages under docs-content/ are split into "Quick", "Standard" and "Deep Dive" content
 * tabs. The tiers are markdown, so nothing about them is type-checked — every rule below is
 * one that would otherwise fail silently and publish a broken page while the build reports
 * success. That failure mode has bitten this repo twice already (see the gate essay in
 * .github/workflows/deploy-docs.yml), so the guards are structural rather than advisory.
 *
 * The rule that earns its keep most is the duplicate-heading one. Markdown does not know
 * about tabs: the toc extension sees all three tiers as one document, so a heading whose text
 * is reused in a later tier has its id renamed (#foo -> #foo_1). The Deep Dive tier is
 * rendered last and carries every anchor the site was linking to before it was tiered, so a
 * careless heading in Quick silently moves a Deep Dive anchor and breaks inbound deep links
 * with no warning anywhere. The docs of a sibling project have accumulated ~10 such ids.
 *
 * Companion guards, same reasoning, different surface:
 *   tests/integration/repo-path-portability.test.js
 *   tests/integration/launchd-plist-portability.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const DOCS = path.join(REPO, 'docs-content');
const TIERS = path.join(DOCS, '_tiers');

/**
 * The canonical tier labels, in the order they must appear.
 *
 * Exact strings rather than a loose pattern: `content.tabs.link` is enabled in mkdocs.yml,
 * which syncs tabs across pages BY LABEL TEXT and persists the choice. One page spelling a
 * tier differently silently opts out of that, so a reader who picked Quick lands on whatever
 * that page's first tab happens to be.
 */
const TIER_LABELS = ['⚡ Quick (~3 min)', '📖 Standard (~15 min)', '📚 Deep Dive (full)'];

const TAB_RE = /^=== "(.+)"$/;
const SNIPPET_RE = /^\s*--8<--\s+"(.+)"\s*$/;
/** ATX headings only, and never inside a fenced block (handled by the caller). */
const HEADING_RE = /^\s*(#{1,6})\s+(.+?)\s*$/;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

/**
 * Every page that opts into tiering.
 *
 * Detected by the presence of a tier LABEL, not by the presence of a tab marker. Content tabs
 * are used for other things here — getting-started/installation.md and index.md tab across
 * macOS/Linux/Windows — and those pages are not tiered and must not be held to tier rules.
 */
function tieredPages() {
  return walk(DOCS)
    .filter((f) => !f.startsWith(TIERS + path.sep))
    .filter((f) => {
      const text = fs.readFileSync(f, 'utf8');
      return TIER_LABELS.some((label) => text.includes(`=== "${label}"`));
    });
}

/**
 * Split a page into its tiers.
 *
 * Fenced code is tracked because a tab marker or a heading inside a ``` block is a literal —
 * this page set documents its own markup, so that case is real rather than theoretical.
 */
function parseTiers(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const tiers = [];
  let current = null;
  let fence = null;

  for (const [i, line] of lines.entries()) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0];
      else if (line.trimStart().startsWith(fence)) fence = null;
      // Lines are kept but flagged, because a tier's body is not only its headings and a
      // future rule may want the fenced text. `headings()` is what must ignore them.
      if (current) current.lines.push([i + 1, line, true]);
      continue;
    }
    if (current) current.lines.push([i + 1, line, Boolean(fence)]);
    if (fence) continue;

    const tab = TAB_RE.exec(line);
    if (tab) {
      current = { label: tab[1], line: i + 1, lines: [] };
      tiers.push(current);
    }
  }
  return tiers;
}

/** Heading text within a tier, normalised for comparison. */
function headings(tier) {
  return tier.lines
    .filter(([, , fenced]) => !fenced)
    .map(([n, line]) => [n, HEADING_RE.exec(line)])
    .filter(([, m]) => m)
    .map(([n, m]) => ({ line: n, text: m[2].replace(/\s+/g, ' ').trim() }));
}

/** Tier includes whose target does not exist under either snippets base_path. */
function missingIncludes(file, rel) {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((line, i) => [i + 1, SNIPPET_RE.exec(line)])
    .filter(([, m]) => m)
    // base_path in mkdocs.yml is [docs-content, docs], searched in that order.
    .filter(([, m]) => ![DOCS, path.join(REPO, 'docs')].some((b) => fs.existsSync(path.join(b, m[1]))))
    .map(([n, m]) => `${rel}:${n}: ${m[1]}`);
}

/** Heading text that appears in more than one tier of the same page. */
function headingClashes(file, rel) {
  const seen = new Map();
  const clashes = [];

  for (const tier of parseTiers(file)) {
    for (const h of headings(tier)) {
      const key = h.text.toLowerCase();
      const prev = seen.get(key);
      // Within one tier a repeat is the author's business and mkdocs' _1 suffix is correct.
      // Across tiers it silently renames an anchor readers already link to.
      if (prev && prev.label !== tier.label) {
        clashes.push(`${rel}:${h.line}: "${h.text}" also appears in ${prev.label} (line ${prev.line})`);
      } else if (!prev) {
        seen.set(key, { label: tier.label, line: h.line });
      }
    }
  }
  return clashes;
}

const PAGES = tieredPages();

describe('docs-content 3-tier pages', () => {
  test('at least one page is tiered (the guard is not silently vacuous)', () => {
    expect(PAGES.length).toBeGreaterThan(0);
  });

  test.each(PAGES.map((p) => [path.relative(REPO, p), p]))(
    '%s uses the canonical tier labels in order',
    (rel, file) => {
      const labels = parseTiers(file).map((t) => t.label);
      expect(labels).toEqual(TIER_LABELS);
    },
  );

  test.each(PAGES.map((p) => [path.relative(REPO, p), p]))(
    '%s: every --8<-- include resolves on disk',
    (rel, file) => {
      // check_paths is on, so mkdocs would also catch this — but only when someone runs a
      // build, and the failure it prints does not say which tier lost its body.
      expect(missingIncludes(file, rel)).toEqual([]);
    },
  );

  test.each(PAGES.map((p) => [path.relative(REPO, p), p]))(
    '%s: no heading text is reused across tiers',
    (rel, file) => {
      expect(headingClashes(file, rel)).toEqual([]);
    },
  );

  test('every tier partial is included by exactly one page', () => {
    const included = new Map();
    for (const page of PAGES) {
      const text = fs.readFileSync(page, 'utf8');
      for (const line of text.split('\n')) {
        const m = SNIPPET_RE.exec(line);
        if (!m) continue;
        const abs = path.join(DOCS, m[1]);
        included.set(abs, [...(included.get(abs) || []), path.relative(REPO, page)]);
      }
    }

    const partials = walk(TIERS);
    const orphans = partials
      .filter((p) => !included.has(p))
      .map((p) => path.relative(REPO, p));
    const shared = [...included.entries()]
      .filter(([, pages]) => pages.length > 1)
      .map(([p, pages]) => `${path.relative(REPO, p)} <- ${pages.join(', ')}`);

    // An orphan is dead weight that still gets hashed into the docs freshness manifest, so it
    // can trigger a rebuild of content nobody can reach.
    expect({ orphans, shared }).toEqual({ orphans: [], shared: [] });
  });
});

/**
 * Negative controls.
 *
 * Every rule above passes when it finds nothing, which is indistinguishable from a rule that
 * can no longer find anything — a regex that stopped matching after a label change, or a
 * parser confused by a fence. Each control feeds the rule a page that violates it and asserts
 * it complains. Probes are written to a temp dir, never to docs-content/, so a crashed run
 * cannot leave a broken page behind for mkdocs to publish.
 */
describe('the tier guards actually fire', () => {
  let dir;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-tiers-probe-'));
  });
  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const probe = (name, body) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, body);
    return file;
  };

  test('a mis-labelled tier is rejected', () => {
    const file = probe('labels.md', ['# P', '', '=== "Quick"', '', '    text', ''].join('\n'));
    expect(parseTiers(file).map((t) => t.label)).not.toEqual(TIER_LABELS);
  });

  test('a tier in the wrong order is rejected', () => {
    const file = probe(
      'order.md',
      [...TIER_LABELS].reverse().flatMap((l) => [`=== "${l}"`, '', '    text', '']).join('\n'),
    );
    expect(parseTiers(file).map((t) => t.label)).not.toEqual(TIER_LABELS);
  });

  test('a broken --8<-- include is reported', () => {
    const file = probe('include.md', ['=== "x"', '', '    --8<-- "_tiers/nope/missing.deep.md"', ''].join('\n'));
    expect(missingIncludes(file, 'probe')).toHaveLength(1);
  });

  test('a heading reused across two tiers is reported', () => {
    const file = probe(
      'clash.md',
      [
        `=== "${TIER_LABELS[0]}"`, '', '    ## Shared name', '',
        `=== "${TIER_LABELS[2]}"`, '', '    ## Shared name', '',
      ].join('\n'),
    );
    expect(headingClashes(file, 'probe')).toHaveLength(1);
  });

  test('a heading inside a fenced block is not mistaken for a real one', () => {
    // The tier pages document their own markup, so "## …" inside a fence is routine. Counting
    // it would make the clash rule fire on prose that renders no heading at all.
    const file = probe(
      'fence.md',
      [
        `=== "${TIER_LABELS[0]}"`, '', '    ```markdown', '    ## Shared name', '    ```', '',
        `=== "${TIER_LABELS[2]}"`, '', '    ## Shared name', '',
      ].join('\n'),
    );
    expect(headingClashes(file, 'probe')).toEqual([]);
  });
});
