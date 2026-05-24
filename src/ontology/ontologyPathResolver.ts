/**
 * ontologyPathResolver — layout-tolerant ontology JSON file resolver.
 *
 * Resolves `{kind, team?}` requests to an existing on-disk ontology JSON file,
 * probing BOTH layouts the codebase has used historically:
 *
 *   - two-tier (preferred):  `.data/ontologies/{upper,lower}/<canonical>.json`
 *   - flat (current reality): `.data/ontologies/<canonical>.json`
 *                              + `.data/ontologies/upper.json` historical alias
 *
 * Background (Phase 42.1.1):
 *   Phase 42.1's `validatePaths()` raised "Upper ontology not found …" because
 *   callers pass two-tier paths but JSON files live flat. The resolver lives
 *   inside the loader as a transparent layer so the 4 callers
 *   (tools.ts, ontology-classification-agent.ts, insight-generation-agent.ts,
 *   persistence-agent.ts) keep their existing path-construction code.
 *
 * Locked alias table (CONTEXT.md `<decisions>` § "Filename Aliases the
 * Resolver MUST Recognise"):
 *
 *   | Kind  | Two-tier (preferred)                                  | Flat fallback(s)                                          |
 *   |-------|-------------------------------------------------------|-----------------------------------------------------------|
 *   | upper | upper/development-knowledge-ontology.json             | development-knowledge-ontology.json, then upper.json      |
 *   | lower | lower/<team>-ontology.json                            | <team>-ontology.json                                      |
 *
 * Threat-model notes (T-42.1.1-01..04):
 *   - Team value is normalised via `path.basename(team)` before being substituted
 *     into the probe filename so `../foo-ontology.json` style traversal is blocked.
 *   - The dirname-walk that locates `.data/ontologies/` STOPS at the filesystem
 *     root and falls back to `<basePath>/.data/ontologies` so a malformed
 *     configHint cannot drive the resolver outside the project tree.
 *   - On miss, the error message lists EVERY probed absolute path so future
 *     layout drift produces an immediately actionable error (Phase 42.1 lost
 *     half a day because the original error reported only one path).
 *   - Cache keyed by `(kind, team, ontologyDir)` — bounded by the project's
 *     small finite team list × 2 kinds × ≤ a handful of base paths in practice.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Successful-resolution payload — also used as the structured-log shape so
 * operators can confirm which layout served the registry after the fact.
 */
export interface OntologyLayoutDetected {
  /** Absolute filesystem path of the resolved ontology JSON file. */
  resolvedPath: string;
  /** Which on-disk layout served the request. */
  layout: 'two-tier' | 'flat';
  /**
   * Which filename alias matched.
   *  - `canonical` = `development-knowledge-ontology.json` (upper) or `<team>-ontology.json` (lower)
   *  - `upper.json` = historical flat alias for upper (kind=upper only)
   */
  alias: 'canonical' | 'upper.json';
}

/**
 * Thrown when no probed path exists on disk. The message lists every absolute
 * path probed (one per line) so layout drift surfaces immediately.
 */
export class OntologyPathNotFoundError extends Error {
  constructor(
    public readonly kind: 'upper' | 'lower',
    public readonly team: string | undefined,
    public readonly probedPaths: string[],
  ) {
    const teamLabel = team ?? 'none';
    const lines = probedPaths.map((p) => `  - ${p}`).join('\n');
    super(
      `Ontology not found (kind=${kind}, team=${teamLabel}). Probed paths:\n${lines}`,
    );
    this.name = 'OntologyPathNotFoundError';
  }
}

/** Resolver input shape. */
export interface ResolveOntologyPathOptions {
  /** Which ontology to resolve. */
  kind: 'upper' | 'lower';
  /** Team identifier — required when kind='lower'. */
  team?: string;
  /**
   * Optional hint from the caller (e.g. the existing OntologyConfig string).
   * The resolver walks up from this path looking for `.data/ontologies` so
   * callers that pass two-tier strings keep working unchanged.
   */
  configHint?: string;
  /** Optional project root. Defaults to `process.cwd()`. */
  basePath?: string;
}

// ---------------------------------------------------------------------------
// Module-level state — cache + probe counter (test-only diagnostics).
// ---------------------------------------------------------------------------

/** Cache keyed by `${kind}::${team ?? ''}::${ontologyDir}`. */
const _cache: Map<string, OntologyLayoutDetected> = new Map();

/**
 * Test-only probe counter — incremented immediately before every fs.existsSync
 * call inside the resolver. Test 9 of ontologyPathResolver.test.ts uses this
 * to assert cache-hit semantics (zero new probes on a repeat call).
 *
 * Documented as test-only API; NOT part of the public resolver contract.
 */
let _probeCount = 0;

/**
 * Reset the test-only probe counter to zero. TEST USE ONLY.
 */
export function __resetProbeCounter(): void {
  _probeCount = 0;
}

