---
phase: 71-experiment-kb-task-taxonomy
reviewed: 2026-06-24T00:00:00Z
depth: deep
files_reviewed: 9
files_reviewed_list:
  - lib/experiments/store.mjs
  - lib/experiments/taxonomy.mjs
  - lib/experiments/token-aggregate.mjs
  - lib/experiments/run-write.mjs
  - scripts/measurement-stop.mjs
  - scripts/experiments-query.mjs
  - scripts/experiments-classify.mjs
  - tests/experiments/enforcement.test.mjs
  - tests/experiments/run-write.test.mjs
  - tests/experiments/taxonomy.test.mjs
  - tests/experiments/token-aggregate.test.mjs
  - tests/experiments/ontology.test.mjs
  - config/task-taxonomy.yaml
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
warnings_resolved: 4
resolved_commits: [4bc9159a7, 200043c7b, 86679972d, 4a3320a4d]
resolved: 2026-06-24T00:00:00Z
status: resolved
---

> **Resolution (2026-06-24):** All 4 warnings fixed and committed atomically on `main` —
> WR-01 `4bc9159a7` (stable produces-edge key + re-close edge-count regression test),
> WR-02 `200043c7b` (blank interactive answer quarantines), WR-03 `86679972d` (loadTaxonomy
> null-guard), WR-04 `4a3320a4d` (confidence threshold ≥2 so lone bare-word match quarantines).
> Suite green: 32 tests, 31 pass, 0 fail, 1 EXPERIMENTS_LIVE-gated skip. The 3 info items remain
> as optional future polish.


# Phase 71: Code Review Report

**Reviewed:** 2026-06-24
**Depth:** deep
**Files Reviewed:** 9 source files + 5 test files + 1 config
**Status:** issues_found

## Summary

Phase 71 delivers the experiment KB and task-taxonomy layer: a dedicated km-core store
(`openExperimentStore`), the closed-6 taxonomy primitives, a read-only SQLite aggregator
over the proxy-owned `token-usage.db`, an idempotent `writeRun()`, and the three operator
CLIs (`measurement-stop`, `experiments-query`, `experiments-classify`).

The security-critical surface is clean: SQL injection is properly parameterized, the
`token-usage.db` is opened `{readonly:true, fileMustExist:true}`, the `ontologyDir` is
wired on every `GraphKMStore` construction, and `console.*` is absent from all files.
Resource cleanup via `try/finally store.close()` is present in every CLI, and the enum
gate (`isValidClass`) fires correctly on all write paths.

Four warnings were found. The most impactful is a genuine idempotency defect in
`writeRun()`: on a re-close the `produces` relation accumulates duplicate edges because
`addRelation` is called without a stable `key`, falling through to Graphology's multi-graph
`addEdge` which does not deduplicate. A second warning is a misleading prompt in the
interactive branch of `measurement-stop`: typing blank when a confident candidate is shown
**confirms** the candidate, not quarantines — directly contradicting the prompt text
"blank to quarantine". The remaining two warnings are a missing null-guard in
`loadTaxonomy()` and the `confident` property on `deriveClassFromText` being trivially
always true when `bestScore > 0`.

---

## Critical Issues

None found.

---

## Warnings

### WR-01: Duplicate `produces` edges accumulate on every re-close (idempotency defect)

**File:** `lib/experiments/run-write.mjs:130`

**Issue:** `addRelation({ type: 'produces', from: runId, to: outcomeId })` is called on
every invocation of `writeRun()`, including re-close. Because no `key` field is supplied,
`GraphKMStore.addRelation` falls through to `this.graph.addEdge(r.from, r.to, r)` — the
Graphology multi-graph `addEdge` adds a NEW parallel edge unconditionally, it does NOT
check for an existing identical edge. Each re-close appends one more `produces` edge
between the same Run and Outcome nodes.

