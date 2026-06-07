---
phase: 45-unified-web-viewer
plan: 01
subsystem: ui
tags: [react, vite, typescript, tailwind, shadcn, zustand, react-router, zod, vitest, lucide-react]

requires:
  - phase: 44-rest-api-git-snapshots
    provides: "camelCase wire-shape lock (REQUIRED_DIGEST_KEYS / REQUIRED_INSIGHT_KEYS) — viewer's Zod schemas mirror this contract"
provides:
  - "Greenfield React 18 + Vite 5 + TypeScript scaffold at integrations/unified-viewer/ — verbatim dashboard version pins"
  - "15 shadcn primitives copied across via npx shadcn add (new-york / neutral preset inherited)"
  - "Zod DigestSchema / InsightSchema / ObservationSchema mirroring Plan 44-16 lock + 5 shape-lock Vitest assertions"
  - "ApiClient class — /api/v1 canonical endpoints + Phase 44 typed-views + ?withDisplay=true BC fallback"
  - "Zustand useViewerStore with the slice shape PATTERNS.md specifies (selection + filters + UI + reset)"
  - "React Router 7 routes — /viewer/:system with key={system} remount + invalid-slug redirect + UnknownSystem 404"
  - "SYSTEM_ENDPOINTS map + SYSTEM_LABELS + isValidSystem type guard per D-45-02"
affects: [45-02-graph-renderer, 45-03-search-filter-detail, 45-04-markdown-display-extension, 45-05-rca-ops-panel, 45-06-smoke-cutover]

tech-stack:
  added:
    - "react@^18.3.1 + react-dom@^18.3.1 (pinned — NOT 19.x)"
    - "vite@^5.3.1 (pinned — NOT 8.x per Pitfall 4 Tailwind-4 engine break)"
    - "tailwindcss@^3.4.4 (pinned — NOT 4.x)"
    - "lucide-react@^0.544.0 (pinned — NOT 1.x per Pitfall 3 icon renames)"
    - "react-router-dom@^7.14.0"
    - "zustand@^5.0.14 (over RTK — provider-less; remount IS the cross-system reset)"
    - "@tanstack/react-query@^5.101.0 (queryKey: [dataset, system] partitions cache per system)"
    - "zod@^4.3.6 (Zod wire-shape validation at the viewer boundary)"
    - "@react-sigma/core@^5.0.6 + sigma@^3.0.3 + graphology@^0.26.0 (pre-installed for Plan 02)"
    - "react-markdown / remark-gfm / rehype-highlight / highlight.js / @tailwindcss/typography (pre-installed for Plan 04)"
    - "vitest@^1.6.0 + jsdom + @testing-library/react + @testing-library/jest-dom (test infra — net new vs dashboard's Jest)"
    - "shadcn primitives — radix-ui umbrella package (NOT individual @radix-ui/react-* per shadcn 2026-06 default)"
  patterns:
    - "Verbatim dashboard pin inheritance (UI-SPEC Design System line 27)"
    - "Shadcn new-york / neutral preset inheritance via components.json + tailwind.config.ts + src/index.css CSS-variable block"
    - "import.meta.env.VITE_* (Vite-canonical env access) NOT process.env.*"
    - "Three ratification sites for camelCase wire-shape lock: server test, viewer schemas, viewer Vitest"
    - "<UnifiedViewer key={system}/> remount as cross-system state-reset boundary (Pitfall 2 lock)"
    - "ApiClient ?withDisplay=true with transparent BC fallback (string[] -> [{name}]) so Plan 02 stays decoupled from Plan 04"

