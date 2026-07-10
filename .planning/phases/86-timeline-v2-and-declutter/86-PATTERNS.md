# Phase 86: Timeline v2 & Declutter - Pattern Map

**Mapped:** 2026-07-10
**Files analyzed:** 15 (7 new, 8 evolve)
**Analogs found:** 15 / 15 (every new file has a strong in-repo analog — this is a pure "extend" phase)

> All paths below are relative to `integrations/system-health-dashboard/` unless prefixed with `lib/` (backend, read-only — no server work this phase).
> **House rule (all files):** extend, never rewrite (Phase-84 D-11); read canonical fields verbatim; never coerce `null`→`0` (ATTR-02 / D-05 / D-12). Every UI edit requires the dashboard rebuild recipe + gsd-browser visual verify on :3032 (CLAUDE.md).

---

## File Classification

| New/Modified File | New? | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|------|-----------|----------------|---------------|
| `src/components/performance/timeline.tsx` | evolve | component | request-response (Redux read) | *(self — evolve in place)* | self |
| `src/components/performance/turn-row.tsx` | new | component | transform (render) | `timeline.tsx` `ParentRow` | exact |
| `src/components/performance/turn-modal.tsx` | new | component (dialog) | request-response | `context-cache-explainer.tsx` `KbDetailDialog` | exact |
| `src/components/performance/timeline-fullscreen.tsx` | new | component (route) | request-response | `pages/performance.tsx` + `timeline.tsx` | role-match |
| `src/components/performance/context-band.tsx` | new | component | transform | `context-cache-explainer.tsx` `scaledBand`/`SEGMENTS` | exact |
| `src/components/performance/run-align.ts` | new | utility (pure) | transform (batch) | *(none — greenfield algorithm)* | **no analog** |
| `src/components/performance/loop-heuristic.ts` | new | utility (pure) | transform (batch) | *(none — greenfield; contrast w/ `lib/experiments/route-heuristics.mjs`)* | **no analog** |
| `src/components/performance/difference-viewer.tsx` | new | component | transform + request-response | `run-compare.tsx` (Delta) + `timeline.tsx` (rows) | role-match |
| `src/components/performance/reconciliation-badge.tsx` | new | component | request-response | `runs-table.tsx` `ScoreCell` (edited badge) | role-match |
| `src/components/performance/runs-table.tsx` | evolve | component | request-response | *(self)* | self |
| `src/components/performance/score-drawer.tsx` | keep | component (fallback) | request-response | *(reference for `saveOverride` contract)* | self |
| `src/components/performance/faceted-sidebar.tsx` | evolve | component | request-response | *(self — remove quarantine toggle)* | self |
| `src/pages/performance.tsx` | evolve | page | request-response | *(self — header control + Compare tab)* | self |
| `src/store/slices/performanceSlice.ts` | evolve | store | request-response (thunks) | `fetchContextTurns` thunk (mirror for reconciliation) | self |
| `tests/e2e/dashboard/performance*.spec.ts` (root repo) | evolve | test | e2e | `tests/e2e/dashboard/performance.spec.ts` | exact |

---

## Shared Patterns

These cross-cut most new files — apply once, reference everywhere.

### S1. Redux read/dispatch idiom (every component)
**Source:** `timeline.tsx:11-28, 440-455`
```typescript
import { useAppSelector, useAppDispatch } from '@/store'
import { fetchContextTurns, selectContextTurnsFor, type ContextTurnRow } from '@/store/slices/performanceSlice'
const dispatch = useAppDispatch()
const turns = useAppSelector(selectContextTurnsFor(taskId))    // ContextTurnRow[]
useEffect(() => { if (taskId) dispatch(fetchContextTurns(taskId)) }, [taskId]) // eslint-disable-line react-hooks/exhaustive-deps
```
- Path alias is `@/` (points at `src/`). Components read state via `useAppSelector(selector(arg))` — selectors are **curried** (`selectContextTurnsFor(taskId)` returns `(state) => ...`), see `performanceSlice.ts:1245`.
- **No page-local `useState` for shared data, no raw `fetch()` in components** (`pages/performance.tsx:28-31`). Local `useState` is only for ephemeral UI (open/draft), e.g. `ParentRow`'s `const [open, setOpen] = useState(false)`.

