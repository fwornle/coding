# Phase 51 — Discussion Log

**Date:** 2026-05-26
**Mode:** discuss (default)
**Pre-state:** rich `51-CONTEXT.md` (filed 2026-05-23, scope-broadened 2026-05-23, callout added 2026-05-24 for statusline-bubble interim mitigation) + no SPEC, no plans, no checkpoint
**Outcome:** CONTEXT.md augmented with `<decisions>`, `<canonical_refs>`, `<code_context>`, `<deferred>` blocks. Phase 50 primitives (`lib/lsl/window.mjs` + `lib/lsl/scan-and-convert.mjs`) confirmed shipped and imported unchanged. Ready for `/gsd-plan-phase 51` with 4-parallel-researcher dispatch.

---

## Areas presented

User authored a comprehensive CONTEXT.md on 2026-05-23 (scope-broadened same day) covering: bug evidence (58 sub-agent transcripts at 2026-05-23 17:00, ETM-watched 1), per-tier per-agent matrix, proposed LSL filename convention, Path A vs Path B comparison, full Must/Should/Could scope, acceptance criteria, and a 2026-05-24 callout on statusline-bubble interim mitigation. Seven residual gray areas were identified before discussion; user locked four directly and three auto-resolved by the locked decisions.

| # | Area | Locked? | Decision |
|---|------|---------|----------|
| Q1 | Path A/B ship order | yes (Q) | Path B first, Path A follow-on per agent → **D-Order** |
| Q2 | Per-agent research depth | yes (Q) | Full mechanism research for all 4 upfront, 4 parallel `gsd-phase-researcher` agents → **D-Research** |
| Q3 | Statusline-bubble mitigation | yes (Q) | Replace inside Phase 51 → **D-Statusline** |
| Q4 | Backfill scope | auto-resolved | Only the 2026-05-23 ~25 transcripts → **D-Backfill** |
| Q5 | LSL filename convention | auto-resolved | Locked verbatim from CONTEXT.md body → **D-LSL-Filename** |
| Q6 | Recursive sub-agents (Could #11) | auto-resolved | Deferred; registry reserves `parent_sub_hash` field |
| Q7 | metadata.source distinction | auto-resolved | `"sub-agent"` for live tier, `"sub-agent-backfill"` for sweep → **D-Live-Sweep-Tags** |

### Pre-discuss decisions still in force (from initial /sl session)

- Primitives strategy: land in 50, reuse in 51 (D-Reuse) — confirmed by Phase 50 closure earlier today
- Agent scope: all four (claude/opencode/copilot/mastra) — feeds D-Research

---

## Discussion trail

### Q1 — Path A vs Path B ship order
- Options: B first / A first / Both in parallel
- **User selected:** B first as stopgap, Path A follow-on
- Rationale: matches CONTEXT.md's own recommendation; ships value immediately; Path A benefits from operating B for a few wave runs first

### Q2 — Per-agent research depth
- Options: light-research-just-enough / full-research-all-4 / claude-only-first
- **User selected:** Full mechanism research for all 4 upfront
- Implication: 4 parallel `gsd-phase-researcher` subagents dispatched during plan-phase, one per agent (claude / opencode / copilot / mastra). Each produces a section in RESEARCH.md (or RESEARCH-{agent}.md) covering process model + transcript location + lifecycle events + recursion + detection plan

### Q3 — Statusline-bubble mitigation
- Options: replace inside Phase 51 / defer replacement
- **User selected:** Replace inside Phase 51
- Rationale: registry IS the source of truth once Phase 51 ships; leaving the 2026-05-24 mitigation in tree creates two divergent code paths

### Auto-resolved (no question asked — derivable from locked decisions + CONTEXT.md body)

- **D-Backfill** — only the 2026-05-23 ~25 transcripts; pre-2026-05-23 historical sweep deferred (most stale `/private/tmp/` transcripts already cleaned up by GSD worktree removal)
- **D-LSL-Filename** — `{YYYY-MM-DD}_{HHHH-HHHH}_S{slot}-{idx}-{hash}[-part{N}].md` locked verbatim from CONTEXT.md proposal
- **D-Live-Sweep-Tags** — `metadata.source = "sub-agent"` (live) vs `"sub-agent-backfill"` (sweep), lets dashboard distinguish real-time vs recovered (operator alerts when live tier is silently broken)

---

## Codebase scout findings

- **Phase 50 primitives confirmed shipped on `main`** — `lib/lsl/window.mjs` (13468 B) + `lib/lsl/scan-and-convert.mjs` (11569 B), 181 tests passing across 20 suites
- **Phase 50 CLI + launchd pattern available** — `scripts/resolve-observations-from-lsl.mjs` (CLI shape template), `launchd/com.coding.lsl-resolver.plist` + `scripts/install-lsl-resolver-launchd.sh` + `scripts/lsl-resolver-job.sh` (periodic-job pattern)
- **2026-05-23 PoC scripts still in tree** — `scripts/backfill-subagent-transcripts.mjs` (5KB) + `scripts/convert-transcripts.js` (10KB), now factored into the Phase 50 primitives
- **2026-05-24 statusline mitigation locations** — `scripts/combined-status-line-projects.json` (projects-mapping with `subMt` field) + `status-line-fast.cjs` (consumer); helpers `_freshestProjectActivityAgeMs()` / `transcriptAgeMs()` locations TBD by research

---

## Cross-reference: pending todos

`gsd-sdk query todo.match-phase 51` returned 1 match (same as Phase 50):

- `2026-05-23-orphan-digest-observation-refs.md` (score 0.6, area "observability / data-integrity") — reviewed, not folded. Same broad area but different failure mode (digest→observation FK integrity, not sub-agent capture). Recorded in `<deferred>` § Reviewed Todos

---

## Deferred ideas surfaced

- Recursive sub-agent capture (Could #11) — registry reserves field, population deferred
- Cross-project sweep — out of scope (other projects use their own GSD instances)
- Provenance richness (Could #12 — auto-tag `metadata.phase = N`, `metadata.plan = NN`) — not blocking
- Sub-agent lifecycle events (Could #13) — useful follow-up but not blocking
- Pre-2026-05-23 historical backfill — most paths already cleaned up

No scope creep encountered.

---

## Anti-patterns avoided

- **Re-asking decided questions.** The 2026-05-23 CONTEXT.md already locked the LSL filename shape, the Path A/B distinction, the per-tier observation-tag scheme, the per-agent research need. None of these were re-decided.
- **Inventing structure without scout.** D-Reuse + D-Statusline were grounded in verified files-on-disk (`lib/lsl/window.mjs` exists, 181 Phase 50 tests pass, statusline-mitigation files identified by grep).
- **Over-claiming research depth.** The planner's instruction is "spawn 4 researchers" (concrete, time-boxed at 30 min per agent), not "research everything thoroughly" (vague, unbounded).

---

## Next step

`/gsd-plan-phase 51` — and per D-Research, the planner MUST dispatch 4 parallel `gsd-phase-researcher` subagents BEFORE writing PLAN.md files. Each researcher hits one agent (claude / opencode / copilot / mastra) and produces a detection plan. The planner then assembles those into the Plan order documented in D-Order.
