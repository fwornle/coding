---
phase: 36-token-usage-per-user-hourly-exports-mirror-lsl-conventions-f
plan: 07
status: complete
completed_at: 2026-05-16
tags: [dashboard, ui, treemap, tooltip, accessibility]
dependency_graph:
  requires: []
  provides: ["treemap-hover-tooltip", "svg-title-fallback"]
  affects: ["integrations/system-health-dashboard"]
tech_stack:
  added: []
  patterns: ["recharts custom Tooltip content component", "SVG <title> a11y fallback"]
key_files:
  modified:
    - integrations/system-health-dashboard/src/pages/token-usage.tsx
  created: []
decisions:
  - "Use recharts `<Tooltip content={...}/>` child-of-Treemap pattern (matches the page's existing BarChart/PieChart convention at lines 419 and 540)."
  - "Use SVG `<title>` (not `aria-label` on the rect) for the fallback — SVG `<title>` is the only thing browsers render as a native hover tooltip on SVG elements, and it doubles as the screen-reader name."
  - "Default `d.input ?? 0` / `d.output ?? 0` in TreemapTooltip — defends against API shape drift (T-36-41 mitigation)."
metrics:
  duration: "~8 min"
  tasks_completed: 1
  files_modified: 1
  commits: 1
---

# Plan 36-07 Summary

## Objective

Make the Token Consumption by Process treemap match the promise of its "Hover for details" subtitle. Before this plan, only boxes ≥ 60×40 px rendered inline text and there was no hover tooltip on any leaf. Small boxes (e.g. `reap-final` at 81×44 px) were visually silent.

## Tasks completed

| Task | Status | Commit |
|------|--------|--------|
| Task 1: Add TreemapTooltip + wire it into the Treemap + SVG title fallback | ✅ | `7c425c716` |

## Changes

**`integrations/system-health-dashboard/src/pages/token-usage.tsx`** (+46 / -5 lines):

1. **New `TreemapTooltip` component** (after `TreemapContent`, ~26 lines): receives recharts' `{ active, payload }`, renders process name (bold) + `Nx tokens total` + blue/green in/out split + call count + avg latency. Matches the page's existing card-tooltip Tailwind style (`bg-background border rounded-md shadow-md`).
2. **Extended `treemapData` mapping** (+2 lines): now carries `input: p.input_tokens` and `output: p.output_tokens`. These fields existed in `summary.by_process` but were being dropped on the floor before.
3. **Wired `<Tooltip content={<TreemapTooltip />} />`** as a child of `<Treemap>` (converted the self-closing `<Treemap .../>` to opening/closing form).
4. **Added `<title>` SVG element** as the first child of `<g>` inside `TreemapContent` — text is `${name} — ${formatTokens(value)} tokens`. This is the native-browser hover tooltip + screen-reader accessibility fallback that works regardless of whether recharts' Tooltip attaches correctly.

## Verification

### Automated (per plan's `<verify>` block)

```
$ grep -c "TreemapTooltip" integrations/system-health-dashboard/src/pages/token-usage.tsx
2  (definition + use)
$ grep "<Tooltip content={<TreemapTooltip" integrations/system-health-dashboard/src/pages/token-usage.tsx
                    <Tooltip content={<TreemapTooltip />} />
$ grep "<title>" integrations/system-health-dashboard/src/pages/token-usage.tsx
      <title>{`${name} — ${formatTokens(value)} tokens`}</title>
$ grep -E "input: p.input_tokens|output: p.output_tokens" integrations/system-health-dashboard/src/pages/token-usage.tsx
      input: p.input_tokens,
      output: p.output_tokens,
$ cd integrations/system-health-dashboard && npm run build   # exit 0
$ docker exec coding-services supervisorctl restart web-services:health-dashboard-frontend
web-services:health-dashboard-frontend: started
$ curl -sS -o /dev/null -w "%{http_code}" http://localhost:3032/token-usage
200
$ docker exec coding-services supervisorctl status web-services:health-dashboard-frontend
web-services:health-dashboard-frontend   RUNNING   pid 55708
```

### Playwright (per CLAUDE.md feedback memory on E2E verification — done via /playwright-cli skill)

Headless Chromium → http://localhost:3032/token-usage → hover smallest leaf + largest leaf.

```
Found 7 <svg rect> inside the treemap card.
Smallest rect: idx=5 w=81  h=44  area=3564     (reap-final — sub-60×40, no inline text)
Largest rect:  idx=0 w=981 h=352 area=345312   (observation-writer)

SMALL assertions: tokens-total=true in/out=true calls=true   ✅
LARGE assertions: tokens-total=true in/out=true calls=true   ✅

SVG <title> elements inside the treemap card: 10
Populated <title> elements (with "tokens" text): 5
   "observation-writer — 2.6M tokens"
   "consolidator-digest — 236.4K tokens"
   "consolidator-insight — 176.0K tokens"
   "reap-test — 30.7K tokens"
   "reap-final — 30.7K tokens"

No browser console errors.
```

### Visual screenshots

