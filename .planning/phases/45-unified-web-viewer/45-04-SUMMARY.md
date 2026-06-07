---
phase: 45-unified-web-viewer
plan: 04
subsystem: Unified Web Viewer — MarkdownViewer + display-overlay handler
tags:
  - viewer
  - markdown
  - km-core
  - ontology
  - phase-45
status: implementation-complete-pending-operator-verify
requirements:
  - UI-01
depends_on:
  - 45-03
provides:
  - integrations/unified-viewer/src/panels/MarkdownViewerPanel.tsx
  - integrations/unified-viewer/src/lib-domain/sanitize-markdown.ts
  - integrations/unified-viewer/src/hooks/useMarkdownHistory.ts
  - lib/km-core/src/ontology/display-overlay.ts
  - .data/ontologies/coding.display.json
  - lib/km-core/src/api/handlers/ontology.ts (extended with ?withDisplay=true)
affects:
  - integrations/unified-viewer/src/panels/SidePanel.tsx
  - integrations/unified-viewer/tailwind.config.ts
  - lib/km-core/src/api/router.ts (KmCoreRouterOptions extended)
  - lib/km-core/src/ontology/registry.ts (skip *.display.json from auto-discovery)
tech-stack:
  added:
    - "@tailwindcss/typography (plugin enabled in tailwind.config.ts)"
  patterns:
    - "VKB-port verbatim sanitizer (6-step regex)"
    - "react-markdown v10 component overrides without rehype-raw (XSS defense-in-depth)"
    - "TanStack Query for markdown fetch (system-keyed cache)"
    - "BC-gated server contract extension (?withDisplay=true)"
key-files:
  created:
    - lib/km-core/src/ontology/display-overlay.ts
    - lib/km-core/tests/unit/display-overlay.test.ts
    - lib/km-core/tests/integration/ontology-display-overlay.test.ts
    - integrations/unified-viewer/src/lib-domain/sanitize-markdown.ts
    - integrations/unified-viewer/src/lib-domain/sanitize-markdown.test.tsx
    - integrations/unified-viewer/src/hooks/useMarkdownHistory.ts
    - integrations/unified-viewer/src/hooks/useMarkdownHistory.test.ts
    - integrations/unified-viewer/src/panels/MarkdownViewerPanel.tsx
    - integrations/unified-viewer/src/panels/MarkdownViewerPanel.test.tsx
    - .data/ontologies/coding.display.json
  modified:
    - lib/km-core/src/api/handlers/ontology.ts
    - lib/km-core/src/api/router.ts
    - lib/km-core/src/ontology/registry.ts
    - integrations/unified-viewer/src/panels/SidePanel.tsx
    - integrations/unified-viewer/src/panels/SidePanel.test.tsx
    - integrations/unified-viewer/tailwind.config.ts
decisions:
  - "Strict-equal 'true' check on ?withDisplay param. Non-string-'true' values (foo, 1, undefined) return BC string-array shape, preserving the OKM rest-contract.test.ts:257 wire shape. (T-45-04-03 mitigation.)"
  - "loadDisplayOverlay throws when ontologyDir is empty per the CLAUDE.md Phase-41 invariant — no process.env fallback (T-45-04-06)."
  - "OntologyRegistry's auto-discovery scan now skips `*.display.json` files (Rule 1 fix) — was emitting noisy 'skipping malformed ontology file' warnings since the overlay file lives alongside upper.json."
  - "MarkdownViewerPanel loading/error states render INSIDE the content area rather than replacing the chrome — keeps back/forward IconButtons mounted during fetch."
  - "highlight.js CSS is theme-gated via a dynamic <link> element (#unified-viewer-highlightjs-theme) swapping href between github.css and github-dark.css from jsDelivr CDN. Avoids shipping both stylesheets in the bundle."
  - "react-markdown v10 emits 'hljs language-X' as the code element's className (not just 'language-X'). The override uses /\\blanguage-/.test(className) instead of VKB's startsWith check."
metrics:
  duration: "28m 21s"
  tasks_completed: 2
  tasks_total: 3
  files_created: 10
  files_modified: 6
  commits: 3
  tests_added: 34
  tests_total: 488 # 317 km-core + 171 viewer
  completed_date: "2026-06-07"
---

# Phase 45 Plan 04: MarkdownViewer + Display-Overlay Handler Summary

Ships the **B-system signature MarkdownViewer panel** (VKB port minus Mermaid per D-45-04) and the **server-side `?withDisplay=true` extension** to `/api/v1/ontology/classes` that unlocks D-45-03's per-class display block while preserving the OKM rest-contract.