key-files:
  created:
    - "integrations/unified-viewer/package.json — pinned dep table + scripts"
    - "integrations/unified-viewer/tsconfig.json (verbatim dashboard + tests/**/*.ts include)"
    - "integrations/unified-viewer/vite.config.ts (vendor-graph + vendor-markdown chunks)"
    - "integrations/unified-viewer/vitest.config.ts (NEW — jsdom env, jest-dom setup)"
    - "integrations/unified-viewer/tailwind.config.ts (verbatim dashboard)"
    - "integrations/unified-viewer/postcss.config.mjs (verbatim dashboard)"
    - "integrations/unified-viewer/components.json (verbatim dashboard shadcn preset)"
    - "integrations/unified-viewer/index.html"
    - "integrations/unified-viewer/.env.example (D-45-02 env-var contract)"
    - "integrations/unified-viewer/.gitignore"
    - "integrations/unified-viewer/src/main.tsx (React.StrictMode + QueryClientProvider + <App/>)"
    - "integrations/unified-viewer/src/App.tsx (BrowserRouter + 3 routes)"
    - "integrations/unified-viewer/src/index.css (verbatim CSS-variable block from dashboard)"
    - "integrations/unified-viewer/src/lib/utils.ts (cn() helper verbatim)"
    - "integrations/unified-viewer/src/test-setup.ts (jest-dom matchers)"
    - "integrations/unified-viewer/src/config/system-endpoints.ts (D-45-02 multi-base-URL map)"
    - "integrations/unified-viewer/src/config/theme.ts (useTheme hook)"
    - "integrations/unified-viewer/src/api/ApiClient.ts (km-core REST + typed-views + BC fallback)"
    - "integrations/unified-viewer/src/api/schemas.ts (Zod camelCase shape lock)"
    - "integrations/unified-viewer/src/api/shape-lock.test.ts (5 Vitest assertions mirroring Plan 44-16)"
    - "integrations/unified-viewer/src/api/ApiClient.test.ts (6 Vitest assertions — fetch stub)"
    - "integrations/unified-viewer/src/store/viewer-store.ts (Zustand 5 with the slice shape)"
    - "integrations/unified-viewer/src/store/viewer-store.test.ts (5 Vitest assertions — reset / toggle semantics)"
    - "integrations/unified-viewer/src/routes/UnifiedViewer.tsx (key={system} remount router)"
    - "integrations/unified-viewer/src/routes/UnifiedViewer.test.tsx (7 Vitest assertions — routing + remount)"
    - "integrations/unified-viewer/src/routes/UnknownSystem.tsx (404 page with 3 valid system links)"
    - "integrations/unified-viewer/src/config/system-endpoints.test.ts (6 Vitest assertions — type guard + maps)"
    - "integrations/unified-viewer/src/components/ui/{button,card,badge,input,dialog,tooltip,scroll-area,separator,tabs,select,checkbox,collapsible,progress,accordion,alert}.tsx (15 shadcn primitives via npx shadcn add — tool-generated, intentionally omitted from PLAN files_modified per plan-checker Dimension 5)"
    - ".planning/phases/45-unified-web-viewer/45-01-SLOPCHECK.txt (post-install slopcheck output + disposition note)"
  modified: []

key-decisions:
  - "Use radix-ui umbrella package (auto-added by shadcn 2026-06 default) instead of individual @radix-ui/react-* packages. The plan listed the 11 individual packages but shadcn's current CLI installs the radix-ui umbrella. Functionally equivalent; documented as an inheritance from shadcn's current preset, not a deviation from intent."
  - "Tighten snake_case anti-mention in schemas.ts comments. Original comments read '// NOT observation_ids' which tripped the plan-level acceptance grep `grep -c 'observation_ids' = 0`. Reworded to 'camelCase per Plan 44-16 lock' — same semantic intent, no false-positive."

patterns-established:
  - "Pattern 1: Verbatim version pinning + post-install grep gate — prevents Pitfall 6 auto-bump regressions"
  - "Pattern 2: <UnifiedViewer key={system}/> as cross-system state-reset boundary — Pitfall 2 mitigation"
  - "Pattern 3: ApiClient envelope-unwrap helper throws on non-2xx AND on success:false — uniform error surface"
  - "Pattern 4: Zod schema + Vitest mirror of server-side wire-shape test = three ratification sites for the contract"
  - "Pattern 5: import.meta.env.VITE_* with localhost defaults via nullish-coalesce — dev runs zero-config"

requirements-completed:
  - UI-01

duration: 14 min
completed: 2026-06-07
---

# Phase 45 Plan 01: Unified Viewer Scaffold Summary

**Greenfield React 18 + Vite 5 + TypeScript + Tailwind + shadcn package at `integrations/unified-viewer/` with VERBATIM dashboard version pins, camelCase wire-shape lock (Zod + Vitest mirror of Plan 44-16), `/viewer/{system}` routing with `key={system}` remount, and a Zustand viewer-store skeleton — Plans 02-06 plug into this without re-doing foundation work.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-06-07T14:57:00Z (approx.)
- **Completed:** 2026-06-07T15:11:30Z (approx.)
- **Tasks:** 2 of 2 auto tasks completed (Task 3 is a `checkpoint:human-verify` — awaiting operator)
- **Files created:** 32 hand-authored + 15 shadcn primitives + 1 slopcheck artifact = 48 files
- **Test count:** 29 Vitest assertions across 5 test files, all GREEN

## Accomplishments

