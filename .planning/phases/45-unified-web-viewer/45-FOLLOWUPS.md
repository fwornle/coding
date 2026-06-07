# Phase 45 — Follow-ups

Items deferred during execution. Each entry must record the plan that deferred it, the
condition under which a later plan should pick it up, and a pointer to the relevant
reference material.

## LoggingControl UI surface (deferred from 45-03 Task 0)

**Deferred during:** Plan 45-03 Task 0 (Logger port).
**Reason:** Task 0 spec marked the UI surface as "optional / defer to a later plan if
time tight". The Logger backend + tests + audit grep gate are landed; what remains is a
user-facing dialog to toggle active levels and categories at runtime.

**What to build:**

- A `LoggingControl.tsx` component (Radix `<Dialog>` + shadcn primitives, **NOT** the
  Mantine variant VOKB ships) that mirrors VOKB's surface at
  `_work/rapid-automations/integrations/operational-knowledge-management/viewer/src/components/LoggingControl.tsx`.
- Display two grids: one of level checkboxes (ERROR / WARN / INFO / DEBUG / TRACE) and
  one of category checkboxes (ROUTING / API / STORE / GRAPH / FILTERS / PANELS / LOGGER /
  DEFAULT). Wire each via `Logger.enableCategory` / `Logger.disableCategory` and
  `Logger.setActiveLevels`.
- Open via a new "Logging" entry in the existing Keyboard Help Dialog (rendered from
  Plan 45-03) — pressing `?` opens the help dialog, which contains a link / button
  labelled "Logging settings" that swaps to the LoggingControl dialog. Alternatively a
  dedicated `IconButton aria-label="Logging settings"` in the NavBar right-side cluster.
- Add a one-line entry in 45-UI-SPEC.md § Icon-only controls if a NavBar icon is chosen.

**When to land:** Plan 45-04 or 45-05 is a good candidate (both already touch the side
panel + tab shell that Plan 45-03 wires). If neither plan picks it up, a tiny standalone
plan in a Phase 45 follow-up wave is fine.

**Acceptance gate (when implemented):**

- Pressing the entry-point control opens the dialog with current level / category state
  preloaded from `Logger.getActiveLevels()` and `Logger.getActiveCategories()`.
- Toggling a checkbox persists via the existing localStorage keys
  (`unifiedViewer_activeLog*`).
- Closing + reopening the page restores the toggled state.
- A Vitest sidecar asserts the dialog renders the 5 levels and 8 categories and that
  click → toggle calls Logger.* methods.