## One-liner

Plan 04 lands the OKB Markdown panel — react-markdown@10 + remark-gfm + rehype-highlight with theme-gated highlight.js CSS, a verbatim port of VKB's 6-step XSS sanitizer (no `rehype-raw`), history nav buttons closing the 7th UI-SPEC icon-only control, and a backward-compatible km-core handler extension that merges `.data/ontologies/coding.display.json` overlay into the ontology classes endpoint when `?withDisplay=true` is requested.

## What Built

### km-core (submodule — b7194cc on main)

1. **`lib/km-core/src/ontology/display-overlay.ts`** — `loadDisplayOverlay(ontologyDir, system) → Record<string, DisplayHint>`. `fs.existsSync` gate + `JSON.parse` with `process.stderr.write` on malformed (per RESEARCH Example 4). Throws on empty `ontologyDir` per CLAUDE.md Phase-41 invariant (T-45-04-06 mitigation).
2. **`lib/km-core/src/api/handlers/ontology.ts`** — extended `GET /ontology/classes` with `?withDisplay=true` gated branch (strict-equal `"true"`). Absent param or any other value returns byte-identical pre-Phase-45 `string[]` shape (T-45-04-03 BC mitigation). Enriched branch returns `Array<{name, level?, parent?, display?}>` with display sourced from the overlay file.
3. **`lib/km-core/src/api/router.ts`** — `KmCoreRouterOptions` gains `ontologyDir` + `displayOverlaySystem` fields. Handler also reads `req.app.locals.ontologyDir` as fallback per plan interfaces block.
4. **`lib/km-core/src/ontology/registry.ts`** — auto-discovery scan now skips `*.display.json` files (Rule 1 fix — was emitting noisy "skipping malformed ontology file" warnings since the overlay file lives alongside `upper.json` in `.data/ontologies/`).
5. **6 overlay tests + 7 handler tests** (13 new — all GREEN). 304 → 317 total km-core tests.

### Seed display overlay (outer repo)

`.data/ontologies/coding.display.json` — 10 class display entries (Observation, Digest, Insight, Component, SubComponent, Detail, LSLSession, MCPAgent, ConstraintRule, WorkflowDefinition) with hex color, lucide-react icon name, and shape per the plan's interfaces block. Tailwind palette (blue-500, emerald-500, amber-500, violet-500, etc.).

### Unified-viewer frontend

1. **`src/lib-domain/sanitize-markdown.ts`** — VERBATIM port of VKB's 6-step regex pipeline. Layer 1 of the T-45-04-01 XSS mitigation envelope (layer 2 = react-markdown's default raw-HTML escape with `rehype-raw` deliberately absent).
2. **`src/hooks/useMarkdownHistory.ts`** — stack-based history hook with browser-like semantics (`pushHistory` truncates the forward stack at the cursor; `back`/`forward` walk; `canBack`/`canForward` derived).
3. **`src/panels/MarkdownViewerPanel.tsx`** — B-system signature panel for `/viewer/okb`:
   - react-markdown@10 + remark-gfm + rehype-highlight stack (versions pinned per PATTERNS.md).
   - 5 component overrides (h1-h6 anchor IDs, img relative-path with `..` escape rejection, pre with Mermaid placeholder detection, code preserving `language-*` className, a with smooth-scroll for `#`, `.md` cross-link through history hook, external links get `target="_blank" rel="noopener noreferrer"`).
   - **Mermaid placeholder** rendered VERBATIM from UI-SPEC: "Mermaid diagrams are not rendered in MVP. Open in raw view to see the source." — D-45-04 defers Mermaid to v2.
   - **Theme-gated highlight.js** via dynamic `<link>` element (id `unified-viewer-highlightjs-theme`) swapping between `github.css` and `github-dark.css` from jsDelivr CDN.
   - **History nav IconButtons** with aria-labels `"Previous viewed entity"` / `"Next viewed entity"` — closes the 7th of 7 mandated UI-SPEC § Icon-only controls.
   - **Loading + error states** render INSIDE the content area; chrome stays mounted so the user can history-navigate mid-load.
   - `prose prose-sm dark:prose-invert max-w-none` wrapper.
4. **`src/panels/SidePanel.tsx`** — `system === 'okb'` Markdown tab now hosts the real `MarkdownViewerPanel` (was a placeholder div until Plan 04).
5. **`tailwind.config.ts`** — registered `@tailwindcss/typography` plugin (required for the `prose-*` classes).
6. **25 panel/hook/sanitizer tests** (all GREEN; 137 → 171 total viewer tests).