- **Greenfield package scaffolded** at `integrations/unified-viewer/` with verbatim dashboard preset (tsconfig, tailwind, postcss, components.json, CSS-variable block, `cn()` helper) and the 5 anti-auto-bump pins (`react@^18.3.1`, `vite@^5.3.1`, `tailwindcss@^3.4.4`, `lucide-react@^0.544.0`, `react-router-dom@^7.14.0`) survived `npm install` verbatim.
- **15 shadcn primitives** installed via `npx shadcn add ...` (button card badge input dialog tooltip scroll-area separator tabs select checkbox collapsible progress accordion alert) under `src/components/ui/`.
- **Wire-shape contract enforced at the viewer boundary** — Zod `DigestSchema` / `InsightSchema` / `ObservationSchema` mirror `REQUIRED_DIGEST_KEYS` / `REQUIRED_INSIGHT_KEYS` / `REQUIRED_OBS_KEYS` from `tests/integration/typed-views.test.js` verbatim. The 5 shape-lock Vitest tests assert both the positive camelCase shape AND the negative snake_case regression THROWS — establishing the third ratification site for the Plan 44-16 lock.
- **Runtime spine wired** — `ApiClient` class (envelope-unwrap, throws on non-2xx, `?withDisplay=true` BC fallback so Plan 02 stays decoupled from Plan 04), `SYSTEM_ENDPOINTS` map + `isValidSystem` type guard per D-45-02, `useViewerStore` Zustand 5 store with the exact slice shape PATTERNS.md specifies.
- **Routing per D-45-02** — `/viewer/:system` mounts `<UnifiedViewer key={system}/>` so subtree fully unmounts on system switch (Pitfall 2 mitigation). `/` redirects to `/viewer/coding`. Invalid slugs render `UnknownSystem` 404 page with three labelled links built on shadcn `<Button asChild>`.
- **Slopcheck re-run inside `integrations/unified-viewer/`** — 43/44 packages `[OK]`. `vitest` flagged `[SUS]` is a documented false-positive of slopcheck's typosquat heuristic (vitest IS the canonical Vite-team test runner, intentionally a sibling-name; pre-approved in RESEARCH.md § Package Legitimacy Audit). Disposition note appended to `45-01-SLOPCHECK.txt`.

## Task Commits

Each task was committed atomically on the worktree branch `worktree-agent-aa5702230224d8706`:

1. **Task 1: Bootstrap the package — config files + version-pinned package.json + shadcn primitives + Zod schemas + shape-lock test** — `b41fcc76b` (feat)
2. **Task 2: Wire SYSTEM_ENDPOINTS / ApiClient / Zustand store / React Router routing** — `a1330610d` (feat)

**Fix-up commit (deviation, see below):** `e7ec33129` (fix)

**Task 3 (checkpoint:human-verify):** NOT committed — checkpoint awaits operator verification per the plan's `<resume-signal>`. See "Awaiting Human Verification" below.

## Files Created / Modified

See `key-files.created` in the frontmatter for the full list. Highlights:

- **Configs:** `package.json` (pinned deps + scripts), `tsconfig.json` (verbatim + `tests/**/*.ts` include), `vite.config.ts` (vendor-graph + vendor-markdown chunks + `:5173` strictPort), `vitest.config.ts` (NEW; jsdom + jest-dom), `tailwind.config.ts` + `postcss.config.mjs` + `components.json` (verbatim from dashboard).
- **Runtime spine:** `src/api/ApiClient.ts`, `src/api/schemas.ts`, `src/config/system-endpoints.ts`, `src/config/theme.ts`, `src/store/viewer-store.ts`, `src/routes/UnifiedViewer.tsx`, `src/routes/UnknownSystem.tsx`, `src/main.tsx`, `src/App.tsx`.
- **Tests:** 5 Vitest files, 29 assertions total — `shape-lock.test.ts` (5), `system-endpoints.test.ts` (6), `ApiClient.test.ts` (6), `viewer-store.test.ts` (5), `UnifiedViewer.test.tsx` (7).
- **Tool-generated:** 15 shadcn primitives in `src/components/ui/` (omitted from PLAN.md `files_modified` per plan-checker Dimension 5 discipline — verified separately by `ls | wc -l = 15`).

## Decisions Made

