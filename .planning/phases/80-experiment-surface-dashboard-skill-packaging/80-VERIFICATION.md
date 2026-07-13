# Phase 80 Verification: Experiment Surface — Dashboard & Skill Packaging

**Status:** passed
**Verified:** 2026-07-13
**Method:** Goal-backward re-derivation from live code + running services (not SUMMARY claims)

---

## Requirement CMP-04: Comparison viewable in Performance dashboard tab as variant columns

### Backend endpoint

- `GET /api/experiments/comparison` registered in `lib/vkb-server/api-routes.js:101` → `handleComparison` (defined at line 591).
- Handler validates `task_hash` via the SHARED `sanitizeTaskHash` (imported from `../experiments/compare.mjs`, line 596) BEFORE opening the store — early 400.
- Opens the store exclusively via `openExperimentStore` (`lib/experiments/store.mjs`) → `readRuns` → `buildComparison` → `close()` in a `finally` block (lines 606-629). No `new GraphKMStore` anywhere in `api-routes.js` or `scripts/experiments-compare.mjs` — confirmed by grep (only hit is the factory itself inside `store.mjs`, which sets the mandatory `ontologyDir`, per CLAUDE.md's km-core rule).
- Response is stamped with `gate_outcome` via the SAME shared helper (`withGateOutcomes`/`GROUP_GATE_OUTCOME`, exported once from `lib/experiments/compare.mjs`, imported by both the endpoint and `scripts/experiments-compare.mjs` — confirmed `scripts/experiments-compare.mjs` has NO local redefinition, only `export { sanitizeTaskHash }` / `export { buildComparison }` re-exports at lines 107/325).

**Test run:**
```
node --test tests/experiments/comparison-endpoint.test.mjs
→ tests 4, pass 4, fail 0
```
All 4 store-backed tests pass, including the deep-equality assertion between endpoint JSON and the CLI's `writeReportJson` doc (schema-drift guard).

**Live endpoint (vkb-server on :8080, hit directly, no mocks):**
```
curl "http://localhost:8080/api/experiments/comparison?task_hash=d4164dca2e742c881d7dfb1b06889cfc4d518fd939209f0612efef3369d504b6"
→ HTTP 200, keys: task_hash, rank_by, generated_at, ranked, failed, ungated, unscored
→ ranked:0 failed:3 ungated:1 unscored:0  (matches 80-01-SUMMARY's recorded grouping exactly)

curl "http://localhost:8080/api/experiments/comparison?task_hash=../../etc/passwd"
→ HTTP 400

curl "http://localhost:3032/api/experiments/comparison?task_hash=<same hash>"
→ HTTP 200  (dashboard proxy forwards unchanged, confirming server.js needed no edit)

curl "http://localhost:3032/api/experiments/comparison?task_hash=../../etc/passwd"
→ HTTP 400
```

### Frontend

- `integrations/system-health-dashboard/src/pages/performance.tsx` — 5th distinct tab confirmed: `TabsTrigger value="comparison" data-testid="comparison-tab"` (line 205), separate from `runs`/`avenues`/`compare`/`reports` (lines 201-204). No overload of the existing "Compare" (manual A/B) or "Reports" (Phase 74 saved queries) tabs — satisfies D-01.
- `integrations/system-health-dashboard/src/store/slices/performanceSlice.ts` — `fetchComparison` is a `createAsyncThunk` (line 774) keyed by `task_hash`, with `comparisonByTaskHash` state (line 332/591) and `selectComparisonFor`/`selectSelectedTaskHash` selectors. This is Redux state, not local `useState` (confirmed by grep: `useState`/`fetch(` appear in `comparison-matrix.tsx` ONLY inside comments, 0 in executable code).
- `comparison-matrix.tsx` renders variants as columns (transposed matrix) with the four honesty-spine groups as visibly separate sections (`comparison-group-ranked/failed/ungated/unscored` testids, lines 223/230/237/244), each with an explicit "— none —" empty state (line 177) rather than a fabricated winner. "FAILED (no successful runs)" title (line 231) confirms the Phase 79 honesty spine is carried through.

**Test run:**
```
npx playwright test tests/e2e/performance/comparison-tab.spec.ts
→ 3 passed (3.5s)
```
All 3 E2E tests pass live against the running dashboard: distinct 5th tab reveals the matrix; all four honesty-spine group regions render; ≥1 variant column renders.

**Visual verification:** Operator sign-off already recorded — commit `9d0319afb` "docs(phase-80): operator approved 80-03 human-verify (Comparison tab renders)" confirms the gsd-browser screenshot checkpoint (`80-03-comparison-tab.png`, `80-03-comparison-tab-full.png`) was approved, superseding the "PENDING" note still present in the 80-03-SUMMARY.md body text. No visual gap.

**CMP-04: SATISFIED.**

---

## Requirement ORCH-01: Full flow invokable as single installed skill/command

- `.claude/commands/experiment.md` exists (158 lines) with valid frontmatter (`description`, `argument-hint`).
- Wraps the full flow as documented: Step 1 parses `--goal/--variants/--agents/--repeats/--task-class/--snapshot-id/--rank-by` with argv-safety (rejects shell metacharacters, no `sh -c` interpolation); Step 2 synthesizes a spec YAML with a CLOSED_6 `task_class` (verified the skill's documented taxonomy — `refactor | bugfix | new-feature | migration | debug | docs` — matches `lib/experiments/taxonomy.mjs:26` `CLOSED_6` exactly) and a resolvable `snapshot_id` (default `smoke-spec`); Step 3 computes `task_hash = sha256(goal_sentence)` skill-side (mirrors `measurement-stop.mjs:805-806`), explicitly NOT scraping the runner's `task_id` stdout; Step 4 runs `scripts/experiment-run.mjs --spec ... --task-class ...` unattended; Step 5 runs `scripts/experiments-compare.mjs --task-hash "$TASK_HASH" --rank-by <rank_by>`.
- Thin-wrapper discipline confirmed: no `buildComparison` reimplementation anywhere outside `lib/experiments/compare.mjs` (grep confirms single definition site); the skill file explicitly states it reimplements no runner/comparison logic and uses only stdlib sha256.

**Distribution confirmed:**
```
~/.claude/commands/experiment.md  — exists, byte-identical to the repo copy (diff: no output)
.github/copilot-instructions.md:119 — "- **experiment** (`.claude/commands/experiment.md`): ..."
CLAUDE.md:108 — "- **/experiment** (`.claude/commands/experiment.md`): ..."
```
All three driveable-agent surfaces (Claude global commands, Copilot catalog, OpenCode CLAUDE.md) carry the skill, installed via the unedited `scripts/generate-agent-instructions.sh`.

**ORCH-01: SATISFIED.**

---

## Success Criterion 3: One command → run → auto-compare → dashboard shows it (mechanical chain)

Verified the wiring/paths close without a live token-burning run (per instructions):

1. Skill computes `TASK_HASH = sha256(goal_sentence)` — the exact same derivation the runner performs at close (`measurement-stop.mjs:805-806`, `crypto.createHash('sha256').update(span.goal_sentence).digest('hex')`). Since the skill owns `goal_sentence` (it wrote it into the spec), the hash is guaranteed identical without scraping runner output.
2. `experiments-compare.mjs --task-hash "$TASK_HASH"` writes `.data/experiments/reports/$TASK_HASH.json` using `buildComparison` from the shared `lib/experiments/compare.mjs`.
3. The dashboard's `fetchComparison` thunk hits `GET /api/experiments/comparison?task_hash=$TASK_HASH`, which independently opens the store and calls the SAME `buildComparison` — proven deep-equal to the CLI's `writeReportJson` doc by the comparison-endpoint test.
4. Both paths (CLI report file, live endpoint) are same-source twins of one `buildComparison` call graph; no divergence possible short of a code change to one and not the other (guarded by the drift test).

**Success criterion 3: mechanically closed.**

---

## Project-rule checks (CLAUDE.md)

- **km-core:** endpoint and CLI both go through `openExperimentStore()` only; zero `new GraphKMStore` in the Phase 80 touched files; the factory itself (`lib/experiments/store.mjs`) sets `ontologyDir` correctly (pre-existing from Phase 78/79, unmodified).
- **No raw console.\*:** grep across `api-routes.js`, `compare.mjs`, `experiments-compare.mjs`, `comparison-matrix.tsx`, `performanceSlice.ts` — zero raw `console.log/error/warn/info` hits.
- **gsd-browser visual verify:** used per 80-03-SUMMARY (not a hand-rolled Playwright script); operator-approved in commit `9d0319afb`.

---

## Minor doc-sync gap (non-blocking)

`.planning/REQUIREMENTS.md` lines 48/52/86/87 still show CMP-04 and ORCH-01 as `[ ]` / "Pending" — last synced at commit `513190a13` (Phase 79 close), which predates all three Phase 80 plan-completion commits the same day. ROADMAP.md correctly shows Phase 80 and all 3 sub-plans as `[x]` complete (2026-07-13). This is a stale-checkbox documentation gap only — functional delivery is confirmed by code, tests, and live services above. Recommend flipping REQUIREMENTS.md's CMP-04/ORCH-01 rows to `[x]`/"Satisfied" as a trivial follow-up.

---

## Summary

| Requirement | Backend | Frontend/Skill | Tests | Live | Status |
|---|---|---|---|---|---|
| CMP-04 | `handleComparison` + shared helper, 200/400 verified live | Comparison 5th tab, Redux-only, honesty spine | 4/4 node tests, 3/3 Playwright | curl 200/400 confirmed on :8080 and :3032 | SATISFIED |
| ORCH-01 | N/A | `.claude/commands/experiment.md` thin wrapper | N/A (skill, not code) | Distributed to Claude/Copilot/OpenCode, confirmed on disk | SATISFIED |

Both CMP-04 and ORCH-01 are satisfied. Phase 80 goal achieved: the experiment flow is invokable as a single installed skill across coding agents, and its comparison is viewable in the Performance dashboard without re-running.
