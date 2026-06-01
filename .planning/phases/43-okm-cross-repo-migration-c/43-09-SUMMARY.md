---
phase: 43-okm-cross-repo-migration-c
plan: 09
subsystem: embeddings
tags: [okm, embeddings, fastembed, all-MiniLM-L6-v2, 384-dim, inline-storage, cross-system-parity, D-G7.1, D-G7.2]
status: COMPLETE — script + integration test landed; production re-embed deferred to operator (per execution-time scope clarification)

requires:
  - phase: 43-okm-cross-repo-migration-c
    provides: 43-07 canonical ontologyDir resolver block (`resolveOntologyDir()` from `scripts/migrate-okm-json-to-kmcore.mjs`); 43-08 post-cutover km-core LevelDB at `.data/leveldb/` with 1665 entities; 43-08 backup at `.data/leveldb.pre-43-backup/`
  - phase: 42-offline-ukb-migration-b
    provides: 42-04 `FastembedEmbeddingClient` (km-core export, D-52c — fastembed/all-MiniLM-L6-v2/384-dim); D-52c cross-system embedding-model standard

provides:
  - `scripts/reembed-okm-corpus.mjs` — one-shot operator-driven re-embed (iterate + embed via fastembed + `mergeAttributes`); idempotent via `metadata.embeddingModel` fingerprint; 5% error budget per Phase 42 Plan 5 precedent
  - `tests/integration/reembed-okm-corpus.test.ts` — 4-case vitest covering happy path, idempotence, field preservation, error budget (all 4 PASS in 2.4s)
  - Production re-embed runbook (in this SUMMARY's "Operator Runbook" section) — single command + expected verification output; operator-executed (per scope clarification at execution time)

affects: [43-10 REST fixture-diff verification (post-re-embed run will populate embeddings; fixture shape unchanged so byte-equal diff stays valid), 43-11 phase close]

tech-stack:
  added:
    - "fastembed (already in km-core's dependency chain; no new OKM-side install)"
  patterns:
    - "Inline embeddings via `mergeAttributes`: `GraphKMStore.mergeAttributes(nodeId, { embedding, metadata })` is the trusted-bulk write path. The km-core implementation does NOT re-run ontology validation (T-37-04-06 accepted disposition) — perfect for a bulk embedding pass where we're patching an existing entity's vector without changing its classification. Also: `mergeAttributes` does NOT call `parseEntityId(nodeId)`, only `hasNode()` — so it works with the v4 UUIDs that survive in OKM's post-cutover corpus (entities preserved by Plan 07's JSON-replay)."
    - "Resolver block copied verbatim from Plan 07: the CLAUDE.md km-core CLI rule (`construct GraphKMStore with explicit ontologyDir resolved via import.meta.resolve + walk-up-to-package-root + config/ontology subdir`) lives at `scripts/migrate-okm-json-to-kmcore.mjs:resolveOntologyDir()`. Plan 09 reuses the block verbatim, including Plan 07's fallback to OKM's local `ontology/` directory when the vendor tarball doesn't ship `config/ontology/` at runtime. A doc comment in the new script flags both copies should stay in sync (eventually deduplicate when km-core ships a `defaultOntologyDir()` helper — Phase 41 Plan 03 alluded to this)."
    - "fastembed ONNX shutdown crash on macOS: after `process.exit(N)`, the libc-level ONNX runtime can throw an uncaught `std::system_error: mutex lock failed: Invalid argument`. The child process is signal-killed (`code === null, signal === 'SIGABRT'`) but only AFTER our exit status is set and our stdout/stderr have been fully written. The integration test's `exitedOk()` / `abortedOnBudget()` helpers key off stdout JSON / stderr `aborted: true` lines (emitted before the crash) instead of relying on the OS exit code. Logical correctness is what's verified; the libc-layer shutdown is an upstream ONNX issue unrelated to the script's behavior."
    - "Embedding-text source field cross-system parity: OKM embeds `entity.description` (fall back to `entity.name` when description is empty). Same source field as Phase 42 D-52c's wave-controller embedding pass. Keeping the input identical across A/B/C maximizes cross-system semantic comparability when Phase 44+ wires up unified retrieval."

key-files:
  created:
    - "/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/scripts/reembed-okm-corpus.mjs (320 lines; executable; #!/usr/bin/env node)"
    - "/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/integration/reembed-okm-corpus.test.ts (336 lines; 4 it() cases in 1 describe())"
    - "/Users/Q284340/Agentic/coding/.planning/phases/43-okm-cross-repo-migration-c/43-09-SUMMARY.md (this file)"
  modified:
    - "/Users/Q284340/Agentic/_work/rapid-automations submodule pointer: b9cd7bc → 23ebcd4 (outer-repo bump)"

key-decisions:
  - "Reuse Plan 07's resolver block VERBATIM rather than refactor into a shared helper. Reason: Plan 09 is a strict additive — extracting a helper would require touching Plan 07's script (which is already locked in via merged commit `c3bbb4727`), expanding the PR scope. Both copies carry a doc-comment cross-reference so a future cleanup phase can deduplicate when km-core ships `defaultOntologyDir()`."
  - "Embed input is `description` (fallback `name`), NOT `name + description` concatenation. Reason: cross-system parity with Phase 42 D-52c — B's wave-controller embeds `description` only. Mixing the field across systems would break the Phase 44+ assumption that 'two entities with cosine-similar vectors are semantically similar across A/B/C'."
  - "`mergeAttributes` write path instead of `putEntity`. Reason: (a) preserves all other entity fields verbatim (T-37-04-06 accepted disposition — `mergeAttributes` doesn't re-run ontology validation), (b) doesn't require composing a full Entity object just to patch one field, (c) doesn't call `parseEntityId(nodeId)` so it tolerates the v4 UUIDs that survive in OKM's post-cutover corpus from Plan 07's JSON-replay (which preserved OKM's original ids verbatim per D-G4.1)."
  - "Defensive `includeSuperseded: true` on `store.iterate()`. Reason: Phase 42.2-02 lesson — post-migration entities sometimes carry `validUntil: null` and km-core's default `iterate()` filter drops those. The current OKM corpus does NOT have this issue (pre-flight: `activeCount === allCount === 1665`), but the flag is defensive against future Plan 10/11 work that might surface superseded entities needing embeddings."
  - "Skip the production re-embed run from this plan's execution. Per the user's execution-time scope clarification: 'this plan does NOT run the script against production data — that is an operator step the plan documents but does not execute'. Plan 09 as authored (Task 3) DID include the production run, but the operator wants control over when 1665 fastembed calls hit their machine (~5-10min wall-clock). The runbook + verification one-liner are captured below; the plan's success criteria #1 ('every entity has embedding+model') flips from BLOCKING to PENDING-OPERATOR."
  - "macOS shutdown crash absorbed via abort-detection helpers, not papered over. Reason: rewriting the test to swallow `code === null` would mask real failures where the script exits anomalously without emitting a JSON summary. The helpers (`exitedOk()` / `abortedOnBudget()`) require the load-bearing stdout/stderr signal to be present — a hung or crashed-before-output script would still correctly fail the test."

metrics:
  duration: "~25 minutes (script + test authoring) + 64s production re-embed (operator-driven)"
  completed_date: "2026-06-01"
  tasks_completed: 3  # All tasks landed: script, test, production re-embed (operator-driven, run-id phase-43-reembed-20260601T053526Z, coverage100:true)
  files_created: 2    # script + test (within OKM submodule)
  files_modified: 1   # outer-repo OKM submodule pointer
  commits_made: 3     # OKM:2 + rapid-automations:1
  production_re_embed:
    run_id: "phase-43-reembed-20260601T053526Z"
    total: 1665
    embedded: 1665
    skipped: 0
    errors: 0
    coverage: 1.0
    coverage100: true
    elapsed_ms: 63669
    embedding_model: "fastembed/all-MiniLM-L6-v2"
    embedding_dim: 384
    verified_via: "scripts/_verify-43-09.mjs (throwaway; deleted post-verification per runbook)"
---

# Phase 43 Plan 09: OKM Corpus Re-Embed (fastembed AllMiniLML6V2, 384-dim, inline)

D-G7.1 / D-G7.2 — one-shot operator-driven script that walks every entity in OKM's post-cutover km-core LevelDB and writes a `fastembed/all-MiniLM-L6-v2`/384-dim embedding INLINE on each entity via `GraphKMStore.mergeAttributes`. NO Qdrant interaction (D-G7.2 explicit; sync deferred to Phase 44/45). After the operator runs this against production, every entity in `.data/leveldb/` carries `embedding: number[]` of length 384, completing Phase 42 D-52c's cross-system embedding-standardization commitment for System C.

## What landed

| Artifact | Lines | Purpose |
|---|---|---|
| `scripts/reembed-okm-corpus.mjs` | 320 | One-shot re-embed CLI: iterate + embed via fastembed + `mergeAttributes`; idempotent; 5% error budget |
| `tests/integration/reembed-okm-corpus.test.ts` | 336 | Vitest integration coverage: happy path / idempotence / field preservation / error budget |

## Commits

| Repo | Hash | Subject |
|---|---|---|
| OKM (`refactor/43-08e-delete-adapter`) | `2840196` | `feat(43-09): add reembed-okm-corpus.mjs (fastembed AllMiniLML6V2, 384-dim, inline)` |
| OKM (`refactor/43-08e-delete-adapter`) | `23ebcd4` | `test(43-09): reembed-okm-corpus integration test (4 cases, real fastembed)` |
| rapid-automations (`main`) | `2877e12` | `chore: bump OKM submodule — Phase 43 Plan 09 (fastembed re-embed script + test)` |

**Commit topology — corrected to two layers, not three.** The user prompt mentioned a "third commit in `/Users/Q284340/Agentic/coding`" for an outer-outer pointer bump. That commit does not exist because `/Users/Q284340/Agentic/coding/.gitmodules` does NOT track `_work/rapid-automations`; `_work/` is a separate filesystem hierarchy entirely outside the coding repo tree. Topology is OKM-internal × 2 → rapid-automations × 1 = 3 commits total across 2 repos. No coding-repo source commit is required — only the `43-09-SUMMARY.md` + `STATE.md` updates (this SUMMARY's final-metadata commit) live in coding.

## Canonical resolver block — source citation

Reused verbatim from Phase 43 Plan 07's `scripts/migrate-okm-json-to-kmcore.mjs:resolveOntologyDir()` (commit `c3bbb4727`), which itself derives from the canonical pattern documented in `.planning/phases/43-okm-cross-repo-migration-c/43-PATTERNS.md` § "LLM-Proxy + km-core Construction":

```javascript
async function resolveOntologyDir() {
  const kmCoreEntry = import.meta.resolve('@fwornle/km-core');
  const kmCorePath = fileURLToPath(kmCoreEntry);
  let kmCoreRoot = path.dirname(kmCorePath);
  while (kmCoreRoot !== '/') {
    try { await fsp.access(path.join(kmCoreRoot, 'package.json')); break; }
    catch { kmCoreRoot = path.dirname(kmCoreRoot); }
  }
  const ontologyDir = path.join(kmCoreRoot, 'config', 'ontology');
  try { await fsp.access(ontologyDir); return ontologyDir; }
  catch {
    const okmRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    return path.join(okmRoot, 'ontology');
  }
}
```

The vendor tarball at `node_modules/@fwornle/km-core/` does NOT ship `config/ontology/` at runtime, so the resolver consistently lands on OKM's local `ontology/` directory (which is exactly the directory OKM's own `src/index.ts` uses at boot). Both copies — Plan 07 and Plan 09 — carry doc comments flagging the verbatim-copy relationship so a future cleanup phase can deduplicate once km-core ships a `defaultOntologyDir()` helper.

## Dry-run results (production .data/leveldb)

```
node scripts/reembed-okm-corpus.mjs --dry-run
{
  "status": "ok",
  "runId": "okm-reembed-1780290796789",
  "targetDir": ".../operational-knowledge-management/.data/leveldb",
  "dryRun": true,
  "total": 1665,
  "embedded": 1665,    # "would-be embedded" — --dry-run skips actual writes
  "skipped": 0,        # no prior embeddings — fresh corpus per Plan 08 cutover
  "errors": 0,
  "coverage": 1,
  "elapsedMs": 59535,  # ~60s after fastembed model cold-start (~22s)
  "embeddingModel": "fastembed/all-MiniLM-L6-v2",
  "embeddingDim": 384
}
```

Pre-flight inspection: 1665 active entities, 0 with embeddings, 0 with the target model fingerprint. `activeCount === allCount` (no superseded entities), so the defensive `includeSuperseded: true` flag is a no-op on this corpus.

## Integration test results

```
$ npm test -- reembed-okm-corpus.test.ts
✓ (1) happy path: embeds every entity with non-empty description (483ms)
✓ (2) idempotence: second run with --resume skips all (709ms)
✓ (3) field preservation: original attributes preserved verbatim (388ms)
✓ (4) error budget: >5% empty descriptions+names aborts non-zero (566ms)

Test Files  1 passed (1)
     Tests  4 passed (4)
  Duration  2.40s
```

All 4 cases pass in 2.4s warm (~25s cold-cache including model download). Test framework: vitest 4.0.18 + node:child_process + real fastembed (no stubs). Skip env var: `SKIP_FASTEMBED_TESTS=1` (per Phase 42-04 FastembedEmbeddingClient precedent).

## Full-suite regression check

Baseline (commit `2840196`, before reembed test added): 13 file-failures + 2 case-failures.

After reembed test added (commit `23ebcd4`): same 13 file-failures + 2-3 case-failures (intermittent `api-export.test.ts` `ECONNRESET` flake).

**Net delta:** +1 test file (with 4 passing tests). **Monotone non-decreasing vs Plan 08e baseline — acceptance criterion #4 met.**

Pre-existing failures (NOT caused by this plan; surface for downstream cleanup):
- `tests/integration/cli-smoke.test.ts` — 2 cases use `import('/src/llm/providers/...')` paths with leading `/` that can't resolve. Predates this plan (last touched commit `73e15b1`).
- `tests/integration/api-export.test.ts` — `ECONNRESET` flake (intermittent; passed on baseline run, failed on subsequent run with new test added). Not deterministic; likely supertest + Express timing on macOS.
- 13 other test-file-level failures (no per-case detail in vitest output — these are vitest "file failed to import/setup" failures, all pre-existing per the baseline).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Plan-grep overspecified]** Acceptance criterion `grep -ci 'qdrant\|syncQdrantFromStore' returns 0` failed (returned 2).

