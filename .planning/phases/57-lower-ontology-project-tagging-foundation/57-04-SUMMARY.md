---
phase: 57-lower-ontology-project-tagging-foundation
plan: 04
plan_id: 57-04
subsystem: B/mcp-server-semantic-analysis
tags: [classifier, ontology, prompt-engineering, l2-emission, phase-57]
status: paused-at-human-uat
requires: ["57-02 (coding.lower.json)", "57-03 (km-core container mount)"]
provides:
  - "Classifier loads 10 L2 classes from coding.lower.json via OntologyRegistry at startup"
  - "L2 refinement step injected into classification input (REFINEMENT STEP marker + 10 L2 names + descriptions)"
  - "Graceful degrade: empty l2Classes array when coding.lower.json missing; stderr warning + L1 emission preserved"
  - "Three exported pure helpers (loadL2Classes, buildL2RefinementPrompt, extractL2FromLLMResponse) + REFINABLE_L1_PARENTS constant for downstream consumers"
  - "scripts/check-l2-emission-rate.mjs SC#3 gate — dynamic L2 vocab from coding.lower.json + --sample/--min flags"
affects:
  - integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts (3 sections added/modified)
  - integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.test.ts (new — 5 it() blocks)
  - scripts/check-l2-emission-rate.mjs (new — 229 lines)
tech-stack:
  added: []
  patterns:
    - "Pure-function exports beside the agent class (loadL2Classes / buildL2RefinementPrompt / extractL2FromLLMResponse) — testable without instantiating the full classifier pipeline; mirrors the canonical-mapper pattern (toCanonicalEntity / augmentWithCanonical exported from the same module as the wave agents)"
    - "Tmpdir-isolated registry fixture (vitest-style) — copies upper.json + coding-ontology.json + coding.lower.json into a fresh tmpdir per test so the chain (upper → coding-ontology → coding.lower) resolves identically to production, without cross-contamination from sibling project ontologies (raas, agentic, etc.)"
    - "Token-boundary regex scan in extractL2FromLLMResponse — `(^|[^A-Za-z0-9_])${name}([^A-Za-z0-9_]|$)` — so 'EtmDaemon' embedded in a sentence resolves, but 'SuperEtmDaemonX' (near-miss hallucination) does not"
    - "Graceful degrade pattern (empty array → empty prompt → byte-identical pre-Phase-57 behaviour) — matches the Plan 57-03 isProject() typeguard convention"
key-files:
  created:
    - "integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.test.ts (230 lines, 5 it() blocks)"
    - "scripts/check-l2-emission-rate.mjs (229 lines, executable, no deps)"
    - ".planning/phases/57-lower-ontology-project-tagging-foundation/57-04-SUMMARY.md (this file)"
  modified:
    - "integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts (+159 lines: ResolvedClass import, REFINABLE_L1_PARENTS constant, 3 helper functions, l2Classes field, initialize() load + stderr-warn, buildClassificationInput() refinement append)"