### S2. Honest-null rendering (bands, badges, score cells, model columns)
**Source:** `runs-table.tsx:116-119, 330-334`, `context-cache-explainer.tsx:189`, `timeline.tsx:536-540`
```typescript
function num(v: number | null): ReactNode {           // NEVER coerce null → 0
  return v == null ? <span className="text-muted-foreground">—</span> : v.toFixed(2)
}
// canonical model verbatim, null → italic "unmeasured" (ATTR-02 regression anchor):
{run?.canonical_model
  ? <span className="font-mono">{normalizeModel(run.canonical_model)}</span>
  : <span className="italic">unmeasured</span>}
// OpenAI-wire cache-write honesty constant (load-bearing — plan greps for it verbatim):
const CACHE_WRITE_NA = 'N/A (provider reports no cache-creation)'   // context-cache-explainer.tsx:189 — IMPORT, do not re-declare
```
Apply to: `context-band.tsx` (cache overlay), `reconciliation-badge.tsx`, `difference-viewer.tsx` header, inline score cells. Branch on `usage.cache_write === null` (the `wire` discriminator), never `?? 0`.

### S3. Secret scrub before rendering any preview (turn-modal, context-band)
**Source:** `context-cache-explainer.tsx:155-183`
```typescript
const SECRET_SCRUBS: [RegExp, string][] = [
  [/sk-[A-Za-z0-9-]{6,}/g, 'sk-***'], [/ghp_[A-Za-z0-9]{6,}/g, 'ghp_***'],
  [/eyJ[A-Za-z0-9._-]{10,}/g, 'eyJ***'], [/\bBearer\s+[A-Za-z0-9._-]{6,}/gi, 'Bearer ***'],
  [/\bAKIA[0-9A-Z]{12,}/g, 'AKIA***'],
]
function scrubSecrets(s: string): string { let o = s; for (const [re, rep] of SECRET_SCRUBS) o = o.replace(re, rep); return o }
```
Any `messages[].preview`, `observation_ref.intent`, or raw arg text rendered in `turn-modal.tsx` MUST pass through `scrubSecrets` first. Import from `context-cache-explainer.tsx` if exported, else lift to a shared util — **do not re-invent the regexes**. React auto-escapes; never `dangerouslySetInnerHTML` (security V7).

### S4. Experiment-cell narrative guard (any component touching narrative)
**Source:** `timeline.tsx:464-491`
```typescript
const runUnknown = run as unknown as Record<string, unknown> | null
const isExperimentCell = !!(runUnknown && (typeof runUnknown.variant === 'string' || typeof runUnknown.base_variant === 'string'))
// → skip the observation time-window join; force scopedNarrative = []
```
`difference-viewer.tsx` aligns on `ContextTurnRow` (per-cell-correct) and MUST carry this guard if it ever joins ambient observations (Pitfall 4). The diff viewer's turn rows must NOT re-run the narrative join for cells.

### S5. Collapsible chevron pattern (identical-prefix collapse, sub-bands)
**Source:** `timeline.tsx:205-224`, `faceted-sidebar.tsx:60-64`
```tsx
<Collapsible open={open} onOpenChange={setOpen} className="rounded-md border">
  <CollapsibleTrigger className="flex ... items-center gap-2 text-left">
    <ChevronRight className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`} />
    ...label...
  </CollapsibleTrigger>
  <CollapsibleContent className="space-y-1 px-3 pb-2">{children}</CollapsibleContent>
