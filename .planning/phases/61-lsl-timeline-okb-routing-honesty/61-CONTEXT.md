# Phase 61: LSL Timeline & OKB Routing Honesty - Context

**Gathered:** 2026-06-20
**Status:** Ready for planning

<domain>
## Phase Boundary

The unified viewer stops quietly misrepresenting data on two surfaces:

1. **LSL timeline strip** — no silent 200-record cap (visible "N of M" honesty), no
   silent 365-day "all" window (honest label), and two distinct tick colors for the
   two session sources (manual/batch vs online/auto) instead of a single pink.
2. **OKB tab (`/viewer/okb`)** — actually reaches OKM Express on `:8090` and renders
   real RaaS / KPI-FW / business entities, instead of forcing km-core's `/api/v1`
   contract (which 404s on `:8090`) and showing coding-KG mirror entities.

**In scope:** UI + routing surgery on `integrations/unified-viewer` plus a small
additive field on the obs-api `/api/coding/lsl/sessions` payload (per-session source).
**Out of scope:** the sparse-graph-node-history backfill question (separate
`mcp-server-semantic-analysis` investigation — see deferred); mirroring OKM data into
coding's km-core (Option C, deferred per Phase 55 ROADMAP).

</domain>

<decisions>
## Implementation Decisions

### LSL 200-record cap honesty (LSLTIME-01)
- **D-01:** Keep a **bounded fetch cap** (do NOT remove it — thousands of overlapping
  2px ticks are illegible and a perf hazard). Surface a **visible "showing N of M
  total" badge** in the strip whenever the in-strip count is below the underlying
  total. The operator can never be silently fooled.
- **D-02:** The badge requires the underlying **total count** for the selected window.
  The obs-api endpoint must return (or the client must obtain) the true total `M`
  alongside the capped `N` sessions — a count-only field is sufficient; full payload
  for all sessions is NOT required. Planner/researcher to confirm the cheapest way to
  get `M` (endpoint count field vs `HEAD`/meta vs separate count query).