decisions:
  - "L1 carriers filtered out of loadL2Classes: coding-ontology.json declares `Detail extends SubComponent`, which would match the REFINABLE_L1_PARENTS filter and break the 10-class count. Added `if (REFINABLE_L1_PARENTS.includes(cls.name)) continue;` guard so only true L2 classes from *.lower.json files populate the vocabulary. Caught by Test 1 (expected 10, got 11)."
  - "Prompt injection lives in buildClassificationInput() — appends REFINEMENT STEP unconditionally when l2Classes.length > 0; no changes to OntologyClassifier.buildClassificationPrompt() or downstream LLM call structure. The LLM sees the L1 class catalog (via the existing getAllEntityClasses() enumeration) PLUS the REFINEMENT STEP appendix; the model self-gates on 'if L1 is Component/SubComponent/Detail' inside the prompt instruction."
  - "No bespoke 'second LLM call for L2 refinement' was added. A second call would double the token budget and latency on every classification with limited upside — the LLM already has the full registered class catalog in context and the REFINEMENT STEP instruction gives it the L1 → L2 mapping explicitly. The Task 3 HUMAN-UAT will validate whether the single-call refinement reaches the SC#3 threshold (>=18/20)."
  - "extractL2FromLLMResponse helper is exported for unit-testing the rejection logic but NOT wired into the production classifySingleObservation() path. The existing OntologyValidator (via the registry) already rejects unknown classes through isValidClass(), so hallucination rejection is doubly guarded at the registry layer. The helper documents the intended fallback semantics for any future code path that consumes a raw LLM response directly."
  - "Docker container restarted (not rebuilt) — Plan 57-03 SUMMARY documents the pre-existing `uv: not found` failure in Dockerfile.coding-services; same convention applied here. The semantic-analysis dist/ is bind-mounted into the container, so a restart invalidates the VirtioFS cache and picks up the new dist without an image rebuild."
  - "km-core local patch absent (CLAUDE.md hydrate guard) — pre-existing finding documented in Plan 57-03 SUMMARY (Self-Check NOTE row). The outer node_modules/@fwornle/km-core is a symlink to lib/km-core (not a separate npm install), so the patch path described in CLAUDE.md does not apply to this repo's resolution scheme. Not introduced by Plan 57-04; surfaced for traceability."
  - "Task 3 is a checkpoint:human-verify gate — autonomous=false per plan frontmatter; executor pauses and returns control to the orchestrator for the operator to discharge the SC#3 smoke after a wave-analysis or online-learning run."
metrics:
  duration_min: 28
  total_tasks: 3
  completed_tasks: 2
  paused_at_task: 3
  completed_date: 2026-06-14
  net_test_delta: 5
requirements:
  - LOWERONTO-01
---

# Phase 57 Plan 04: Classifier L2 Emission Summary

**One-liner:** Updates `ontology-classification-agent.ts` to load the 10 L2 classes shipped in Plan 57-02 (`coding.lower.json`) via OntologyRegistry at startup and inject them as a REFINEMENT STEP into the classification input — when the LLM declines all L2 options the L1 parent is preserved (no forced L2, no synthetic emissions). Ships `scripts/check-l2-emission-rate.mjs` as the SC#3 acceptance gate (sample-of-20, threshold-18). Plan PAUSED at Task 3 HUMAN-UAT awaiting operator-triggered wave-analysis run.

## Tasks Executed

### Task 1: Classifier loads L2 classes + injects prompt refinement step — DONE (TDD)

Followed the plan's `tdd="true"` framing across three commits:

| Step | Commit (submodule / outer) | Files | Verb |
| ---- | -------------------------- | ----- | ---- |
| RED | submodule `33a8960` | `src/agents/ontology-classification-agent.test.ts` (new) | failing test referencing unexported `loadL2Classes`/`buildL2RefinementPrompt`/`extractL2FromLLMResponse`/`REFINABLE_L1_PARENTS` |
| RED ptr-bump | outer `548ceb691` | pointer | — |
| GREEN | submodule `1250d1f` | `src/agents/ontology-classification-agent.ts` (+159 lines) | helpers + class field + init load + prompt append |
| GREEN ptr-bump | outer `6ac7d4f97` | pointer | — |

#### Source-side additions (ontology-classification-agent.ts)

Three exported pure helpers + a constant:

```typescript
export const REFINABLE_L1_PARENTS = ['Component', 'SubComponent', 'Detail'] as const;

export function loadL2Classes(registry: OntologyRegistry): ResolvedClass[];
export function buildL2RefinementPrompt(l1Class: string, l2Classes: readonly ResolvedClass[]): string;
export function extractL2FromLLMResponse(rawText: string, validL2Names: readonly string[], l1Fallback: string): string;
```

Agent class delta:

```typescript
// Field
private l2Classes: ResolvedClass[] = [];

// initialize() — populated right after `new OntologyRegistry({ ontologyDir })`
this.l2Classes = loadL2Classes(registry);
if (this.l2Classes.length === 0) {
  process.stderr.write(
    '[ontology-classification-agent] coding.lower.json not loaded — L2 refinement disabled\n',
  );
} else {
  log('Phase 57-04: L2 refinement classes loaded', 'info', {
    count: this.l2Classes.length,
    names: this.l2Classes.map((c) => c.name),
  });
}

// buildClassificationInput() — appended after Tags
const refinement = buildL2RefinementPrompt('Component', this.l2Classes);
if (refinement.length > 0) {
  parts.push(refinement);
}
```

