---
phase: 84
slug: per-turn-context-revelation
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-07
---

# Phase 84 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `84-RESEARCH.md` §Validation Architecture (single source of truth).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node --test` (node stdlib test runner) — the Phase-82/83 house style (`token-usage.test.ts` in proxy `src/`; coding-side `tests/` node --test) |
| **Config file** | none — `node --test` discovers `*.test.mjs` / `*.test.js`; proxy uses `src/*.test.ts` |
| **Quick run command** | `node --test tests/context-turns/*.test.mjs` (per-module) |
| **Full suite command** | `node --test tests/context-turns/ tests/redaction/ tests/vkb/` (recursive) + one LIVE golden-comparison span (Plan 09) |
| **Estimated runtime** | ~20 seconds (unit) + ~1 measured cell (live gate) |

---

## Sampling Rate

- **After every task commit:** Run the relevant `node --test tests/<module>/*.test.mjs`
- **After every plan wave:** Run full `node --test` recursive + redaction + sweeper suites
- **Before `/gsd-verify-work`:** Full suite must be green
- **Phase gate:** full suite green + one LIVE measured span producing a real `.gz` readable via the API + a gsd-browser screenshot of the honest explainer (never claim UI works from DB queries alone)
- **Max feedback latency:** ~20 seconds (unit); live gate is human-checkpoint

---

## Per-Task Verification Map

| Behavior | Plan | Wave | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|----------|------|------|------------|-----------------|-----------|-------------------|-------------|--------|
| logContextTurn writes one valid JSONL line per request | 04 | 1 | T-84-04 / — | never-throw best-effort; scope to span.task_id | unit | `node --test tests/context-turns/write-line.test.mjs` | ❌ W0 | ⬜ pending |
| Cache split carried separately (input/read/write/output), never folded | 04 | 1 | — | honest split, no fold | unit | `node --test tests/context-turns/cache-split.test.mjs` | ❌ W0 | ⬜ pending |
| OpenAI-wire line marks cache_write as provider-none (N/A discriminator) | 04 | 1 | — | never infer cache-write | unit | `node --test tests/context-turns/openai-wire.test.mjs` | ❌ W0 | ⬜ pending |
| Preview fallback always present (~120 char cap) + tool name/size captured | 04 | 1 | — | preview always available | unit | `node --test tests/context-turns/digest.test.mjs` | ❌ W0 | ⬜ pending |
| Redaction applier loads all 27 patterns; masks sk-/Bearer/JWT/env-var; preserves return shape; fail-closed | 02 | 1 | T-84-06-01 | fail-closed content block | unit | `node --test tests/redaction/config-load.test.mjs` | ❌ W0 | ⬜ pending |
| Flag-gated raw-body redacted before write; no secret substrings survive; flag-off writes nothing | 06 | 2 | T-84-06-01/02/03 | default OFF, redact-pre-write | unit | `node --test tests/redaction/proxy-raw-body.test.mjs` | ❌ W0 | ⬜ pending |
| gzip-at-close produces `.gz`, removes plaintext; crash leaves readable `.jsonl` | 05 | 1 | — | crash-safe plaintext | unit | `node --test tests/context-turns/close-gzip.test.mjs` | ❌ W0 | ⬜ pending |
| Observation correlation: nearest-by-createdAt within span window+agent; null when none | 05 | 1 | T-84-05-03 | null when uncertain | unit | `node --test tests/context-turns/correlate.test.mjs` | ❌ W0 | ⬜ pending |
| Age sweeper deletes >retention, keeps ≤retention; never-throw on bad dir | 03 | 1 | T-84-03 / — | never-throw, decoupled | unit | `node --test tests/context-turns/sweeper.test.mjs` (drive `context-turns-sweeper-job.sh` via env `CONTEXT_TURNS_RETENTION_DAYS`) | ❌ W0 | ⬜ pending |
| Read API: verbatim gunzip, ENOENT→graceful-empty, traversal rejected | 07 | 2 | T-84-07 | `_validTaskId` traversal guard | unit | `node --test tests/vkb/context-turns-route.test.mjs` | ❌ W0 | ⬜ pending |
| Explainer renders honest sent/cached/fresh + N/A for OpenAI-wire | 08 | 3 | — | honest measurement | e2e (gsd-browser) | `gsd-browser` screenshot of Performance tab at :3032 | ❌ W0 | ⬜ pending |
| End-to-end: measured span produces a context-turns.jsonl.gz readable via the API | 09 | 4 | T-84-09-01 | live redaction verified | live golden | manual measured 1-cell run + `curl :12435/api/context-turns?task_id=…` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/context-turns/` suite (write-line, cache-split, openai-wire, digest, close-gzip, correlate, sweeper) — none exist yet
- [ ] `tests/redaction/config-load.test.mjs` + `tests/redaction/proxy-raw-body.test.mjs` — redaction rewire + raw-body coverage
- [ ] `tests/vkb/context-turns-route.test.mjs` — read-API coverage
- [ ] Fixture: a recorded Anthropic `/v1/messages` request body + an OpenAI `/api/complete` body (offline write-line + taxonomy tests)
- [ ] Fixture: a small observations JSON slice (for correlation tests)
- [ ] Sweeper shell test harness (env-driven `CONTEXT_TURNS_RETENTION_DAYS` + temp `.data/measurements/`)

---

## Manual-Only Verifications

| Behavior | Decision | Why Manual | Test Instructions |
|----------|----------|------------|-------------------|
| Honest explainer renders real sent/cached/fresh + N/A for OpenAI-wire + "how caching works" copy | D-11/D-12 | Visual correctness of a live UI cannot be asserted from DB/file inspection (project rule) | gsd-browser navigate Performance tab at :3032 for a task with context-turns data → screenshot → confirm real numbers, N/A label for copilot/opencode cache-write, and the caching copy (84-08 Task 3) |
| Full live pipeline: real `.gz` + both read APIs + live redaction | Phase goal | Requires a real measured span through the live proxy | Run a measured 1-cell span; confirm `.gz` on disk, both read APIs serve turns, `gunzip` of raw-bodies shows no unredacted secrets (84-09 Tasks 2/3) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s (unit)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