- **radix-ui umbrella package** is what shadcn's 2026-06 CLI installs by default. The plan listed individual `@radix-ui/react-{accordion,collapsible,dialog,…}` packages (mirroring the dashboard's older shadcn preset). Functionally equivalent; the umbrella package re-exports all the primitives. This is a presentational difference, not a contract change — primitives compile and import cleanly.
- **Placeholder `src/main.tsx` in Task 1**, overwritten in Task 2 — the plan splits configs (Task 1) and the entry/router (Task 2), but `vite build` requires `src/main.tsx` to exist. Task 1's placeholder kept the build green; Task 2 replaced it with the real `QueryClientProvider + <App/>` shell. Reflected in the Task 1 commit; the line about "Task 2 OVERWRITES" remains in commit history.
- **vitest@^1.6.0** specifically (Vitest 1.x matches Vite 5 major per RESEARCH.md). Did NOT bump to Vitest 2.x.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Initial file writes landed in main repo path, not worktree**
- **Found during:** Task 1 (after `npm install`, when first attempting `git status`)
- **Issue:** Absolute paths (`/Users/Q284340/Agentic/coding/integrations/unified-viewer/`) resolved to the **main repo** instead of the worktree (`/Users/Q284340/Agentic/coding/.claude/worktrees/agent-aa5702230224d8706/`). The worktree's pwd was the orchestrator's cwd but writes went elsewhere. This is the `<abs_path_safety>` failure mode the agent contract calls out.
- **Fix:** Moved the entire `integrations/unified-viewer/` directory (including `node_modules/`) from the main repo path into the worktree path via `mv`. Also moved `45-01-SLOPCHECK.txt` from main `.planning/` into the worktree `.planning/`. Verified by `git status --short` showing both files as untracked inside the worktree.
- **Verification:** `git status --short` showed the expected untracked entries; subsequent `git add` + `git commit` succeeded with the worktree HEAD safety asserts passing.
- **Committed in:** N/A (these were preparatory moves before any commit; the commit that landed the files is `b41fcc76b`).

