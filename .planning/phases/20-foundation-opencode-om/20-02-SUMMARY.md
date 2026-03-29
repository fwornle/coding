---
phase: 20-foundation-opencode-om
plan: 02
subsystem: infra
tags: [mastra, opencode, libsql, observational-memory, install-scripts]

requires: []
provides:
  - "install_mastra_opencode() function in install.sh"
  - "Mastra cleanup section in uninstall.sh"
  - "test_mastra_opencode() smoke test in test-coding.sh"
  - ".observations/ directory with default config.json"
  - ".opencode/mastra.json plugin config template"
affects: [20-foundation-opencode-om]

tech-stack:
  added: ["@mastra/opencode (npm)", "@mastra/libsql (transitive)"]
  patterns: ["install_*() function pattern", "test_*() smoke test pattern", "uninstall section pattern"]

key-files:
  created: []
  modified:
    - install.sh
    - uninstall.sh
    - scripts/test-coding.sh

key-decisions:
  - "Node.js >= 22 hard requirement enforced before installing @mastra/opencode"
  - "Default model set to google/gemini-2.5-flash for observation background work"
  - ".observations/ preserved on uninstall (user data pattern matching .data/ precedent)"

patterns-established:
  - "install_mastra_opencode(): npm install with version gate and config file creation"
  - "test_mastra_opencode(): 5-check smoke test for package/dir/config/exports/LibSQL"

requirements-completed: [OCOM-01, OCOM-02]

duration: 26min
completed: 2026-03-29
---

# Phase 20 Plan 02: Lifecycle Scripts Summary

**Mastra OpenCode install/uninstall/test functions added to lifecycle scripts with Node 22+ gate, LibSQL storage at .observations/, and 5-check smoke test**

## Performance

- **Duration:** 26 min
- **Started:** 2026-03-29T16:26:40Z
- **Completed:** 2026-03-29T16:52:40Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- install.sh gains install_mastra_opencode() that installs npm package, creates .observations/ with token budget config, and .opencode/mastra.json with LibSQL storage path
- uninstall.sh removes package and plugin config while preserving observation data
- test-coding.sh gains test_mastra_opencode() with 5 smoke tests: package resolution, directory existence, config files, MastraPlugin export, LibSQL DB creation

## Task Commits

Each task was committed atomically:

1. **Task 1: Add install_mastra_opencode() to install.sh** - `1fe9fd69` (feat)
2. **Task 2: Add uninstall section and test_mastra_opencode() smoke test** - `8fb19568` (feat)

## Files Created/Modified
- `install.sh` - Added install_mastra_opencode() function and call in main flow
- `uninstall.sh` - Added Mastra OpenCode cleanup section
- `scripts/test-coding.sh` - Added test_mastra_opencode() function and conditional call in Phase 8

## Decisions Made
- Node.js major version extracted via `node -v | sed | cut` for portable version check
- test_mastra_opencode() called conditionally (only when @mastra/opencode is installed) to avoid false failures
- LibSQL test uses /tmp temp DB with $$ PID suffix for safe parallel execution

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Lifecycle scripts ready for @mastra/opencode installation
- Running `install.sh` will install the plugin and create observation infrastructure
- test-coding.sh will validate the installation when package is available

---
*Phase: 20-foundation-opencode-om*
*Completed: 2026-03-29*
