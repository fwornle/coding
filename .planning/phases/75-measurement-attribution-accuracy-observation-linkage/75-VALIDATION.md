---
phase: 75
slug: measurement-attribution-accuracy-observation-linkage
status: ready
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-29
---

# Phase 75 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | dual: `node --test` (lib/* + scripts/* `.mjs`) + jest 29.x (`.js` ETM/ObservationWriter + dashboard `.tsx`); playwright for e2e |
| **Config file** | none for node:test; jest in package.json; dashboard `integrations/system-health-dashboard/jest.config` |
| **Quick run command** | `node --test <changed *.test.mjs>` or `npx jest <changed *.test.js>` |
| **Full suite command** | `node --test tests/experiments/*.test.mjs tests/lsl/token/*.test.mjs` + `npx jest tests/live-logging/` + `npx playwright test tests/e2e/performance/` |
| **Estimated runtime** | ~60-90 seconds (unit) + ~30s (e2e, when dashboard live) |

---

## Sampling Rate

- **After every task commit:** Run quick run command on the changed test file
- **After every plan wave:** Run full suite command
- **Before `/gsd-verify-work`:** Full suite green + a live re-measure of a short Claude session showing `cladpt` rows + canonical=Opus
- **Max feedback latency:** ~90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-T1 | 75-01 | 1 | ATTR-01/02/03 | T-75-01 | temp DB only; no proxy-DB write | unit (RED) | `node --test tests/experiments/canonical-attribution.test.mjs tests/lsl/token/stop-adapter-registry.test.mjs` | ❌ creates | ⬜ pending |
| 01-T2 | 75-01 | 1 | OBS-01/02 | T-75-02 | synthetic fixture, no PII | unit (RED) | `npx jest tests/live-logging/ETM-recapture.test.js` | ❌ creates | ⬜ pending |
| 01-T3 | 75-01 | 1 | ATTR-02 | T-75-01 | offline-safe skip-guard | e2e (RED) | `npx playwright test tests/e2e/performance/canonical-columns.spec.ts --list` | ❌ creates | ⬜ pending |
| 02-T1 | 75-02 | 2 | ATTR-01 | T-75-21/22/23 | readonly DB; bound `?` params; denylist overrides adapter hash | unit | `node --test tests/experiments/canonical-attribution.test.mjs tests/experiments/token-aggregate.test.mjs` | ✅ (Plan 01) | ⬜ pending |
| 02-T2 | 75-02 | 2 | ATTR-02 | T-75-21 | null-not-zero; idempotent | unit | `node --test tests/experiments/canonical-attribution.test.mjs tests/experiments/run-write.test.mjs` | ✅ (Plan 01) | ⬜ pending |
| 03-T1 | 75-03 | 2 | ATTR-03 | T-75-31/32/33/34 | uid-gate preserved; single build binding (no double-count); idempotent insert | unit | `node --test tests/lsl/token/stop-adapter-registry.test.mjs` | ✅ (Plan 01) | ⬜ pending |
| 04-T1 | 75-04 | 3 | ATTR-01/02/03 | T-75-41/42 | capture best-effort; canonical never dominant | integration | `node --test tests/lsl/token/stop-adapter-registry.test.mjs tests/experiments/canonical-attribution.test.mjs` + `node --check scripts/measurement-stop.mjs` | ✅ (Plan 01) | ⬜ pending |
| 04-T2 | 75-04 | 3 | ATTR-03 | T-75-43 | non-fatal bypass warning | source assertion | `node --check scripts/measurement-stop.mjs` + grep "Anthropic-direct bypass" | n/a | ⬜ pending |
| 05-T1 | 75-05 | 2 | OBS-02 | T-75-51/52 | redact-before-persist; cursor dedup | unit | `npx jest tests/live-logging/ETM-recapture.test.js` | ✅ (Plan 01) | ⬜ pending |
| 05-T2 | 75-05 | 2 | OBS-01 | T-75-53 | shared single-span reader | unit | `npx jest tests/live-logging/ETM-recapture.test.js tests/live-logging/ObservationWriter.pre-llm-dedup.test.js` | ✅ (Plan 01) | ⬜ pending |
| 05-T3 | 75-05 | 2 | OBS-01/02 | T-75-51 | ETM kickstart, no stall | human-verify | live: `launchctl kickstart -k gui/$(id -u)/com.coding.etm` + observation query | manual | ⬜ pending |
| 06-T1 | 75-06 | 3 | ATTR-02 | T-75-61 | read-only render; no recompute | source assertion | grep canonical_model + testids in 3 surfaces | ✅ (Plan 01) | ⬜ pending |
| 06-T2 | 75-06 | 3 | ATTR-02 | T-75-SC | bind-mount build, no Docker rebuild | build | `cd integrations/system-health-dashboard && npm run build` | n/a | ⬜ pending |
| 06-T3 | 75-06 | 3 | ATTR-02 | T-75-61/62 | two columns consistent; unmeasured sentinel | e2e human-verify | `npx playwright test tests/e2e/performance/canonical-columns.spec.ts` + gsd-browser | ✅ (Plan 01) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/experiments/canonical-attribution.test.mjs` — fg/bg derivation (isForegroundGroup) + canonical computation (canonical != dominant-by-count) + canonical persistence on Run.metadata (ATTR-01/02). Env-gate live paths on EXPERIMENTS_LIVE, never `--live` argv.
- [ ] `tests/lsl/token/stop-adapter-registry.test.mjs` — per-agent registry dispatch (claude=transcript→cladpt+task_id; copilot/opencode/mastra=stamp-only, no build = no double-count) + idempotent insert (ATTR-03/D-04).
- [ ] `tests/lsl/token/_fixtures/main-session.jsonl` — owned non-subagent main-session transcript with a usage block + an extended-thinking block (per-turn + per-reasoning-step rows).
- [ ] `tests/live-logging/ETM-recapture.test.js` (jest) — OBS-02 acceptance fixture from transcript `e0af5b8b` (last typed prompt 2026-06-28T21:00:43Z, ran to 2026-06-29T06:08Z, 5 AskUserQuestion decisions 05:30–06:03Z): expect ≥2 observations dated ~05:30–06:03Z (NOT collapsed to T0), each with non-empty metadata.task_id, no duplicate (task_id, batch-last-message-uuid) keys.
- [ ] `tests/live-logging/_fixtures/e0af5b8b-recapture.jsonl` — the transcript fixture above (typed prompt @T0 + AskUserQuestion decisions @T0+n, per-message uuid + timestamp).
- [ ] `tests/e2e/performance/canonical-columns.spec.ts` — dashboard two-column render + empty-canonical "unmeasured" sentinel (ATTR-02), data-testid="run-canonical-model"/"run-background-models", offline-safe skip-guard.
- [ ] Acceptance grep (CLAUDE.md convention): grep the stop path for the time-window seam locating the main-session JSONL + the `cladpt` insert at stop.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| ETM mid-set re-capture produces multiple, time-spread, task_id-linked observations in a live session | OBS-01/02 | Requires live launchd ETM + a real multi-decision session | `launchctl kickstart -k gui/$(id -u)/com.coding.etm`; query observations for the active task_id; confirm multiple, time-spread, task_id-stamped (Plan 05 checkpoint) |
| Two-column model display renders consistently across runs table, score drawer, timeline; legacy Runs show "unmeasured" | ATTR-02 | Visual dashboard rendering | `gsd-browser` against localhost:3032 per CLAUDE.md (Plan 06 checkpoint) |
| Live re-measure: short Claude session yields `cladpt` rows + canonical=Opus, idempotent across recompute | ATTR-03 | Requires a real measured session | Phase gate before `/gsd-verify-work`: `SELECT COUNT(*) FROM token_usage WHERE task_id=? AND user_hash='cladpt'` > 0; Run.canonical_model = session model |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 90s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ready
