---
phase: 72
slug: syntactic-route-quality
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-24
---

# Phase 72 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `72-RESEARCH.md` §"Validation Architecture".

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` + `node:assert/strict` (established `tests/experiments/*.test.mjs` convention — NOT jest) |
| **Config file** | none — `node --test` discovers `tests/**` |
| **Quick run command** | `node --test tests/experiments/route-heuristics.test.mjs` |
| **Full suite command** | `node --test tests/experiments/ tests/token-adapters/` |
| **Estimated runtime** | ~5 seconds (pure-function + fixture tests; no LLM, no network) |

---

## Sampling Rate

- **After every task commit:** Run `node --test tests/experiments/route-heuristics.test.mjs`
- **After every plan wave:** Run `node --test tests/experiments/`
- **Before `/gsd-verify-work`:** Full experiment + token-adapter suites green **AND** one live /gsd run close proving cross-agent (at minimum one Claude run with all six heuristics + the D-02 null path)
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 72-01-* | 01 | 1 | ROUTE-02 | T-DoS (V5) | per-line JSON.parse try/catch; `null` (not 0) on unsupported trace (D-02) | unit | `node --test tests/experiments/route-heuristics.test.mjs` | ❌ W0 | ⬜ pending |
| 72-02-* | 02 | 1 | ROUTE-01 | T-traversal (V5) | reads PLAN.md/ROADMAP `**Goal**:` only; no task_id→filename build | unit | `node --test tests/experiments/goal-sentence.test.mjs` | ❌ W0 | ⬜ pending |
| 72-03-* | 03 | 2 | ROUTE-02 | T-uid (V4) | uid-check gate on every agent file read (reuse claude-token-rows.mjs:93-101) | unit | `node --test tests/experiments/route-readers.test.mjs` | ❌ W0 | ⬜ pending |
| 72-04-* | 04 | 3* | ROUTE-02 | T-sqli (V5) | OpenCode db opened `mode=ro&immutable=1`; JS-side time-window filter (no SQL interpolation) | unit | `node --test tests/experiments/route-readers.test.mjs` | ❌ W0 | ⬜ pending |
| 72-05-* | 05 | 4* | ROUTE-01, ROUTE-02 | T-pii (V6) | `inputs_digest` (sha256), never raw tool inputs, stored on Route node | integration | `node --test tests/experiments/run-write.test.mjs` | partial — extend | ⬜ pending |
| 72-05-live | 05 | 4* | ROUTE-01, ROUTE-02 | — | live close lands Run + 6 heuristics + Route node | manual/live | operator close + `node scripts/experiments-query.mjs` | n/a (live gate) | ⬜ pending |

*Waves 3/4 reflect the post-revision dependency fix (72-04 → wave 3, 72-05 → wave 4). Update if the planner re-waves differently.

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/fixtures/route/` — golden `RouteEvent[]` fixtures (loop, edit-revert, redundant-read, abandoned, parallel-same-turn, true-negatives) — covers ROUTE-02
- [ ] `tests/experiments/route-heuristics.test.mjs` — one block per heuristic + true-negative cases (D-08) — covers ROUTE-02
- [ ] `tests/experiments/route-readers.test.mjs` — captured per-agent trace fixtures (small real-shape JSONL / events.jsonl / part rows) — covers ROUTE-02
- [ ] `tests/experiments/goal-sentence.test.mjs` — PLAN.md/ROADMAP `**Goal**:` extraction + quarantine path — covers ROUTE-01
- [ ] extend `tests/experiments/run-write.test.mjs` — Route node + six flat metrics + idempotent re-close

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live /gsd run close lands a Run with PLAN.md-derived `goal_sentence`, six strict heuristics, and one Route node | ROUTE-01, ROUTE-02 | Requires a real agent session trace on disk + a live measurement span; cannot be synthesized deterministically end-to-end | Run a real /gsd task to close, then `node scripts/experiments-query.mjs` and confirm the Run carries six non-null heuristics + a `tookRoute` edge to a Route node carrying the goal_sentence |
| Coarser/untraceable run writes `null` (not `0`) for unsupported heuristics | ROUTE-02 (D-02) | Depends on a real run whose trace file is unlocatable | Close a run with no locatable trace; confirm the six metrics are `null` in the stored Run |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (5 listed above)
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
