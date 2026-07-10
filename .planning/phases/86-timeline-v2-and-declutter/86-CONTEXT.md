# Phase 86: Timeline v2 & Performance Page Declutter - Context

**Gathered:** 2026-07-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Turn the run timeline into a **per-turn story** and declutter the performance-page IA.

**Timeline v2** — each turn renders as a compact, scannable row (user-prompt excerpt, tool-call chips, token cost with cache split, a mini context-window band) that opens a **rich single-turn drill-down modal**; a separate **fullscreen** view shows the whole run's timeline. A **full difference viewer** compares two paired runs (`rerun_of`) side-by-side from their first divergence point. Runs without Phase-84 context-turns data **degrade gracefully** to the v1 row.

**Declutter** — surface the quarantine toggle to page level, streamline scoring to inline row edits, add reconciliation status badges, and wire compare-from-selection.

**Data source is Phase-84 context-turns** (`/api/context-turns`): per-turn `role`, byte sizes, `tool_use` name + arg size, cache split (`input`/`cache_read`/`cache_write`/`output`), cache-breakpoint message indices, reused category taxonomy, and an ETM-observation reference or ~120-char preview fallback. This phase **consumes** that data through richer UI — it adds no new capture.

**Depends on:** Phase 82, 84 (context-turns data + cache columns), Phase 83 (reconciliation badge source), Phase 85 (`rerun_of`/`base_variant` run-pairing metadata — the difference viewer's foundation).

**Out of scope (belongs elsewhere):**
- Any change to token/context **capture** — measured-span-only, owned by Phases 82–84.
- New reconciliation/discrepancy **semantics** — owned by Phase 83 (this phase only surfaces the existing status).
- Interactive spans / branch avenues → **Phase 87**.
- Live agent-output tail streaming in the monitor — rejected in Phase 85 (D-04/D-10), still out.

**Scope note for the planner:** the user chose the **full** difference viewer (not the light "wire into existing RunCompare" option). This materially enlarges the phase — it introduces a run-alignment algorithm, a first-divergence detector, and a loop heuristic. Size the plan accordingly; this is a deliberate, Phase-85-sanctioned inclusion, not scope creep.
</domain>

<decisions>
## Implementation Decisions

### Turn anatomy & drill-down
- **D-01: Compact row + rich modal.** The turn row stays scannable — prompt excerpt (1 line) + tool-name chips + token/cache summary + mini per-turn context band. The **drill-down modal** (click the turn) holds the full detail: complete message list, each `tool_use` name + arg digest, cache-breakpoint positions, per-message byte sizes, raw preview. Evolves the existing role-aware `timeline.tsx` row, not a rewrite.
- **D-02: Modal = one turn; Fullscreen = whole timeline.** The modal is a single-turn deep dive. A separate **fullscreen** button expands the entire run's timeline to its own full-viewport view (long runs / walking a whole trajectory / presenting) — more turns visible, keyboard nav. Two distinct purposes, not the same content at two sizes.
- **D-03: Semantic-first tool args.** Show tool **name + arg size + the ETM observation intent line** (Phase-84 D-07's primary "what this did" field). Show **full arg text only when `capture_raw_bodies` was ON** for that span. Never fabricate arg content for spans without raw capture — degrade to name + size + semantic line.

### Context-window band
- **D-04: Both — mini inline + full cumulative band.** Each row carries a **mini per-turn bar** (glanceable); the **fullscreen/modal** renders the **full cumulative growth band** across the whole run (context window filling turn-by-turn — history accreting, tools/system steady). The cumulative band is the visual that tells the "why did this run cost more" story behind the difference viewer.
- **D-05: Category length + cache-state overlay.** Segment **length encodes the category taxonomy** (system / tools / history / fresh — **reuse the existing context-breakdown taxonomy** at the proxy's `perRunBreakdownPath`, Phase-84 D-08, one taxonomy across both surfaces). A **cached-vs-fresh overlay** (opacity/hatching) shows how much of each category was `cache_read`. Honest rendering only — the cached portion comes from measured wire values, **never inferred** (Phase-84 D-12; OpenAI-wire agents that report no cache-creation render "N/A", not 0).
- **D-06: Graceful degradation → v1 rows.** Runs with **no Phase-84 context-turns data** (pre-84 runs, interactive non-measured spans) fall back to today's v1 timeline row (turn label + tokens + observation lines) with the v2 enrichments (band, cache split, tool digests) simply absent, plus a subtle **"no per-turn context captured"** note. Nothing is lost; the run stays readable.

### Difference viewer (full)
- **D-07: Full divergence-point trajectory diff.** Select two **paired** runs → **auto-align** their per-turn sequences, **auto-detect the first divergence point**, render side-by-side **from that divergence** with **cumulative token deltas** per turn and **loop badges** on repeated tool signatures. The identical prefix before divergence is **collapsed** by default. Reuses the D-01 turn components + D-04 bands. Consumes Phase-85 `rerun_of` pairs + Phase-84 context-turns.
- **D-08: Entry via runs-table multi-select.** Compare-from-selection lives in the **runs-table**: multi-select checkboxes (`toggleRunSelected` already exists) surface a **"Compare selected (2)"** action that opens the difference viewer. Natural home; leverages existing selection state.
- **D-09: Advisory loop badges on single runs too.** A subtle **"possible loop"** badge marks turns that repeat a recent tool-call signature (same tool + similar args). Shown on **any single run**, not only in compare — makes "this run looped 4× on the same failing test" visible at a glance. **Advisory, never asserted** (the heuristic is fuzzy); the diff viewer's loop badges share this same detector.

### Declutter IA
- **D-10: Quarantine → page-level control.** Promote the "show quarantined runs" toggle out of the faceted sidebar to a **prominent header-row control** near the summary cards / runs-table header, **with a count** ("Show quarantined (3)") so hidden trivial/unclassified runs are discoverable. (Currently buried in `faceted-sidebar.tsx`.)
- **D-11: Scoring → inline row edits, no drawer.** Streamline the score-**override** flow: make score cells **inline-editable in the runs-table row** (edit + autosave), eliminating the separate "Edit scores" drawer round-trip. The judge (`judge.mjs`/`score-write.mjs`) still writes the authoritative scores; the server still re-validates every override (the drawer's existing `saveOverride` PATCH contract is preserved — this is a surface change, not a scoring-logic change).
- **D-12: Reconciliation badge on row + header.** Surface Phase-83 reconciliation status out of the cache-explainer: a **glanceable per-run badge in the runs-table row** (✓ reconciled / ⚠ Δ discrepancy / transcript-fallback) **and** the **detailed reconciliation note on the open run's timeline header** (e.g. "wire 12.0k = transcript 12.0k, 0 discrepancies").

### Claude's Discretion
- Exact modal/fullscreen component mechanics (Radix Dialog vs a routed fullscreen), band render approach (SVG vs CSS), and mini-band token→width scaling.
- The **run-alignment rule** for D-07 (align by turn index vs tool-call signature vs timestamp) and the **loop-heuristic definition** for D-09 (what counts as a "repeat" — exact-args vs fuzzy, window size) — captured as **research hand-offs** below; planner/researcher pins them.
- Redux surface layout for the diff viewer + inline-score-edit state (extend `performanceSlice` vs a new slice).
- Reconciliation badge status vocabulary/colours and the exact quarantine-count query.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Prior locked decisions this phase inherits
- `.planning/phases/84-per-turn-context-revelation/84-CONTEXT.md` — the context-turns data contract this phase renders: per-turn JSONL schema (D-07 semantic-first digest, D-08 category taxonomy + cache-breakpoint message indices, D-09 cache split separate), the `/api/context-turns` read API (D-10), and the existing cache-explainer extension (D-11) + honest all-agents cache display (D-12). **Read first.**
- `.planning/phases/85-experiment-control-center/85-CONTEXT.md` — run-pairing metadata the difference viewer consumes (D-05 `rerun_of`, D-07 `base_variant`, same `task_hash` comparability); the "difference viewer is the north-star for re-runs" specifics line explicitly hands this feature to Phase 86.
- `.planning/phases/83-token-reconciliation-layer/83-CONTEXT.md` — the reconciliation status/`reconciliation.json` semantics D-12 surfaces (do not re-implement; only badge it).
- `CLAUDE.md` — no-console-log (`process.stderr.write`), constraint-dodging forbidden, and the **dashboard rebuild recipe** (bind-mount + VirtioFS cache gotchas; `npm run build` + restart frontend for UI changes) — mandatory for verifying every UI change on `:3032`.

### Requirements this phase satisfies
- `.planning/REQUIREMENTS.md` — **DASH-02** (timeline renders per-reasoning-step rows as stacked sub-bands + `granularity_tier` badge — already partly present, v2 keeps it), **VALID-01/ATTR-02** (canonical model attribution shown honestly in timeline/score-drawer/runs-table — the difference viewer and inline scores must not reintroduce dominant-vs-first-row divergence).

### UI files to extend (coding repo — dashboard)
- `integrations/system-health-dashboard/src/components/performance/timeline.tsx` — the v1 role-aware turn narrative to evolve into v2 (ParentRow, SubBand, TurnObservations, TierBadge, ProcessPill; collapsible children = reasoning sub-bands). **Primary target.**
- `integrations/system-health-dashboard/src/components/performance/context-cache-explainer.tsx` — existing per-turn cache split + context-window anatomy band + reconciliation note (~865). Source of the band's category colours (D-05) and the reconciliation copy D-12 relocates.
- `integrations/system-health-dashboard/src/components/performance/runs-table.tsx` — `toggleRunSelected`/`selectSelectedTaskId` (D-08 compare-select), the per-row "Edit scores" trigger to replace with inline edits (D-11), and where the quarantine control (D-10) + reconciliation row badge (D-12) integrate.
- `integrations/system-health-dashboard/src/components/performance/score-drawer.tsx` — the `saveOverride` PATCH contract + `SCORE_DIMENSIONS` (from `./corrected-wins`) that inline editing (D-11) must preserve server-side.
- `integrations/system-health-dashboard/src/components/performance/run-compare.tsx` — existing metrics compare; the difference viewer (D-07) either extends or sits beside it.
- `integrations/system-health-dashboard/src/components/performance/faceted-sidebar.tsx` — current quarantine toggle location (~121–138) that D-10 promotes out.
- `integrations/system-health-dashboard/src/pages/performance.tsx` — the page IA (Tabs: Runs / Compare / Reports; SummaryCards; sidebar+table+timeline layout) where declutter placement lands.
- `integrations/system-health-dashboard/src/store/slices/performanceSlice.ts` — `fetchContextTurns`/`selectContextTurnsFor` (Phase-84) + `fetchTimeline`/`RunScore`/`saveOverride` thunks/selectors to extend for the diff viewer + inline scores.

### Read APIs the UI calls
- `lib/vkb-server/api-routes.js` — `handleContextTurns` (`/api/context-turns`, Phase-84 D-10) + `handleReconciliation` (Phase-83) thin verbatim-serve read routes the UI consumes; `/api/experiments/scores/:taskId` PATCH for score overrides.
- `integrations/system-health-dashboard/server.js` — container→host proxy passthrough for the above.

### Difference-viewer data foundation (Phase 85)
- `lib/experiments/run-write.mjs` + `lib/experiments/query.mjs` — Run record shape carrying `rerun_of`/`base_variant`; `readRuns` for pairing lookups (D-07/D-08).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`timeline.tsx` turn components** (ParentRow, SubBand, TurnLabel, TierBadge, ProcessPill, `assignObservationsToTurns`): the v1 narrative is already role-aware with tier badges + collapsible reasoning sub-bands + observation→digest chaining — v2 adds the band, cache split, tool digests, modal, and fullscreen on top.
- **`context-cache-explainer.tsx`**: already renders per-turn cache splits + a context-window anatomy band + the reconciliation note — the category colours (D-05) and reconciliation copy (D-12) come from here.
- **`fetchContextTurns`/`selectContextTurnsFor`** (Phase-84, `performanceSlice.ts`): the per-turn data feed already exists — v2 reads it; no new fetch plumbing for turn detail.
- **`toggleRunSelected` + selection selectors** (`runs-table.tsx`): multi-select state for D-08 compare-from-selection already present.
- **`saveOverride` PATCH thunk + server-authoritative validation** (`score-drawer.tsx`): reuse for D-11 inline edits — keep the contract, change only the surface.
- **`handleContextTurns`/`handleReconciliation` thin read-API pattern**: verbatim-serve + graceful-ENOENT; nothing new server-side for reading.

### Established Patterns
- **Extend, don't replace** (Phase-84 D-11 lineage): v2 evolves existing components.
- **Honest measurement / never infer** (Phase-84 D-12): band cache overlay + reconciliation badge show measured values or "N/A", never a fabricated number.
- **Server-authoritative score writes**: inline edits still PATCH + re-validate; the client never becomes the source of truth.
- **Dashboard rebuild discipline** (CLAUDE.md): bind-mount + VirtioFS cache means `npm run build` + frontend restart to see UI changes; visual verification via `gsd-browser` on `:3032` (feedback_dashboard_screenshots_gsd_browser).

### Integration Points
- v2 turn detail modal + fullscreen route/dialog off `timeline.tsx`.
- Difference viewer: new component reading two runs' context-turns + Phase-85 pairing metadata; entry action in `runs-table.tsx`; likely a new Compare-tab surface or extension of `run-compare.tsx`.
- Declutter: quarantine control → `performance.tsx` header; inline score cells → `runs-table.tsx` rows; reconciliation badge → runs-table row + timeline header.
</code_context>

<specifics>
## Specific Ideas

- **The difference viewer is the user's north-star** (carried from Phase 85): "see where two runs differ and how the different decisions lead to more or fewer tokens, more or fewer loops." The user chose the **full** version — auto-aligned, first-divergence-highlighted, cumulative token deltas, loop badges, identical prefix collapsed. Treat run-pairing (`rerun_of`) as a hard input, not decoration.
- **"More or fewer loops" is a first-class concern** — hence advisory loop badges surface on single runs (D-09), not only in compare.
- **The cumulative growth band tells the cost story** — the user picked "both" specifically so the whole-run band (context accreting) is available in fullscreen, beyond the per-row glance.
- **Honest over pretty** — cached-state overlay and reconciliation badge must reflect measured wire values; "N/A (provider limitation)" over an inferred cache number for OpenAI-wire agents.
</specifics>

<deferred>
## Deferred Ideas

- **Live agent-output tail in the timeline/monitor** — rejected in Phase 85 (D-04/D-10: hot-path churn, redaction scope, needs a streaming endpoint). Not this phase.
- **Queueing launches when the span slot is busy** — Phase-85 D-02 deferral, unrelated to Phase 86.
- **Line-size ceiling / pagination on `/api/context-turns`** for very large spans — Phase-84 deferral; revisit only if a span's context-turns file grows unwieldy enough to bog the modal/fullscreen render.

**Research hand-offs (for gsd-phase-researcher, not user decisions):**
- **Run-alignment rule for the difference viewer (D-07).** How to align two runs' per-turn sequences and detect the first divergence — by turn index, by tool-call signature, or a hybrid — given repeats and interleaved reasoning sub-bands. Pin the alignment + divergence-detection algorithm; the "collapse identical prefix" behaviour depends on it.
- **Loop-heuristic definition (D-09).** What counts as a "repeat" tool-call signature (exact args vs fuzzy match, look-back window, minimum repeat count) so the advisory badge is useful without crying wolf. Same detector serves single-run badges and the diff viewer.
- **Turn → ETM observation correlation** is already solved upstream (Phase-84 D-07); v2 consumes the reference/preview field, no new correlation work.

### Reviewed Todos (not folded)
The `todo.match-phase` scan surfaced only low-relevance (score ≤0.6) VKB/observability/km-core items — orphan digest refs, OKM Express API contract, LSL timeline 200-cap, online-learning filter/hierarchy — the same set reviewed and not folded in Phases 78/84/85. None concern the performance-tab timeline UI, the difference viewer, or the declutter items. Reviewed and **not folded** — they belong to the VKB/observability workstream.

</deferred>

---

*Phase: 86-timeline-v2-and-declutter*
*Context gathered: 2026-07-10*