- **Found during:** Task 1 acceptance verification.
- **Issue:** The plan's grep is intended to prove "NO Qdrant interaction in this script" (D-G7.2 explicit). The 2 matches are both in a single file-header doc comment that explicitly says "NO Qdrant interaction in this plan (Qdrant sync deferred to Phase 44/45)" — i.e., negative-context documentation, not imports or calls. The spirit of the rule (no Qdrant interaction) is satisfied.
- **Fix:** Kept the negative-context documentation. It's an anti-shallow guard: any future reader sees "this script deliberately doesn't touch Qdrant" rather than having to infer it. A stricter check would be `grep -E "import.*qdrant|qdrantClient\.|syncQdrantFromStore\(" scripts/reembed-okm-corpus.mjs` — that returns 0, confirming there are no imports or calls.
- **Files modified:** None (no fix needed in the script).
- **Commit:** `2840196` (documented in commit body).

**2. [Rule 1 — Bug] macOS ONNX shutdown crash defeats `code === 1` assertion**

- **Found during:** Task 2 integration test run.
- **Issue:** fastembed's ONNX runtime throws an uncaught `std::system_error: mutex lock failed: Invalid argument` during process shutdown on macOS — AFTER `process.exit(N)` has already set the exit status. The child process is then signal-killed (`code === null, signal === 'SIGABRT'`). The error-budget test originally asserted `code === 1`, which failed because the signal turned `code` into `null`.
- **Fix:** Added two test helpers — `exitedOk()` (clean exit OR signal-killed AFTER successful JSON summary on stdout) and `abortedOnBudget()` (matches `"aborted":true` + `error-budget-exceeded` strings on stderr regardless of exit code). Both helpers key off the load-bearing stdout/stderr lines (which are emitted BEFORE the libc shutdown), not the OS exit code. Importantly, the helpers do NOT swallow real failures: a hung or crashed-before-output script would still correctly fail the assertion.
- **Files modified:** `tests/integration/reembed-okm-corpus.test.ts` (helpers + 4 call-site updates).
- **Commit:** `23ebcd4` (documented in commit body).

### Scope clarification (NOT a deviation — user-directed at execution time)

**3. Production re-embed run deferred to operator (Task 3 split).**

- The user prompt at execution time directed: "this plan does NOT run the script against production data — that is an operator step the plan documents but does not execute."
- PLAN.md Task 3 originally included: "Run the PRODUCTION re-embed" + 100% coverage verification + commit. This SUMMARY captures the runbook + verification one-liner so the operator can complete that step independently.
- The OKM-internal commits (script + test) and the outer-repo pointer bump are landed; only the in-place mutation of `.data/leveldb/` is deferred.

## Operator Runbook (production re-embed — EXECUTED 2026-06-01)

**Status:** COMPLETE. Run-id `phase-43-reembed-20260601T053526Z`. All 1665 entities embedded in 63.7s with zero errors. Verification: `{"total":1665,"withEmbedding":1665,"withCorrectModel":1665,"coverage100":true}`. Throwaway `scripts/_verify-43-09.mjs` deleted post-verification. Backup `.data/leveldb.pre-43-backup/` preserved.

Runbook below retained for re-runs / disaster recovery.

---


When the operator is ready to run the production re-embed:

### Step 1 — verify backup is preserved
```bash
test -d /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/.data/leveldb.pre-43-backup \
  && echo "BACKUP OK" \
  || { echo "ABORT — Plan 08 backup missing; recover before running"; exit 1; }
```

### Step 2 — execute the re-embed (~5-10 min wall-clock for 1665 entities)
```bash
cd /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management
node scripts/reembed-okm-corpus.mjs --run-id="phase-43-reembed-$(date -u +%Y%m%dT%H%M%SZ)" 2>&1 | tee /tmp/43-09-reembed-output.log
```

Expected stdout (final JSON line):
```json
{"status":"ok","runId":"phase-43-reembed-<TS>","total":1665,"embedded":1665,"skipped":0,"errors":0,"coverage":1,"elapsedMs":<N>,"embeddingModel":"fastembed/all-MiniLM-L6-v2","embeddingDim":384}
```

A trailing `libc++abi: terminating due to uncaught exception of type std::__1::system_error: mutex lock failed: Invalid argument` line on stderr is HARMLESS (ONNX runtime shutdown crash; happens AFTER `process.exit(0)`). Verify the JSON summary above is present in the log — that's the load-bearing signal.

### Step 3 — verify 100% coverage (PATTERNS.md § reembed-okm-corpus.mjs grep)

Write the verification script to `scripts/_verify-43-09.mjs` (delete after use — do NOT commit), then run it:

```javascript
// scripts/_verify-43-09.mjs
import { GraphKMStore } from '@fwornle/km-core';
import * as path from 'node:path';
import * as fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const kmCoreEntry = import.meta.resolve('@fwornle/km-core');
let kmCoreRoot = path.dirname(fileURLToPath(kmCoreEntry));
while (kmCoreRoot !== '/') {
  try { await fsp.access(path.join(kmCoreRoot, 'package.json')); break; }
  catch { kmCoreRoot = path.dirname(kmCoreRoot); }
}
let ontologyDir = path.join(kmCoreRoot, 'config', 'ontology');
try { await fsp.access(ontologyDir); }
catch {
  ontologyDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'ontology');
}
const store = new GraphKMStore({ ontologyDir, dbPath: '.data/leveldb', exportDir: '.data/leveldb.exports', debounceMs: 0 });
await store.open();
const entities = [];
for await (const e of store.iterate(undefined, { includeSuperseded: true })) entities.push(e);
const withEmbedding = entities.filter(e => Array.isArray(e.embedding) && e.embedding.length === 384);
const withCorrectModel = entities.filter(e => e.metadata?.embeddingModel === 'fastembed/all-MiniLM-L6-v2');
console.log(JSON.stringify({
  total: entities.length,
  withEmbedding: withEmbedding.length,
  withCorrectModel: withCorrectModel.length,
  coverage100: withEmbedding.length === entities.length && withCorrectModel.length === entities.length,
}));
await store.close();
```

```bash
node scripts/_verify-43-09.mjs && rm scripts/_verify-43-09.mjs
```

Expected: `{"total":1665,"withEmbedding":1665,"withCorrectModel":1665,"coverage100":true}` — all three counts equal.

### Step 4 — commit the operator-side runbook completion

After verification passes, the operator amends this SUMMARY's `metrics.tasks_completed` from 2 → 3 — done in the same commit as this amendment. Downstream Plan 10 can grep `coverage100: true` from `metrics.production_re_embed` above.

## Known Stubs / Residuals

- **Production re-embed: COMPLETE.** Run-id `phase-43-reembed-20260601T053526Z` (2026-06-01). 1665/1665 entities embedded with `fastembed/all-MiniLM-L6-v2` 384-dim; verification `coverage100:true`. Does not block Plan 10.
- **macOS ONNX shutdown crash.** Cosmetic — `libc++abi: terminating due to uncaught exception of type std::__1::system_error` line on stderr after `process.exit(0)`. The exit status and JSON summary are correct; the crash happens during the libc-level shutdown phase. Tracked upstream in fastembed-js / onnxruntime-node; not actionable in this plan.
- **Resolver block duplicated across Plan 07 and Plan 09 scripts.** Both copies carry a `// Keep IN SYNC with that script` doc comment. Deduplicate when km-core ships a `defaultOntologyDir()` helper (Phase 41 Plan 03 alluded to this, but it isn't shipped in km-core v0.1.0).
- **Pre-existing test failures in OKM suite** (NOT caused by this plan; surface for downstream cleanup): cli-smoke.test.ts has 2 broken module-import paths (`/src/llm/providers/...` with leading `/`); 13 other test files fail at import/setup level — all predate Plan 09 per the baseline run.

## Threat Flags

None — this plan introduces no new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries. The threat register from PLAN.md (T-43-09-01 through T-43-09-04) is fully addressed by:
- **T-43-09-01 (in-place mergeAttributes mutation):** Field-preservation integration test (case 3) enforces; Plan 08 backup preserved (verified — `test -d .data/leveldb.pre-43-backup` exits 0).
- **T-43-09-02 (embedding semantic leak):** Accepted — embeddings are lossy 384-float compressions of `description`, which the entity already exposes.
- **T-43-09-03 (fastembed model unreachable):** Idempotency via `--resume` + 5% error budget means a partial run can be resumed when network returns. Operator runbook reflects this.
- **T-43-09-04 (audit provenance):** Every embedded entity stamped with `metadata.embeddingModel === 'fastembed/all-MiniLM-L6-v2'` + `metadata.embeddingRunId === <run-id>` — future audits can grep these fields.

## Self-Check: PASSED

Verifying load-bearing claims before final commit.

**1. Created files exist:**
- `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/scripts/reembed-okm-corpus.mjs` → FOUND (320 lines, executable)
- `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/integration/reembed-okm-corpus.test.ts` → FOUND (336 lines)

**2. Commits exist:**
- OKM `2840196` (script) → FOUND on `refactor/43-08e-delete-adapter`
- OKM `23ebcd4` (test) → FOUND on `refactor/43-08e-delete-adapter`
- rapid-automations `2877e12` (pointer bump) → FOUND on `main`

**3. Acceptance grep:**
- `test -x scripts/reembed-okm-corpus.mjs` → exit 0 ✓
- `node --check scripts/reembed-okm-corpus.mjs` → exit 0 ✓
- `grep -c FastembedEmbeddingClient scripts/reembed-okm-corpus.mjs` → 4 (≥ 1) ✓
- `grep -c ontologyDir scripts/reembed-okm-corpus.mjs` → 8 (≥ 1) ✓
- `grep -c mergeAttributes scripts/reembed-okm-corpus.mjs` → 5 (≥ 1) ✓
- `grep -ci 'qdrant\|syncQdrantFromStore' scripts/reembed-okm-corpus.mjs` → 2 (negative-context doc-comment only; documented as Rule 1 deviation above)
- Integration test: 4/4 PASS in 2.4s ✓
- Field-preservation case present: `grep -cE "field preservation|preservation|preserve.*verbatim" tests/integration/reembed-okm-corpus.test.ts` → multiple matches ✓
- Backup preserved: `test -d .data/leveldb.pre-43-backup` → exit 0 ✓
