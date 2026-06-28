# Phase 73: Semantic Route Judge & Success Scoring - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-28
**Phase:** 73-semantic-route-judge-success-scoring
**Areas discussed:** Evidence-gathering depth, goal_aligned_ratio formula, Judge invocation & idempotency, Override surface & storage

---

## Evidence-gathering depth

| Option | Description | Selected |
|--------|-------------|----------|
| Lean deterministic harness | Read on-disk artifacts (VERIFICATION.md, REVIEW.md count, test summary, diff stat, PLAN.md tasks); no fresh runs; absent evidence → null | ✓ |
| Judge-from-trace+diff only | Feed only trace + diff + goal; judge infers all 5 dims | |
| Full active harness | Run tests + linter + code-review at scoring time | |

**User's choice:** Lean deterministic harness (recommended).
**Notes:** Full active harness explicitly considered and deferred as too heavy for v0. Null-not-zero carries from Phase 72 D-02.

---

## goal_aligned_ratio formula

| Option | Description | Selected |
|--------|-------------|----------|
| Consequential events, toward/(toward+away) | Score Edit/Write/Bash/Task only; neutral excluded from denominator; per-event labels + rationale | ✓ |
| All tool calls, toward/total | Score every call incl Reads; neutral in denominator | |
| Delegate exact filter to research | Lock ratio+rationale guardrail, pin filter in planning | |

**User's choice:** Consequential events, `toward/(toward+away)` (recommended).
**Notes:** User wants the ratio to reflect *acting* not *looking*; reads must not dilute. Exact tool-name set delegated to research (fixture-tested, Phase 72 D-08 style).

---

## Judge invocation & idempotency

| Option | Description | Selected |
|--------|-------------|----------|
| Sync at close, one call, recompute CLI | One Haiku call returns ratio + rubric; idempotent re-judge by task_id; fail → null+pending; recompute CLI | ✓ |
| Async / on-demand sweeper | Close stays zero-LLM; separate sweeper judges later | |
| Two calls (ratio vs rubric) | Separate judge calls, double overhead | |

**User's choice:** Sync at close, one call, recompute CLI (recommended).
**Notes:** Single structured call for cost + consistency. Judge call self-measured via proxy (Phase 68). Trivial-run guard added (see below).

### Trivial-run guard (follow-up)

| Option | Description | Selected |
|--------|-------------|----------|
| Skip below a threshold, mark not_scored:trivial | ~0 consequential events → skip judge, scores null + distinct trivial marker | ✓ |
| Judge every run | Always call the judge | |

**User's choice:** Skip below a threshold, mark `not_scored: "trivial"` (recommended).
**Notes:** Distinct from judge-failure `pending`. Saves Haiku calls on no-op runs; keeps averages clean.

---

## Override surface & storage

| Option | Description | Selected |
|--------|-------------|----------|
| Extend Outcome + Route, field pairs, PATCH now / UI in 74 | Rubric on Outcome, ratio on Route, corrected_* pairs, minimal PATCH now | |
| New Score entity | Dedicated Score class (Run--scored-->Score) holding judged + corrected | ✓ |
| Flat on the Run | All scores flat on Run alongside heuristics | |

**User's choice:** New `Score` entity.
**Notes:** Chosen for clean forensic separation of judged vs corrected. Deliberately supersedes Phase 72 D-09's "ratio on Route" remark — Route keeps syntactic heuristics, Score is the semantic home.

### Override sequencing (follow-up)

| Option | Description | Selected |
|--------|-------------|----------|
| Storage + PATCH API now, UI in 74 | Score entity + corrected_* + minimal PATCH endpoint in 73; UI controls in Phase 74 tab | ✓ |
| Storage only, defer API + UI to 74 | Only define corrected_* fields in 73 | |
| Minimal override UI now too | Build a bare override control in 73 | |

**User's choice:** Storage + PATCH API now, UI in 74 (recommended).
**Notes:** Makes SCORE-02's storage contract testable via API now without front-running Phase 74's Performance tab.

---

## Claude's Discretion

- Exact judge prompt + structured-output schema (single call → ratio + per-event labels + rubric + rationales).
- Precise "consequential event" tool-name set per agent (fixture-tested).
- Trivial-run threshold value; whether goal_aligned_ratio is also mirrored flat on the Run.
- The `taskType` string routing to claude-haiku; reuse of the canonical `/api/complete` client.
- corrected-vs-judged read precedence in queries.

## Deferred Ideas

- Performance dashboard tab + override UI controls + Report entity → Phase 74.
- Full active evidence harness (run tests/linter/review at scoring time) → deferred, too heavy for v0.
- 4 reviewed-but-unrelated todos (orphan-digest-refs, okm-api-contract, sub-agent-dashboard-gap, vkb-filter-asymmetry) — weak keyword matches, not folded.