**2. [Rule 3 — Blocking] Worktree HEAD was 9bfeaa119, missing the Phase 45 planning commits**
- **Found during:** Task 1 (when about to commit and confirming `.planning/phases/45-unified-web-viewer/` didn't exist in the worktree)
- **Issue:** The worktree was created at an older HEAD (`9bfeaa119` = Phase 44 final) before the Phase 45 planning commits (`bc73af8d7`, `144ad9929`, `951dcd467`, `6ec8c3e5b`) landed on main. This is the known #2015 reproducer the agent contract's `<worktree_branch_check>` block guards against.
- **Fix:** Per the contract's self-recovery protocol — verified `9bfeaa119` is an ancestor of main HEAD (`6ec8c3e5b`), then `git reset --hard 6ec8c3e5b` on the worktree branch. Untracked files (the new scaffold + slopcheck output) survived the reset by default (reset --hard only touches tracked files).
- **Verification:** Post-reset, `ls .planning/phases/45-unified-web-viewer/` lists all the Phase 45 plans + context files; the scaffold is still present.
- **Committed in:** N/A (no commit needed — fast-forward reset only).

**3. [Rule 1 — Bug] schemas.ts comments tripped the plan-level snake_case anti-mention grep**
- **Found during:** Verification block after Task 2
- **Issue:** Original comments read `// NOT observation_ids` and `// NOT digest_ids` etc. Helpful as docs, but the plan's `<verification>` block asserts `grep -c 'observation_ids' src/api/schemas.ts = 0`. The literal grep counted the comment occurrences and returned 1 instead of 0.
- **Fix:** Reworded the comments to `// camelCase per Plan 44-16 lock` — same semantic intent (the field IS camelCase by design of the lock), no literal snake_case spelling. Per CLAUDE.md's `acceptance_grep_word_boundary` lesson: derive verification from must_have intent, not author-literal regex. The Zod schema + the shape-lock test still enforce the contract.
- **Files modified:** `integrations/unified-viewer/src/api/schemas.ts`
- **Verification:** Post-edit, `grep -c 'observation_ids' src/api/schemas.ts` returns 0; `grep -c 'digest_ids' src/api/schemas.ts` returns 0; `grep -c 'last_updated' src/api/schemas.ts` returns 0; `grep -c 'files_touched' src/api/schemas.ts` returns 0; the 5 shape-lock Vitest assertions still pass.
- **Committed in:** `e7ec33129` (fix commit).

---

**Total deviations:** 3 auto-fixed (2 Rule 3 blocking, 1 Rule 1 bug).
**Impact on plan:** None of the deviations changed plan intent. Deviations 1 and 2 were environment-setup issues caused by the orchestrator-worktree boundary (well-known known issues per the agent contract). Deviation 3 tightened an acceptance gate that had a false positive. No scope creep.

## Issues Encountered

None beyond the deviations above. The scaffold built cleanly on first attempt once the worktree path issue was resolved; npm install succeeded with no warnings beyond a `whatwg-encoding` deprecation in a transitive dep; shadcn CLI installed all 15 primitives in a single invocation.

## Awaiting Human Verification — Task 3 Checkpoint

**Task 3 is `type="checkpoint:human-verify" gate="blocking"`.** The plan author wants an operator to visually exercise the dev server before the plan is marked complete. The orchestrator was passed an `autonomous: false` plan with `gate="blocking"`, so this is NOT auto-approved.

**Verification commands the operator should run** (verbatim from the plan):

1. `cd integrations/unified-viewer && npm run dev` — Vite serves on http://localhost:5173.
2. Visit `http://localhost:5173/` — URL should redirect to `/viewer/coding`; page renders the ViewerCore stub with a "Coding" wordmark and three labelled placeholder regions.
3. Visit `http://localhost:5173/viewer/okb` — wordmark changes to "OKB"; visit `/viewer/cap` — wordmark changes to "CAP".
4. Visit `http://localhost:5173/viewer/foo` — UnknownSystem page renders with three labelled links to /viewer/coding, /viewer/okb, /viewer/cap.
5. Confirm dashboard-style look-and-feel (same neutral background, same Inter font, same shadcn button styling).
6. `cat integrations/unified-viewer/package.json | grep -E '"(react|vite|tailwindcss|lucide-react)":'` — confirm the 4 pins read `^18.3.1`, `^5.3.1`, `^3.4.4`, `^0.544.0` respectively.
7. `cd integrations/unified-viewer && npx vitest run` — all 29 tests GREEN.
8. `cat .planning/phases/45-unified-web-viewer/45-01-SLOPCHECK.txt` — confirm all 44 packages were scanned (43 [OK] + 1 [SUS] vitest with the appended disposition note).

**Resume signal expected:** Type `approved` if scaffold is correct, or describe regressions.

## Verification — Plan `<verification>` Block (all PASS)

Last full verification run (post-deviation-3 commit):

```
1. npm run build                                            -> exits 0; dist/ produced
2. npx vitest run                                           -> 29/29 GREEN across 5 test files
3. ls src/components/ui/*.tsx | wc -l                       -> 15
4. node -p "require('./package.json').dependencies['lucide-react']" -> "^0.544.0"
5. node -p "require('./package.json').dependencies['react']"        -> "^18.3.1"
6. grep -c 'key={system}' src/routes/UnifiedViewer.tsx      -> 3 (>=1 required)
7. grep -c 'observationIds' src/api/schemas.ts              -> 2 (>=1 required)
8. grep -c 'observation_ids' src/api/schemas.ts             -> 0 (required: 0)
9. 45-01-SLOPCHECK.txt exists + final disposition line OK   -> "DISPOSITION: ACCEPTED. ... All 44 packages safe."
```

## Self-Check: PASSED

- All hand-authored files in `key-files.created` exist on disk: VERIFIED (via `npm run build` transforming 197 modules and Vitest running across all 5 test files).
- Task 1 commit (`b41fcc76b`) and Task 2 commit (`a1330610d`) plus fix-up commit (`e7ec33129`) are present in `git log --oneline -5` on the worktree branch.
- All `<verification>` block checks pass (see above).
- Shape-lock test enforces both positive camelCase AND negative snake_case throws — three ratification sites per the contract.
- 15 shadcn primitives present and importing cleanly.
- All 5 anti-auto-bump pins survived `npm install` and `npx shadcn add` runs.

## Next Phase / Plan Readiness

- **Plan 02 (graph renderer)** can begin: `@react-sigma/core` + `sigma` + `graphology` are already installed as dependencies and chunked into `vendor-graph`; `ApiClient.listEntities()` / `listRelations()` / `listOntologyClasses()` are ready to call; the `ViewerCore` stub layout has a `data-testid="viewer-canvas"` slot for `SigmaCanvas` to drop into.
- **Plan 03 (filters + entity panel)** can begin: `useViewerStore` exposes `searchQuery`, `visibleLevels`, `selectedClasses`, `setSelectedNode` already; the `viewer-filter-rail` and `viewer-side-panel` placeholder slots in `ViewerCore` are wired.
- **Plan 04 (`?withDisplay=true` server extension)** can begin: the `ApiClient` already calls `?withDisplay=true` with a transparent BC fallback (`string[] -> [{name}]`), so Plan 04 lands purely server-side without touching the viewer.
- **Plan 05 (RCA panel)** can begin: the `OkmRcaClient` will be a separate file (not added in this plan per `<must_haves>` — Plan 05 introduces it).
- **Plan 06 (smoke + cutover)** depends on Plans 02-05; no foundation work outstanding here.

**Blocker for completion of this plan only:** Task 3 operator verification (see "Awaiting Human Verification" above). All code is committed and verifiable; the human gate is purely a final visual smoke.

---
*Phase: 45-unified-web-viewer*
*Completed: 2026-06-07*
