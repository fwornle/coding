
## Deferred from Plan 44-17 (consolidator cutover)

- **tests/integration/typed-views.test.js — REQUIRED_DIGEST_KEYS / REQUIRED_INSIGHT_KEYS use snake_case but observation-view.ts returns camelCase**
  - File: `tests/integration/typed-views.test.js`
  - Issue: test asserts `digest_ids` / `files_touched` / `observation_ids` / `last_updated` but the live `/api/coding/*` typed views return `digestIds`, `filesTouched`, `observationIds`, `lastUpdated` (per lib/km-core/src/adapters/observation-view.ts:90/108).
  - Pre-existing on `main` BEFORE Plan 44-17 (commit 255a1f934 — Phase 44 Wave 0 RED stub never updated). NOT caused by the consolidator cutover. Both writer + obs-api integration suites stay GREEN.
  - Resolution: update REQUIRED_*_KEYS to camelCase OR fix observation-view.ts to snake_case (the dashboard reads camelCase per Pitfall 2 comment).