- `/tmp/36-07-tooltip-small.png` — Tooltip popover over the **81×44 px `reap-final` leaf** (a box too small to render inline text via `TreemapContent`'s `width > 60 && height > 40` gate). Tooltip reads:
  > **reap-final**
  > 30.7K tokens total
  > 30.1K in · 564 out
  > 1 call · avg 20.7s
- `/tmp/36-07-tooltip-large.png` — Tooltip popover over the **981×352 px `observation-writer` leaf**. Tooltip reads:
  > **observation-writer**
  > 2.6M tokens total
  > 2.4M in · 151.2K out
  > 759 calls · avg 7.1s

Both screenshots confirm the "Hover for details" card subtitle (line 349 of token-usage.tsx) is no longer aspirational.

## Deviations from plan

**None.** Plan executed exactly as written.

The TypeScript pre-check (`tsc --noEmit`) emits two **pre-existing** errors on lines 420 and 540 of token-usage.tsx (Formatter type incompatibility with recharts' `Formatter<number, NameType>` accepting `undefined`). These are on the BarChart and Cumulative chart `Tooltip formatter` props — **not on my changes**, and they pre-date this plan (verifiable by `git stash && tsc` on baseline). The build script is intentionally `tsc --noEmit 2>/dev/null; vite build`, so vite always runs regardless of tsc output; build exits 0. Per Rule 3 scope boundary, pre-existing errors in unrelated lines are out of scope. Logged to deferred-items as a note.

**One transient hiccup, self-recovered:** During the in-flight edit, an external tool (linter or auto-formatter) momentarily reverted the SVG `<title>` insertion from the file between my Edit call and the next Read. I re-applied it, rebuilt, restarted, and re-ran the Playwright verification — the final committed state has the `<title>` element and the Playwright run confirmed 5 populated SVG `<title>` leaves in the live DOM. No data lost; no commit polluted.

## Auto-fixes / Authentication gates

None. No auth required, no bug fixes needed beyond the plan's scope.

## Files modified

- `integrations/system-health-dashboard/src/pages/token-usage.tsx` (commit `7c425c716`)

No other files touched. The other dirty files in the working tree (CONTEXT.md, STATE.md, ROADMAP.md, `.data/observation-export/*`, etc.) are owned by a parallel chat executing Waves 1–4 of this phase and were explicitly out of scope for plan 36-07.

## Coordination notes

This plan ran in parallel with another chat executing Waves 1–4 of Phase 36 (plans 36-01..36-05, which touch `_work/rapid-llm-proxy/src/token-usage.ts` and `proxy-bridge/server.mjs`). 36-07 touched ONLY the dashboard React file — zero file overlap, no merge conflicts, no race conditions. 36-06 was deliberately left untouched (it depends on Wave 3 of the parallel chat).

## Deferred items

- **Pre-existing tsc errors** on token-usage.tsx lines 420 + 540 (recharts Formatter type narrowing). Not introduced by this plan; needs a separate cleanup pass that widens the formatter signature to accept `number | undefined`.

## Threat surface scan

No new security-relevant surface introduced. The TreemapTooltip is pure React render of already-fetched API data with no `dangerouslySetInnerHTML`. T-36-41 (missing input_tokens / output_tokens) is mitigated via `d.input ?? 0` / `d.output ?? 0` defaults. T-36-45 (FUSE cache) didn't trigger — `supervisorctl restart web-services:health-dashboard-frontend` was sufficient; no need to fall back to `docker-compose restart coding-services`. Verified the served bundle hash (`index-BYvsKpz7.js`) contained the new "tokens total" string before running the Playwright assertions.

## Success criteria — all met

- ✅ Every box in the process treemap has a working hover tooltip with process / total / in / out / calls / avg latency
- ✅ SVG `<title>` fallback present for screen readers + native-browser hover + recharts-failure safety net (5 populated titles, one per process leaf, verified in live DOM)
- ✅ Dashboard rebuilt + redeployed; Playwright E2E hover assertion passes on small (81×44) AND large (981×352) boxes
- ✅ No visual regressions on the rest of the Token Usage page (sibling chart cards unchanged)
- ✅ Screenshots saved: `/tmp/36-07-tooltip-{small,large}.png`
- ✅ No browser console errors during hover
- ✅ "Hover for details" card subtitle is now truthful (no longer aspirational)

## Self-Check: PASSED

- FOUND: `integrations/system-health-dashboard/src/pages/token-usage.tsx` (modified, 46+ / 5-)
- FOUND: commit `7c425c716` in git log (`feat(36-07): wire TreemapTooltip + <title> fallback on token-usage treemap`)
- FOUND: `/tmp/36-07-tooltip-small.png` (118899 bytes)
- FOUND: `/tmp/36-07-tooltip-large.png` (121047 bytes)
- FOUND: live dashboard at http://localhost:3032/token-usage returns HTTP 200
- FOUND: `TreemapTooltip` function defined + used (2 occurrences)
- FOUND: `<title>` SVG element on line 136
- FOUND: `input: p.input_tokens` + `output: p.output_tokens` in treemapData mapping
- FOUND: `<Tooltip content={<TreemapTooltip />} />` wired as Treemap child