The comment at line 129 correctly identifies the Graphology behavior ("multi-graph; a
duplicate edge is harmless for the v0 stub") and declares it acceptable, but "harmless"
is only true if no consumer iterates `findRelations({ type: 'produces', from: runId })`.
Any future consumer that counts or iterates those edges will observe N edges after N
re-closes instead of 1. The `run-write.test.mjs` SC-2 test asserts `rels.length === 1`
(line 185) but only for the first write; the re-close test (line 146) does not check
relation count, so the accumulation is not caught by the test suite today.

**Fix:** Assign a stable, deterministic edge key derived from `runId + outcomeId`:

```js
// lib/experiments/run-write.mjs  (step 5)
await store.addRelation({
  type:  'produces',
  from:  runId,
  to:    outcomeId,
  // Stable key → addRelation deduplicates on key collision (silent skip).
  // Without a key, Graphology addEdge creates a NEW parallel edge every call.
  key:   `${runId}:produces:${outcomeId}`,
});
```

Then add a post-re-close assertion to the idempotency test:

```js
// tests/experiments/run-write.test.mjs  (SC-2 re-close test, after second writeRun)
const rels = await store.findRelations({ type: 'produces', from: secondId });
assert.equal(rels.length, 1, 're-close must NOT add a duplicate produces edge');
```

---

### WR-02: Interactive "blank to quarantine" prompt confirms the candidate when one exists

**File:** `scripts/measurement-stop.mjs:160–162`

**Issue:** The prompt reads:

```
task_class [refactor] (one of: …; blank to quarantine):
```

The operator is told "blank to quarantine", but when a confident candidate is present
(`derived.confident === true`) and the operator types nothing, the logic at line 162
evaluates `chosen = answer || candidate` → `chosen = '' || 'refactor'` → `'refactor'`.
The empty entry silently accepts the candidate and writes `task_class='refactor'` with
`pending=false`. There is no way for the operator to quarantine a span that the heuristic
classified confidently, unless they deliberately type an invalid string and accept the
`exit(2)`.

This contradicts the documented D-06 guarantee that a deliberately unclassified span can
always be quarantined by the operator. The prompt text makes this worse: operators who
read "blank to quarantine" will be surprised when their blank entry does not quarantine.

**Fix:** Separate the "accept candidate" action (e.g. Enter or any blank) from
"quarantine" (e.g. a dedicated sentinel like `-` or `q`), or remove the candidate fallback
so blank always means quarantine regardless of whether a candidate exists:

```js
// Option A: blank always quarantines; operator must explicitly type the candidate to accept
const chosen = answer;       // NOT `answer || candidate`
if (!chosen) {
  taskClass = 'unclassified';
  pending = true;
} else if (!isValidClass(chosen, taxonomy)) { ... }
else {
  taskClass = chosen;
}

// And update the prompt text:
const hint = candidate ? ` (suggested: ${candidate})` : '';
`task_class${hint} (one of: …; blank to quarantine): `
```

This preserves D-06 quarantine reachability while still surfacing the candidate as a
suggestion rather than a default-on-blank.

---

### WR-03: `loadTaxonomy()` has no null-guard — throws TypeError on empty/malformed YAML

**File:** `lib/experiments/taxonomy.mjs:33–37`

**Issue:** `yaml.load()` returns `undefined` for an empty file and `null` for an explicit
YAML null document. `loadTaxonomy` then does `parsed.version` and `parsed.classes` without
checking whether `parsed` is an object, producing a misleading `TypeError: Cannot read
properties of undefined (reading 'version')`. Although the default path is a checked-in
file, `loadTaxonomy` accepts a caller-supplied `filePath` argument, making this exploitable
by a misconfigured test pointing at a wrong path.

Similarly, `deriveClassFromText(text, taxonomy)` at line 69 calls
`Object.entries(taxonomy.classes)` without guarding against `taxonomy.classes` being
`undefined`. If a caller passes `loadTaxonomy()` output where the YAML has no `classes`
key, this crashes.

**Fix:**

```js
// lib/experiments/taxonomy.mjs
export function loadTaxonomy(filePath = DEFAULT_TAXONOMY_PATH) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = yaml.load(raw);
  if (!parsed || typeof parsed !== 'object' || !parsed.classes) {
    throw new Error(
      `task-taxonomy YAML at '${filePath}' is empty or missing a 'classes' key`,
    );
  }
  return { version: parsed.version, classes: parsed.classes };
}
```

---

### WR-04: `confident` is trivially always true when `bestScore > 0` — dead logic branch

**File:** `lib/experiments/taxonomy.mjs:83`

**Issue:** The return value of `deriveClassFromText` is:

```js
return bestScore > 0
  ? { taskClass: best, confident: bestScore >= 1 }
  : { taskClass: null, confident: false };
```

The ternary's positive branch fires only when `bestScore > 0`, i.e. `bestScore >= 1`.
Inside that branch, `confident: bestScore >= 1` is therefore **always** `true` — the
condition `bestScore >= 1` is identical to the guard `bestScore > 0` (both are integers,
so `> 0` is the same as `>= 1`). The `confident` flag was presumably intended to
distinguish a single weak hit (`score === 1`) from a strong multi-hit. As written, even a
single keyword match marks the result as `confident: true`, meaning the headless
"confident → accept" branch in `measurement-stop.mjs` (line 176) is triggered by any
single-keyword overlap, including accidental matches on common words like "add", "fix",
or "new".

This causes over-eager auto-classification in headless mode. A task with the goal
"investigate and add a new endpoint" will match multiple classes at score 1 (debug=1 via
"investigate", new-feature=1 via "add"+"new"). The winner is non-deterministic among ties
(iteration order of `Object.entries`), and the result is accepted as confident with no
quarantine.

**Fix:** Introduce a meaningful threshold distinguishing a real signal from a lucky match:

```js
// lib/experiments/taxonomy.mjs
const CONFIDENT_THRESHOLD = 2; // require at least 2 keyword hits (or 1 hyphenated hit = +2)
return bestScore > 0
  ? { taskClass: best, confident: bestScore >= CONFIDENT_THRESHOLD }
  : { taskClass: null, confident: false };
```

Update `taxonomy.test.mjs` to cover the `confident: false` case for single-keyword inputs
and add a tie-breaking assertion (the current suite has no test where two classes score
equally).

---

## Info

### IN-01: `crypto` import in `measurement-stop.mjs` is not guarded — SHA-256 of the goal sentence runs even when overriding to a known class

**File:** `scripts/measurement-stop.mjs:51,188–190`

**Issue:** `task_hash` is computed unconditionally from `span.goal_sentence` using SHA-256
at line 188–190. When `--task-class` is supplied by an operator, the goal sentence is
still hashed, even though `task_hash` is only meaningful as a content-addressable key for
deduplication in the D-13 schema. This is not wrong but is wasted computation; more
importantly it means `task_hash` silently becomes `null` (line 190) for any span with no
`goal_sentence`, giving no indication to the caller that the dedup key is absent.

**Fix:** No code change required, but document in the JSDoc that `task_hash` is `null`
when `goal_sentence` is absent, and add a process.stderr warning when that happens so
operators are notified that D-13 dedup is degraded.

---

### IN-02: `ontologyStrict: false` in `store.mjs` silently degrades to noop on malformed ontology

**File:** `lib/experiments/store.mjs:47`

**Issue:** `ontologyStrict: false` means that if `experiment-ontology.json` contains a
malformed class definition, km-core logs a warning and skips it, leaving the experiment
registry with fewer classes than expected. In that state, a `putEntity` with
`entityType:'Run'` would succeed without validation — the strict-path comment in
`run-write.mjs` would no longer hold. The SC-1 test in `ontology.test.mjs` (line 110)
guards against this by asserting no "skipping malformed ontology file" warning appears.
That is the correct defense, but it only runs in tests, not at runtime.

**Fix:** Consider `ontologyStrict: true` so that a malformed ontology causes a hard failure
at store-open time rather than silent degradation. If the ontology file is trusted
(checked-in), strict mode is the right default. If you keep `ontologyStrict: false`, add
a startup check that verifies `store.ontology.isValidClass('Run') === true` and throw
before any write if it is not.

---

### IN-03: `parseStrArg` does not guard against a flag appearing as the last argv token (value is null)

**File:** `scripts/measurement-stop.mjs:67–71`, `scripts/experiments-query.mjs:35–39`, `scripts/experiments-classify.mjs:33–37`

**Issue:** `parseStrArg` returns `argv[i + 1] ?? null` when the flag is found. If the
operator runs `node scripts/measurement-stop.mjs --task-class` (flag present, value
absent), `argv[i+1]` is `undefined`, the null-coalescing returns `null`, and `explicit`
is `null` — the explicit-override branch is skipped entirely, and the CLI falls through to
interactive or headless mode as if no `--task-class` was given. There is no warning.
This is a silent no-op that could confuse operators.

**Fix:** When the flag is found but the next token is either absent or starts with `--`,
emit an error:

```js
function parseStrArg(argv, flag) {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  const val = argv[i + 1];
  if (val === undefined || val.startsWith('--')) {
    process.stderr.write(`error: ${flag} requires a value\n`);
    process.exit(2);
  }
  return val;
}
```

---

_Reviewed: 2026-06-24_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
