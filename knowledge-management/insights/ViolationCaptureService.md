# ViolationCaptureService

**Type:** SubComponent

## What It Is

`ViolationCaptureService` is implemented in `violation-capture-service.js`, exposing a `ViolationCaptureService` class and a `getViolationCaptureService` accessor function (per the code graph, entries 3–4). It is a sub-component of `ConstraintSystem`, sitting alongside siblings `HookConfigLoader`, `UnifiedHookManager`, `HealthPromptHook`, and `KnowledgeInjectionHooks`. Beyond these two named entities, no source file for `violation-capture-service.js` was actually supplied in this evidence set — all five code files retrieved for this analysis (workflow-graph dashboard hooks, CLI gating tests, dashboard polling hooks, `hooks-api.js`, `claude-bridge.js`) belong to adjacent "hooks"/"dashboard" neighborhoods and make no reference to this service (observations 6–7). This document is therefore grounded strictly in the code graph's entity list and the architectural context supplied by parent/sibling records, not in the service's actual method bodies.

## Architecture and Design

The `get*Service` naming of `getViolationCaptureService` is consistent with a singleton-accessor pattern — lazily instantiating and caching a module-level instance — mirrored elsewhere in this codebase (e.g., the eager-initialization pattern in `UnifiedHookManager`'s `hook-manager.js` and the abstract `HooksManager` base class in `lib/agent-api/hooks-api.js`). However, this pattern is unconfirmed beyond the entity name itself (observation 10); no `sanitizeParams`, `updateViolationHistory`, or other methods appear in the supplied graph slice.

Architecturally, `ViolationCaptureService` sits under `ConstraintSystem`, whose violation data is consumed by a Next.js-based "constraint-monitor" dashboard — distinct from the Vite-based system-health-dashboard used elsewhere (observations 2, 9). This implies a clean separation between the capture/persistence layer (this service) and its presentation layer, which lives in a separate frontend stack and deploy pipeline.

![ViolationCaptureService — Architecture](images/violation-capture-service-architecture.png)

## Implementation Details

The only implementation facts available are the two graph entities: the `ViolationCaptureService` class itself and its `getViolationCaptureService` singleton-accessor function, both in `violation-capture-service.js` (observations 3–5, 12). No internal methods, data structures, or persistence mechanisms (e.g., JSONL audit logging, sanitization routines) can be confirmed from the current evidence, despite such capabilities being plausible given the service's name and domain. Claims about internal structure beyond the class/function pair would be speculative and are explicitly excluded here.

## Integration Points

Functionally, `ViolationCaptureService` is presumed to produce the violation data that feeds the constraint-monitor dashboard, which is surfaced through the tmux statusline: clicking the "constraints" field opens or focuses this dashboard tab (observation 1). This ties the service into the broader `ConstraintSystem` click-driven statusline UX described in the parent hierarchy context. The constraint-monitor dashboard (Next.js) is architecturally separate from the system-health-dashboard (Vite), meaning this service's consumers are not the dashboard hook files retrieved during this analysis (observation 9).

![ViolationCaptureService — Relationship](images/violation-capture-service-relationship.png)

No confirmed dependency exists between `ViolationCaptureService` and sibling hook components (`HookConfigLoader`, `UnifiedHookManager`, `HealthPromptHook`, `KnowledgeInjectionHooks`) beyond shared membership under `ConstraintSystem` and a structurally similar singleton/registration naming convention seen elsewhere in the hooks ecosystem.

## Usage Guidelines

Given the sparse verified evidence, the primary guideline is caution: a session record indexed as "about ViolationCaptureService" (the "Multi-Repo Commit Hygiene" record) actually describes an unrelated personal workflow involving `gh`, `rapidscribe-meeting`, and EF-412 feedback filing, with no mention of violation capture at all (observations 8, 11). This indicates the record-to-component tagging for this entity is unreliable and should not be trusted as documentation of behavior. Future retrieval or documentation efforts should specifically target `scripts/violation-capture-service.js` directly rather than relying on filename/keyword-substring matches, which have repeatedly surfaced the adjacent hooks/dashboard neighborhood instead of the actual implementation (observation 7). Any future insight generation for this component should treat prior "session" evidence with skepticism until re-verified against genuine source and record content.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- ViolationCaptureService (class) in violation-capture-service.js
- getViolationCaptureService (function) in violation-capture-service.js

**Other:**
- The code graph confirms exactly two entities for this component: a `ViolationCaptureService` class and a `getViolationCaptureService` accessor function, both located in `violation-capture-service.js`. The `get*Service` naming convention is consistent with a singleton-accessor pattern (lazily instantiate-and-cache a module-level instance), but the graph slice supplied here contains no further entities — no `sanitizeParams`, `updateViolationHistory`, or other methods — so the internal method structure cannot be independently confirmed from this evidence beyond the class/function pair.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- Statusline Click-Click-Report Feature work record establishes that clicking the 'constraints' field in the tmux statusline opens or focuses the constraint-monitor dashboard tab that displays this service's output.
- The HealthDashboard architecture record groups the constraint-monitor dashboard (Next.js) alongside the system-health-dashboard (Vite) as the two operational dashboards fed by click-through health reporting, implying ViolationCaptureService output is consumed specifically by the Next.js constraint-monitor app.
- The session record titled 'Rec Project — Multi-Repo Commit Hygiene', indexed as 'about ViolationCaptureService' in the work-record list, in fact describes an unrelated personal workspace workflow — creating/managing GitHub Enterprise repos via `gh`, recording meetings via the `rapidscribe-meeting` CLI, and filing EF-412 team-feedback entries in a second-brain vault — with no mention of violation capture, sanitization, or JSONL audit logging, indicating the record-to-component tagging for this entity is likely mismatched rather than substantively descriptive.
- The HealthDashboard architecture record establishes that ConstraintSystem violation data — the category of output a service named `ViolationCaptureService` would plausibly produce — feeds a Next.js-based 'constraint-monitor' dashboard that is architecturally distinct from the Vite-based system-health-dashboard, implying any UI consuming this service's persisted records sits in a separate frontend stack and build/deploy pipeline from the one shown in the supplied `usePolledFetch.ts`/`hooks.ts` files.

## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- [SESSION] The Statusline Click-Report Feature work record establishes that clicking the 'constraints' field in the tmux statusline opens or focuses the constraint-monitor dashboard tab, integrating ConstraintSystem output into the click-driven statusline UX

### Siblings
- [HookConfigLoader](./HookConfigLoader.md) -- [CGR] HookConfigLoader (class) in hook-config.js
- [UnifiedHookManager](./UnifiedHookManager.md) -- [CGR] UnifiedHookManager (class) in hook-manager.js
- [HealthPromptHook](./HealthPromptHook.md) -- [SESSION] obs-api Service Lifecycle record notes an open, unresolved defect where a coverage metric denominator wrongly includes 'observations' and 'digests' entity types, skewing values this hook's summary could reflect.
- [KnowledgeInjectionHooks](./KnowledgeInjectionHooks.md) -- [LLM] lib/agent-api/hooks-api.js defines an abstract `HooksManager` base class whose constructor pre-populates `this.hooks` (a `Map<string, RegisteredHook[]>`) with an empty array for every value in the `HookEvent` enum, exactly mirroring the eager-initialization pattern the parent context attributes to `hook-manager.js`'s `UnifiedHookManager`. This is a distinct file from `hook-manager.js` — `hooks-api.js` exposes `registerHook()`/`unregisterHook()`/`triggerHook()` as a generic interface, while subclasses must implement `getAgentType()`, `loadNativeHooks()`, and `saveNativeHooks()` (all of which throw 'must be implemented by subclass' if unimplemented here), so this file is the abstract contract rather than the concrete dispatcher.


---

*Generated from 12 observations*
