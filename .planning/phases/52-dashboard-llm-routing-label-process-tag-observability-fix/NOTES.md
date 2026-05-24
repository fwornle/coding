# Phase 52 — Notes (pre-planning)

Captured 2026-05-24 during phase 42.1 ukb verification run.

## Background

During the wave-analysis production run for phase 42.1, the dashboard UKB workflow
modal showed each sub-step badged with `llama-70b`, suggesting all sub-steps were
routed to Groq's llama-3.3-70b-versatile. The user noticed and asked whether we
were still sending to Groq despite the v6.x intent that Claude-code (Max) +
Copilot subscriptions be tried first.

Investigation showed two distinct, real issues. The "llama-70b" badge is purely
cosmetic — actual routing is correct — but the system is opaque enough that an
operator can't easily confirm that from the dashboard alone.

## Issue 1 — Dashboard sub-step llmModel labels are hardcoded to Groq

`integrations/system-health-dashboard/src/components/workflow/constants.ts:603`:

```ts
standard: 'llama-70b',
```

and 18+ `llmModel: 'Groq: llama-3.3-70b-versatile'` literals throughout
`constants.ts` and the legacy `ukb-workflow-graph.tsx`.

These were appropriate when Groq was the only production provider. Now they
mislead operators reading the dashboard: a sub-step badged `llama-70b` may have
actually been served by Claude-code Max or Copilot.

**Fix direction:** either (a) compute the model badge from live token-usage at
render time, or (b) relabel the static badge to reflect the tier
("standard / auto" or "preferred: claude-sonnet, fallback: llama-70b") rather
than a specific provider/model.

## Issue 3 — Wave-step progress counters jump from 0 to total at end of wave

Captured 2026-05-24 from the Workflow Trace modal at the end of the 42.1
production ukb run (screenshot in session).

The Insight Generation step in Wave 4 shows the final number ("74 docs
generated") *only after the wave completes*. While the wave is running the
counter sits at 0, then snaps to 74 at the end. Same shape for the inline
arrows on the wave rows (`8 → 8 → 8`, `26 → 26 → 26`, `40 → 40 → 40`,
`107 → 107 → 107` — start = in-progress = end because the in-progress
sample never gets emitted while the wave is still in flight).

For a 68m 42s wave this is essentially zero feedback. Operators can't tell
whether the wave is stuck at doc #3 or making steady progress through #47.

**Fix direction:**

- Emit per-item progress updates inside the wave loop (not only at
  step boundaries). Likely site: the insight-generation iteration in
  `integrations/mcp-server-semantic-analysis/src/agents/coordinator.ts` (or
  wherever the doc-generation loop lives — confirm with grep on
  `docsGenerated` / `insightDocsGenerated`).
- Pipe per-item progress through `workflow-runner.ts:469-530`-style
  `writeProgressPreservingDetails` calls so the dashboard SSE stream picks
  them up — note Phase 10 race-condition guidance in MEMORY.md before
  layering more progress writes.
- Dashboard side: ensure the `stepsDetail.{wave}.itemsCompleted` / `itemsTotal`
  fields are read and rendered as `{n}/{N}` next to the wave row.

**Suggested split** if this grows: keep it bundled with Issue 1 (dashboard
label correctness) since both touch the same display surfaces.

## Issue 2 — wave-analysis HTTP calls don't set `body.process`

Confirmed via `.data/llm-proxy/token-usage.db` for the 2026-05-24 run:

| process              | provider     | model                  | calls |
|----------------------|--------------|------------------------|------:|
| observation-writer   | claude-code  | claude-haiku-4.5       | 22    |
| health-coordinator   | claude-code  | claude-haiku-4.5       | 13    |
| **unknown**          | **copilot**  | claude-sonnet-4.6      | **6** |
| **unknown**          | **claude-code** | claude-haiku-4.5    | **4** |
| observation-writer   | claude-code  | claude-sonnet-4.6      | 2     |

The wave-analysis sub-steps (Relation Discovery, Detail Extraction, Ontology
classification, …) all show as `process='unknown'`. This means an operator
cannot pin a hard provider/model override per sub-step via the settings UI in
`integrations/system-health-dashboard` (which writes `processOverrides` in
`_work/rapid-llm-proxy/.data/llm-proxy/llm-settings.json`).

**Fix direction:** thread a meaningful `process` string through every LLM call
in `integrations/mcp-server-semantic-analysis/src/agents/{semantic-analyzer,
wave-controller, wave1-project-agent, wave2-component-agent, wave3-detail-agent,
semantic-analysis-agent}.ts` — at minimum one process per wave + sub-step
combination so the settings UI can offer per-sub-step pinning.

## Evidence cross-reference

- Proxy routing logic: `_work/rapid-llm-proxy/proxy-bridge/server.mjs:1470-1510`
  (stage 0 process-pin → stage 1 explicit body.provider → stage 2 subscription
  hint → stage 3 preference order `['claude-code', 'copilot', 'groq', 'openai',
  'anthropic']`).
- Hard pin storage: `_work/rapid-llm-proxy/.data/llm-proxy/llm-settings.json`
  → `processOverrides: { health-coordinator: ..., observation-writer: ... }`
  (wave-analysis processes are absent).
- Dashboard label source: `integrations/system-health-dashboard/src/components/workflow/constants.ts`.

## Scope notes for the planner

- Bug-fix style phase, not part of v7.1 Knowledge Management Unification scope.
- Goal: make the dashboard's claim of "what model handled this sub-step"
  *verifiable from telemetry*, and let an operator pin sub-step providers via
  the settings UI.
- Non-goal: changing the actual routing preference order — that already works
  correctly (claude-code → copilot → groq → openai → anthropic).
- Suggested split into two plans:
  - **52-01:** semantic-analysis `process` tag plumbing (Issue 2).
  - **52-02:** dashboard label correctness (Issue 1) — likely depends on 52-01
    if we go the "live token-usage at render time" route.
