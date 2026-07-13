# Phase 80: Experiment Surface — Dashboard & Skill Packaging - Pattern Map

**Mapped:** 2026-07-13
**Files analyzed:** 7 (2 create + 4 modify + 1 shell modify)
**Analogs found:** 7 / 7 (all in-repo — no RESEARCH-only fallbacks)

Three subsystems: **(1) backend endpoint** (`GET /api/experiments/comparison` on the vkb-server), **(2) dashboard Comparison tab** (new tab + matrix component + Redux thunk), **(3) skill packaging** (`.claude/commands/experiment.md` + installer). Every new file has a concrete in-repo analog; excerpts + line refs below.

---

## File Classification

| New/Modified File | Op | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|----|------|-----------|----------------|---------------|
| `lib/vkb-server/api-routes.js` (`handleComparison` + route reg) | modify | route + handler | request-response (read-only) | `handleRunsQuery` (same file, 547-565) + route reg 91 | exact (same file, same store idiom) |
| `integrations/system-health-dashboard/src/components/performance/comparison-matrix.tsx` | create | component | request-response / transform | `run-compare.tsx` (comparison view) + `runs-table.tsx` (table scaffold) | role-match |
| `integrations/system-health-dashboard/src/store/slices/performanceSlice.ts` (`fetchComparison` thunk + state) | modify | store (Redux slice) | request-response (async fetch) | `fetchReconciliation` (681-702) keyed-by-id + `fetchReports` (815-827) typed generic | exact |
| `integrations/system-health-dashboard/src/pages/performance.tsx` (Comparison `TabsTrigger`/`TabsContent`) | modify | page (tab wiring) | event-driven (tab select) | existing `Tabs` block (198-237) + `activeTab` useState (135) | exact (same block) |
| `.claude/commands/experiment.md` | create | config (skill file) | batch (CLI wrapper) | `.claude/commands/sl.md` (frontmatter + step structure) | role-match |
| `scripts/generate-agent-instructions.sh` | run (no edit) | config (installer) | file-I/O (copy/symlink) | already generic — globs `*.md` (93, 116-120) | exact (no change; re-run) |
| `tests/e2e/performance/comparison-tab.spec.ts` | create | test (E2E) | request-response verify | existing `tests/e2e/**` Playwright specs | role-match |

**Key routing fact:** `/api/experiments/*` is proxied dashboard→`host.docker.internal:8080` at `integrations/system-health-dashboard/server.js:346` — **NO server.js change**. The endpoint lands on the vkb-server (`lib/vkb-server/api-routes.js`), which the proxy forwards automatically (CONTEXT D-04).

---

## Pattern Assignments

### 1. `lib/vkb-server/api-routes.js` — `handleComparison` + route registration (route + handler, request-response)

**Analog:** `handleRunsQuery` (api-routes.js:547-565) — the exact `open → readRuns → close-in-finally` transient-store idiom. The new handler adds one `buildComparison` call between `readRuns` and the JSON response.

**Route registration** — add beside the runs route (api-routes.js:91-95):
```javascript
app.get('/api/experiments/runs', (req, res) => this.handleRunsQuery(req, res));
app.delete('/api/experiments/runs', (req, res) => this.handleDeleteRuns(req, res));
app.get('/api/experiments/runs/:taskId/timeline', (req, res) => this.handleTimeline(req, res));
// ADD:
// app.get('/api/experiments/comparison', (req, res) => this.handleComparison(req, res));
```

**Transient-store handler pattern to clone** (api-routes.js:547-565):
```javascript
async handleRunsQuery(req, res) {
  try {
    const { openExperimentStore } = await import('../experiments/store.mjs');
    const { readRuns } = await import('../experiments/query.mjs');
    const store = await openExperimentStore(this.experimentRepoRoot ? { repoRoot: this.experimentRepoRoot } : {});
    try {
      const rows = await readRuns(store, { includePending: req.query.includePending === 'true' });
      return res.status(200).json({ rows });
    } finally {
      await store.close();
    }
  } catch (error) {
    logger.error('Runs query failed', { error: error.message });
    return res.status(500).json({ error: 'Runs query failed', message: error.message });
  }
}
```

