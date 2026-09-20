# UseClassifierJudge

**Type:** Detail

# UseClassifierJudge — Technical Insight Document

## What It Is

`useClassifierJudge` is a React hook implemented in `integrations/system-health-dashboard/src/components/llm-routing/use-classifier-judge.ts`, responsible for polling, merging, and persisting state for the LLM classifier subsystem's backend configuration (`config/prompt-classifier.yaml`). It is consumed as a child dependency of `OffloadRoutingDecision` (`offload-decision.tsx:186`), where it is instantiated alongside — but deliberately isolated from — `useOffloadPolicyDraft`. The hook returns a `Judge` interface bundling per-backend state (`JudgeBackend[]`), whole-service error/reachability signals (`judgeError`, `judgeUrl`), and KNN-strategy diagnostics, giving the UI everything needed to both observe and edit classifier configuration without directly touching the backing file.

## Architecture and Design

The hook's central design decision is separating **config-file truth from runtime truth**: `JudgeBackend.enabled` (lines 29-45) captures what the config says should happen, while `reachable` captures what's actually happening. This split is explicitly traced to a postmortem — a 2026-09-02 incident where the classifier returned HTTP 502 for a full day while `enabled: true` remained set, leaving only a buried per-row error string with no dashboard signal. This is a documented example of an architectural decision being retrofitted from an incident rather than derived from abstract API design taste.

The same "off vs. broken" concern is mirrored at the whole-service level via `judgeError`/`judgeUrl`, populated independently of `judge` itself in `load()` — a two-tier failure-visibility design spanning both individual backend rows and total service outages.

A second core pattern is the **draft/overlay state model**: polled truth (`judge`) and in-progress edits (`draftEnabled`, `draftRubric`, `draftStrategy`) live in separate `useState` slots, combined only via a `merged` memo (lines 178-183) that overlays draft `enabled` values onto the freshly polled object while leaving `reachable`/`lastError`/`lastLatencyMs` always sourced from the latest poll. Critically, the polling `setInterval(load, pollMs)` loop (lines 129-138) is *not* paused during edits — an explicit choice, per inline comment, because "a judge can go unreachable WHILE someone is editing it." This is safe precisely because draft and polled state never share a slot.

## Implementation Details

Internally, the hook is structured as several small array transforms over a single `backends[]` list — `.map`/`.some` iterations (surfaced in the call graph as `UseClassifierJudge -> b`) power `effectiveEnabled`, `dirty`, and the `merged` memo. This composability is what enables `save()` (lines 150-176) to implement a **diff-only PATCH**: it filters `judge.backends` to only rows where `draftEnabled[b.id] !== b.enabled`, and includes `rubric`/`strategy` in the PATCH body only if actually touched (`draftRubric !== null && draftRubric !== judge.rubric`). This avoids overwriting the whole YAML file on every save, which matters because polling continues concurrently with open edits — a full-file write could clobber unrelated fields changed by another operator between poll and save.

The `Judge` interface also always includes a `knn` block and `counts.knn` sub-object, even though `strategy` defaults to `'llm'` and the backend may never populate KNN fields. `setJudge` spreads `{ strategy: 'llm', knn: {...defaults...}, ...incoming }`, guaranteeing the shape is always present so downstream UI can render KNN diagnostics unconditionally — at the cost of every consumer needing to tolerate zero-valued KNN stats as steady-state for non-KNN deployments.

## Integration Points

Inside `OffloadRoutingDecision`, `useClassifierJudge(proxyBase)` runs alongside `useOffloadPolicyDraft(proxyBase, onSaved)` as two independently polling, independently saving hooks — justified by the component's own comment that they write to different files on different machines' schedules (`llm-routing.yaml` on the proxy vs. `config/prompt-classifier.yaml` locally). The parent's gate-ladder computation (`configRungs`, built from `policy.draft`) is deliberately kept from reading `judge`/`cls` (aliased `policy.classifier`, line 225-227) — enforced simply by not passing judge state into `evaluateOffload` — so editing the rubric or toggling a backend never silently redraws counts the classifier doesn't govern. This isolation directly supports the parent's dual-mode ('config' vs 'recorded') toggle design, which depends on stable, non-cross-contaminated rung geometry.

## Usage Guidelines

Developers extending this hook should preserve the enabled/reachable separation rather than collapsing it into a single status flag — that distinction exists specifically to prevent silent-failure ambiguity discovered in production. Saves must remain diff-based; resist the temptation to PATCH the full backend list or rubric/strategy unconditionally, as this reintroduces the stale-overwrite race the current design avoids. When adding new draft fields, follow the existing pattern of separate `useState` slots merged only at render via `merged`, and never pause polling to "protect" a draft — the concurrent-poll behavior is intentional. Finally, any new hook composed alongside `useClassifierJudge` in `OffloadRoutingDecision` should default to isolation unless a real coupling requirement is proven, consistent with the `configRungs`/`evaluateOffload` boundary.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- useClassifierJudge (function) in use-classifier-judge.ts

**Relationships:**
- Calls: b

**Other:**
- Call chain: UseClassifierJudge -> b
- The code graph's `call_graph` entry `UseClassifierJudge -> b` reflects the hook's internal `.map(b => ...)` / `.some(b => ...)` iteration idiom over `judge.backends` (parameter conventionally named `b`), visible in `effectiveEnabled`, `dirty`, and the `merged` memo — the hook's core logic is structured as several small array transforms over a single `backends[]` list rather than a monolithic state object, which is what let the diff-based `save()` and the overlay-based `merged` view be implemented as independent, composable functions.


## Hierarchy Context

### Parent
- [OffloadRoutingDecision](./OffloadRoutingDecision.md) -- [LLM] OffloadDecision (offload-decision.tsx) is architected around a dual-mode toggle — 'config' (routes, answering 'what will happen') versus 'recorded' (calls, answering 'what did happen') — that deliberately share the same GATES/rung geometry so an operator can flip between intent and behaviour without re-reading a layout. This is a single-component design choice explicitly justified in the header comment rather than splitting into two cards, trading some internal branching complexity (mode-dependent counts, detail strings) for a consistent mental model at the UI layer.


---

*Generated from 13 observations*
