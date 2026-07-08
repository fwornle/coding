---
phase: 84-per-turn-context-revelation
plan: 05
subsystem: span-close-lifecycle
tags: [context-turns, gzip, observation-correlation, span-close, measurement-stop, wave-1]

# Dependency graph
requires:
  - "84-01 — tests/context-turns/{close-gzip,correlate}.test.mjs skipped stubs + observations-slice.json fixture"
  - "84-04 — proxy appends plaintext context-turns.jsonl (observation_ref:null) at both write sites"
provides:
  - "scripts/measurement-stop.mjs enrichObservationRefs(lines,{from,to,agent,observations}) — nearest-by-createdAt observation within span window+agent (best-effort D-07)"
  - "loadObservationsForWindow({from,to,agent}) — obs-api :12436 with exported observations.json fallback"
  - "closeContextTurns(dir,{from,to,agent,observations}) — enrich -> gzip context-turns.jsonl(.gz) + rm plaintext (D-03); gzip raw-bodies.jsonl when present; never-throw"
  - "span-close wiring beside the reconciliation write (reuses sanitizeTaskId path build)"
affects: [84-07, 84-09]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Correlation runs at span close (not the proxy hot path — Pitfall 1: observations carry no task_id and don't exist at request time)"
    - "Injected observations array keeps enrichObservationRefs offline/deterministic for unit tests; production loads via loadObservationsForWindow"
    - "Each file (context-turns / raw-bodies) gzipped in its own best-effort try/catch so a failure on one never skips the other"

key-files:
  created: []
  modified:
    - scripts/measurement-stop.mjs
    - tests/context-turns/close-gzip.test.mjs
    - tests/context-turns/correlate.test.mjs

key-decisions:
  - "observation_ref shape = { id, intent, theme? } where intent is a <=120-char snippet of the observation's `Intent:` clause (observations expose `summary`, not `theme`; digests would carry theme)."
  - "A turn correlates only when its own ts is inside [span.started_at, span.ended_at]; observations are also window+agent filtered, then the nearest-by-createdAt wins (many turns -> ONE observation, coarse reference per D-07)."
  - "loadObservationsForWindow tries localhost:12436 AND host.docker.internal:12436 (measurement-stop runs on the HOST, not the container) with a 2s timeout, then falls back to .data/observation-export/observations.json; [] on total failure (preview stands)."
  - "gzip via node:zlib zlib.gzipSync (same lib lsl-file-manager.js uses) — no new compression code."

requirements-completed: []

# Metrics
duration: 9min
completed: 2026-07-08
---

# Phase 84 Plan 05: Span-Close gzip + Observation-Ref Enrichment Summary

**At span close (`scripts/measurement-stop.mjs`, beside the reconciliation.json write) each per-turn context line is enriched with the nearest correlating ETM observation (time-window + agent, best-effort D-07), then the plaintext `context-turns.jsonl` is gzipped to `.gz` and removed (D-03) and `raw-bodies.jsonl` is likewise gzipped when present — all best-effort never-throw, so a crashed span leaves a readable plaintext for the age sweeper. Correlation runs HERE, not in the proxy hot path (Pitfall 1: observations have no task_id and don't exist at request time).**

## Performance

- **Duration:** ~9 min
- **Completed:** 2026-07-08
- **Tasks:** 2
- **Files modified:** 3 (1 script + 2 tests)

## Accomplishments

- **Task 1 — gzip-at-close + plaintext removal.** Added `closeContextTurns(dir, opts)` and wired it into `main()` as a new best-effort block (step 3.0c) beside the reconciliation write, reusing the same `sanitizeTaskId(span.task_id)` + `.data/measurements/<id>` path build. Reads `context-turns.jsonl` (when present) → `zlib.gzipSync` → `context-turns.jsonl.gz` → `fs.unlinkSync` the plaintext; does the same for `raw-bodies.jsonl` → `.gz`. Each file is guarded in its own try/catch (a failure on one never skips the other), and a missing file is normal (silently skipped). Enrichment runs BEFORE gzip so the enriched lines are what get compressed.
- **Task 2 — observation-ref enrichment + un-skipped tests.** Added `enrichObservationRefs(lines, {from,to,agent,observations})` (pure, offline, per-line never-throw): for each turn whose `ts` falls inside the span window, pick the same-agent observation whose `createdAt` is nearest to the turn's ts and set `observation_ref = { id, intent, theme? }`, else leave `null`. Added `loadObservationsForWindow` (obs-api :12436 host/container, then exported `observations.json` fallback, `[]` on total failure) and `intentSnippet`. Un-skipped and filled `close-gzip.test.mjs` (3 tests: round-trip gzip + plaintext removal + raw-bodies gzip; crash leaves readable plaintext; missing file never throws) and `correlate.test.mjs` (5 tests: in-window match, out-of-window null, wrong-agent null, empty-source null, many-turns→one-observation).

## Task Commits

1. **Task 1+2 implementation (measurement-stop.mjs)** — `5bc3464b9` (feat)
2. **Task 2 tests (close-gzip + correlate)** — `fcbd1dafd` (test)

> Task 1 and Task 2 both edit `scripts/measurement-stop.mjs` (Task 2's enrichment is called from Task 1's close routine and cannot be cleanly split into two file commits), so the script lands as one cohesive `feat` commit and the tests as a separate `test` commit.

## Files Created/Modified

- `scripts/measurement-stop.mjs` (**MODIFIED**) — `import zlib`; new exported helpers `enrichObservationRefs`, `loadObservationsForWindow`, `closeContextTurns` (+ internal `intentSnippet`); new best-effort span-close block (step 3.0c) wiring the close beside the reconciliation write.
- `tests/context-turns/close-gzip.test.mjs` (**MODIFIED**) — un-skipped, 3 tests.
- `tests/context-turns/correlate.test.mjs` (**MODIFIED**) — un-skipped, 5 tests.

## Deviations from Plan

None — plan executed as written. The correlate test uses a turn agent of `opencode` (not `copilot`) for the wrong-agent case, because the fixture's in-window `copilot` observation (obs-3333) would otherwise legitimately correlate; `opencode` has no in-window observation, giving the intended null.

## Threat Surface

- **T-84-05-01 (DoS, obs-api unreachable / no context-turns file)** mitigated: `loadObservationsForWindow` try/catches every base + 2s timeout and falls back to the exported JSON (`[]` on total failure); `closeContextTurns` guards each file with `existsSync` + its own try/catch → stderr; the whole close block is best-effort and never aborts span close.
- **T-84-05-02 (Tampering, path build)** mitigated: reuses the existing `sanitizeTaskId(span.task_id)` + `.data/measurements` build; scoped to `span.task_id` (`resolveLiveTaskId` is gone at close).
- **T-84-05-03 (Info disclosure, mis-attributed observation_ref)** accepted per plan: correlation is a coarse best-effort annotation (many turns → one obs), null when uncertain, documented as reference not proof.
- **T-84-05-SC** N/A: no package installs (pure Node stdlib — `node:zlib`).

## Verification

- `node --check scripts/measurement-stop.mjs` — clean.
- Grep gates: `context-turns.jsonl`=8, `raw-bodies.jsonl`=6, `gzipSync|createGzip`=2, `enrichObservationRefs|observation_ref`=10.
- `node --test tests/context-turns/close-gzip.test.mjs tests/context-turns/correlate.test.mjs` → **8 pass / 0 fail / 0 skipped**.
- Full glob `node --test tests/context-turns/*.test.mjs` → **13 pass / 0 fail / 0 skipped** (the last two Wave-0 stubs are now filled).

## Next Phase Readiness

- 84-07 (vkb-server read mirror + dashboard) consumes the `.gz` produced here (the `GET /api/context-turns` route from 84-04 already gunzips `.gz`), now carrying real `observation_ref` annotations where an observation correlated.
- 84-09 (live E2E / redeploy) exercises the full write→close→read path. **NOT redeployed here** by design.

---
*Phase: 84-per-turn-context-revelation*
*Completed: 2026-07-08*

## Self-Check: PASSED
- All modified files verified present (`scripts/measurement-stop.mjs`, `tests/context-turns/{close-gzip,correlate}.test.mjs`, this SUMMARY).
- Commits `5bc3464b9` (feat) and `fcbd1dafd` (test) verified in git log.