**`handleComparison` composition** (new — same skeleton, one extra import + one extra call):
- dynamic-import `openExperimentStore` from `../experiments/store.mjs`, `readRuns` from `../experiments/query.mjs`, **and `buildComparison` from `../experiments/compare.mjs`** (top-level static `import { buildComparison }` is also fine — it is a pure module, no store).
- validate `req.query.task_hash` server-side via `sanitizeTaskHash` (D-06) — a 400 BEFORE opening the store, mirroring `handleReconciliation`'s `_validTaskId` early-return (api-routes.js:639-644).
- `rankBy = req.query.rank_by ?? 'composite'` maps to `buildComparison`'s `rankBy` override (D-05).
- `open → const rows = await readRuns(store) → const report = buildComparison(rows, { taskHash, rankBy }) → close in finally → res.json(report)`.

**GOTCHA — `openExperimentStore` sets `ontologyDir` internally** (CLAUDE.md km-core rule): do NOT `new GraphKMStore(...)`. `openExperimentStore()` already injects `ontologyDir` (confirmed by `scripts/experiments-compare.mjs:74-75` comment "opens via openExperimentStore() — ontologyDir set in lib/experiments/store.mjs"). Reuse the helper exactly as `handleRunsQuery` does; do not construct a store by hand.

**`sanitizeTaskHash` — reuse from `scripts/experiments-compare.mjs:108-125`** (extract into a shared spot or re-import; it is already an `export`):
```javascript
export function sanitizeTaskHash(hash) {
  if (typeof hash !== 'string' || hash.length === 0) {
    throw new Error('sanitizeTaskHash: task_hash is required and must be a non-empty string');
  }
  if (hash.includes('\0')) { throw new Error(/* null byte */); }
  if (hash.includes('/') || hash.includes('\\')) { throw new Error(/* path separator */); }
  if (hash.includes('..')) { throw new Error(/* traversal */); }
  if (!/^[A-Za-z0-9._-]+$/.test(hash)) { throw new Error(/* charset */); }
  return hash;
}
```
The route is READ-only (no filename is written), so the endpoint only needs the *validation* (allowlist regex) — wrap the throw in a `400` rather than crashing. Note `scripts/experiments-compare.mjs` imports its store helpers with a repo-relative `../lib/...` path; the vkb-server handler already uses `../experiments/...` (it lives under `lib/vkb-server/`), so the `buildComparison` import path is `../experiments/compare.mjs`.

**`buildComparison` signature + return shape** (from `lib/experiments/compare.mjs:284-357` — the FROZEN Phase 79 schema the endpoint returns verbatim):
```javascript
// buildComparison(rows, { taskHash, rankBy = 'composite' })
// rows: readRuns join output (any task_hash — filters internally to taskHash)
// returns:
{
  taskHash,        // string
  rankBy,          // 'composite' | 'tokens' | 'wallclock' | 'score'
  ranked:   [],    // VariantEntry[] each with .rank + .composite (sorted best-first)
  failed:   [],    // "no successful runs" — never a cheap winner
  ungated:  [],    // no test_command
  unscored: [],    // successful+gated but null/zero rubric
}
// VariantEntry = { variant, n, composite?/rank?/reason?, metrics: { <metric>: {mean,stddev,median,min,max,n} } }
// metrics keys: totalTokens, wallclock, loop_count, edit_revert_count, redundant_read_count,
//   abandoned_tool_count, total_step_count, wallclock_per_step, rubric_score, + 5 rubric dims.
```

**NOTE — `gate_outcome` stamping (D-05):** `buildComparison`'s raw output does NOT carry the per-variant `gate_outcome` field; that is added by the CLI's `withGateOutcomes` wrapper in `scripts/experiments-compare.mjs:146-157` + `writeReportJson:171-189`. The dashboard's frozen schema (CONTEXT D-05, `experiments-compare.mjs:38-52`) DOES include `gate_outcome` per VariantEntry. **The endpoint must apply the same `GROUP_GATE_OUTCOME` map** so the live JSON matches the CLI-written report JSON exactly — extract `GROUP_GATE_OUTCOME` + `withGateOutcomes` from `experiments-compare.mjs:146-157` and shape the response like `writeReportJson`'s `doc` (with `task_hash`, `rank_by`, `generated_at`, the four `gate_outcome`-stamped group arrays). This is the single most likely schema-drift bug (live tab vs CLI file diverge).

