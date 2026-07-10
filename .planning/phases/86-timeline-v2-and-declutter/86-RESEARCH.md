# Phase 86: Timeline v2 & Performance Page Declutter - Research

**Researched:** 2026-07-10
**Domain:** React/Redux dashboard UI — per-turn timeline visualization, run-pair difference viewer (sequence alignment + loop heuristic), performance-page IA declutter. Pure **consumer** of Phase 82/83/84/85 data; adds no capture.
**Confidence:** HIGH (codebase is fully read; the two research hand-offs are grounded in the real data contract + an authoritative algorithm; no new packages)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Turn anatomy & drill-down**
- **D-01: Compact row + rich modal.** Turn row stays scannable (prompt excerpt 1 line + tool-name chips + token/cache summary + mini per-turn context band). Click → drill-down modal holds full detail (complete message list, each `tool_use` name + arg digest, cache-breakpoint positions, per-message byte sizes, raw preview). **Evolves the existing role-aware `timeline.tsx` row, not a rewrite.**
- **D-02: Modal = one turn; Fullscreen = whole timeline.** Modal is a single-turn deep dive. A separate **fullscreen** button expands the entire run's timeline to its own full-viewport view (more turns visible, keyboard nav). Two distinct purposes.
- **D-03: Semantic-first tool args.** Show tool **name + arg size + the ETM observation intent line** (Phase-84 D-07 primary field). Show full arg text **only when `capture_raw_bodies` was ON** for that span. Never fabricate arg content for spans without raw capture — degrade to name + size + semantic line.