## Commits

| Commit | Repo | Subject |
|--------|------|---------|
| `b7194cc` | submodule `lib/km-core` | feat(45-04): /ontology/classes?withDisplay=true display-overlay extension |
| `4b0286d` | outer repo | chore(45-04): bump km-core submodule for display-overlay handler + seed coding.display.json |
| `9c75609` | outer repo | feat(45-04): MarkdownViewerPanel — B-system signature panel, VKB port minus Mermaid |

## Verification

### Automated test gates (all GREEN)

```bash
cd lib/km-core && npx vitest run \
  tests/unit/display-overlay.test.ts \
  tests/integration/ontology-display-overlay.test.ts \
  tests/unit/ontology-registry.test.ts
# → 34/34 tests pass (6 overlay + 7 handler + 21 registry-regression).

cd integrations/unified-viewer && npx vitest run
# → 171/171 tests pass (137 prior + 34 new in Plan 04:
#   11 sanitizer + 4 history + 10 panel + 5 SidePanel + 4 IconButton already).

cd lib/km-core && npm run build       # → tsc clean
cd integrations/unified-viewer && npm run build  # → vite build clean (~2.4k modules, ~84 KB gzip)
```

### Grep gates from PLAN.md `<verification>`

```bash
grep -rE "from ['\"]rehype-raw['\"]" integrations/unified-viewer/src/
# → no matches (0 imports — XSS defense layer 2 enforced)

grep -c "Mermaid diagrams are not rendered" \
  integrations/unified-viewer/src/panels/MarkdownViewerPanel.tsx
# → 1 (placeholder copy verbatim from UI-SPEC)

grep -c "@tailwindcss/typography" \
  integrations/unified-viewer/tailwind.config.ts
# → 2 (require() + the prose-* gate comment)

grep -E "loadDisplayOverlay\(.+,.+\)" lib/km-core/src/api/handlers/ontology.ts
# → 1 match (handler invokes loadDisplayOverlay with both args)

grep -c "z.array(z.string())" lib/km-core/src/api/handlers/ontology.ts
# → 2 (BC-shape comment preserved at both load points)
```

### Pending operator verification (Task 3 checkpoint:human-verify)

Operator-driven verification steps are documented in PLAN.md Task 3 `<how-to-verify>`. Highlights:

1. Restart obs-api / coding-services so the km-core build with the new handler ships into the container.
2. `curl 'http://localhost:12436/api/v1/ontology/classes'` returns `{success: true, data: ["Class1", ...]}` (BC preserved).
3. `curl 'http://localhost:12436/api/v1/ontology/classes?withDisplay=true'` returns `{success: true, data: [{name, level?, parent?, display?}, ...]}` with `Observation` display.color === `"#3b82f6"`.
4. `cd integrations/unified-viewer && npm run dev` → visit `/viewer/coding` — Observation nodes render with the seeded blue color; unmapped classes still use FNV-1a fallback.
5. Visit `/viewer/okb`, select a B-side entity, switch to the Markdown tab — formatted output appears (headings rendered, code blocks syntax-highlighted, GFM tables visible).
6. Mermaid fenced blocks render the placeholder div, NOT a Mermaid diagram.
7. `.md` cross-links inside Markdown content navigate; back/forward IconButtons (lucide ChevronLeft/Right) enable/disable correctly.
8. Theme toggle (NavBar IconButton) swaps highlight.js CSS between light/dark themes.
9. Browser console clean — no XSS-triggered alerts even on entity descriptions containing `<script>`.

### Deployment note (per plan action)

The km-core change is server-side and ships into `coding-services` Docker the next time the container rebuilds. For host-side dev (Vite at `localhost:5173`), the `npm run build` in `lib/km-core` already produced an updated `dist/` that any consumer importing `@fwornle/km-core` from a node_modules symlink picks up automatically. **No Docker rebuild required for Plan 04 verification** — restarting obs-api (which lives in the container) IS required if the operator wants the new handler live without a full container rebuild.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] OntologyRegistry auto-discovery now skips `*.display.json` files**
- **Found during:** Task 1 first test run.
- **Issue:** The registry's `loadFromDisk()` and `reload()` filtered files by `f.endsWith('.json') && f !== 'upper.json'`. Since the Plan 04 overlay file (`coding.display.json`) lives in the same `.data/ontologies/` directory and ends with `.json`, the registry was attempting to load it as an ontology file, producing stderr noise: `[km-core/ontology-registry] skipping malformed ontology file 'coding.display.json': missing meta or classes`. The handler tests' `OntologyRegistry` instances showed this on every construction.
- **Fix:** Added `!f.endsWith('.display.json')` to both filters in `src/ontology/registry.ts`. Phase 38 registry tests (21 tests) all continue to pass — no behavior change for legitimate ontology files.
- **Files modified:** `lib/km-core/src/ontology/registry.ts`
- **Commit:** `b7194cc`

