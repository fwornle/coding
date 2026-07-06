# Phase 83 Deferred Items

## [83-03] Pre-existing: tests/token-adapters/token-db.test.js — `test is not defined`

- Discovered during 83-03 regression sweep. The file imports fs/os/path/createRequire
  but NOT `test`/`assert` from `node:test` — so `node --test tests/token-adapters/token-db.test.js`
  throws `ReferenceError: test is not defined` at load.
- Present verbatim at the plan base commit `b58b309` (token-db.mjs was last touched by
  83-03 `feat` commit only; the test file is byte-identical to base). NOT caused by 83-03.
- Out of scope for 83-03 (SCOPE BOUNDARY: only auto-fix issues DIRECTLY caused by this
  plan's changes). Plan 83-03 verification targets `reconcile-matcher.test.js` (13/13 pass)
  and `token-db-dedup-merge.test.js` (4/4 pass, zero regression).
- Fix when touched: add `import test from 'node:test'; import assert from 'node:assert/strict';`.