**Error handling** (identical to `handleRunsQuery`): `logger.error(...)` + `res.status(500).json({ error, message })`. Use the module `logger` (api-routes.js:16 `const logger = createLogger('api')`) — **no `console.*`** (CLAUDE.md).

---

### 2. `src/components/performance/comparison-matrix.tsx` — variant-column matrix (component, transform)

**Analog A (comparison-view scaffold):** `run-compare.tsx` (209 lines) — a self-reading comparison component: `Card` + `useAppSelector`/`useAppDispatch`, a `Delta` cell helper, a `MetricRow` interface, colour-by-direction. Mirror its imports + `fmtNum`/`Delta` helpers.

**Analog B (table scaffold):** `runs-table.tsx` — `Table/TableBody/TableCell/TableHead/TableHeader/TableRow` from `@/components/ui/table`, `Badge`, `Tooltip`. D-02 wants variants-as-**columns**, metrics-as-**rows** (transposed vs runs-table), so use the `Table` primitives but put variants in `<TableHead>` cells and metrics in rows.

**Imports pattern to copy** (run-compare.tsx:1-18):
```typescript
import { useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAppSelector, useAppDispatch } from '@/store'
import {
  fetchComparison,            // NEW thunk (add to slice)
  selectComparisonFor,        // NEW selector (add to slice)
  selectSelectedTaskId,       // REUSE (performanceSlice.ts:1628) — D-03 task context
  type ComparisonReport,      // NEW type (add to slice)
} from '@/store/slices/performanceSlice'
```

**Fetch-on-mount pattern** (mirror run-compare.tsx:`useEffect` dispatch + slice-driven render — component holds NO fetch, NO shared useState; project rule `project_dashboard_redux_state`):
```typescript
const dispatch = useAppDispatch()
const taskHash = useAppSelector(selectSelectedTaskId)      // D-03: reuse the existing selection context
const report = useAppSelector((s) => selectComparisonFor(s, taskHash))
useEffect(() => { if (taskHash) dispatch(fetchComparison(taskHash)) }, [dispatch, taskHash])
```

**Honesty-spine rendering (D-02):** render the four groups as visually distinct sections — `ranked` (best-first, with `rank`+`composite`), then `failed`/`ungated`/`unscored` in a separate "not ranked" region carrying each entry's `.reason`. This is the exact partition the CLI's `renderTable` uses (`experiments-compare.mjs:262-303`) — mirror its section labels ("RANKED …", "FAILED (no successful runs …)", "UNGATED …", "UNSCORED …"). A variant with no successful runs shows "no successful runs", never a cheap winner.

**Variance cell:** each metric cell is `{mean,stddev,median,min,max,n}`. Discretion (CONTEXT): render `mean ± stddev` with median/range on hover (use the `Tooltip` primitive from runs-table.tsx:11-12). `fmtNum` helper is at run-compare.tsx:39-42.

**Delta/colour helper (optional, run-compare.tsx:44-60):** if you want best-column highlighting, the `Delta` component's green/red direction logic is reusable, but the matrix's primary job is the ranked table, not pairwise deltas.

---

### 3. `src/store/slices/performanceSlice.ts` — `fetchComparison` thunk + state (store, async fetch)

**Analog (keyed-by-id fetch):** `fetchReconciliation` (performanceSlice.ts:681-702) — a same-origin `fetch` keyed by an id, graceful on absence, storing into a `Record<string, …>` map. This is the closest match because the comparison is keyed by `task_hash` (like reconciliation is keyed by `taskId`).

**Analog (typed generic + query param):** `fetchReports` (815-827) for the simple typed-generic shape, and `fetchRunNarrative` (708-736) for building a query string with `URLSearchParams`.