- **D-03:** The chosen cap number (current `limit=200`) may be raised to a sane ceiling
  (Claude's discretion — e.g. 500) so typical windows fit without the badge, but the
  badge must still fire honestly when exceeded. Document the cap + its meaning in the
  `useLslSessions` hook header (it currently documents the old contract).

### "all" window honesty (LSLTIME-02)
- **D-04:** Rename the `'all'` window option to **`'1y'`** to honestly reflect the
  existing 365-day `WINDOW_MS` value (line 33 of `useLslSessions.ts`). Window ladder
  becomes **24h / 7d / 30d / 1y**. No backend window change; the misnamed "all" label
  is the lie being removed.
- **D-05:** A true all-time window was explicitly NOT chosen (would pull the full ~22k
  session history and couples with cap-removal we rejected). If true all-time is wanted
  later it is a separate enhancement. The `'1y'` rename + the "N of M" badge together
  give honest coverage.
- **D-06:** Update every consumer of the `'all'` key — `LslWindow` type, `WINDOW_MS`
  record, the strip toggle UI, the auto-slide `ageMs`/`WINDOW_MS` comparisons in
  `LslTimelineStrip.tsx`, and `useNodeToBucketsIndex` if it references the key.

### Bi-source tick coloring (LSLTIME-03)
- **D-07:** The session payload carries **no source signal today** (confirmed shape:
  `{id, startAt, endAt, observationCount, entityIds}`). **obs-api adds a per-session
  `source` field** to `/api/coding/lsl/sessions`, derived from the constituent
  observations' `metadata.source` (live/auto e.g. `auto`/`sub-agent` vs manual/batch).
  Backend is the honest source of truth — client-side id-heuristic inference was
  explicitly rejected as fragile.
- **D-08:** Two buckets: **online/auto** (live LSL streaming — claude-code/sub-agent
  transcripts via ObservationWriter) vs **manual/batch** (operator-triggered
  wave-analysis / batch ingestion). Strip keeps **pink (`bg-pink-300`, the existing
  `metadata.source==='auto'` convention) for online/auto** and adds a **distinct second
  hue for manual/batch** (exact hue is Claude's discretion — pick something clearly
  distinguishable at a glance without hovering, e.g. amber or slate; must coexist with
  the existing greyed-out 0-obs disabled state and the blue selection/halo rings).
- **D-09:** Researcher to confirm the exact derivation rule for a session's source when
  its observations are mixed-source (e.g. dominant source, or any-batch → batch). Pick a
  deterministic rule and document it.

### OKB contract bridge (OKBROUTE-01, OKBROUTE-02)
- **D-10:** Bridge at the **ApiClient layer** for `system=okb`: rewrite the km-core
  canonical paths (`/api/v1/entities`, `/api/v1/relations`, etc.) to OKM Express's
  legacy `/api/entities` shape, AND add a **response adapter** normalizing OKM Express's
  payload to the unified viewer's `Entity[]` / `Relation[]` shape. OKM Express stays
  untouched (tactical close — it is on its way out; server-side `/api/v1` mounting was
  rejected as heavier/cross-repo). This matches the REQUIREMENTS.md note "Adapter logic
  in `lib/system-endpoints.ts` or `ApiClient.ts`".
- **D-11:** The rewrite/adapter MUST be **scoped to `okb` only** — the `coding`/VKB
  system continues to hit km-core's `/api/v1` contract unchanged. Drive the branch off
  the active `System` slug (`system-endpoints.ts`), not a global flag.
- **D-12:** Researcher to diff OKM Express's `/api/entities` response shape against
  `ApiClient.Entity` (`ApiClient.ts:20-28`) and map fields (envelope `{success,data}` is
  shared per the todo; entity-attribute shape needs confirming). Cover entities AND
  relations/neighbors paths the OKB graph view exercises.

### OKB truthful-failure UX (Success Criterion #5)
- **D-13:** When OKM Express is **unreachable or errors** on `:8090`, the OKB tab
  surfaces a **truthful "OKM Express unreachable on :8090"** message and renders nothing
  — it MUST NOT silently fall back to the coding-KG mirror. Investigate WHY coding-KG
  mirror entities (`CodeAnalyzer`, `PersistenceAgent`) currently appear despite the
  endpoint pointing at `:8090` (likely a fallback/default base-URL path or the okb URL
  not being applied) and remove that silent-fallback path.

### Claude's Discretion
- Exact bounded cap number (D-03), the second tick hue for manual/batch (D-08), the
  cheapest mechanism to obtain total `M` (D-02), and the mixed-source derivation rule
  (D-09) — all delegated to research/planning within the locked decisions above.

### Folded Todos
Both folded todos carry `resolves_phase: 61` and ARE this phase's source material
(mapped 1:1 onto the requirements):

- **`.planning/todos/pending/2026-06-14-lsl-timeline-200-cap-and-all-window-misnaming.md`**
  — LSL timeline silently truncates history (200-cap + "all"=365d). Folds onto
  LSLTIME-01 (D-01..D-03) and LSLTIME-02 (D-04..D-06). Contains the disk-history
  forensics (22,583 files back to 2025-06-16; per-month distribution) the planner needs.
- **`.planning/todos/pending/2026-06-10-okm-express-api-contract-bridge.md`**
  — OKM Express `/api/entities` vs unified-viewer `/api/v1/entities` mismatch. Folds
  onto OKBROUTE-01/02 (D-10..D-13). Documents the concrete 404 vs 200 probe results and
  the Option A/B/C analysis (we chose Option A).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` §"Phase 61: LSL Timeline & OKB Routing Honesty" — goal + 5
  success criteria.
- `.planning/REQUIREMENTS.md` — LSLTIME-01/02/03, OKBROUTE-01/02 (lines 38-45).

### Folded todos (forensics + option analysis)
- `.planning/todos/pending/2026-06-14-lsl-timeline-200-cap-and-all-window-misnaming.md`
  — cap/window forensics, fix outline, acceptance.
- `.planning/todos/pending/2026-06-10-okm-express-api-contract-bridge.md`
  — contract-mismatch probe results, Option A/B/C trade-offs.

### LSL timeline source files
- `integrations/unified-viewer/src/panels/coding/useLslSessions.ts` — `WINDOW_MS`
  (line 29-34, `all`=365d at line 33), `limit=200` in `fetchSessions` (line 49),
  `LslWindow` type (line 23), `LslSession` interface (line 36-42, no source field).
- `integrations/unified-viewer/src/panels/coding/LslTimelineStrip.tsx` — tick render +
  `fillClass` `bg-pink-300` (~line 920), auto-slide `WINDOW_MS` comparisons (~line
  310-418), 0-obs disabled state (~line 905-930).
- `tests/integration/obs-api.coding-lsl-sessions.test.js` — documents the current
  session payload contract (header comment line 7) — the obs-api source-field addition
  must extend this test.

### OKB routing source files
- `integrations/unified-viewer/src/api/ApiClient.ts` — `Entity`/`Relation` shapes
  (line 20-36), hardwired `/api/v1/entities` (line 112) + `/api/v1/relations` (line
  131), envelope `{success,data}` in `get<T>` (line 89-100).
- `integrations/unified-viewer/src/config/system-endpoints.ts` — `okb` → `:8090`
  (line 24, D-55-01a), `System` slug + `isValidSystem` guard (line 18-41). NOTE the
  REQUIREMENTS.md ref says `lib/system-endpoints.ts` but the live path is
  `src/config/system-endpoints.ts`.

### Prior-phase decisions carried forward
- `.planning/phases/55-unified-viewer-feature-parity-with-vokb/` — D-55-01a (okb→:8090),
  D-55-01b (cap system removed; 2-system viewer); VKB/VOKB labels.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `useLslSessions` hook (TanStack Query, queryKey partitioned by `windowKey`) — the
  single point to add the total-`M` plumbing and `source` field consumption; shared by
  the strip AND `useNodeToBucketsIndex`.
- Existing `metadata.source==='auto'` → pink convention (graph viewer + strip comment at
  ~line 940) — reuse pink for the online/auto bucket so visual language stays consistent.
- `System` slug + `isValidSystem` type guard in `system-endpoints.ts` — the natural
  branch point for okb-only path rewriting (D-11).

### Established Patterns
- ApiClient already does shape-normalization adapters internally (`listRelations`
  normalizes graphology `{source,target,attributes}` → `{from,to,type}` at line 132-136;
  `listOntologyClasses` BC-wraps `string[]` → `[{name}]`). The OKM Express adapter
  (D-10/D-12) follows this exact established idiom — add an okb-branch normalizer.
- Strip tick styling is class-composition (`fillClass` + `ringClass` + `disabledClass`)
  — the second source color slots in as another `fillClass` branch without disturbing
  the disabled/selection/halo ring logic.

### Integration Points
- obs-api `/api/coding/lsl/sessions` (served by obs-api on port 12436, NOT the dashboard
  server) — additive `source` field + total-count surface. This is the only backend
  touch; everything else is unified-viewer frontend.
- Unified viewer is bind-mounted; per CLAUDE.md the frontend bundle rebuild +
  `supervisorctl restart` (or equivalent dev `vite` at `:5173`) is needed to see changes.

</code_context>

<specifics>
## Specific Ideas

- Operator's lived symptom that motivates LSLTIME-01/02: "no data prior to May 27" in
  the strip despite 12 months of ingested history — the acceptance bar is seeing ticks
  back to the true window edge (or an honest badge explaining the cut), never a silent
  cliff.
- SC#5 negative assertion is explicit and testable: the OKB tab must NEVER show
  `CodeAnalyzer` / `PersistenceAgent` (coding-KG mirror names). E2E should assert their
  absence + presence of real RaaS / KPI-FW entities when `:8090` is up, and the
  truthful unreachable message when it's down.

</specifics>

<deferred>
## Deferred Ideas

- **True all-time LSL window** (`WINDOW_MS.all = Infinity` / oldest-on-disk) — rejected
  for this phase (D-05); revisit only if the `1y` + badge combination proves
  insufficient.
- **Sparse graph-node history backfill** — the km-core graph has only ~13 nodes from
  2025-06 then a gap to 2026-03, suggesting the batch wave-analysis pipeline had its own
  windowing cap or was run rarely against older LSL files. Separate
  `mcp-server-semantic-analysis` investigation (noted in the LSL todo's "Side note").
  Not a viewer/timeline concern.
- **Mirror OKM data into coding's km-core (Option C)** — heavier; only if the operator
  wants the OKB tab queryable offline. Deferred per Phase 55 ROADMAP.
- **Server-side `/api/v1` adapter on OKM Express (Option B)** — the strategic
  "one canonical contract everywhere" path; revisit if OKM Express survives long-term
  instead of being retired.

### Reviewed Todos (not folded)
The `todo.match-phase` query surfaced several score-0.6 generic keyword matches that are
NOT in Phase 61 scope and were reviewed but not folded:
- `2026-05-10-obs-api-libcxx-mutex-shutdown-crash.md` — obs-api SIGTERM crash; infra, not viewer.
- `2026-05-23-orphan-digest-observation-refs.md` — data-integrity; Phase 59 territory.
- `2026-06-10-sub-agent-dashboard-observability-gap.md` — worktree-isolated agent obs gap; observability.
- `2026-06-14-online-filter-hides-ck-truncates-trace.md` — OntologyFilter/hierarchy visibility; Phase 60-adjacent.
- `2026-06-14-vkb-evidence-pattern-filter-asymmetry-and-ontology.md` — filter asymmetry; separate UI concern.

</deferred>

---

*Phase: 61-LSL Timeline & OKB Routing Honesty*
*Context gathered: 2026-06-20*