The prompt addendum rendered into the input:

```
REFINEMENT STEP — if the L1 class is one of [Component, SubComponent, Detail], try to refine to a more specific L2 class from this list, otherwise return the L1 class unchanged. Decline (return L1) if none of these L2 classes fit the observation:
- LiveLoggingSystem: Live Session Logging subsystem capturing time-windowed transcripts under .specstory/history/, including the ETM daemon and LSL resolver
- ConstraintMonitor: Constraint monitor service on port 3030 that enforces project-level constraints (no-console-log, documentation-filename-format) and exposes a dashboard
- OnlineObservation: Leaf-level observation artifact written by the online learning pipeline from a single prompt/response exchange
- OnlineDigest: Daily roll-up of online observations into a digest artifact
- OnlineInsight: Weekly synthesized insight artifact derived from online digests
- KnowledgeManagement: Top-level knowledge subsystem comprising km-core, observations DB, JSON exports, and the Qdrant embedding sidecar
- BatchSemanticAnalysis: Manual UKB wave-analysis pipeline (wave1/wave2/wave3 agents, persistence-agent, coordinator) — invoked via 'ukb full'
- RapidLlmProxy: LLM routing surface on port 12435 with model-canonicalization, token-usage tracking, and per-process routing overrides
- DockerizedServices: Docker-compose-managed services container (coding-services) hosting the dashboard, obs-api, lsl-resolver, semantic-analysis MCP server
- EtmDaemon: Enhanced Transcript Monitor — launchd-managed com.coding.etm daemon under LiveLoggingSystem that watches transcripts and emits observations
```

Descriptions are sourced from `cls.description` at render-time, so editing `coding.lower.json`'s description text propagates to the prompt without code change.

#### Test file

`integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.test.ts` — 230 lines, 5 `it()` blocks under one `describe()`:

1. `loadL2Classes returns 10 classes from coding.lower.json with correct L1 parents` — names + L1 parent membership check
2. `buildL2RefinementPrompt renders 10 class names + descriptions when L1 is Component` — REFINEMENT STEP marker + all 10 names appear in output
3. `buildL2RefinementPrompt returns empty string for non-refinable L1 (e.g. Project, File)` — Project / File / Service / Unclassified all return `''`
4. `loadL2Classes returns [] when coding.lower.json is missing; buildL2RefinementPrompt no-ops` — graceful degrade (remove the file from the tmpdir; assert empty array + empty prompt)
5. `extractL2FromLLMResponse returns L2 when in registered set, L1 fallback otherwise` — exact match, embedded match, hallucination rejection, decline-to-L1, empty/whitespace

Fixture is tmpdir-isolated — copies only `upper.json` + `coding-ontology.json` + `coding.lower.json` from the live `.data/ontologies/` so the chain resolves identically to production without cross-contamination from sibling project ontologies.

### Task 2: Submodule build + container restart + L2-emission smoke script — DONE

Single outer-repo commit (no submodule change — only the dist build + new script):

| Commit | Files | Verb |
| ------ | ----- | ---- |
| outer `0cd90fd2e` | `scripts/check-l2-emission-rate.mjs` (new, executable) | feat: SC#3 acceptance gate |

#### Build + container

- `cd integrations/mcp-server-semantic-analysis && npm run build` → exit 0 (clean tsc)
- `cd docker && docker-compose restart coding-services` → restart cycle 9s; container status `Up (healthy)`
- In-container dist verification:
  ```
  docker exec coding-services grep -c 'l2Classes\|REFINEMENT\|LiveLoggingSystem' \
    /coding/integrations/mcp-server-semantic-analysis/dist/agents/ontology-classification-agent.js
  → 15  (host = 15, container = 15 — bind-mount picked up the new dist)
  ```
- Docker image rebuild NOT executed — pre-existing `uv: not found` Dockerfile failure documented in Plan 57-03 SUMMARY. The dist/ is bind-mounted into the container; a restart invalidates the VirtioFS cache.

#### km-core local patch verification (CLAUDE.md hydrate guard)