**Thunk pattern to copy** (fetchReconciliation.681-702):
```typescript
export const fetchComparison = createAsyncThunk<
  { taskHash: string; report: ComparisonReport | null },
  { taskHash: string; rankBy?: string },
  { rejectValue: string }
>(
  'performance/fetchComparison',
  async ({ taskHash, rankBy }, { rejectWithValue }) => {
    try {
      const qs = new URLSearchParams({ task_hash: taskHash })
      if (rankBy) qs.set('rank_by', rankBy)
      const response = await fetch(`/api/experiments/comparison?${qs.toString()}`)
      if (!response.ok) throw new Error(`API returned ${response.status}`)
      const report = (await response.json()) as ComparisonReport
      return { taskHash, report }
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : 'Unknown error')
    }
  }
)
```

**State field** — add to `interface PerformanceState` (near reconciliationByTaskId, 271-274) and its initial value (532):
```typescript
// interface PerformanceState:
comparisonByTaskHash: Record<string, ComparisonReport | null>
// initial state (near line 532):
comparisonByTaskHash: {},
```

**extraReducers case** — mirror the reconciliation reducer (performanceSlice.ts:1380-1382):
```typescript
.addCase(fetchComparison.fulfilled, (state, action) => {
  state.comparisonByTaskHash[action.payload.taskHash] = action.payload.report
})
```
(Add matching `.pending`/`.rejected` only if you surface a loading/error banner — reconciliation is best-effort with no pending case, which is the simplest honest pattern.)

**Selector** — add beside `selectReconciliationFor` style selectors:
```typescript
export const selectComparisonFor = (state: RootState, taskHash: string | null) =>
  taskHash ? (state.performance.comparisonByTaskHash[taskHash] ?? null) : null
```

**`ComparisonReport` TS type** — model it on the frozen Phase 79 JSON schema (`experiments-compare.mjs:26-56`): `{ task_hash, rank_by, generated_at, ranked, failed, ungated, unscored }` with `VariantEntry = { variant, n, gate_outcome, rank?, composite?, reason?, metrics }`. Mirror the existing `ReconciliationSummary` type declaration style (performanceSlice.ts:162+).

---

### 4. `src/pages/performance.tsx` — Comparison `TabsTrigger` + `TabsContent` (page, tab select)

**Analog:** the existing controlled `Tabs` block (performance.tsx:198-237) + `activeTab` useState (135). Add a 5th tab; do NOT overload the existing "Compare" (manual 2-run A/B) or "Reports" tabs — CONTEXT D-01 audit trap.

**Add the trigger** in the `TabsList` (after the "reports" trigger, ~203):
```tsx
<TabsTrigger value="reports" data-testid="reports-tab">Reports</TabsTrigger>
<TabsTrigger value="comparison" data-testid="comparison-tab">Comparison</TabsTrigger>
```

**Add the content** (after the reports `TabsContent`, ~236):
```tsx
<TabsContent value="comparison" className="mt-4">
  <ComparisonMatrix />
</TabsContent>
```

**Import** the new component beside the other performance-component imports (performance.tsx:19-30):
```typescript
import { ComparisonMatrix } from '@/components/performance/comparison-matrix'
```
`activeTab` (135, `useState('runs')`) already drives `Tabs value=`; no state-machine change needed — a new string value "comparison" just works.

---

### 5. `.claude/commands/experiment.md` — the `experiment` skill (config, CLI wrapper)

**Analog:** `.claude/commands/sl.md` — YAML frontmatter (`description:` + optional `argument-hint:`) then a `# Title` + `## Instructions` + numbered `### Step N` body. The installer (below) extracts `description:` from frontmatter, so it MUST be present.

**Frontmatter to mirror** (sl.md:1-4):
```markdown
---
description: Declare + run a cross-agent experiment matrix, then auto-compare and render the ranked variant table
argument-hint: run --goal "…" --variants A,B --agents claude,opencode --repeats N
---
```