/**
 * Read the current value of the test-only probe counter. TEST USE ONLY.
 */
export function __getProbeCount(): number {
  return _probeCount;
}

/**
 * Reset the resolver's module-level cache. Exposed for tests that want to
 * exercise the probe path on every call (e.g. fresh fixture per test).
 * Double-underscore prefix marks this as non-public API.
 */
export function __clearCache(): void {
  _cache.clear();
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * fs.existsSync wrapper that increments the test-only probe counter. ALL
 * existence checks in this module MUST route through this function so the
 * counter accurately reflects "work done" for Test 9.
 */
function probeExists(absPath: string): boolean {
  _probeCount += 1;
  return fs.existsSync(absPath);
}

/**
 * Locate the `.data/ontologies` ancestor directory.
 *
 * Strategy:
 *   1. If `configHint` is provided, walk up via `path.dirname` until a parent
 *      ends in `.data/ontologies` OR filesystem root is reached.
 *   2. Otherwise (or on walk failure), fall back to
 *      `path.resolve(basePath ?? process.cwd(), '.data/ontologies')`.
 *
 * The walk STOPS at root — it cannot escape the filesystem and cannot return
 * a directory above the project tree.
 */
function locateOntologyDir(opts: ResolveOntologyPathOptions): string {
  const fallback = path.resolve(opts.basePath ?? process.cwd(), '.data', 'ontologies');

  if (!opts.configHint) {
    return fallback;
  }

  const absoluteHint = path.isAbsolute(opts.configHint)
    ? opts.configHint
    : path.resolve(opts.basePath ?? process.cwd(), opts.configHint);

  let cursor = absoluteHint;
  // Walk upward until we hit a directory whose path ends in
  // `.data/ontologies` (the segment AND its parent), or the root.
  // Bounded by path depth — guaranteed to terminate.
  while (true) {
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      // hit filesystem root
      break;
    }
    if (
      path.basename(cursor) === 'ontologies' &&
      path.basename(parent) === '.data'
    ) {
      return cursor;
    }
    cursor = parent;
  }

  return fallback;
}

/**
 * Build the ordered probe list for a given (kind, team, ontologyDir).
 * Order matters — first existing file wins.
 */
function buildProbeList(
  kind: 'upper' | 'lower',
  team: string | undefined,
  ontologyDir: string,
): Array<{ path: string; layout: 'two-tier' | 'flat'; alias: 'canonical' | 'upper.json' }> {
  if (kind === 'upper') {
    return [
      // (a) two-tier
      {
        path: path.join(ontologyDir, 'upper', 'development-knowledge-ontology.json'),
        layout: 'two-tier',
        alias: 'canonical',
      },
      // (b) flat canonical
      {
        path: path.join(ontologyDir, 'development-knowledge-ontology.json'),
        layout: 'flat',
        alias: 'canonical',
      },
      // (c) flat alias
      {
        path: path.join(ontologyDir, 'upper.json'),
        layout: 'flat',
        alias: 'upper.json',
      },
    ];
  }

  // kind === 'lower' — team is required; normalise to bare basename so
  // `../foo-ontology.json` style traversal is blocked (T-42.1.1-01).
  if (!team) {
    throw new Error("resolveOntologyPath: kind='lower' requires a team value");
  }
  const safeTeam = path.basename(team);
  const lowerFile = `${safeTeam}-ontology.json`;
  return [
    {
      path: path.join(ontologyDir, 'lower', lowerFile),
      layout: 'two-tier',
      alias: 'canonical',
    },
    {
      path: path.join(ontologyDir, lowerFile),
      layout: 'flat',
      alias: 'canonical',
    },
  ];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve a `{kind, team?}` request to an existing on-disk ontology JSON file.
 *
 * @throws OntologyPathNotFoundError when no probed alias exists on disk. The
 *   error message lists every absolute path the resolver tried so layout drift
 *   produces an immediately actionable error.
 */
export function resolveOntologyPath(
  opts: ResolveOntologyPathOptions,
): OntologyLayoutDetected {
  const ontologyDir = locateOntologyDir(opts);

  // Sanitise team value for the cache key so the cache mirrors the
  // sanitisation applied in buildProbeList (`path.basename(team)`).
  const cacheTeam = opts.team ? path.basename(opts.team) : '';
  const cacheKey = `${opts.kind}::${cacheTeam}::${ontologyDir}`;
  const cached = _cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const probes = buildProbeList(opts.kind, opts.team, ontologyDir);
  const probed: string[] = [];
  for (const probe of probes) {
    probed.push(probe.path);
    if (probeExists(probe.path)) {
      const result: OntologyLayoutDetected = {
        resolvedPath: probe.path,
        layout: probe.layout,
        alias: probe.alias,
      };
      _cache.set(cacheKey, result);
      return result;
    }
  }

  throw new OntologyPathNotFoundError(opts.kind, opts.team, probed);
}
