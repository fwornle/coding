---
phase: 77-experiment-spec-per-variant-snapshot-foundation
reviewed: 2026-07-03T09:50:27Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - lib/experiments/experiment-spec.mjs
  - lib/experiments/evidence-harness.mjs
  - lib/experiments/experiment-restore.mjs
  - scripts/measurement-start.mjs
  - scripts/experiment-restore.mjs
  - config/experiments/example-experiment.yaml
  - tests/experiments/experiment-spec.test.mjs
  - tests/experiments/measurement-start-variant.test.mjs
  - tests/experiments/experiment-restore.test.mjs
findings:
  critical: 1
  warning: 4
  info: 3
  total: 8
status: issues_found
---

# Phase 77: Code Review Report

**Reviewed:** 2026-07-03T09:50:27Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Reviewed the phase-77 experiment foundation: a pure YAML spec resolver/validator
(`experiment-spec.mjs`), a variant-aware measurement-start CLI (`measurement-start.mjs`),
and the per-cell snapshot-restore determinism orchestrator (`experiment-restore.mjs`)
wiring `lib/repro/restore-snapshot.mjs`.

Shell-safety validation (`SHELL_META_RE`), the D-06 aggregated fail-fast, the CLI
exit-code contract, and the digest manifest sort-order are all implemented soundly and
well-tested at the unit level. However, the central determinism guarantee (D-11/D-12)
has a **BLOCKER**: `digestRestoredState` hashes the *entire* restored
`knowledge-graph/` directory, which — once the real Phase-67 rig runs — contains a
freshly-written LevelDB store whose bytes are wall-clock/non-deterministic. The unit
suite masks this because every test injects a stub restore that never invokes km-core.
As wired, two repeats of an identical variant will almost always digest DIFFERENTLY and
`assertRepeatsIdentical` will spuriously abort the run — the opposite of the intended
"prove identical starting conditions" contract.

Four warnings and three info items follow.

## Critical Issues

### CR-01: Determinism digest hashes non-deterministic LevelDB bytes → every real run spuriously aborts

**File:** `lib/experiments/experiment-restore.mjs:124-138` (with `restoreForCell:165`)
**Issue:**
`restoreForCell` sets `kbDir = path.join(res.sandboxDataDir, 'knowledge-graph')` and
`digestRestoredState` then calls `listFilesRecursive(kbDir)`, hashing EVERY file under
that directory. In production the sandbox `knowledge-graph/` is populated by the real
rig: `restore-snapshot.mjs` → `hydrateSandbox` (`lib/repro/kb-capture.mjs:107-139`)
opens a `GraphKMStore` with `dbPath = <sandbox>/knowledge-graph/leveldb` and
`debounceMs:0`, then `open()`/`close()`. A clean km-core `close()` fires `persistGraph`,
writing LevelDB artifacts (`LOG`, `MANIFEST-NNNNNN`, `CURRENT`, `*.ldb`, `LOCK`) into
`leveldb/`. LevelDB's `LOG` embeds wall-clock timestamps and MANIFEST numbering/sequence
bytes are not stable across opens — this is *exactly* the "leveldb/ is byte-exact only
mid-write, the JSON export is the canonical restore source" caveat documented in
`kb-capture.mjs:26-36` and CLAUDE.md ("km-core node_modules patch").

Consequently two repeats restored from the *same* baseline snapshot will produce
DIFFERENT digests, `assertRepeatsIdentical` (`:184-200`) throws, and
`runVariantRepeats` / the CLI abort with exit 1 (D-12) on a run that actually restored
correctly. The determinism proof is unusable against the live rig.

The unit tests do not catch this: every test in
`tests/experiments/experiment-restore.test.mjs` and the `EXPERIMENT_RESTORE_FAKE` CLI
seam inject a stub restore that writes only a static `general.json` — km-core / LevelDB
never runs, so the digest is trivially stable. The failure only surfaces with the real
`restoreSnapshot`.

**Fix:** Digest only the canonical, deterministic restore source (the JSON export),
never the LevelDB working files. Hash `knowledge-graph/exports/general.json`
specifically (and/or the raw captured export), not the whole `knowledge-graph/` tree:

```js
// restoreForCell — point the digest at the canonical export, not the leveldb/ dir:
const kbExport = path.join(res.sandboxDataDir, 'knowledge-graph', 'exports', 'general.json');
const settingsPath = path.join(res.sandboxDataDir, 'llm-settings.json');
const digest = digestRestoredState({ kbExport, settingsPath, worktree: res.worktree });

// digestRestoredState — hash the single canonical file (hashFileOrAbsent), OR if a dir
// walk is retained, exclude the leveldb/ subtree in listFilesRecursive:
if (e.isDirectory()) {
  if (e.name === 'leveldb') continue; // non-deterministic LevelDB working files
  out.push(...listFilesRecursive(dir, childRel));
}
```

Add at least one integration-level test that drives the real `restoreSnapshot`
twice from one snapshot and asserts identical digests, so the stub can never again hide
this.

## Warnings

### WR-01: Explicit `variants: []` resolves to ZERO cells with no error (violates the stated invariant)