**2. [Rule 1 - Bug] MarkdownViewer loading/error states no longer replace the panel chrome**
- **Found during:** Task 2 panel tests for cross-link click semantics.
- **Issue:** Initial implementation had `if (fetchQuery.isLoading) return <LoadingDiv/>` which unmounted the back/forward IconButtons during fetch. Test 7 couldn't find `data-testid="markdown-back"` after a cross-link click because the panel was in the loading state.
- **Fix:** Refactored so loading/error states render INSIDE the content area only. Chrome (header with filename + IconButtons) stays mounted during all fetch states, giving the user the ability to history-navigate away mid-load.
- **Files modified:** `integrations/unified-viewer/src/panels/MarkdownViewerPanel.tsx`
- **Commit:** `9c75609`

**3. [Rule 1 - Bug] react-markdown v10 code-override className detection updated**
- **Found during:** Task 2 Test 3 (TypeScript fenced code block).
- **Issue:** The VKB-style `className?.startsWith('language-')` check misses the case where rehype-highlight produces `className === "hljs language-ts"` (className starts with "hljs", not "language-"). The override was then rendering the code block with the inline-code styling (`bg-muted px-1 rounded`) and dropping the language-X class, breaking rehype-highlight's CSS scope.
- **Fix:** Switched to `/\blanguage-/.test(className) || /\bhljs\b/.test(className)` so both attribute orderings are detected. Test 3 now passes; syntax highlighting works.
- **Files modified:** `integrations/unified-viewer/src/panels/MarkdownViewerPanel.tsx`
- **Commit:** `9c75609`

### No architectural changes

All changes stay within the planned file set + the registry filter fix (a one-line addition that strengthens an existing concern). No new tables/services/auth changes.

## Threat Model Confirmation

| Threat ID | Disposition | Status |
|-----------|-------------|--------|
| T-45-04-01 (XSS via raw HTML) | mitigate | **CONFIRMED** — Sanitizer + react-markdown defaults; tests assert no `<script>` element in rendered DOM, no `onerror=` attribute survives, no `javascript:` URL on rendered `<a>`. No `rehype-raw` import. |
| T-45-04-02 (Open redirect via Markdown anchor) | mitigate | **CONFIRMED** — Anchor override adds `target="_blank" rel="noopener noreferrer"` for `http(s):` URLs; `.md` routes through `useMarkdownHistory`; `#` smooth-scrolls in-panel. Tests assert all three branches. |
| T-45-04-03 (BC regression on /ontology/classes) | mitigate | **CONFIRMED** — Handler Test 1 asserts `data` is a string array when `?withDisplay` is absent or any non-"true" value. OKM rest-contract.test.ts contract holds. |
| T-45-04-04 (Display-overlay file leak) | accept | **ACCEPTED** — display blocks contain only color/icon/shape. Operator-controlled content surface. |
| T-45-04-05 (Image relative-path escape) | mitigate | **CONFIRMED** — `resolveImageSrc` rejects relative paths that escape the markdown base via `..` segments (returns null → image is dropped). |
| T-45-04-06 (km-core ontologyDir invariant) | mitigate | **CONFIRMED** — `loadDisplayOverlay` throws on empty `ontologyDir`; handler wires from `KmCoreRouterOptions.ontologyDir` OR `req.app.locals.ontologyDir`; NEVER from `process.env`. Acceptance grep gate passes. |

## Threat Flags

None — Plan 04 introduces no security-relevant surface beyond what the threat model already enumerates.

## Known Stubs

None — all panel content paths are wired (`entity.description`, `metadata.markdown_url` fetch, history hook). The 'Mermaid diagrams are not rendered' div is a deliberate placeholder per UI-SPEC and D-45-04 (deferred to v2), not a stub.

## What's Next (Plan 05 / Plan 06)

- **Plan 05** ports the RCA panel (C's signature) per UI-SPEC § RCA Lookup Panel Option A. Independent of Plan 04 — they only share the `SidePanel` shell.
- **Plan 06** is the cross-system smoke + Playwright E2E + cutover gate.

## Self-Check: PASSED

All 13 planned files exist on disk; all 3 commits are reachable (`b7194cc` in submodule, `4b0286d` and `9c75609` in outer repo).