</Collapsible>
```
Reuse for the diff viewer's "Show N identical turns" collapsed prefix (D-07) and preserve for reasoning sub-bands (DASH-02).

---

## Pattern Assignments

### `turn-row.tsx` (NEW — component, transform)  — extract v2 compact row

**Analog:** `timeline.tsx` `ParentRow` (166-226), `TurnLabel` (118-133), `ProcessPill` (93-116), `TierBadge` (58-65).

**Core row scaffold to copy** (`timeline.tsx:181-202`): the `rounded-md border ${accent}` card, `flex items-center justify-between gap-3 px-3 py-2` header, `data-testid="timeline-row" data-role data-has-observations`. **Preserve `TierBadge` (`data-testid="granularity-tier-badge"`) and the collapsible `children` sub-bands** — these are the DASH-02 regression anchors; a rewrite that drops them fails the phase.

**v2 additions layered on the existing row (UI-SPEC §1 anatomy, left→right):**
- Tool-name chips: `<Badge variant="secondary" className="text-xs">` per `messages[].tool.name`, "+N" overflow chip. Chip idiom already at `timeline.tsx:158`, `runs-table.tsx:136`.
- Mini band: `<ContextBand variant="mini" />` (see context-band.tsx), `h-2` (UI-SPEC Spacing).
- Loop badge when `loopFlags[i]` — outline `status-warning` (see reconciliation-badge.tsx palette).
- Whole row is the click target → opens `turn-modal.tsx` (mirror the `CollapsibleTrigger` click surface; add `cursor-pointer`).

**Tokens/em-dash helper** (`timeline.tsx:42-44`): `tokens(v)` renders `—` for null, `.toLocaleString()` otherwise. Reuse verbatim.

---

### `turn-modal.tsx` (NEW — component/dialog, request-response)  — single-turn drill-down (D-01)

**Analog:** `context-cache-explainer.tsx` `KbDetailDialog` (352-419).

**Dialog shell to copy** (`context-cache-explainer.tsx:355-365`):
```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
<Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
  <DialogContent className="max-w-[760px] w-[90vw] max-h-[85vh] overflow-y-auto" data-testid="turn-modal">
    <DialogHeader><DialogTitle>Turn detail</DialogTitle></DialogHeader>
    {/* message list · tool name+size+intent (D-03) · cache_breakpoints · per-message bytes · scrubbed preview */}
  </DialogContent>