**Body (D-07/D-09 — a THIN wrapper; shells to existing CLIs, reimplements nothing):**
The skill's `experiment run` flow chains two existing scripts:
1. **Run the matrix** — `scripts/experiment-run.mjs`. CLI surface (experiment-run.mjs:105-120 usage):
   ```
   node scripts/experiment-run.mjs --spec <file> [--variant <name>]... [--repeats N] [--timeout <sec>]
                                   [--run-id <id>] [--run-dir <dir>] [--rerun-of <run_id>]
                                   [--model V=M]... [--agent V=A]...
   ```
   Note: `experiment-run.mjs` is **spec-file driven** (`--spec config/experiments/*.yaml`), NOT `--goal/--variants/--agents` flags. The ORCH-01 headline `experiment run --goal … --variants A,B --agents …` surface must either (a) synthesize a spec YAML from those flags then call `--spec`, or (b) the skill documents the spec-file path. Confirm which during planning — the flag→spec mapping is the one real design decision the skill introduces. Env knobs the skill should surface: `CODING_REPO`, `LLM_PROXY_DATA_DIR`, `LLM_PROXY_PORT`, `CODING_PROXY_ROUTE` (experiment-run.mjs:26-37).
2. **Auto-compare** — `scripts/experiments-compare.mjs` (experiments-compare.mjs:61-64):
   ```
   node scripts/experiments-compare.mjs --task-hash <h> [--rank-by tokens|wallclock|score|composite] [--csv]
   ```
   This prints the ranked table AND writes `.data/experiments/reports/<task_hash>.json` — the SAME file the dashboard Comparison tab reads live (closes the D-04↔D-07 loop; success-criterion 3).

**Agent-quirk notes to embed in the skill (D-09):**
- Copilot hooks need `{version:1,hooks:{...}}` with `type`/`bash` (NOT `command`/`args`), and no `$CODING_REPO` in `cwd` (ENOENT) — memory `feedback_copilot_hook_schema.md`.
- OpenCode headless needs `--dangerously-skip-permissions` — memory `reference_uniform_token_capture_agents.md`.

---

### 6. `scripts/generate-agent-instructions.sh` — skill installer (config, file-I/O) — RUN, do not edit

**Analog = itself; it is already generic.** It globs `.claude/commands/*.md` and distributes to all three agents. Adding `experiment.md` + re-running the script installs it everywhere — NO code change to the installer (CONTEXT D-08).