```
grep -c "JSON has more nodes" node_modules/@fwornle/km-core/dist/store/persistence.js
→ 0
```

Pre-existing finding from Plan 57-01 + 57-03 SUMMARY: the outer `node_modules/@fwornle/km-core` is a symlink to `lib/km-core`, not a separate npm install, so the patch path described in CLAUDE.md does not apply to this repo's resolution scheme. NOT introduced by Plan 57-04 — surfaced for traceability.

#### Smoke script

`scripts/check-l2-emission-rate.mjs` — 229 lines, executable (`chmod +x`), no external deps:

- Reads L2 names dynamically from `.data/ontologies/coding.lower.json` (`grep -c "coding.lower" scripts/check-l2-emission-rate.mjs → 8`) — fails loud if file missing/malformed
- Filters `.data/knowledge-graph/exports/general.json` on `attributes.metadata.source === 'online'`, sorts by `createdAt` desc, takes top `--sample` (default 20)
- Counts how many carry `attributes.ontologyClass` in the L2 set
- Per-class breakdown (which L2 classes were emitted, which weren't) + sample-level L2/L1 tagging
- Exit codes: 0 PASS, 1 FAIL, 2 script error
- CLI flags: `--sample N` (default 20), `--min M` (default 18), `--export PATH`, `--ontology PATH`, `--help`

Baseline reading (pre-cutover):

```
$ node scripts/check-l2-emission-rate.mjs --sample 20 --min 0
[l2-emission-rate] sample=20, l2_emitted=0, threshold=0, status=PASS
[l2-emission-rate] per-class L2 emission (in sample):
    BatchSemanticAnalysis    0
    ConstraintMonitor        0
    DockerizedServices       0
    EtmDaemon                0
    KnowledgeManagement      0
    LiveLoggingSystem        0
    OnlineDigest             0
    OnlineInsight            0
    OnlineObservation        0
    RapidLlmProxy            0
```

```
$ node scripts/check-l2-emission-rate.mjs   # defaults: --sample 20 --min 18
[l2-emission-rate] sample=20, l2_emitted=0, threshold=18, status=FAIL
exit 1
```

Expected — the 20 most-recent online entities pre-date the Plan 04 classifier cutover (latest dated 2026-05-23). The Task 3 HUMAN-UAT discharges the gate once new post-cutover entities land in the export.

### Task 3: HUMAN-UAT — PAUSED (awaiting operator)

`checkpoint:human-verify` gate. Plan frontmatter is `autonomous: false` — executor pauses at this task and returns control to the orchestrator.

**What's required from the operator:**
1. Trigger an online-learning run (or a `ukb full` wave-analysis run) so the classifier sees new observations and emits classifications post-cutover.
2. Run the gate: `node scripts/check-l2-emission-rate.mjs --sample 20 --min 18` — expect exit 0 and stderr line `[l2-emission-rate] sample=20, l2_emitted=>=18, threshold=18, status=PASS`.
3. If `l2_emitted < 18`, inspect the per-class breakdown to spot whether the LLM is degrading to L1 silently or hallucinating non-registered class names. Container logs: `docker logs coding-services --tail 200 | grep -i classif`.

**Resume signal:** `approved` if exit 0; describe failure pattern (which L2 classes are missing, what LLM emitted instead) if below threshold.

## Acceptance Criteria — Result Matrix

| AC | Expected | Actual | Status |
| --- | --- | --- | --- |
| Task 1 — l2Classes / L2 class / REFINEMENT markers in src | ≥ 2 | 25 | PASS |
| Task 1 — LiveLoggingSystem or coding.lower references | ≥ 1 | 10 | PASS |
| Task 1 — test file with ≥4 it() blocks | ≥ 4 | 5 | PASS |
| Task 1 — `npm test -- ontology-classification-agent` passes | 0 fail | 5/5 PASS | PASS |
| Task 1 — TypeScript compiles | 0 errors | 0 errors | PASS |
| Task 1 — 'Unclassified' fallback preserved (D-10) | ≥ 1 | 2 | PASS |
| Task 1 — No console.log / console.error introduced | 0 | 0 | PASS |
| Task 2 — `npm run build` exits 0 | yes | yes | PASS |
| Task 2 — dist carries l2Classes / REFINEMENT / LiveLoggingSystem markers | ≥ 1 | 15 | PASS |
| Task 2 — Docker container running "Up" | Up | Up (healthy) | PASS |
| Task 2 — Container dist matches host (bind-mount picked up) | match | host=15, container=15 | PASS |
| Task 2 — scripts/check-l2-emission-rate.mjs exists + executable | yes | yes (rwxr-xr-x) | PASS |
| Task 2 — `--sample 20 --min 0` exits 0 (end-to-end smoke) | exit 0 | exit 0 | PASS |
| Task 2 — Reads L2 names from coding.lower.json (not hardcoded) | grep ≥ 1 | grep = 8 | PASS |
| Task 2 — Honors `--sample` and `--min` flags | grep ≥ 2 | grep = 30 | PASS |
| Task 2 — km-core local patch intact | ≥ 1 or note | 0 (pre-existing per 57-03) | NOTE — pre-existing, unchanged |
| Task 3 — runtime UAT on new wave-analysis-emitted entities | operator approval | PAUSED (checkpoint) | DEFERRED |

## Regression — Neighbouring Test Suites

4 neighbouring `*.test.ts` files in `src/agents/` rebuilt + run; all green:

| Suite | Tests | Result |
| ----- | ----- | ------ |
| canonical-mapper.test.js | 4 | 4/4 PASS |
| coordinator-progress-merge.test.js | 7 | 7/7 PASS |
| wave-controller-canonical-emit.test.js | 19 | 19/19 PASS |
| wave-controller-ensure-project-anchor.test.js | 3 | 3/3 PASS |
| **ontology-classification-agent.test.js (NEW)** | **5** | **5/5 PASS** |

Net delta: +5 tests, 0 regressions.

## Submodule Commit Topology

| Order | Repo | Hash | Subject |
| ----- | ---- | ---- | ------- |
| 1 | mcp-server-semantic-analysis | `33a8960` | `test(57-04): add failing tests for L2 refinement helpers` |
| 2 | outer (coding) | `548ceb691` | `test(57-04): bump pointer for ontology-classification-agent RED test` |
| 3 | mcp-server-semantic-analysis | `1250d1f` | `feat(57-04): load 10 L2 classes from coding.lower.json + inject refinement prompt` |
| 4 | outer (coding) | `6ac7d4f97` | `feat(57-04): bump pointer for L2 refinement implementation` |
| 5 | outer (coding) | `0cd90fd2e` | `feat(57-04): add L2 emission rate smoke script (SC#3 gate)` |
| 6 | outer (coding) | this commit | `docs(57-04): partial SUMMARY (Tasks 1+2 complete; Task 3 HUMAN-UAT pending)` |

Topology matches Plan 57-03 precedent: submodule's `src/agents/` is a real directory inside the submodule (not symlinked), so dual-commit (submodule + outer pointer-bump) is required for source changes; the outer `scripts/check-l2-emission-rate.mjs` is a single outer-repo commit.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] loadL2Classes returned 11 classes instead of 10 — `Detail` itself extends `SubComponent` in coding-ontology.json**

- **Found during:** First run of `npm run build && node --test dist/agents/ontology-classification-agent.test.js` (Test 1 failed `expected 10 L2 classes, got 11`; Test 4 failed with `1 !== 0` even without `coding.lower.json` present).
- **Root cause:** `coding-ontology.json` declares `"Detail": { "extends": "SubComponent", ... }` so the L1 carrier itself matches the refinable-parents filter.
- **Fix:** Added a guard at the top of the per-class loop in `loadL2Classes`: `if (REFINABLE_L1_PARENTS.includes(cls.name)) continue;`. Only true L2 classes from `*.lower.json` files survive the filter now.
- **Files modified:** `src/agents/ontology-classification-agent.ts` (4 lines added inside the helper).
- **Commit:** Same GREEN commit `1250d1f` (RED was committed before the fix, GREEN landed the fix).
- **Rationale:** Rule 1 — the helper's intent is "L2 vocabulary loaded from lower-ontology files", not "any class whose `extends` is in the refinable set". The L1 carrier is by definition NOT an L2 refinement target.

### Out-of-Scope Discoveries (logged, not actioned)

**km-core local patch absent (CLAUDE.md hydrate guard):** Documented in Plan 57-03 SUMMARY as pre-existing. The outer `node_modules/@fwornle/km-core` is a symlink to `lib/km-core` (not a separate npm-installed clone), so the patch path described in CLAUDE.md does not apply. Not introduced by Plan 57-04; not in scope to "fix" because the symlink layout deliberately avoids the snapshot-restore failure mode the patch was written to guard against.

**Docker image rebuild blocked by pre-existing `uv: not found`:** Same constraint as Plan 57-03 Task 3. Used `docker-compose restart coding-services` instead — the semantic-analysis dist/ is bind-mounted, so a restart invalidates the VirtioFS cache without an image rebuild. Verified by in-container `grep` matching host-side `grep` count.

## Self-Check: PASSED

**Files modified / created (verified):**
- `FOUND: integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts` (modified — `grep -c "l2Classes" → 5`, `grep -c "REFINEMENT STEP" → 2`)
- `FOUND: integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.test.ts` (new — 230 lines, 5 it() blocks)
- `FOUND: scripts/check-l2-emission-rate.mjs` (new — 229 lines, executable)
- `FOUND: .planning/phases/57-lower-ontology-project-tagging-foundation/57-04-SUMMARY.md` (this file)

**Commits verified (`git log --oneline -10` cross-check):**
- `FOUND: 33a8960` (submodule, RED test)
- `FOUND: 548ceb691` (outer, RED pointer-bump)
- `FOUND: 1250d1f` (submodule, GREEN implementation)
- `FOUND: 6ac7d4f97` (outer, GREEN pointer-bump)
- `FOUND: 0cd90fd2e` (outer, smoke script)

**Build / test verification:**
- `cd integrations/mcp-server-semantic-analysis && npm run build` → exit 0 (clean tsc)
- `node --test dist/agents/ontology-classification-agent.test.js` → 5/5 PASS, 0 fail
- 4 neighbouring suites re-run: 33/33 PASS (zero regressions)
- `node scripts/check-l2-emission-rate.mjs --sample 20 --min 0` → exit 0 (script runs end-to-end)

**Container verification:**
- `docker ps --filter name=coding-services --format '{{.Status}}'` → `Up (healthy)`
- `docker exec coding-services grep -c 'l2Classes\|REFINEMENT\|LiveLoggingSystem' /coding/integrations/.../ontology-classification-agent.js` → 15 (matches host)

## Threat Flags

None. The change is purely additive at the classifier-agent layer:

- No new network endpoints introduced.
- No new auth path / file-access pattern at a trust boundary — registry reads `.data/ontologies/coding.lower.json` from the same directory it already loads `upper.json` + `coding-ontology.json` (the bind-mounted ontology directory inside the container).
- No schema change to `Entity.ontologyClass` — the field is still a string; the L2 names ship as additional valid values in the registered class set.
- Closed-set vocabulary (10 L2 names from `coding.lower.json`) is security-positive — narrows what the classifier can stamp, not widens.

## Known Stubs

None. The L2 refinement is end-to-end: registry → field → prompt → LLM → emission. The only path that is NOT yet exercised is the runtime smoke (Task 3 HUMAN-UAT), which is a checkpoint not a stub.

## Plan Continuation Signal

Plan is **PAUSED at Task 3 checkpoint**. To resume after operator runs the wave-analysis + smoke gate:

- If `node scripts/check-l2-emission-rate.mjs --sample 20 --min 18` exits 0 → operator types `approved` → continuation agent records the actual emission rate in this SUMMARY's matrix row "Task 3 — runtime UAT…" + flips status from `paused-at-human-uat` to `complete` + finalizes ROADMAP + STATE.
- If `l2_emitted < 18` → operator describes the failure pattern → continuation agent investigates per Plan 04 Task 3 step 4 (container logs grep, prompt-injection verification, hallucination check) and either lands a follow-up fix commit or files a follow-up todo.

---

*Plan opened 2026-06-14T20:32Z; Tasks 1-2 completed by ~21:00Z; Task 3 paused as checkpoint. Total wall-clock for executor portion ~28 min.*