</Dialog>
```
Radix handles focus-trap / ESC / scroll-lock — do not hand-roll (RESEARCH Don't-Hand-Roll).

**Semantic-first tool digest (D-03)** — mirror `turnNote` (`context-cache-explainer.tsx:170-183`): prefer `observation_ref.intent`, else last-user `preview`; both through `scrubSecrets`. Full arg text ONLY when `capture_raw_bodies` was ON for the span — else name + size + intent, never fabricated. Byte sizes render `font-mono` via `kb()` (`context-cache-explainer.tsx:82`).

**Drive open-state via slice** (like `explainTaskId`): add `modalTurn`/`modalTaskId` to `performanceSlice`, mount once in `performance.tsx`, mirror `setExplainTaskId` (`runs-table.tsx:393`, `pages/performance.tsx:181`).

---

### `context-band.tsx` (NEW — component, transform)  — mini + cumulative band (D-04/D-05)

**Analog:** `context-cache-explainer.tsx` `scaledBand` (90-99) + `SEGMENTS` (70-77).

**IMPORT `scaledBand` and `SEGMENTS` — do NOT fork** (D-05 "one taxonomy"). The byte→width math already floors tiny segments to ≥1.2% and renormalizes to 100:
```typescript
function scaledBand(byKey: Record<string, number>, totalBytes: number): { view: Segment[]; prefixPct: number } | null
// SEGMENTS: sys #d9f99d/#84cc16, tools #cffafe/#06b6d4, know #e9d5ff/#a855f7,
//           hist #fecaca/#ef4444, tout #fed7aa/#f97316, user #bfdbfe/#3b82f6
```
Feed `ContextTurnRow.categories[]` → `{key: bytes}` map → `scaledBand`. Render as a **flex row of width-% `<div>`s** — NOT recharts (recharts `<Bar fill>` can't use CSS `var()`; note at `context-cache-explainer.tsx:52-56`). No SVG.

- **Mini** (`variant="mini"`, in turn-row): `h-2`, byte-share within the turn.
- **Cumulative** (modal/fullscreen): `h-3`/`h-4`, per-turn category bytes stacked across the run; width = cumulative / final-turn bytes.
- **Cached overlay (D-05):** hatched 45° `repeating-linear-gradient` (~4px pitch) over the `usage.cache_read` share; solid = fresh (UI-SPEC Q3). **Honesty gate:** `usage.cache_write === null` → render `CACHE_WRITE_NA` (S2), never an amber write segment.

These modules currently live as **file-local (non-exported) functions** in `context-cache-explainer.tsx`. Plan must `export` them (or lift to `context-band.tsx` and re-import into the explainer) so both surfaces share ONE definition — do not copy-paste.

---

### `run-align.ts` (NEW — pure utility, batch transform)  — **NO ANALOG**

Greenfield algorithm; RESEARCH §2 pins it. Keep **dependency-free** (import only the `ContextTurnRow` type) so root Jest OR a minimal dashboard vitest can test it (RESEARCH A5/OQ2). Signature = per-turn tool-call `(name, log2-size-bucket)` list (RESEARCH §1). Contract: `alignRuns(a,b) → { prefixLen, firstDivergence, pairs }` (common-prefix walk + LCS tail). **Aligns on `ContextTurnRow[]`, never `TimelineRow[]` or timestamps** (Pitfall 2). Reads two runs' turns from the store (S1) — no network during alignment.

### `loop-heuristic.ts` (NEW — pure utility, batch transform)  — **NO ANALOG**

Greenfield; RESEARCH §3. Shares `turnSignature` with run-align.ts. Windowed (WINDOW=6), fuzzy (log2 bucket), non-adjacent, min-repeat ≥2; skip pure-reasoning (`R|`) turns. **Deliberately DISTINCT from** the backend `loopCount` in `lib/experiments/route-heuristics.mjs:229` (strict-adjacent, exact-digest) — do not merge. The diff viewer MAY additionally surface the persisted `run.loop_count` (`Run.loop_count`, `performanceSlice.ts:74`) as the "hard" number beside the advisory badges.

---

### `difference-viewer.tsx` (NEW — component)  — full trajectory diff (D-07/D-08)

**Analogs:** `run-compare.tsx` `Delta` (44-60) for signed cumulative token deltas; `timeline.tsx` turn components + `context-band.tsx` for the rows/bands; `run-compare.tsx:120-134` for the two-run read pattern.

**Signed-delta render to copy** (`run-compare.tsx:44-60`):
```tsx
const sign = d > 0 ? '+' : '−'
const color = isGood == null ? 'text-muted-foreground' : isGood ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
return <span className={`font-mono ${color}`}>{sign}{...}{pct}</span>
```
UI-SPEC Q5 refines the palette to `status-*` tokens: decrease (fewer tokens = good) → `text-status-success`; increase → `text-muted-foreground`; always show explicit `+`/`−`.

**Two-run read** (`run-compare.tsx:124-134`, adapt to context-turns):
```typescript
const aTurns = useAppSelector(selectContextTurnsFor(aId))
const bTurns = useAppSelector(selectContextTurnsFor(bId))
useEffect(() => { if (aId) dispatch(fetchContextTurns(aId)) }, [aId, dispatch])
useEffect(() => { if (bId) dispatch(fetchContextTurns(bId)) }, [bId, dispatch])
const { prefixLen, firstDivergence, pairs } = alignRuns(aTurns, bTurns)   // pure, no network
```
Identical prefix `[0, prefixLen)` collapsed via `Collapsible` (S5). Canonical-model header read verbatim (S2). Lives as a new surface in the **Compare tab** beside `RunCompare` (UI-SPEC Q1). Entry: `run-compare`-style, but triggered from runs-table multi-select — see runs-table.tsx assignment.

---

### `reconciliation-badge.tsx` (NEW — component, request-response)  — D-12

**Analog:** `runs-table.tsx` `ScoreCell` edited-badge (130-150) for the tooltip+badge shape; `timeline.tsx` `TierBadge` (58-65) for the compact badge.

**Badge+tooltip idiom to copy** (`runs-table.tsx:131-149`): `Tooltip`/`TooltipTrigger asChild` wrapping a `Badge variant="outline"` with a lucide icon + label, tooltip content holds the detail.

**Vocabulary (UI-SPEC pinned):** `flaggedCount>0` → `status-warning` `AlertTriangle` "⚠ Δ discrepancy"; `fallback>0` → `status-neutral` `FileText` "transcript-fallback"; else `matched>0` → `status-success` `Check` "✓ reconciled"; `reconciliation===null` → **no badge** (D-06 honesty). Icon+colour pairing (never colour alone).

**Data:** add a `fetchReconciliation` thunk to the slice **mirroring `fetchContextTurns`** (`performanceSlice.ts:531-546`) against `GET /api/experiments/runs/:taskId/reconciliation`. Server shape (`lib/vkb-server/api-routes.js:623-645`): serves `reconciliation.json` verbatim, ENOENT → `200 {reconciliation:null}`. Header note reads the summary string verbatim, never recomputed.

---

### `runs-table.tsx` (EVOLVE)  — D-08 compare-select, D-11 inline scores, D-12 row badge

**Compare-select (D-08):** `toggleRunSelected` + `selectedRunIds` already exist (`runs-table.tsx:315`, `:158`). The bulk-selection toolbar (`runs-table.tsx:218-238`) is the exact analog for the "Compare selected (2)" CTA — add a primary `Button` enabled only when `selectedRunIds.length === 2`, dispatching `setCompareA`/`setCompareB` (`performanceSlice.ts:1206-1207`) + switching to the Compare tab / opening the diff viewer.

**Inline score cells (D-11):** evolve `ScoreCell` (`runs-table.tsx:121-151`) to edit-in-place. On focus → shadcn `Input` (`score-drawer.tsx:180-191` idiom: `className="mt-1 font-mono" inputMode="decimal"`), autosave on blur/Enter via the **existing `saveOverride` thunk**:
```typescript
dispatch(saveOverride({ taskId, edits: [{ dimension, value }], overridden_by: DEFAULT_OVERRIDDEN_BY }))
```
Client range mirror from `score-drawer.tsx:63-73` (`validateDim`); server re-validates (`saveOverride` `performanceSlice.ts:623`). Optimistic show, revert on non-2xx (404 = "score changed, reopen"; 400 = message — `score-drawer.tsx:203-210`). Keep the "edited" yellow badge (`runs-table.tsx:136-142`) + judged tooltip. `stopPropagation` on the cell so the click doesn't bubble to the row's `setSelectedTaskId` (`runs-table.tsx:308, 366`).

**Row reconciliation badge (D-12):** add a `<ReconciliationBadge taskId={run.task_id} />` cell.

---

### `faceted-sidebar.tsx` (EVOLVE)  — D-10 remove quarantine toggle

**Remove** the include-pending block (`faceted-sidebar.tsx:121-139`) — the `<label data-testid="include-pending-row">` + `Checkbox data-testid="include-pending-toggle"` that dispatches `setIncludePending` + `fetchRuns(next)`. **Preserve `data-testid="include-pending-toggle"`** at the new page-header home. The `includePending` slice flag + `?includePending=true` fetch param stay unchanged (`performanceSlice.ts:894, 1228`).

---

### `pages/performance.tsx` (EVOLVE)  — D-10 header control, fullscreen route, diff viewer tab

**Quarantine control (D-10):** place near `SummaryCards` (`pages/performance.tsx:131`) — reuse the `Checkbox`+label idiom removed from the sidebar, now **with a count**: "Show quarantined (3)". Count = `runs.filter(r => r.quarantined /* confirm flag in Wave 0 */).length` (UI-SPEC Q4). `SummaryCards` (48-86) is the analog for header-region derived counts.

**Compare tab:** the diff viewer sits in the existing `<TabsContent value="compare">` (`pages/performance.tsx:166-168`) beside `RunCompare`.

**Fullscreen route (D-02):** `timeline-fullscreen.tsx` mounts at a react-router child route `/performance/timeline/:taskId`. `App.tsx` already wires `/performance`; add the child there (analog: the existing `<Routes>` in `App.tsx`). Header uses `text-2xl font-bold` (`pages/performance.tsx:124`). Modal + fullscreen open-state driven by slice, not page-local `useState` (S1).

---

### `performanceSlice.ts` (EVOLVE)  — thunks/selectors for new surfaces

**Reconciliation thunk:** mirror `fetchContextTurns` (`:531-546`) exactly — same-origin fetch, graceful-empty, store keyed by taskId (`:1027-1028` reducer pattern; `:1245` curried selector).
**Modal/fullscreen state:** add `modalTaskId`/`modalTurnIndex` (or a `{taskId, index}`), mirror `setExplainTaskId`/`selectExplainTaskId` (`:894`-region reducers, `:1228`-region selectors).
**Inline-score / diff state:** extend `performanceSlice` (UI-SPEC Q2 default) — do NOT add a new slice. `saveOverride` (`:623`), `setCompareA/B` (`:951-954`), `selectContextTurnsFor` (`:1245`), `selectSelectedRunIds` (`:1293`) already exist.

---

### `tests/e2e/dashboard/performance.spec.ts` (root repo, EVOLVE)  — e2e

**Analog:** `/Users/Q284340/Agentic/coding/tests/e2e/dashboard/performance.spec.ts` (already covers the Phase-74 flows a–e). Extend for D-01/D-02/D-08/D-11/D-12 + the DASH-02 regression assertions (`granularity-tier-badge`, `timeline-reasoning-step` still present). Reuse `navigateToPerformance` (`:21-29`), `runRowCount` (`:31-33`), the data-presence skip guard, and `http://localhost:3032` baseURL. New `data-testid`s to assert: `turn-modal`, the compare CTA, inline score input, reconciliation badge, `CACHE_WRITE_NA` string. Pure modules (`run-align`, `loop-heuristic`) test via root Jest: `npm test -- run-align loop-heuristic` (RESEARCH Validation).

