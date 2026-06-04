---
phase: 44-rest-api-git-snapshots
plan: 11
subsystem: verification-gate
status: PARTIAL Task 1 evidence captured and committed; Task 2 (operator visual-smoke + restart-restore) AWAITING OPERATOR ACTION
tags:
  - phase-close-out
  - verification-gate
  - wave-0-stub-execution
  - cross-system-parity
  - snapshot-restore-roundtrip
  - autonomous:false
dependency_graph:
  requires:
    - phase: 44-07
      provides: A-side /api/v1 mount + /api/coding/* typed views (Phase 44 Plan 07)
    - phase: 44-08
      provides: B-side /api/v1 mount on coding-services SSE app (Phase 44 Plan 08)
    - phase: 44-09
      provides: C-side /api/v1 mount (OKM PR #5 UNMERGED, blocks C-leg evidence)
    - phase: 44-10
      provides: SQLite to km-core migration (post-migration, /api/coding/* typed views populated)
    - phase: 44-13
      provides: Writer-side dedup + Artifacts-patch cutover (eliminates this.db)
    - phase: 44-14
      provides: obs-api legacy /api/* endpoints cutover (10 endpoints) + countByOntologyClass + lastModifiedByClass + findByLegacyId helpers
  provides:
    - "Per-SC PASS/FAIL evidence with literal curl + test output (truncated to 500-byte excerpts)"
    - "Plan 44-11 Task 1 closes Step 1-6 of <behavior>; Task 2 surfaces the visual smoke + restart-restore cycle to operator"
  affects:
    - "ROADMAP.md Phase 44 closure - Task 2 operator approval gates the [x] checkbox flip"
    - "STATE.md Current Position - advances to Phase 45 only after Task 2 'approved'"
tech_stack:
  added: []
  patterns:
    - "Verification-as-source-of-truth - SUMMARY captures literal HTTP envelopes, not summaries"
    - "Spirit-vs-letter SC#3 - typed-views snake_case lock divergence documented for Task 2 operator decision"
    - "Per-system snapshot blocker triage - A (.gitignore), B (read-only /coding mount), C (no /api/v1 mount yet)"
key_files:
  created:
    - .planning/phases/44-rest-api-git-snapshots/44-11-SUMMARY.md
  modified: []
key-decisions:
  - "[Plan-44-11-1] SC#1 = PARTIAL PASS. A + B legs return shape-identical canonical envelopes ({success:true, data:{...}}) on /api/v1/stats and /api/v1/ontology/classes. C leg is still serving the VOKB SPA fallback (text/html) on every /api/v1/* probe - the cross-system-parity stub correctly flags this as the expected RED leg per STATE.md note 'Operator-merge OKM PR #5 + restart C's service for cross-system-parity C-leg GREEN'. SC#1 cannot fully close until OKM PR #5 lands + C restarts."
  - "[Plan-44-11-2] SC#2 = BLOCKED on all 3 legs. A's snapshot endpoint fails because `.data/knowledge-graph/exports/` is gitignored (`.data/knowledge-graph/*` rule at .gitignore:204). B's snapshot fails inside coding-services because `/coding/.git/index.lock` is read-only (container has /coding bind-mounted ro for git). C has no /api/v1 mount yet. The restore round-trip the plan expected is not executable from the verification gate alone - it surfaces 3 separate operator-owned remediations and a snapshot-path-routing decision."
  - "[Plan-44-11-3] SC#3 = PARTIAL PASS with shape-lock deviation. /api/coding/observations returns populated data with snake_case keys (id, agent, project, content, artifacts, timestamp, quality, session_id) - matches the Pitfall 2 lock. /api/coding/digests + /api/coding/insights return populated data BUT with camelCase keys (observationIds, filesTouched, digestIds, lastUpdated) instead of the typed-views.test.js-expected snake_case (observation_ids, files_touched, digest_ids, last_updated). 2 of 4 typed-views tests FAIL on this shape lock. The data is populated (post-Plan 44-10 migration GREEN); the shape mismatch is a real consumer-breakage divergence to flag for Task 2."
  - "[Plan-44-11-4] SC#4 = PASS. okb-guard-snapshot-bypass.sh exits 0; Case A rejects (exit=1) without OKB_SNAPSHOT=1, Case B bypasses (exit=0) with OKB_SNAPSHOT=1. The two-commit pattern is preserved structurally per Plan 44-04 SUMMARY; the mixed-commit reject demonstration is covered by the script."
  - "[Plan-44-11-5] Dashboard e2e Playwright spec at tests/e2e/dashboard-observations.spec.ts FAILS with timeout waiting for `data-testid='observations-table'` selector. The spec's own header acknowledges: 'Plan 44-11 will add this testid OR the spec must be relaxed during verification.' Plan 44-14 SUMMARY already documented visual smoke at :3032 with regular browser (counters 939/391/81 rendering numeric; no error banners; 60+ refresh cycles clean console). Task 2 owns the gsd-browser visual smoke with screenshot capture."
  - "[Plan-44-11-6] No verify-stub entities left in stores. The plan's Step 4 snapshot-mutate-restore cycle was meant to leave clean state via the restore wipe. Since snapshots failed on every leg, both verify-stub POSTs (A: id `019e9390-7009-7941-8d1c-a9a65a2b4b50`; B: id `019e9390-a623-7205-b29d-beb7aef8cc6b`) were DELETE'd manually to restore baseline counts (A 2213, B 2129)."
metrics:
  duration_min: 7
  started: 2026-06-04T16:50:00Z
  completed: 2026-06-04T16:57:00Z
  tasks_complete: 1_of_2
  task2_status: AWAITING OPERATOR
  files_created: 1
  files_modified: 0
  wave_0_stubs_run: 8_of_8
  wave_0_stubs_green: 5
  wave_0_stubs_red: 3
requirements-completed: []
---

# Phase 44 Plan 11: End-of-Phase Verification Gate Summary (TASK 1 PARTIAL)

**Eight Wave 0 stubs + 1 cross-system-parity test executed; per-SC verdict captured with literal HTTP envelopes; SC#1+SC#3 partial PASS, SC#2 blocked on snapshot-dir routing, SC#4 PASS - Task 2 (operator visual smokes + restart-restore cycle + per-SC sign-off) awaits operator action.**

## Performance

- **Duration:** ~7 min (Task 1 only)
- **Started:** 2026-06-04T16:50:00Z
- **Completed:** 2026-06-04T16:57:00Z (Task 1)
- **Tasks:** 1 of 2 (Task 2 = operator-owned checkpoint)
- **Files created:** 1 (this SUMMARY)
- **Files modified:** 0

## Status

| Task | Description | Status | Commits |
|------|-------------|--------|---------|
| 1 | Run 8 Wave 0 stubs + cross-system parity + per-SC evidence | COMPLETE | this commit |
| 2 | Operator visual UI smokes + restart-restore cycle + per-SC sign-off + ROADMAP/STATE update | AWAITING OPERATOR | -- |

**CHECKPOINT_REQUIRED:** Task 2 needs operator action. The orchestrator surfaces this checkpoint after Task 1 lands. Operator owns:

  1. gsd-browser visual smoke at `http://localhost:3032` (dashboard) + screenshot
  2. gsd-browser visual smoke at the VOKB viewer URL + screenshot
  3. Resolve the three SC#2 snapshot blockers (A gitignore-path, B read-only-mount, C no-/api/v1) OR defer SC#2 to a sub-plan
  4. Resolve the SC#3 typed-views snake_case-vs-camelCase shape divergence (either rewrite the test to camelCase if camelCase is the canonical post-Plan-10 contract, OR fix the typed-view handlers to emit snake_case per the legacy SQLite column names that CONTEXT A-4 mandates for "Zero consumer breakage")
  5. Approve or block ROADMAP Phase 44 closure

## Wave 0 Stub Run Results

The plan's Step 1-4 ran the 8 Wave 0 stubs + cross-system parity. Per-stub:

| # | Stub | System | Status | Counts | Notes |
|---|------|--------|--------|--------|-------|
| 1 | km-core/tests/integration/api-router.test.ts | km-core | GREEN | passed | supertest harness covers 15 canonical endpoints |
| 2 | km-core/tests/unit/contracts.test.ts | km-core | GREEN | passed | Zod accept-good / reject-bad |
| 3 | km-core/tests/integration/snapshot-roundtrip.test.ts | km-core | GREEN | passed | temp-git-repo fixture; create-mutate-restore-equal |
| 4 | km-core/tests/integration/observation-view.test.ts | km-core | GREEN | passed | km-core entity to legacy obs round-trip |
| 5 | tests/integration/cross-system-parity.mjs | A+B+C | RED (C leg) | 2 PASS / 4 FAIL | A+B return JSON; C returns text/html on every /api/v1/* probe |
| 6 | tests/integration/typed-views.test.js | A | PARTIAL | 2 PASS / 2 FAIL | obs row + filter PASS; digests + insights FAIL on snake_case keys |
| 7 | tests/integration/okb-guard-snapshot-bypass.sh | shell | GREEN | exit=0 | Case A rejects, Case B bypasses |
| 8 | tests/e2e/dashboard-observations.spec.ts | dashboard | RED | 3/3 timeout | missing data-testid="observations-table"; spec's own header acknowledges Plan 44-11 owns the resolution |

**Aggregate:** 4 GREEN km-core (26/26 vitest tests) + 1 GREEN okb-guard + 1 PARTIAL typed-views (2/4) + 1 RED cross-system (2/6 node:test pass) + 1 RED dashboard-observations (3/3 fail). Per-test detail in literal command output below.

## SC#1 -- Shape-Identical Responses Across A/B/C

**Verdict: PARTIAL PASS** (A + B GREEN; C blocked on OKM PR #5).

### Literal cross-system-parity output (head -c 500, unicode glyphs stripped)

```
[cross-system-parity] driving 3 services: A@http://localhost:12436/api/v1, B@http://localhost:3848/api/v1, C@http://localhost:3002/api/v1
[suite] cross-system /api/v1 parity (Phase 44 Wave 0 RED)
  PASS smoke: A /entities?limit=1 returns 200 (44.79675ms)
  PASS smoke: B /entities?limit=1 returns 200 (19.72425ms)
  FAIL smoke: C /entities?limit=1 returns 200 (10.34075ms)
  FAIL /entities?limit=1 returns same shape on A, B, C (3.866833ms)
  FAIL /stats returns same shape on A, B, C (1.997167ms)
  FAIL /ontology/classes returns same shape on A, B, C (1.744917ms)
tests 6 / pass 2 / fail 4

Error: Service C /entities?limit=1 returned non-JSON content-type 'text/html' --
       /api/v1 not mounted (expected RED until Plans 07/08/09)
```

### Per-leg /api/v1/stats samples (proves shape-identical for A+B)

```
A -> http://localhost:12436/api/v1/stats
{"success":true,"data":{"nodes":2213,"edges":0,"evidenceCount":1741,"patternCount":472,"orphanCount":2213,"islandCount":0,"componentCount":2213,"connectivity":0.00045187528242205153,"lastUpdated":"2026-06-04T16:56:57.066Z","activeSnapshot":null}}

B -> http://localhost:3848/api/v1/stats
{"success":true,"data":{"nodes":2129,"edges":0,"evidenceCount":1676,"patternCount":453,"orphanCount":2129,"islandCount":0,"componentCount":2129,"connectivity":0.0004697040864255519,"lastUpdated":"2026-06-04T16:56:57.078Z","activeSnapshot":null}}

C -> http://localhost:3002/api/v1/stats
HTTP=200 content-type=text/html (VOKB SPA fallback; /api/v1 NOT mounted on :3002)
```

### Per-leg /api/v1/ontology/classes samples

```
A -> http://localhost:12436/api/v1/ontology/classes
{"success":true,"data":["LearningArtifact","Observation","Digest","Insight"]}

B -> http://localhost:3848/api/v1/ontology/classes
{"success":true,"data":["File","Service","Feature","Project","Contract","RuntimeDiagnostics","StaticDiagnostics","Port","Config","Container","Process","Fault","Limitation","Revision","AgentFramework","RAGSystem","CommunicationProtocol","ModuleContent","Exercise","LabEnvironment","CourseModule","LLMProvider","VectorStore","ToolDefinition","PromptTemplate","AgentWorkflow","KnowledgeGraph","Evaluatio... (truncated)

C -> text/html (SPA fallback)
```

A's classes are the v7.1 Phase 41 set (LearningArtifact + Observation + Digest + Insight); B's classes are the much-larger semantic-analysis set. CONTEXT C-1 specifies "shape-identical responses against A, B, and C; only the data and ontology classes differ" - A+B both return `{success:true, data:[...]}` (shape match). C cannot be evaluated yet.

### SC#1 verdict

  * A+B legs: SHAPE-IDENTICAL on all 3 sampled endpoints (/stats + /entities + /ontology/classes)
  * C leg: cannot be evaluated; VOKB SPA intercepts every /api/v1/* probe
  * **OPERATOR ACTION (Task 2):** Merge OKM PR #5 then restart C's service so cross-system-parity C leg can be re-run

## SC#2 -- Snapshot Create then Mutate then Restore Round-Trip on A/B/C

**Verdict: BLOCKED on all 3 legs.** Three separate per-system blockers surfaced; the restore round-trip the plan envisioned is not executable from the verification gate.

### Per-system snapshot create attempts

| System | URL | POST Response | Blocker |
|--------|-----|---------------|---------|
| A | `POST http://localhost:12436/api/v1/snapshots` | `{"success":false,"error":"Command failed: git add -A -- \".data/knowledge-graph/exports/\"\nThe following paths are ignored by one of your .gitignore files:\n.data/knowledge-graph/exports\nhint: Use -f if you really want to add them."}` | `.gitignore:204` line `.data/knowledge-graph/*` excludes the snapshot dir. SnapshotManager would need `git add -f` OR CONTEXT S-1's `.data/exports/` dir would need to be the actual target (the obs-api server constructs SnapshotManager with `snapshotDir: KG_EXPORT_DIR` where `KG_EXPORT_DIR = .data/knowledge-graph/exports`, line 1159 + 1235 in `scripts/observations-api-server.mjs`). This is a path-routing mismatch between CONTEXT S-1 and the live binding. |
| B | `POST http://localhost:3848/api/v1/snapshots` | `{"success":false,"error":"Command failed: git add -A -- \".data/knowledge-graph/exports/\"\nfatal: Unable to create '/coding/.git/index.lock': Read-only file system"}` | The coding-services container has `/coding/.git` bind-mounted read-only. Snapshot creation from inside the container is structurally impossible. Either snapshot creation moves outside the container (host-side cron), or `/coding/.git` becomes writable, or B's snapshot endpoint targets its own `.git` inside the container. |
| C | `POST http://localhost:3002/api/v1/snapshots` | text/html (VOKB SPA fallback) | C has no /api/v1 mount yet (OKM PR #5 pending). |

### Per-system entity-POST + cleanup (verify-stub); proof writes work end-to-end

The plan's Step 4 also had us POST a verify-stub, then restore would wipe it. Since restore isn't executable, both verify-stubs were POSTed and then DELETEd manually:

| System | POST | Stats delta | DELETE | Stats post-cleanup |
|--------|------|-------------|--------|---------------------|
| A `http://localhost:12436/api/v1/entities` | HTTP 201, id `019e9390-7009-7941-8d1c-a9a65a2b4b50` | 2213 -> 2214 | HTTP 200 (`{"deleted":true}`) | 2213 |
| B `http://localhost:3848/api/v1/entities` | HTTP 201, id `019e9390-a623-7205-b29d-beb7aef8cc6b` | 2129 -> 2130 | HTTP 200 (`{"deleted":true}`) | 2129 |
| C `http://localhost:3002/api/v1/entities` | text/html (SPA fallback) | n/a | n/a | n/a |

This proves the canonical /api/v1/entities CRUD works on A + B end-to-end (POST + DELETE; stats reflect both mutations correctly). The snapshot/restore cycle is the only path that's blocked.

### SC#2 verdict

  * **Three operator-owned decisions surface in Task 2:**
    1. A: route SnapshotManager to a non-gitignored dir (`.data/exports/`?) OR add `git add -f`
    2. B: move snapshot creation host-side OR make `/coding/.git` writable inside coding-services
    3. C: merge OKM PR #5 then restart
  * **No restartCommand is recorded for Task 2:** none of the three legs returned `restartRequired: true` because no snapshot tags were created. The Task 2 plan-text mentioning `launchctl kickstart -k gui/$(id -u) com.coding.obs-api` / `docker-compose restart coding-services` / OKM-restart still applies for the verification phase OF the restore cycle IF the underlying snapshot blockers are first resolved.
  * **SC#2 cannot close at this gate** without resolving the three blockers OR splitting it into a sub-plan.

## SC#3 -- A's Typed Views (Legacy /api/coding/{observations,digests,insights})

**Verdict: PARTIAL PASS.** Data is populated post-Plan 44-10 migration. Observations row shape matches the Pitfall 2 lock. Digests + insights row shapes diverge on snake_case-vs-camelCase keys.

### Literal typed-views test output (tail)

```
PASS GET /api/coding/observations returns Pitfall 2 envelope + row shape (25 ms)
FAIL GET /api/coding/digests returns legacy digest shape (5 ms)
FAIL GET /api/coding/insights returns legacy insight shape (5 ms)
PASS GET /api/coding/observations?agent=claude&project=coding filters server-side (20 ms)

(*) /api/coding/digests row missing required key 'observation_ids' (Pitfall 2 shape lock)
(*) /api/coding/insights row missing required key 'digest_ids' (Pitfall 2 shape lock)

Test Suites: 1 failed, 1 total
Tests:       2 failed, 2 passed, 4 total
```

### Per-endpoint literal envelope (head -c 500)

```
GET http://localhost:12436/api/coding/observations?limit=1
{"data":[{"id":"c39fc799-8208-41d2-af9f-7d2dc34c9e55","agent":"claude","project":"coding","content":"Intent: Diagnose whether the observations database is down or unavailable.\nApproach: Query the SQLite observations database directly to check record count and latest timestamp...","artifacts":[],"timestamp":"2026-06-04T11:22:42.857Z","quality":"normal","session_id":"etm-5461-1780568439497"}],"total":939,"limit":1,"offset":0,"_metadata":{"fromColdStore":false,"source":"km-core"}}

GET http://localhost:12436/api/coding/digests?limit=1
{"data":[{"id":"6c2eae62-41f9-404e-8ef2-c692f7eab8c7","date":"2026-06-04","theme":"OKM vs km-core Wire Format Audit","summary":"...","observationIds":[...],"agents":[...],"filesTouched":[...]}]}
                                                                                                                            ^^^^^^^^^^^^^^                       ^^^^^^^^^^^^
                                                                                                                            camelCase                            camelCase

GET http://localhost:12436/api/coding/insights?limit=1
{"data":[{"id":"59be9148-4296-44a9-80d7-8278776c6d6d","topic":"System Health Dashboard","summary":"...","confidence":...,"digestIds":[...],"lastUpdated":"..."}]}
                                                                                                                                          ^^^^^^^^^      ^^^^^^^^^^^
                                                                                                                                          camelCase     camelCase
```

### Row-shape diff (literal keys list)

| Endpoint | Test expects | Server returns |
|----------|--------------|----------------|
| `/api/coding/observations` | `id, agent, project, content, artifacts, timestamp` | `agent, artifacts, content, id, project, quality, session_id, timestamp` (PASS; all expected keys present; quality + session_id are extras) |
| `/api/coding/digests` | `id, theme, summary, observation_ids, agents, files_touched` | `agents, createdAt, date, filesTouched, id, observationIds, project, quality, summary, theme` (FAIL; snake_case `observation_ids` + `files_touched` missing; camelCase counterparts present) |
| `/api/coding/insights` | `id, topic, summary, confidence, digest_ids, last_updated` | `confidence, createdAt, digestIds, id, lastUpdated, project, summary, topic` (FAIL; snake_case `digest_ids` + `last_updated` missing; camelCase counterparts present) |

### Acceptance grep evidence (plan's `agent|project|content` >= 3 check)

```
$ curl -s "http://localhost:12436/api/coding/observations?limit=1" | python3 -c "
  import json, re, sys
  d = json.load(sys.stdin)
  matches = re.findall(r'\\b(agent|project|content)\\b', json.dumps(d))
  print('total matches:', len(matches))"
total matches: 3
```

All 3 acceptance words (agent + project + content) are present in the populated response.

### SC#3 verdict

  * Migration data flow: GREEN. /api/coding/observations renders 939 rows (matches dashboard counter from Plan 44-14 verification), `_metadata.source='km-core'`.
  * Pitfall 2 lock on observations: GREEN. snake_case keys preserved on the observations endpoint.
  * Pitfall 2 lock on digests + insights: RED. camelCase has crept into those two endpoints.
  * **OPERATOR DECISION (Task 2):** Either (a) treat camelCase as the canonical contract post-Plan-44-09 amend and update typed-views.test.js to camelCase, OR (b) the digests + insights handlers in observation-view adapters need to convert their km-core entity camelCase metadata to snake_case at the boundary to satisfy "Zero consumer breakage" per CONTEXT A-4.

## SC#4 -- OKB-Baseline Guard Holds Under Unified Snapshot Endpoint

**Verdict: PASS.** okb-guard-snapshot-bypass.sh exits 0; both cases verified.

### Literal okb-guard output (unicode separators stripped)

```
Case A: OKB_SNAPSHOT=0 expecting hook exit != 0
  PASS: hook rejected (exit=1)
Case B: OKB_SNAPSHOT=1 expecting hook exit 0
  PASS: hook bypassed (exit=0)

Summary: PASS=2, FAIL=0
GREEN: OKB_SNAPSHOT bypass contract holds.
exit=0
```

### SC#4 supporting evidence

  * `bash tests/integration/okb-guard-snapshot-bypass.sh; echo exit=$?` -> `exit=0` (meets plan's acceptance criterion)
  * The mixed-commit reject demonstration the plan envisioned (`git add foo.unrelated && git add .data/exports/bar.json && git commit -m "test"` -> expect rejection) is structurally covered by the script's Case A; the manual inline demo was intentionally skipped; destructive demo would have required a `git reset HEAD~ --hard` rollback and offered no additional evidence
  * Plan 44-04 SUMMARY already documented the SnapshotManager -> OKB_SNAPSHOT=1 wrapper (CONTEXT S-3 mechanism)
  * Snapshots were not created in this verification (SC#2 blocker), so the "SnapshotManager-issued commits succeed" half of the loop cannot be exercised here; Task 2 will exercise it after the three SC#2 blockers are resolved

### SC#4 verdict

  * The OKB-baseline guard contract holds (mechanism is in place + the bypass works)
  * The SnapshotManager-issued half of the loop awaits SC#2 unblock

## Task Commits

This plan ships ONE commit covering Task 1 deliverable:

1. **Task 1: Wave 0 stub run + cross-system parity + per-SC evidence** -- `<this commit>` (test)

## Files Created/Modified

  * **NEW** `.planning/phases/44-rest-api-git-snapshots/44-11-SUMMARY.md` -- this evidence log
  * **MODIFIED** none (Task 1 is verification-only; the only artifact is the SUMMARY itself)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Cleanup] Manually deleted both verify-stub entities after SC#2 snapshot blockers prevented restore-driven cleanup**

  * **Found during:** Step 4 (per-system snapshot create attempts)
  * **Issue:** The plan's Step 4 expected `POST /api/v1/snapshots` -> `POST /api/v1/entities` (verify-stub) -> `POST /api/v1/snapshots/<tag>/restore` cycle. The restore was supposed to be the natural cleanup mechanism that wipes the verify-stub. Since all three snapshot legs are blocked (A gitignore, B read-only mount, C no mount), the restore never runs. Leaving verify-stub entities in the live stores would pollute the corpus the dashboard renders.
  * **Fix:** Issued explicit `DELETE http://localhost:12436/api/v1/entities/<id>` + `DELETE http://localhost:3848/api/v1/entities/<id>` after capturing the POST evidence + stats delta. Confirmed both DELETEs return HTTP 200 + the stats return to baseline (2213 / 2129).
  * **Files modified:** none (write paths only; verification gate creates no source-tree changes)
  * **Verification:** Post-DELETE GET /api/v1/stats on both legs confirms `nodes:2213` / `nodes:2129`; baseline restored.
  * **Committed in:** n/a (no source file mutation)

**2. [Rule 1 - Evidence-recording deviation] dashboard-observations.spec.ts deferred to Task 2 visual smoke**

  * **Found during:** Step 4 (Playwright spec run)
  * **Issue:** The plan's Step 4 expected `npx playwright test tests/e2e/dashboard-observations.spec.ts`. The spec FAILED with `TimeoutError: page.waitForSelector: Timeout 15000ms exceeded` waiting for `[data-testid="observations-table"]`. The spec's own header (lines 9-15) acknowledges: "Plan 44-11 will add this testid OR the spec must be relaxed during verification."
  * **Fix:** Recorded as stub-deferred-to-Task-2. Plan 44-14 SUMMARY already documented visual smoke at :3032 via regular browser (counters 939/391/81 rendering numeric; no error banners; 60+ refresh cycles clean). Task 2 owns the gsd-browser visual smoke with screenshot capture.
  * **Justification:** Per the deviation rules + the spec's own deferral note, leaving the spec RED while documenting the prior-work visual confirmation IS the expected verification-gate outcome. The fix (adding testids OR rewriting the spec) is operator-owned scope for Task 2 or a follow-up sub-plan.
  * **Files modified:** none
  * **Committed in:** n/a

**Total deviations:** 2 auto-fixed (both Rule 1 -- verification-gate scope management). Both preserve plan intent: Task 1 records evidence as-is; Task 2 surfaces the remediations to operator.

## Threat Model Coverage (from 44-11-PLAN.md threat_model)

| ID | Threat | Mitigation Status |
|----|--------|-------------------|
| T-44-11-01 | Restore-then-restart destructive op on live systems | N/A; no restore was executed (SC#2 blocked). Operator-owned destructive gate from Plan 04/06 stays intact for Task 2. |
| T-44-11-02 | Screenshots may contain real observation content | Deferred to Task 2 (gsd-browser smoke). `.planning/phases/44-rest-api-git-snapshots/_artifacts/` is the documented sink; .gitignore convention preserved. |
| T-44-11-03 | Restart cycle briefly interrupts service | Deferred to Task 2. None of the three legs are mid-restart at the moment of Task 1 close. |
| T-44-11-SC | No new package installs | Honored; verification reuses existing test infrastructure. |

## Acceptance Criteria Run

Plan's `acceptance_criteria` block, executed verbatim:

```text
$ test -f .planning/phases/44-rest-api-git-snapshots/44-11-SUMMARY.md && wc -l .planning/phases/44-rest-api-git-snapshots/44-11-SUMMARY.md | awk '{exit ($1>=50)?0:1}'
  -> 0  (file exists, >=50 lines)  PASS

$ grep -cE "SC#1|SC#2|SC#3|SC#4" .planning/phases/44-rest-api-git-snapshots/44-11-SUMMARY.md
  -> 36+ matches  (>=4 required)  PASS

$ grep -c "Wave 0" .planning/phases/44-rest-api-git-snapshots/44-11-SUMMARY.md
  -> 8+ matches  (>=1 required)  PASS

$ grep -c "cross-system-parity" .planning/phases/44-rest-api-git-snapshots/44-11-SUMMARY.md
  -> 4+ matches  (>=1 required)  PASS

$ grep -cE "(12436|3848|3002).*api/v1" .planning/phases/44-rest-api-git-snapshots/44-11-SUMMARY.md
  -> 15+ matches  (>=3 required, all three ports + api/v1 paired)  PASS

$ cd lib/km-core && npx vitest run tests/integration/api-router.test.ts tests/unit/contracts.test.ts tests/integration/snapshot-roundtrip.test.ts tests/integration/observation-view.test.ts 2>&1 | tail -3 | grep -cE "(passed|0 failing)"
  -> 1  (>=1 required, "4 passed (4)" + "26 passed (26)" lines)  PASS

$ bash tests/integration/okb-guard-snapshot-bypass.sh; echo exit=$?
  -> exit=0  PASS

$ node --test tests/integration/cross-system-parity.mjs 2>&1 | tail -3 | grep -cE "(pass|0 failed)"
  -> 1+  (matches "pass 2")  PASS at grep level (but the suite is RED on 4 of 6 due to C leg + 3 shape diffs)

$ curl -s "http://localhost:12436/api/coding/observations?limit=1" | grep -cE "\\b(agent|project|content)\\b"
  -> 1 line containing all 3 keywords  PASS (literal-match count is 3 inside that 1 line)
```

All 9 acceptance criteria pass at the literal-grep level. The cross-system-parity criterion passes the grep ">=1 pass" gate but the SUITE is RED; the gate's intent was the suite-pass condition, which is the OPERATOR DECISION for Task 2 (the C leg is structurally blocked).

## Issues Encountered

1. **SC#2 unexecutable from verification gate** -- three separate per-system blockers (gitignore path on A, read-only mount on B, no-/api/v1 on C). Documented for Task 2 operator triage.
2. **SC#3 typed-views shape lock divergence** -- digests + insights camelCase vs snake_case. Documented for Task 2 operator decision.
3. **Dashboard e2e spec testids not present** -- spec's own header acknowledges Plan 44-11 owns the resolution. Deferred to Task 2 visual smoke.
4. **Cross-system-parity C leg blocked on OKM PR #5** -- STATE.md already documented this. C cannot be verified until OKM PR #5 is merged + C is restarted.

## Operator Runbook (Task 2)

The orchestrator surfaces `CHECKPOINT_REQUIRED: 44-11 Task 2 needs operator action`. Operator runs:

### Visual UI smokes

1. **Dashboard at :3032; gsd-browser**
   ```bash
   gsd-browser navigate http://localhost:3032
   gsd-browser screenshot .planning/phases/44-rest-api-git-snapshots/_artifacts/dashboard-44-$(date +%s).png
   ```
   * Top-line counters: 939 / 391 / 81 (per Plan 44-14 verification)
   * statusline badge: GREEN
   * No 503 / 500 error banners
   * (If gsd-browser daemon is broken as Plan 44-14 noted, fall back to regular Chrome and confirm visually.)

2. **VOKB viewer at C URL** (operator-known path; typically `http://localhost:3002/` or `/viewer`)
   ```bash
   gsd-browser navigate http://localhost:3002/
   gsd-browser screenshot .planning/phases/44-rest-api-git-snapshots/_artifacts/vokb-44-$(date +%s).png
   ```
   * Graph renders
   * Search/filter/cluster work
   * Snapshot list shows snapshots (will be EMPTY today; SC#2 blocked)

### SC#2 remediation (operator decision)

Three blockers, three options:

| Blocker | Option A (in-phase) | Option B (sub-plan) |
|---------|---------------------|---------------------|
| A's `.data/knowledge-graph/exports/` gitignored | Patch SnapshotManager to use `git add -f` OR re-route to `.data/exports/` per CONTEXT S-1 | Draft Plan 44-16 "Snapshot-dir routing fix" |
| B's `/coding/.git` read-only inside coding-services | Move snapshot creation host-side OR mount `/coding/.git` rw | Draft Plan 44-16 with B-leg fix |
| C has no /api/v1 mount | Merge OKM PR #5 + restart C | Already-tracked as STATE.md follow-up |

### SC#3 remediation (operator decision)

Either (a) update `tests/integration/typed-views.test.js` to expect camelCase keys (`observationIds`, `filesTouched`, `digestIds`, `lastUpdated`) if camelCase is the canonical post-Plan-09 contract, OR (b) the observation-view adapters need to convert km-core entity camelCase metadata to snake_case at the boundary to honor CONTEXT A-4 "Zero consumer breakage" (legacy SQLite columns were `observation_ids` / `files_touched` / `digest_ids` / `last_updated`).

Preference per CONTEXT A-4 spirit: option (b); preserve snake_case at the legacy endpoint boundary. But the dashboard already renders 939/391/81 correctly with the current camelCase output, so the actual consumer impact is bounded.

### Restart-then-restore cycle

The plan's Task 2 envisioned this; SC#2 blocks it. After the SC#2 blockers are resolved (either in-phase or via Plan 44-16), the cycle would be:

  * A: `launchctl kickstart -k gui/$(id -u) com.coding.obs-api` then `sleep 5; curl http://localhost:12436/api/v1/stats | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['data']['nodes'])"`
  * B: `cd /Users/Q284340/Agentic/coding/docker && docker-compose restart coding-services` then `sleep 10; curl http://localhost:3848/api/v1/stats | python3 -c "..."`
  * C: operator-known OKM restart command (typically docker-compose restart <okm-container>)

### Operator decision authority

  * **"approved"** -> phase passes; ROADMAP Phase 44 -> `[x]`; STATE.md -> Phase 45
  * **"partial: SC#1 PASS, SC#3 PASS, SC#2 deferred to 44-16, SC#4 PASS"** -> planner drafts 44-16 for SC#2
  * **"issues: <details>"** -> operator triages specific failures
  * **"rollback"** -> restore .observations/observations.db backup per Plan 44-10 Task 3

## Next Phase Readiness

  * Phase 44 cannot close fully at this gate
  * Three operator-owned decisions surface:
    1. SC#2 path-routing fix (sub-plan or in-phase)
    2. SC#3 snake_case-vs-camelCase shape lock (test rewrite or handler fix)
    3. C-leg unblock (OKM PR #5 merge + restart)
  * Plan 44-15 (consolidator cutover) remains the natural next step regardless of SC#2 resolution
  * Phase 45 (Unified Web Viewer) does NOT depend on SC#2 in any structural way; the snapshot/restore round-trip can mature in parallel

## Self-Check: PASSED

  * [x] `/Users/Q284340/Agentic/coding/.planning/phases/44-rest-api-git-snapshots/44-11-SUMMARY.md` exists (verified before commit)
  * [x] km-core 4 Wave 0 tests run + GREEN (literal `Test Files 4 passed (4) / Tests 26 passed (26)`)
  * [x] okb-guard-snapshot-bypass.sh exit=0 (literal `exit=0` captured)
  * [x] typed-views test run + 2/4 PASS recorded with per-test failure messages
  * [x] cross-system-parity 3 legs probed; A+B GREEN, C RED with non-JSON content-type confirmed
  * [x] dashboard-observations Playwright spec run + 3/3 timeout failure recorded
  * [x] Per-system /api/v1/stats envelope captured literally for A+B; C HTML fallback confirmed
  * [x] Per-system /api/v1/ontology/classes captured literally for A+B
  * [x] Per-system snapshot POST attempt + literal error response captured for A+B+C
  * [x] Per-system entity POST + DELETE round-trip executed for A+B (stats delta + cleanup confirmed)
  * [x] All 9 plan acceptance_criteria literal-grep gates pass
  * [x] Per-SC verdict (PASS/PARTIAL/BLOCKED) recorded with reasoning
  * [x] Operator runbook + decision authority documented for Task 2

## TDD Gate Compliance

N/A; plan type is `execute` (verification gate, not feature work). The Wave 0 stubs themselves are the gate; this plan records their state.

---
*Phase: 44-rest-api-git-snapshots*
*Plan 11 Task 1 completed: 2026-06-04T16:57:00Z*
*Plan 11 Task 2 status: AWAITING OPERATOR ACTION*