**Context-window band**
- **D-04: Both — mini inline + full cumulative band.** Each row carries a mini per-turn bar (glanceable); fullscreen/modal renders the full cumulative growth band across the whole run.
- **D-05: Category length + cache-state overlay.** Segment length encodes the category taxonomy (system / tools / history / fresh — **reuse the existing context-breakdown taxonomy** at the proxy's `perRunBreakdownPath`, Phase-84 D-08, one taxonomy across both surfaces). A cached-vs-fresh overlay (opacity/hatching) shows how much of each category was `cache_read`. **Honest only** — cached portion from measured wire values, never inferred (OpenAI-wire agents render "N/A", not 0).
- **D-06: Graceful degradation → v1 rows.** Runs with no Phase-84 context-turns data fall back to today's v1 timeline row with v2 enrichments simply absent, plus a subtle "no per-turn context captured" note.

**Difference viewer (full)**
- **D-07: Full divergence-point trajectory diff.** Select two **paired** runs → auto-align per-turn sequences, auto-detect first divergence, render side-by-side from that divergence with cumulative token deltas per turn and loop badges on repeated tool signatures. Identical prefix before divergence **collapsed** by default. Reuses D-01 turn components + D-04 bands. Consumes Phase-85 `rerun_of` pairs + Phase-84 context-turns.
- **D-08: Entry via runs-table multi-select.** Compare-from-selection in the runs-table: multi-select checkboxes (`toggleRunSelected` exists) surface a "Compare selected (2)" action that opens the difference viewer.
- **D-09: Advisory loop badges on single runs too.** Subtle "possible loop" badge marks turns that repeat a recent tool-call signature. Shown on any single run, not only in compare. **Advisory, never asserted** (the heuristic is fuzzy); the diff viewer's loop badges share this same detector.

**Declutter IA**
- **D-10: Quarantine → page-level control.** Promote the "show quarantined runs" toggle out of the faceted sidebar to a prominent header-row control near the summary cards / runs-table header, **with a count** ("Show quarantined (3)").
- **D-11: Scoring → inline row edits, no drawer.** Score cells inline-editable in the runs-table row (edit + autosave), eliminating the separate "Edit scores" drawer round-trip. The judge still writes authoritative scores; the server still re-validates every override (the existing `saveOverride` PATCH contract is preserved — surface change, not scoring-logic change).
- **D-12: Reconciliation badge on row + header.** Glanceable per-run badge in the runs-table row (✓ reconciled / ⚠ Δ discrepancy / transcript-fallback) AND detailed reconciliation note on the open run's timeline header.

### Claude's Discretion
- Exact modal/fullscreen component mechanics (Radix Dialog vs routed fullscreen), band render approach (SVG vs CSS), mini-band token→width scaling.
- **The run-alignment rule for D-07** and **the loop-heuristic definition for D-09** — captured as **research hand-offs**; researcher/planner pins them. **(This RESEARCH pins both — see Architecture Patterns §2 and §3.)**
- Redux surface layout for the diff viewer + inline-score-edit state (extend `performanceSlice` vs new slice).
- Reconciliation badge status vocabulary/colours and the exact quarantine-count query.

### Deferred Ideas (OUT OF SCOPE)
- Any change to token/context **capture** (measured-span-only, owned by Phases 82–84).
- New reconciliation/discrepancy **semantics** (owned by Phase 83 — this phase only surfaces the existing status).
- Interactive spans / branch avenues → **Phase 87**.
- Live agent-output tail streaming in the monitor — rejected in Phase 85 (D-04/D-10), still out.
- Line-size ceiling / pagination on `/api/context-turns` for very large spans — revisit only if a span's file bogs the modal/fullscreen render.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DASH-02 | Timeline renders `per-reasoning-step` rows as stacked sub-bands under their parent turn + shows each run's `granularity_tier` as a badge so cross-tier averages aren't over-interpreted. **Already present in v1** (`SubBand`, `TierBadge`, `ParentRow` collapsible children in `timeline.tsx`). | v2 **must preserve** the `children` sub-band rendering + `TierBadge` when it evolves the row. The alignment algorithm (§2) must treat per-reasoning-step children as sub-bands under a parent turn, not as top-level turns — align on parent turns only. Confirmed shape: `TimelineRow.children?: TimelineRow[]`, `granularity_tier ∈ {per-turn, per-reasoning-step, per-session-aggregate}`. |
| VALID-01 / ATTR-02 | Canonical model attribution shown honestly (no dominant-vs-first-row divergence) across runs table, score drawer, timeline. The diff viewer + inline scores must not reintroduce divergence. | v2 surfaces MUST read `run.canonical_model` / `run.canonical_agent` / `run.background_models` **verbatim** (never recompute per surface). The diff viewer's two-run header and the inline score cells inherit this: read `canonical_model`, render `italic "unmeasured"` when null — never a dominant fallback. Both DASH-02 and ATTR-02 are marked **Complete** in REQUIREMENTS.md; this phase is a *no-regression* obligation, not a new implementation. |

**Note:** CONTEXT names DASH-02 and VALID-01/ATTR-02 as *satisfied/preserved*, not newly built. Treat them as regression anchors: every v2 acceptance test must assert the tier badge, the sub-band children, and the canonical-model read-through survive the evolution.
</phase_requirements>

## Summary

Phase 86 is a **pure frontend consumption** phase in the `system-health-dashboard` React/Redux app (performance page on `:3032`). Every backend data contract it needs already ships: the per-turn `ContextTurnRow[]` (Phase 84, `fetchContextTurns`/`selectContextTurnsFor`), the run-pairing metadata `rerun_of`/`base_variant`/`task_hash` (Phase 85, on the `Run` index signature), and the reconciliation status (`/api/experiments/runs/:taskId/reconciliation`, Phase 83). No new backend routes, no new capture, **no new npm packages** — every dependency the phase needs (React 18.3.1, Radix Dialog 1.1.15, recharts 3.6.0, react-router-dom 7.14.0, @reduxjs/toolkit 2.11.2) is already installed.

The two highest-value outputs are the **run-alignment / first-divergence algorithm (D-07)** and the **loop heuristic (D-09)**, both delegated by CONTEXT. This research pins both against the *real* data shapes. Alignment operates on the **`ContextTurnRow[]`** sequence keyed by a **normalized tool-call signature** derived from `messages[].tool.{name,size}`, with a **greedy common-prefix walk for divergence detection wrapped by a Myers/LCS re-sync of the divergent tail** — the identical prefix is the longest common prefix by signature, and "first divergence" is the first index where the signatures differ. The loop heuristic is a **fuzzy, non-adjacent, windowed** repeat detector (look-back window ~6 turns, signature = `tool_name` + coarse size bucket, min repeat count ≥ 2 within the window) — deliberately **distinct from** the existing strict-adjacent `loopCount` in `lib/experiments/route-heuristics.mjs`, which serves a different (backend, exact-args, adjacent-only) purpose.

The declutter items (D-10 quarantine → page header, D-11 inline score edits, D-12 reconciliation badge) are small surface relocations that reuse existing state (`includePending`, `saveOverride`, `handleReconciliation`) — the risk there is **not preserving the server-authoritative contract** (D-11) and **not inferring cache/reconciliation values** (D-05/D-12 honesty rule).

**Primary recommendation:** Evolve `timeline.tsx` in place (never rewrite). Author two pure, unit-testable TS modules — `run-align.ts` (signature + LCS-based prefix/divergence) and `loop-heuristic.ts` (windowed fuzzy repeat) — under `src/components/performance/`, tested with Jest (root `ts-jest` ESM harness — the dashboard has **no** vitest/jest of its own) against fixture run-pairs. Render bands as **CSS width-% div segments** (reuse the existing `scaledBand`/`SEGMENTS` from `context-cache-explainer.tsx`), use **Radix `Dialog`** for the single-turn modal (already imported in that file) and a **`react-router` route** (`/performance/timeline/:taskId`) for the fullscreen view. Verify every UI change visually on `:3032` via `gsd-browser` per CLAUDE.md.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-turn row / modal / fullscreen render | Browser (React component) | — | Pure presentation of already-fetched Redux state |
| Run-alignment + first-divergence detection | Browser (pure TS module) | — | Operates on two `ContextTurnRow[]` already in the store; no server round-trip; deterministic + unit-testable client-side |
| Loop heuristic | Browser (pure TS module) | — | Advisory badge computed from the in-memory turn sequence; fuzzy/UI-only — deliberately NOT the backend `route-heuristics.mjs` metric |
| Context-window band scaling | Browser (CSS/div render) | — | Reuses `scaledBand` byte→width math already in `context-cache-explainer.tsx` |
| Context-turns / reconciliation / run data | API (vkb-server, existing) | Database (`.data/measurements/`) | Already served by `handleContextTurns` / `handleReconciliation` / `readRuns` — **zero new backend work** |
| Inline score override (D-11) | API (vkb-server, existing PATCH) | Browser (optimistic UI) | Server re-validates + persists `corrected_*` (authoritative); browser only issues the existing `saveOverride` PATCH + optimistic display |
| Quarantine toggle (D-10) | Browser (relocate control) | API (existing `?includePending`) | Pure control relocation from sidebar to page header; the fetch param already exists |

## Standard Stack

This phase adds **no packages**. It uses what is installed. Confirmed via `node_modules/*/package.json` on 2026-07-10.

### Core (already installed — do NOT reinstall)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react | 18.3.1 [VERIFIED: node_modules] | Component model | Dashboard's framework |
| @reduxjs/toolkit | 2.11.2 [VERIFIED: node_modules] | State (`performanceSlice`) | All shared perf state already lives here |
| @radix-ui/react-dialog | 1.1.15 [VERIFIED: node_modules] | Single-turn drill-down **modal** (D-01) | **Already imported + used** in `context-cache-explainer.tsx` (`KbDetailDialog`) — mirror that pattern |
| react-router-dom | 7.14.0 [VERIFIED: node_modules] | **Fullscreen** timeline route (D-02) | `<Routes>` already wires `/performance` in `App.tsx`; add a child route for full-viewport view |
| lucide-react | 0.544.0 [VERIFIED: node_modules] | Icons (badges, chips) | Existing icon set (`Pencil`, `Layers`, `RotateCcw`, `ChevronRight`) |

### Supporting (already installed)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| recharts | 3.6.0 [VERIFIED: node_modules] | Existing per-turn cache bar chart in explainer | ONLY if a charted view is needed; the **band itself is plain CSS divs**, not recharts (see Architecture §4) |
| @radix-ui/react-collapsible | 1.1.2 [VERIFIED: node_modules] | Reasoning sub-bands + prefix-collapse (D-07) | Reuse `Collapsible` (already in `timeline.tsx`) for the "identical prefix collapsed" region |
| @radix-ui/react-tooltip | 1.2.8 [VERIFIED: node_modules] | Loop-badge / cache "N/A" explanations | Existing `Tooltip` pattern |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Radix Dialog for modal | A routed modal (`react-router` overlay) | Dialog is already installed, imported, and matches the `KbDetailDialog` precedent — routed modal adds URL state the single-turn view doesn't need. **Use Dialog for the modal; use a route only for fullscreen (D-02 makes them distinct purposes).** |
| CSS div band | recharts stacked `<Bar>` | recharts is heavier and its `<Bar fill>` can't use CSS `var()` (the explainer comment notes this); the band is a horizontal segmented bar — a flex row of width-% divs is lighter, themeable, and already the `scaledBand` idiom. **Use CSS divs.** |
| Hand-rolled greedy index-walk alignment | A diff npm package (e.g. `diff`, `fast-myers-diff`) | Adding a package for a ~40-line LCS is unjustified for a phase whose whole premise is "no new capture / consume existing" — and every added package is a slopcheck surface. The sequences are tens of turns (LCS O(n²) is trivially fine). **Hand-roll a tested pure module.** |

**Installation:**
```bash
# NONE. This phase installs no packages. All deps above are already in
# integrations/system-health-dashboard/node_modules (verified 2026-07-10).
```

**Version verification:** Performed via `node -e "require('<pkg>/package.json').version"` against the dashboard's own `node_modules` on 2026-07-10. All five core libraries resolved to the versions above.

## Package Legitimacy Audit

**Not applicable — this phase installs no external packages.** It is a pure frontend consumption phase using dependencies already vetted and installed for the dashboard (Phases 74/84/85). No `npm install` step, no new registry surface, no slopcheck run required. If the planner discovers a genuine need for a new package (e.g. a diff library — this research recommends AGAINST it), the Package Legitimacy Gate must be run and a `checkpoint:human-verify` inserted before install.

## Architecture Patterns

### System Architecture Diagram

```
                          Performance Page (:3032, react-router /performance)
                                          │
        ┌─────────────────────────────────┼──────────────────────────────────┐
        │                                 │                                    │
   [Redux performanceSlice]         [Runs Table row]                    [Timeline panel]
        │  (already holds:)          (D-08 multi-select                  (evolves timeline.tsx)
        │   runsByTaskId              → "Compare selected (2)")                 │
        │   timelineByTaskId          (D-11 inline score cell)          ┌──────┴───────┐
        │   contextTurnsByTaskId      (D-12 reconciliation badge)       │              │
        │   selectedRunIds ───────────────┐                        [v2 turn row]  [fullscreen route]
        │   compareA/compareB             │                         D-01/D-04     /performance/
        │   includePending (D-10)         │                             │          timeline/:taskId
        │                                 ▼                             ▼          (D-02, keyboard nav)
        │                        ┌──────────────────┐          [Radix Dialog:
        │                        │ Difference Viewer │           single-turn
        │                        │   (D-07, NEW)     │           drill-down modal]
        │                        └────────┬─────────┘                 D-01
        │                                 │
        │              ┌──────────────────┼──────────────────┐
        │              ▼                  ▼                   ▼
        │      run-align.ts        loop-heuristic.ts    context bands
        │      (PURE, NEW)         (PURE, NEW)          (reuse scaledBand
        │       align 2×             windowed fuzzy      from explainer)
        │       ContextTurnRow[]     repeat detector
        │       → prefix + first     (shared: single-run
        │         divergence          badges + diff badges)
        │              │                  │
        └──────────────┴──────────────────┴──── read from store; NO server calls
                                 │
                    ═══════════ BROWSER │ SERVER ═══════════ (nothing new server-side)
                                 │
                    [vkb-server :8080 — EXISTING routes]
                      GET /api/experiments/runs/:taskId/context-turns   (handleContextTurns)
                      GET /api/experiments/runs/:taskId/reconciliation  (handleReconciliation)
                      GET /api/experiments/runs?includePending=true     (readRuns)
                      PATCH /api/experiments/scores/:taskId             (handleScoreOverride)
                                 │
                    [.data/measurements/<sanitizeTaskId>/ ]
                      context-turns.jsonl(.gz) · reconciliation.json
```

The primary use case (compare two paired runs): user multi-selects 2 runs in the table → "Compare selected" → the viewer reads both `ContextTurnRow[]` from the store → `run-align.ts` computes the longest common prefix + first divergence index → the prefix collapses, the divergent tail renders side-by-side with per-turn cumulative token deltas → `loop-heuristic.ts` flags repeated signatures on either side. No network call fires during alignment.

### Recommended Project Structure
```
integrations/system-health-dashboard/src/components/performance/
├── timeline.tsx              # EVOLVE (D-01/D-02/D-04/D-06) — the primary target
├── turn-row.tsx              # NEW (extract v2 compact row from timeline.tsx)
├── turn-modal.tsx            # NEW (D-01 Radix Dialog single-turn drill-down)
├── timeline-fullscreen.tsx   # NEW (D-02 routed full-viewport view + keyboard nav)
├── context-band.tsx          # NEW (D-04/D-05 mini + cumulative band; imports scaledBand)
├── difference-viewer.tsx     # NEW (D-07/D-08 side-by-side from divergence)
├── run-align.ts              # NEW PURE — alignment + first-divergence (unit-tested)
├── loop-heuristic.ts         # NEW PURE — windowed fuzzy repeat detector (unit-tested)
├── reconciliation-badge.tsx  # NEW (D-12 row badge + header note)
├── context-cache-explainer.tsx  # SOURCE of scaledBand/SEGMENTS palette (import, don't fork)
├── runs-table.tsx            # EVOLVE (D-08 compare action, D-11 inline cells, D-12 badge)
├── faceted-sidebar.tsx       # EVOLVE (D-10 remove quarantine toggle)
├── score-drawer.tsx          # KEEP as fallback / reference for saveOverride contract
└── performance.tsx           # EVOLVE (D-10 header control placement)
```

### Pattern 1: The alignment key is a normalized tool-call signature over `ContextTurnRow[]`  [PRIMARY HAND-OFF — D-07]

**What:** The difference viewer aligns two runs' **`ContextTurnRow[]`** sequences (NOT the `TimelineRow[]` timeline — the timeline is role-tagged token rows; the context-turns are the per-request semantic sequence with tool metadata). The alignment key per turn is a **signature string** derived from that turn's tool usage.

**Why `ContextTurnRow`, not `TimelineRow`:** `ContextTurnRow.messages[]` carries `tool: { name: string | null; size: number } | null` per message — this is exactly the "same tool + similar args" signal D-07/D-09 need. `TimelineRow` has no tool-arg field. Confirmed shapes (from `performanceSlice.ts` L91–160):
- `ContextTurnRow`: `{ ts, task_id, agent, wire, request_id, model, usage:{input,output,cache_read,cache_write}, cache_breakpoints[], categories[], messages[], observation_ref }`
- `ContextTurnMessage`: `{ i, role, bytes, tool: {name,size}|null, preview }`

**The signature function:**
```typescript
// run-align.ts — pin the comparison key. A turn's signature is the ordered list of
// its tool-call (name, coarse-size-bucket) pairs. Coarse size bucketing (not exact
// bytes) makes the same tool with a near-identical arg align across two runs whose
// prompts differ by a token or two. Reasoning-only turns (no tool) key on role+bucket.
function sizeBucket(bytes: number): string {
  if (bytes <= 0) return 'z'
  return String(Math.floor(Math.log2(bytes)))   // log2 bucket: 256B and 300B collide; 256B and 4KB don't
}
export function turnSignature(t: ContextTurnRow): string {
  const tools = (t.messages ?? [])
    .map((m) => m.tool)
    .filter((x): x is { name: string | null; size: number } => x != null && !!x.name)
    .map((x) => `${x.name}:${sizeBucket(x.size)}`)
  if (tools.length > 0) return `T|${tools.join(',')}`
  // No tool this turn (pure reasoning / user prompt) — key on the assistant/user
  // shape + a coarse total-bytes bucket so two "think" turns still align.
  const bytes = (t.messages ?? []).reduce((a, m) => a + (m.bytes ?? 0), 0)
  return `R|${sizeBucket(bytes)}`
}
```

**When to use:** Every alignment and every loop check derives from `turnSignature`. Keep it exported and pure so both `run-align.ts` and `loop-heuristic.ts` import it and the tests pin it once.

### Pattern 2: First-divergence = longest common prefix by signature; re-sync the tail with LCS  [PRIMARY HAND-OFF — D-07]

**What:** Two-phase, matching how real diff tools work ([Myers 1986]; git trims the longest common prefix/suffix before diffing the divergent middle):

1. **Common-prefix walk (the collapse + first-divergence).** Walk both signature arrays from index 0 in lockstep; the **first index `d` where `sigA[d] !== sigB[d]`** is the *first divergence point*. Indices `0..d-1` are the *identical prefix* → collapsed by default (D-07). This is O(n) and is exactly the "where did they start behaving differently" the user's north-star wants.

2. **LCS re-sync of the divergent tail (for cumulative deltas + loop badges).** From `d` onward the two runs may re-converge (e.g. both eventually run the same failing test again). Compute the **Longest Common Subsequence** of `sigA[d..]` and `sigB[d..]` to pair up turns that still correspond, marking the rest as insert (only-in-B) / delete (only-in-A). This gives the side-by-side pairing so **cumulative token deltas** are computed per aligned pair, and unaligned turns render as one-sided. Sequences are tens of turns → the O(n²) DP LCS is trivially fast; no diff library needed.

**Why this over "align by turn index" or "by timestamp":**
- **Turn index alone** breaks the moment one run inserts an extra tool call — every subsequent turn mis-pairs. It's fine ONLY for the identical prefix (where indices agree by definition), which is why phase 1 uses index lockstep.
- **Timestamp** is meaningless across two independent runs (different wall-clock) — never align on `ts`.
- **Signature + LCS** handles repeats and interleaved reasoning sub-bands: sub-bands are `TimelineRow.children` and are NOT in the `ContextTurnRow` sequence, so the alignment sequence is naturally the parent-turn stream. Reasoning turns key via the `R|` branch of `turnSignature`.

**Handling repeats:** LCS is repeat-safe by construction (a repeated signature can match multiple positions; the DP picks the longest consistent pairing). The **loop badge** (§3) is a *separate* pass over each run independently — it does not affect alignment.

**Example:**
```typescript
// run-align.ts
export interface AlignResult {
  prefixLen: number                 // identical-prefix length → collapse [0, prefixLen)
  firstDivergence: number | null    // = prefixLen when sequences differ; null when identical
  pairs: Array<{ a: number | null; b: number | null }> // aligned index pairs for the tail (null = one-sided)
}
export function alignRuns(a: ContextTurnRow[], b: ContextTurnRow[]): AlignResult {
  const sa = a.map(turnSignature), sb = b.map(turnSignature)
  // Phase 1: common-prefix walk
  let p = 0
  while (p < sa.length && p < sb.length && sa[p] === sb[p]) p++
  const firstDivergence = (p < sa.length || p < sb.length) ? p : null
  // Phase 2: LCS over the divergent tail (sa[p..], sb[p..]) → pairs
  const pairs = lcsPairs(sa.slice(p), sb.slice(p), p)  // offsets back to absolute indices
  return { prefixLen: p, firstDivergence, pairs }
}
// lcsPairs: standard O(n·m) DP building the pair list; ~35 lines, fully unit-testable.
```

### Pattern 3: Loop heuristic — windowed fuzzy repeat, DISTINCT from the backend detector  [PRIMARY HAND-OFF — D-09]

**What:** A turn earns a "possible loop" badge when its signature repeats a signature seen within a recent look-back window. **Advisory, fuzzy, never asserted.**

**Concrete tunable definition (recommended defaults):**
- **Signature:** `turnSignature(t)` from §1 — `tool_name` + **log2 size bucket** (this IS the "same tool + similar args" fuzzy match D-09 asks for; exact-args would cry wolf less but miss the "looped on the same failing test with slightly different output" case the user cares about).
- **Look-back window:** **6 turns** (`WINDOW = 6`). A repeat only counts if the earlier occurrence is within the last 6 turns — a tool used once at turn 2 and again at turn 40 is not a loop.
- **Minimum repeat count:** **≥ 2 occurrences within the window** (i.e. the current turn + at least one prior in-window match). Badge the current (later) turn.
- **Advisory copy:** the badge tooltip says "possible loop — this turn repeats a recent tool signature; args are matched fuzzily so this is a hint, not a fact."

```typescript
// loop-heuristic.ts
const WINDOW = 6
export function loopFlags(turns: ContextTurnRow[]): boolean[] {
  const sigs = turns.map(turnSignature)
  return sigs.map((sig, i) => {
    if (sig.startsWith('R|')) return false        // don't flag pure-reasoning turns as loops
    for (let j = Math.max(0, i - WINDOW); j < i; j++) if (sigs[j] === sig) return true
    return false
  })
}
```

**Why NOT reuse `lib/experiments/route-heuristics.mjs` `loopCount`:** [VERIFIED: codebase — `route-heuristics.mjs:229`] The existing backend `loopCount` counts **maximal runs of ≥2 STRICTLY-ADJACENT** `(tool_name, inputs_digest)` events over a `RouteEvent[]` trace with **exact `inputs_digest`** matching. That is a precise, adjacent-only, exact-args backend metric (persisted as `Run.loop_count`). D-09 explicitly wants the OPPOSITE profile: **non-adjacent** (the loop can have intervening turns), **fuzzy** (size bucket, not exact digest), **UI-advisory** (never a persisted count). They serve different purposes and MUST stay separate — do not try to make one call the other. However, the diff viewer MAY *also* surface the persisted `run.loop_count` (already on the `Run` record) as the "hard" number beside the fuzzy per-turn badges — that gives the user both the strict backend count and the advisory hint.

**Shared detector:** `loopFlags` runs identically for (a) single-run badges in the evolved `timeline.tsx` and (b) each side of the difference viewer. One import, one test suite.

### Pattern 4: Context-window band — CSS width-% div segments, reuse `scaledBand`  [D-04/D-05]

**What:** The band is a horizontal flex row of `<div>`s whose `width: {pct}%` encodes category byte share. **Reuse the existing `scaledBand(byKey, totalBytes)` and `SEGMENTS` palette** from `context-cache-explainer.tsx` — do not fork the byte→width math or invent a second palette (D-05: one taxonomy across both surfaces).

```typescript
// Source: integrations/system-health-dashboard/src/components/performance/context-cache-explainer.tsx L58-99
// SEGMENTS category palette (sys/tools/know/hist/tout/user) + scaledBand() already
// floor tiny-but-real segments to ≥1.2% and renormalize to 100. IMPORT these.
const SEGMENTS = [ { key:'sys', label:'System Instructions', fill:'#d9f99d', ... cached:true }, ... ]
function scaledBand(byKey, totalBytes) { /* floors + renormalizes; returns {view, prefixPct} */ }
```

- **Mini per-turn bar (D-04):** feed a single `ContextTurnRow.categories[]` → `scaledBand` → a short (~8px tall) segmented bar in the row. Token→width scaling is **byte-share within the turn** (glanceable relative composition), NOT absolute — a mini-band shows *what* the turn's context was made of, not how big vs the window.
- **Cumulative growth band (D-04, fullscreen/modal):** stack per-turn category bytes cumulatively across the run so the operator sees history accreting turn-by-turn. Width = cumulative bytes / final-turn bytes.
- **Cached-vs-fresh overlay (D-05):** overlay opacity/hatching keyed on `usage.cache_read` share. **Honesty gate:** when `usage.cache_write === null` (OpenAI wire — the `wire` discriminator), render the overlay as **"N/A (provider reports no cache-creation)"** — reuse the exact `CACHE_WRITE_NA` constant from the explainer (L189), never a 0.

### Pattern 5: D-11 inline score edit preserves the `saveOverride` PATCH contract

**What:** Replace the runs-table "Edit scores" drawer trigger with inline-editable cells that dispatch the **existing** `saveOverride` thunk on blur/enter (autosave). The thunk issues one `PATCH /api/experiments/scores/:taskId` per edited dimension; the server re-validates ranges (regressions ∈ {0,1}, others ∈ [0,1]) and persists `corrected_*` — **the client never becomes the source of truth** (VALID-01 honesty). On success it re-dispatches `fetchRuns` so corrected-wins refreshes.

```typescript
// Reuse VERBATIM — do NOT re-implement applyOverride. Contract from performanceSlice.ts L623
dispatch(saveOverride({ taskId, edits: [{ dimension: 'goal_achieved', value: 0.9 }], overridden_by: DEFAULT_OVERRIDDEN_BY }))
// Client-side range mirror (block obviously-bad saves) from score-drawer.tsx validateDim L63; server re-validates.
```

**Optimistic vs server-authoritative:** show the edited value immediately (optimistic) but on a non-2xx PATCH revert to the judged/prior value and surface the 400/404 branch (score-drawer already models this: 404 = "score changed, reopen"; 400 = validation message). Keep the `score-drawer.tsx` component mounted as a fallback for multi-field bulk edits if desired, but the row is the primary surface (D-11).

### Anti-Patterns to Avoid
- **Rewriting `timeline.tsx`.** D-01 is explicit: *evolve* the role-aware row (ParentRow/SubBand/TierBadge/ProcessPill/`assignObservationsToTurns`). A rewrite loses DASH-02 (tier badge + sub-bands) and the observation→digest chaining. Extract components, don't replace behavior.
- **Aligning the difference viewer on `TimelineRow[]` or on timestamps.** Align on `ContextTurnRow[]` by signature (§2). Timestamps are cross-run-meaningless.
- **Inferring cache-write for OpenAI-wire turns.** `usage.cache_write: null` → render `CACHE_WRITE_NA`, never 0 (D-05/D-12, Phase-84 D-12). The plan's acceptance greps for the verbatim string.
- **Making the inline score edit client-authoritative.** Must go through `saveOverride` PATCH; server re-validates (VALID-01 / D-11).
- **Recomputing canonical model per surface.** Read `run.canonical_model` verbatim; null → `italic "unmeasured"` (ATTR-02 no-regression).
- **Adding a diff npm package.** Hand-roll the ~35-line LCS; the phase's premise is zero new surface and the sequences are tiny.
- **Merging the fuzzy loop badge into the strict backend `loopCount`.** Keep them separate (§3).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Single-turn modal | Custom overlay + focus trap + ESC handling | Radix `Dialog` (installed 1.1.15, used in `KbDetailDialog`) | Focus trap, ARIA, ESC, scroll-lock handled |
| Category byte→width band math | New scaling function + palette | `scaledBand` + `SEGMENTS` from `context-cache-explainer.tsx` | One taxonomy (D-05); floors tiny segments; already themed |
| Fullscreen navigation | Manual history/back handling | `react-router` child route (`<Routes>` already in `App.tsx`) | Back button + deep-link for free |
| Score override write/validate | Client-side score mutation | Existing `saveOverride` thunk → PATCH → server re-validate | Server-authoritative (VALID-01); prevents client-source-of-truth divergence |
| Reconciliation status fetch | New endpoint | Existing `GET .../reconciliation` (`handleReconciliation`, graceful-empty) | Phase 83 D-13 shipped it; zero backend work |
| Quarantine include | New filter plumbing | Existing `includePending` slice flag + `?includePending=true` | Already wired in `faceted-sidebar.tsx`; D-10 only relocates the control |
| Collapsible identical prefix | Custom show/hide | Radix `Collapsible` (already in `timeline.tsx`) | Consistent with existing sub-band collapse |

**Key insight:** Almost everything this phase needs already exists in the codebase as a reusable primitive. The ONLY genuinely new logic is the two pure algorithm modules (`run-align.ts`, `loop-heuristic.ts`) — and those are precisely the parts the CONTEXT delegated as research hand-offs. Build those two carefully and test them; assemble everything else from existing parts.

## Runtime State Inventory

Not a rename/refactor/migration phase — this is greenfield UI on top of existing data contracts. Section omitted per instructions. (No stored data, service config, OS state, secrets, or build artifacts carry a string this phase renames.)

## Common Pitfalls

### Pitfall 1: VirtioFS bind-mount cache masks UI changes on :3032
**What goes wrong:** You edit a `.tsx`, run nothing, refresh `:3032`, and see stale UI (or a truncated-file `SyntaxError` in the backend).
**Why it happens:** `system-health-dashboard` is bind-mounted into `coding-services`; Docker Desktop's VirtioFS caches host edits and does not pick them up live (CLAUDE.md).
**How to avoid:** After any frontend edit: `cd integrations/system-health-dashboard && npm run build` then `docker exec coding-services supervisorctl restart web-services:health-dashboard-frontend`. For `server.js`/`static-server.js` edits, restart the whole container (`docker-compose restart coding-services`) — a `supervisorctl` restart alone re-reads the STALE cached file.
**Warning signs:** UI unchanged after edit; backend exits with `SyntaxError: Invalid or unexpected token` mid-line; `docker exec … wc -lc <file>` size ≠ host size.

### Pitfall 2: Aligning on `TimelineRow` instead of `ContextTurnRow`
**What goes wrong:** The diff viewer mis-pairs turns because `TimelineRow` has no tool-arg signal and mixes background-process rows.
**Why it happens:** `timeline.tsx` is the visible thing, so it's tempting to diff its rows.
**How to avoid:** Align on `ContextTurnRow[]` (has `messages[].tool.{name,size}`). Render with the v2 turn components, but compute alignment from the context-turns stream. `selectContextTurnsFor(taskId)` already exists.
**Warning signs:** Divergence detected at turn 0 for a genuine rerun; deltas that don't correspond to visible tool differences.

### Pitfall 3: Loop badge crying wolf (or staying silent)
**What goes wrong:** Either every read/edit turn gets a loop badge (exact-adjacent over-fires on normal iteration) or genuine 4×-on-the-same-test loops go unbadged (window too small / signature too strict).
**Why it happens:** Wrong window size or wrong signature granularity.
**How to avoid:** Use the §3 defaults (window 6, log2 size bucket, skip pure-reasoning turns) and make them **tunable constants** so they can be calibrated against real rerun fixtures. Ship advisory copy so a false positive is low-cost.
**Warning signs:** Loop badges on nearly every row, or none on a run whose `run.loop_count` is high.

### Pitfall 4: Experiment-cell narrative bleed (inherited from Phase 85)
**What goes wrong:** The difference viewer joins ambient session observations to a sandboxed experiment cell's turns (foreign-session intents rendered against the cell).
**Why it happens:** `timeline.tsx` already guards this (`isExperimentCell` → skip narrative fetch, force `scopedNarrative = []`) — a NEW viewer that re-joins observations reintroduces the bug.
**How to avoid:** The difference viewer aligns on `ContextTurnRow` (which is per-cell-correct) and must NOT re-run the observation time-window join for experiment cells. Carry the `isExperimentCell` guard into any new component that touches narrative.
**Warning signs:** "Approve the checkpoint…" style intents appearing on an experiment cell's turns in the diff.

### Pitfall 5: OpenAI-wire `cache_write: null` rendered as 0
**What goes wrong:** The overlay/badge shows a fabricated 0 cache-write for copilot/opencode runs, implying "tried to cache, wrote nothing."
**Why it happens:** Naive `?? 0` coercion.
**How to avoid:** Branch on `usage.cache_write === null` (the `wire` discriminator) and render `CACHE_WRITE_NA` verbatim. Never fold cache into a total (Phase-84 D-09/D-12).
**Warning signs:** A copilot run's band shows amber cache-write segments; `0` where the explainer shows N/A.

## Code Examples

### Reading both runs' context-turns for the difference viewer
```typescript
// Source: performanceSlice.ts L531 (fetchContextTurns) + L1027 (contextTurnsByTaskId)
const aTurns = useAppSelector(selectContextTurnsFor(aId))   // ContextTurnRow[]
const bTurns = useAppSelector(selectContextTurnsFor(bId))
useEffect(() => { if (aId) dispatch(fetchContextTurns(aId)) }, [aId])
useEffect(() => { if (bId) dispatch(fetchContextTurns(bId)) }, [bId])
const { prefixLen, firstDivergence, pairs } = alignRuns(aTurns, bTurns)   // pure, no network
```

### Single-turn drill-down modal (mirror `KbDetailDialog`)
```tsx
// Source: context-cache-explainer.tsx L352-418 (KbDetailDialog) — mirror the Dialog usage
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
function TurnModal({ open, onClose, turn }: { open: boolean; onClose: () => void; turn: ContextTurnRow | null }) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-[760px] w-[90vw] max-h-[85vh] overflow-y-auto" data-testid="turn-modal">
        <DialogHeader><DialogTitle>Turn detail</DialogTitle></DialogHeader>
        {/* message list, tool name+size digests, cache_breakpoints, per-message bytes, preview */}
      </DialogContent>
    </Dialog>
  )
}
```

### Reconciliation badge (D-12) — read verbatim, never recompute
```typescript
// Fetch the existing route (add a thunk mirroring fetchContextTurns), render status verbatim.
// GET /api/experiments/runs/:taskId/reconciliation → { reconciliation: { summary: { matched,
//   unmatched_wire, unmatched_transcript, fallback, aggregateDeltas, flaggedCount }, ... } | null }
// (Source: measurement-stop.mjs L632-650 write shape; api-routes.js handleReconciliation L623.)
// Badge vocabulary (Claude's discretion): flaggedCount>0 → "⚠ Δ discrepancy"; fallback>0 → "transcript-fallback";
// else matched>0 → "✓ reconciled"; reconciliation===null → no badge (graceful, D-06 honesty).
```

## State of the Art

| Old Approach (v1, shipped) | Current Approach (v2, this phase) | When Changed | Impact |
|--------------------------|-----------------------------------|--------------|--------|
| Turn row = role + tokens + observation line | Turn row + tool chips + cache split + mini band + drill-down modal | Phase 86 | Scannable story with drill-down |
| Cache split only in `context-cache-explainer` pop-up | Cache split + cumulative band inline on the timeline | Phase 86 | Cost story visible without opening the explainer |
| `RunCompare` = metric table (turns/tokens/scores) | + full difference viewer (aligned, first-divergence, cumulative deltas, loop badges) | Phase 86 | "where did two runs diverge and why did one cost more" |
| Quarantine toggle in sidebar; scores via drawer | Quarantine at page header w/ count; inline score cells | Phase 86 | Fewer clicks, discoverable |

**Deprecated/outdated:** none removed — v1 rows are the graceful-degradation fallback (D-06), the score drawer remains a valid fallback surface, and `RunCompare` stays for metric-level comparison beside the new trajectory diff.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | log2 size-bucketing is the right fuzziness for the signature (256B≈300B align; 256B≠4KB) | Patterns §1/§3 | Too coarse → over-aligns/over-flags; too fine → mis-aligns reruns with tiny prompt drift. **Mitigation:** make bucket + window tunable constants; calibrate against real rerun fixtures in Wave 0. |
| A2 | Look-back window of 6 turns + min-repeat 2 is a useful loop default | Patterns §3 | Wrong-sized window mis-flags. **Mitigation:** tunable; verify against a known-looping rerun. |
| A3 | Reasoning sub-bands (`TimelineRow.children`) are NOT present in the `ContextTurnRow` sequence, so alignment naturally operates on parent turns | Patterns §2, DASH-02 | If a proxy request per reasoning-step DOES emit a context-turn line, the sequence granularity differs from the timeline. **Verify:** inspect a real `context-turns.jsonl` line count vs timeline parent count for one run before locking the align granularity. |
| A4 | `run.loop_count` (backend strict count) is safe to surface beside the fuzzy badges as the "hard" number | Patterns §3 | If `loop_count` is frequently null (no trace), the "hard" column is mostly em-dashes — acceptable (null-not-zero house rule), just note it. |
| A5 | The dashboard has no unit-test runner; pure modules test via the root Jest (`ts-jest` ESM) harness | Validation Architecture | If root Jest can't resolve the dashboard's `@/` path alias or TSX-adjacent `.ts`, a tiny per-dashboard vitest config may be needed instead. **Verify in Wave 0.** |

## Open Questions

1. **Does a per-reasoning-step proxy request emit its own `context-turns.jsonl` line?** (A3)
   - What we know: the timeline models reasoning steps as `TimelineRow.children` (sub-bands); the context-turns line is per *measured LLM request*.
   - What's unclear: whether a thinking sub-step is a separate request (→ separate context-turn) or folded into the parent turn's request.
   - Recommendation: in Wave 0, read one real run's `context-turns.jsonl` and compare its length to that run's timeline parent-turn count. Align on whatever the context-turns granularity actually is; render reasoning children as sub-bands regardless (DASH-02).

2. **Where do the two pure modules' unit tests live?** (A5)
   - What we know: root uses Jest+ts-jest (ESM); the dashboard has only Playwright E2E under `tests/e2e/`.
   - What's unclear: whether root Jest resolves the `@/` alias + imports the dashboard's TS cleanly.
   - Recommendation: keep `run-align.ts` / `loop-heuristic.ts` **dependency-free** (import only the local `ContextTurnRow` type) so they can be tested by root Jest OR a 10-line vitest config with zero React/alias coupling. Decide in Wave 0.

3. **Reconciliation badge vocabulary + colours** (Claude's discretion per CONTEXT).
   - Recommendation: reuse the honest-measurement palette already in the explainer (green `#22c55e` = reconciled/good, amber `#f59e0b` = discrepancy/write, muted for transcript-fallback). Confirm with the user during discuss/plan if a specific vocabulary is wanted.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Build (`tsc`/`vite`) | ✓ | v25.8.1 | — |
| npm | — | ✓ | 11.11.0 | — |
| Dashboard on :3032 | Visual verification | ✓ | HTTP 200 | — |
| gsd-browser | CLAUDE.md-mandated visual verify | ✓ | present (`/usr/local/bin/gsd-browser`) | — |
| React / Radix Dialog / recharts / react-router / RTK | All UI | ✓ | 18.3.1 / 1.1.15 / 3.6.0 / 7.14.0 / 2.11.2 | — |
| context-turns data (`/api/context-turns`) | Difference viewer, bands | ✓ | Phase 84 shipped | Graceful-empty `{contextTurns:[]}` → v1 fallback (D-06) |
| reconciliation data (`/api/…/reconciliation`) | D-12 badge | ✓ | Phase 83 shipped | Graceful-empty `{reconciliation:null}` → no badge |
| `rerun_of`/`base_variant` on Run | D-07/D-08 pairing | ✓ | Phase 85 shipped (`run-write.mjs`) | null for non-reruns → viewer works on any 2 runs, pairing just decorates |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** context-turns / reconciliation absence is the *designed* D-06 graceful-degradation path, not a blocker.

## Validation Architecture

nyquist_validation is not disabled in `.planning/config.json` (`workflow` has no `nyquist_validation` key → treated as enabled). The two pure algorithm modules are the ideal Nyquist test seams.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | **Jest 29.7 + ts-jest 29.4 (ESM)** at repo root for pure-TS modules; **Playwright 1.58** at `tests/e2e/` for UI. The dashboard package has **no** unit runner of its own — this is a Wave 0 decision point (A5/OQ2). |
| Config file | Root: `jest.config` (via `package.json` `test` script `NODE_OPTIONS='--experimental-vm-modules' jest`). E2E: `tests/e2e/` (`npx playwright test`). Dashboard: none — may add a minimal `vitest.config.ts` if root Jest can't import the dashboard TS cleanly. |
| Quick run command | `npm test -- run-align loop-heuristic` (root Jest, pure modules) |
| Full suite command | `npm test` (root) + `npx playwright test tests/e2e/dashboard/performance*.spec.ts` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| D-07 | `alignRuns` returns correct `prefixLen`/`firstDivergence` for a fixture rerun-pair | unit | `npm test -- run-align` | ❌ Wave 0 |
| D-07 | Identical runs → `firstDivergence === null`, full prefix collapse | unit | `npm test -- run-align` | ❌ Wave 0 |
| D-07 | LCS re-syncs a re-converging tail (insert in B, then match) | unit | `npm test -- run-align` | ❌ Wave 0 |
| D-09 | `loopFlags` flags a non-adjacent windowed repeat, ignores out-of-window + pure-reasoning turns | unit | `npm test -- loop-heuristic` | ❌ Wave 0 |
| D-01/D-02 | Turn row opens modal; fullscreen route renders whole timeline | e2e | `npx playwright test tests/e2e/dashboard/performance.spec.ts` | ⚠ extend existing |
| D-08 | Multi-select 2 runs → "Compare selected" opens diff viewer | e2e | `npx playwright test tests/e2e/dashboard/performance-compare.spec.ts` | ⚠ extend existing |
| D-11 | Inline score edit issues PATCH; server-invalid value rejected | e2e | `npx playwright test tests/e2e/dashboard/performance.spec.ts` | ⚠ extend existing |
| D-12 | Reconciliation badge renders reconciled/discrepancy/fallback; absent → no badge | e2e | `npx playwright test tests/e2e/dashboard/performance.spec.ts` | ⚠ extend existing |
| D-05 | OpenAI-wire turn renders `CACHE_WRITE_NA`, not 0, in the band overlay | e2e (visual + text) | gsd-browser screenshot + grep string | ⚠ new assertion |
| DASH-02 | Tier badge + reasoning sub-bands survive the v2 evolution | e2e | `npx playwright test` (assert `granularity-tier-badge`, `timeline-reasoning-step`) | ⚠ extend existing |

### Sampling Rate
- **Per task commit:** `npm test -- run-align loop-heuristic` (pure modules, < 5s) + `npm run build` in the dashboard (tsc typecheck).
- **Per wave merge:** full root `npm test` + `npx playwright test tests/e2e/dashboard/performance*.spec.ts`.
- **Phase gate:** full suite green + **gsd-browser visual verification on :3032** (CLAUDE.md mandate — never claim "works" from DB/unit alone; feedback_e2e_verify, feedback_dashboard_screenshots_gsd_browser).

### Wave 0 Gaps
- [ ] `run-align.ts` — pure alignment module (signature + prefix walk + LCS pairs), keep dependency-free
- [ ] `loop-heuristic.ts` — pure windowed fuzzy repeat detector, shares `turnSignature`
- [ ] Test home decision: root Jest can import the two `.ts` modules, OR add a minimal `vitest.config.ts` to the dashboard (resolve A5/OQ2 first)
- [ ] Fixture run-pairs: (a) identical runs, (b) rerun that diverges at turn N then re-converges, (c) a known-looping run — as `ContextTurnRow[]` JSON fixtures
- [ ] Verify one real `context-turns.jsonl` granularity vs timeline parent count (resolve A3/OQ1) before locking align granularity
- [ ] Extend `tests/e2e/dashboard/performance.spec.ts` + `performance-compare.spec.ts` for D-01/D-02/D-08/D-11/D-12

## Security Domain

`security_enforcement` is not present in `.planning/config.json` (absent = enabled). This phase is client-only rendering of already-persisted, already-redacted data — the applicable surface is narrow but real.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface — internal dashboard |
| V3 Session Management | no | — |
| V4 Access Control | no | Read-only local dashboard; PATCH already server-guarded |
| V5 Input Validation | **yes** | Inline score edit (D-11) — client mirrors ranges, **server re-validates** (existing `handleScoreOverride`). Never trust the client value. |
| V6 Cryptography | no | — |
| V7 Output Encoding / XSS | **yes** | Rendering `messages[].preview`, `observation_ref.intent`, tool names, arg previews into the DOM. React auto-escapes; **do not** `dangerouslySetInnerHTML`. Reuse the client-side `scrubSecrets` (explainer L162) on any preview surfaced in the new modal/band. |

### Known Threat Patterns for React/Redux dashboard rendering measured LLM data
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Secret leaking into a rendered preview (arg digest / user-input preview) | Information disclosure | Apply the existing `scrubSecrets` (sk-/ghp_/JWT/Bearer/AKIA regexes, explainer L155-166) before rendering any preview in the new turn modal/band; raw bodies stay in the redacted `raw-bodies.jsonl` channel |
| XSS via unescaped preview/tool text | Tampering | React default escaping; never `dangerouslySetInnerHTML`; treat all `preview`/`intent`/tool strings as untrusted text |
| Client-forged score override | Tampering | Server-authoritative PATCH re-validation (D-11); client range mirror is UX-only |

## Sources

### Primary (HIGH confidence — codebase, read this session)
- `integrations/system-health-dashboard/src/components/performance/timeline.tsx` — v1 role-aware row (ParentRow/SubBand/TierBadge/ProcessPill/assignObservationsToTurns/isExperimentCell guard) — the evolve target
- `integrations/system-health-dashboard/src/components/performance/context-cache-explainer.tsx` — `SEGMENTS` palette, `scaledBand`, `KbDetailDialog` Radix pattern, `CACHE_WRITE_NA`, `scrubSecrets`, per-turn cache split
- `integrations/system-health-dashboard/src/components/performance/runs-table.tsx` — `toggleRunSelected`, ScoreCell, Edit-scores trigger, re-run prefill, `isCompletedExperimentRun`
- `integrations/system-health-dashboard/src/components/performance/score-drawer.tsx` — `saveOverride` contract, `validateDim`, `SCORE_DIMENSIONS`
- `integrations/system-health-dashboard/src/components/performance/run-compare.tsx` — existing metric compare (compareA/B), `summarizeByRole`
- `integrations/system-health-dashboard/src/components/performance/faceted-sidebar.tsx` L121-139 — quarantine toggle (`includePending`) to relocate
- `integrations/system-health-dashboard/src/pages/performance.tsx` — page IA (Tabs Runs/Compare/Reports, SummaryCards, header)
- `integrations/system-health-dashboard/src/store/slices/performanceSlice.ts` — `ContextTurnRow`/`ContextTurnMessage`/`TimelineRow`/`Run` types, `fetchContextTurns`/`selectContextTurnsFor`/`fetchTimeline`/`saveOverride`/`setCompareA`/`includePending`
- `lib/vkb-server/api-routes.js` — `handleContextTurns` (L671), `handleReconciliation` (L623), scores PATCH (L83)
- `lib/experiments/route-heuristics.mjs` L229 — existing strict-adjacent `loopCount` (the detector D-09 must stay DISTINCT from)
- `lib/experiments/run-write.mjs` L135-136 — `rerun_of`/`base_variant`/`task_hash` Run record write
- `lib/experiments/query.mjs` L77-113 — `readRuns` shape (goal_sentence, etc.)
- `scripts/measurement-stop.mjs` L632-650 — reconciliation.json write shape (summary + perRequest)
- `.planning/phases/{83,84,85}-*/…-CONTEXT.md`, `.planning/REQUIREMENTS.md` (DASH-02 L139, VALID-01 L27, ATTR-02 L147), `CLAUDE.md`
- `node_modules/*/package.json` — installed dependency versions (verified 2026-07-10)

### Secondary (MEDIUM confidence — verified against Myers' original paper)
- Myers, "An O(ND) Difference Algorithm and Its Variations" (1986) — LCS/edit-graph, common-prefix trimming, first-divergence — grounds the §2 alignment recommendation

### Tertiary (LOW confidence — none load-bearing)
- General web summaries of Myers/LCS diff (used only to confirm the prefix-trim + LCS approach is the standard practice; the concrete algorithm is pinned against the primary paper and the real data shapes)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified against the dashboard's own `node_modules`; zero new packages
- Architecture (both hand-offs): HIGH — grounded in the real `ContextTurnRow` contract read this session + the authoritative Myers/LCS approach; the loop heuristic is contrasted against the actual existing `route-heuristics.mjs`
- Pitfalls: HIGH — drawn from CLAUDE.md/MEMORY.md operational lessons + the existing `isExperimentCell` guard + the OpenAI-wire honesty contract
- Validation: MEDIUM — the pure-module test seam is clear; the *home* for those tests (root Jest vs a new dashboard vitest) is a genuine Wave 0 decision (A5/OQ2)

**Research date:** 2026-07-10
**Valid until:** 2026-08-09 (30 days — stable stack, no fast-moving external deps; the only decay risk is dashboard component refactors)
```

Sources:
- [The Myers Difference Algorithm](https://nathaniel.ai/myers-diff/)
- [Myers, An O(ND) Difference Algorithm and Its Variations (1986)](https://publications.mpi-cbg.de/Myers_1986_6330.pdf)
- [Text Diff Algorithms Explained: Myers, LCS & Tradeoffs](https://wizlytools.com/blog/text-diff-algorithms-explained/)