---

## No Analog Found

Only the two pure algorithm modules are genuinely greenfield — precisely the CONTEXT-delegated research hand-offs. RESEARCH §2/§3 fully specify them.

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `run-align.ts` | utility (pure) | batch transform | No sequence-alignment/LCS code exists in the dashboard; build tested from RESEARCH §2. Contrast reference only: none. |
| `loop-heuristic.ts` | utility (pure) | batch transform | Deliberately distinct from the backend `lib/experiments/route-heuristics.mjs:229` `loopCount` (strict-adjacent, exact-digest) — that is a *contrast*, not an analog to copy. |

---

## Metadata

**Analog search scope:** `integrations/system-health-dashboard/src/components/performance/`, `src/pages/`, `src/store/slices/`, `src/components/ui/`; `lib/vkb-server/api-routes.js`, `lib/experiments/`; `tests/e2e/dashboard/`.
**Files scanned (read this session):** timeline.tsx, runs-table.tsx, context-cache-explainer.tsx (partial, targeted ranges), score-drawer.tsx, faceted-sidebar.tsx, run-compare.tsx, pages/performance.tsx, performanceSlice.ts (targeted ranges), api-routes.js (reconciliation route), corrected-wins.ts (exports), performance.spec.ts (head).
**UI primitives available** (`src/components/ui/`): dialog, collapsible, tooltip, tabs, checkbox, badge, input, button, separator, sheet, table, scroll-area, alert, card, progress, select — all shadcn, zero new packages.
**Pattern extraction date:** 2026-07-10