**File:** `lib/experiments/experiment-spec.mjs:241-243`
**Issue:** When a spec carries an explicit empty `variants: []`, `Array.isArray(parsed.variants)`
is true, `cells = [].map(...) === []`, `validateCells([])` finds no errors, and
`resolveExperimentSpec` returns `{ cells: [] }` — an empty matrix with zero runs. This
directly contradicts the module's own documented invariant ("the cartesian product must
never collapse to zero cells", `:41-44`). The `axes:` path is protected (an empty axis
falls back to a `DEFAULT_AXIS` sentinel, `:107`), but the `variants:` escape hatch is not.
Downstream the CLI produces a confusing "available variants: " (empty list) message.
**Fix:** After resolving `cells`, guard against emptiness:
```js
if (cells.length === 0) {
  throw new Error(`experiment spec resolved to zero cells — 'variants:' is empty (path: ${pathLabel})`);
}
```

### WR-02: The KNOWN_AGENTS "divergence test" does not actually compare against the route-trace source

**File:** `tests/experiments/experiment-spec.test.mjs:165-167` (claim at `lib/experiments/experiment-spec.mjs:36-39`)
**Issue:** The comment on `KNOWN_AGENTS` states "a divergence test in the suite asserts
it equals the route-trace set", and the test is titled "equals the route-trace-resolve
SoT set". But the test compares against a hardcoded literal `['claude','copilot','opencode']`,
not the actual `KNOWN_AGENTS` in `lib/experiments/route-trace-resolve.mjs:23` (which is
module-private and not exported). If the route-trace set ever changes, this test stays
green — it provides zero real drift protection, contrary to its stated purpose.
**Fix:** Export `KNOWN_AGENTS` from `route-trace-resolve.mjs` and import it into the test
for a genuine equality assertion, e.g.:
```js
import { KNOWN_AGENTS as ROUTE_TRACE_AGENTS } from '../../lib/experiments/route-trace-resolve.mjs';
assert.deepEqual([...KNOWN_AGENTS].sort(), [...ROUTE_TRACE_AGENTS].sort());
```

### WR-03: `--repeats 1` reports "byte-identical" and exits 0 — a vacuous determinism "proof"

**File:** `scripts/experiment-restore.mjs:83-99`, `lib/experiments/experiment-restore.mjs:212-221`
**Issue:** The CLI accepts any `repeats >= 1`. With `--repeats 1`, `runVariantRepeats`
restores a single cell and `assertRepeatsIdentical` (which cannot diverge with one entry)
returns the lone digest; the CLI prints "1 repeats byte-identical" and exits 0. A single
sample proves nothing about determinism, yet the operator gets an unconditional success
signal — misleading for the very contract (D-11/D-12) this tool exists to enforce.
**Fix:** Require at least two repeats for a determinism run:
```js
if (!Number.isInteger(repeats) || repeats < 2) {
  process.stderr.write(`error: --repeats must be >= 2 to prove determinism (got '${repeatsArg}')\n`);
  process.exit(2);
}
```

### WR-04: `gitHead` fail-soft to '' lets a broken git read masquerade as a matching restore

**File:** `lib/experiments/experiment-restore.mjs:96-104,125`
**Issue:** `gitHead` returns `''` on any non-clean `git rev-parse` (error, non-zero
status, timeout). `digestRestoredState` then uses `resolvedSha = gitSha || gitHead(...) || ''`.
If the git read fails identically across every repeat (e.g. the worktree was never a valid
checkout, or `git` timed out), all repeats digest with `git_sha:` empty and therefore
*match* — `assertRepeatsIdentical` passes and the run reports success even though the
restored git state was never actually verified. A determinism assertion must not treat a
failed read as "identical". (In the current happy path the worktree is always a valid
checkout, so this is latent, but it silently degrades the guarantee.)
**Fix:** Distinguish "no worktree provided" from "git read failed". When a `worktree` is
supplied but `gitHead` returns '', surface it — either throw, or fold a sentinel
(`git_sha:<unreadable>`) that differs from a genuine empty so a broken read cannot pass
as a match.

## Info

### IN-01: `coercePositiveInt` silently swallows invalid/zero/negative `repeats`

**File:** `lib/experiments/experiment-spec.mjs:73-77,235`
**Issue:** `repeats: 0`, `repeats: -3`, or `repeats: "abc"` all silently fall back to `1`
with no warning. A `repeats: 0` typo (operator intent "don't run") becomes a single run.
Given the module WARNs on unknown models/frameworks, a silent coercion of a malformed
`repeats` is inconsistent.
**Fix:** Emit a `process.stderr.write('WARN: ...')` when the raw value is present but not
a positive integer, mirroring the loose-dimension warnings.

### IN-02: Memoized `resolveSpec` ignores its path argument

**File:** `scripts/measurement-start.mjs:204-205`
**Issue:** `const resolveSpec = (p) => (cachedResolved ??= resolveExperimentSpec(p));`
caches on first call regardless of `p`. It works today because both call sites pass the
same `specPath`, but it is a latent bug: a future caller passing a second path would
silently receive the first spec's envelope.
**Fix:** Key the cache by path (`cache.get(p) ?? cache.set(p, resolveExperimentSpec(p))`)
or add a comment/assert that a single path is assumed.

### IN-03: Test-only fake-restore leaks tmp directories

**File:** `scripts/experiment-restore.mjs:55-69`
**Issue:** `makeFakeRestore` calls `fs.mkdtempSync` per invocation and never removes the
directory. Under the `EXPERIMENT_RESTORE_FAKE` seam each test run leaves `exp-restore-fake-*`
trees in `os.tmpdir()`. Harmless to correctness but accumulates litter across CI runs.
**Fix:** Track created roots and `fs.rmSync(root, { recursive: true, force: true })` on exit,
or document the seam as leaving temp artifacts by design.

---

_Reviewed: 2026-07-03T09:50:27Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