**How it installs per agent** (extract for the plan's verification step):
- **Claude** (`install_claude_global`, 109-123): `cp` every `$COMMANDS_DIR/*.md` → `~/.claude/commands/`, logs `"Claude: installed $count skill(s) → $target"` (122). The N-skill log line the CONTEXT references.
- **Copilot** (`generate_copilot_instructions`, 128-176): regenerates `.github/copilot-instructions.md`, emitting a skill catalog via `emit_skill_list ""` (169).
- **OpenCode** (`ensure_skill_references_in_claude_md`, 182-223): idempotently rewrites the `## Available Skills (Auto-Generated)` section in `CLAUDE.md` via `emit_skill_list "/"` (218).

**Frontmatter dependency** — the installer reads `description:` from frontmatter (`extract_description`, 54-85) and falls back to the first non-`#`/non-`---` line (100-102). Give `experiment.md` a `description:` so the catalog line is clean.

**Verification the plan should run:** after `./scripts/generate-agent-instructions.sh`, assert `experiment.md` appears in (a) `~/.claude/commands/`, (b) `.github/copilot-instructions.md` catalog, (c) `CLAUDE.md` Available-Skills section. The log line "installed N skill(s)" should increment by 1.

---

### 7. `tests/e2e/performance/comparison-tab.spec.ts` — Playwright E2E (test, request-response verify)

**Analog:** existing specs under `tests/e2e/` (CLAUDE.md mandates structured E2E under `tests/e2e/<area>/<spec>.spec.ts`, run via `npx playwright test`). Reuse the `data-testid` convention already on the tabs (`avenues-tab`, `compare-tab`, `reports-tab` at performance.tsx:201-203) — add `data-testid="comparison-tab"` and assert the variant columns + the four honesty-spine groups render.

**Project mandate (memory `feedback_green_nodes` / `feedback_e2e_verify`):** ALWAYS write a Playwright test for this kind of grouped/coloured UI; NEVER claim "works" from endpoint/DB queries alone. Visual smoke via **gsd-browser** at `localhost:3032` (navigate/screenshot/click) is ALSO mandatory (memory `feedback_dashboard_screenshots_gsd_browser`) — not a hand-rolled `node /tmp/foo.mjs` Playwright script.

---

## Shared Patterns

### Transient experiment store (backend)
**Source:** `lib/vkb-server/api-routes.js:547-565` (`handleRunsQuery`) + `lib/experiments/store.mjs` (`openExperimentStore`).
**Apply to:** the new `handleComparison`.
Always `open → operate → await store.close()` in a `finally`; honour `this.experimentRepoRoot` for test isolation; NEVER `new GraphKMStore` (ontologyDir is set inside `openExperimentStore`, CLAUDE.md km-core rule).

### Frozen Phase 79 comparison schema (backend + frontend)
**Source:** `scripts/experiments-compare.mjs:26-56` (schema doc) + `writeReportJson:171-189` (the `doc` shape) + `GROUP_GATE_OUTCOME`/`withGateOutcomes:146-157`.
**Apply to:** the endpoint response AND the frontend `ComparisonReport` type.
The endpoint must emit the SAME `{task_hash, rank_by, generated_at, ranked/failed/ungated/unscored}` doc the CLI writes — including per-variant `gate_outcome` — so the live tab and the CLI-written `.json` never diverge. `buildComparison`'s raw output lacks `gate_outcome`; stamp it via `withGateOutcomes`.

### Server-side task_hash validation
**Source:** `scripts/experiments-compare.mjs:108-125` (`sanitizeTaskHash`) + `api-routes.js:639-644` (`_validTaskId` early-400 in `handleReconciliation`).
**Apply to:** `handleComparison` — validate `?task_hash` BEFORE opening the store; 400 on failure (D-06). Read-only route, so only the allowlist regex matters (no filename write).

### Redux-only dashboard state
**Source:** `performanceSlice.ts` `createAsyncThunk` + `createSelector`; `performance.tsx:32-36` header comment ("No page-local useState holds shared state; no fetch() lives in this component").
**Apply to:** the matrix component + the `fetchComparison` thunk. Component holds NO fetch and NO shared useState — read via `useAppSelector`, mutate via dispatched thunk (memory `project_dashboard_redux_state`).

### No raw console.* / logger discipline
**Source:** `api-routes.js:16` (`createLogger('api')`); `compare.mjs:50` + CLIs use `process.stderr.write` only.
**Apply to:** every new backend line — use the module `logger`; never `console.*` (CLAUDE.md no-console-log).

### Dashboard bind-mount rebuild (verification)
**Source:** CLAUDE.md "Rebuilding After Code Changes".
**Apply to:** after editing `performance.tsx` / `performanceSlice.ts` / `comparison-matrix.tsx`:
```bash
cd /Users/Q284340/Agentic/coding/integrations/system-health-dashboard && npm run build
docker exec coding-services supervisorctl restart web-services:health-dashboard-frontend
```
The vkb-server (:8080) is a SEPARATE process from the dashboard container — confirm its restart mechanism to pick up the new `api-routes.js` route (NOT `server.js`, NOT the dashboard `docker-compose build`).

---

## No Analog Found

None. Every file maps to a concrete in-repo analog. The only genuinely-new logic is:
- the flag→spec-YAML synthesis in `experiment.md` (if the ORCH-01 `--goal/--variants/--agents` surface must translate to `experiment-run.mjs --spec`) — a skill-prose decision, no code analog needed.
- the `gate_outcome` stamping location (endpoint vs client) — resolved by reusing `withGateOutcomes` from the CLI (extract, don't reinvent).

---

## Metadata

**Analog search scope:** `lib/vkb-server/`, `lib/experiments/`, `scripts/`, `integrations/system-health-dashboard/src/{pages,components/performance,store/slices}/`, `.claude/commands/`.
**Files scanned (read):** `api-routes.js` (1-120, 520-650), `compare.mjs` (full), `experiments-compare.mjs` (full), `experiment-run.mjs` (1-120), `generate-agent-instructions.sh` (full), `sl.md` (1-40), `performance.tsx` (1-60, 150-250), `performanceSlice.ts` (671-745, 815-846, 1378-1391 + greps), `run-compare.tsx` (1-70), `runs-table.tsx` (1-40 + greps).
**Pattern extraction date:** 2026-07-13
