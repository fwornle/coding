# Phase 51 — Deferred Items

Out-of-scope discoveries surfaced while executing Plan 51-06.

## Pre-existing test infrastructure failures (NOT introduced by Plan 51-06)

Two unrelated test files in `tests/live-logging/` fail to LOAD under jest's
ESM mode because they use CommonJS `require()`:

- `tests/live-logging/RepositoryIndexer.test.js` — last touched `960b37590`.
- `tests/live-logging/EmbeddingClassifier.test.js` — last touched `960b37590`.

Failure mode: `ReferenceError: require is not defined` at module-load time
(before any test runs). Tests=0 for both suites. Per SCOPE BOUNDARY in
deviation rules, fixing these is outside this plan — both files were
authored long before the `worktree-agent-a4adc3f1697625d96` branch.

Remediation suggestion (for a future phase): port both test files to ESM
import syntax, or add a per-file `// @jest-environment` directive that
selects the CJS test environment.

## Phase 50 window.mjs comment vs. behavior

`lib/lsl/window.mjs:65-67` carries the comment:

> Sub-agent transcripts (`-S{slot}` suffix) are deliberately excluded —
> Phase 51 handles those.

The actual `parseLSLFilenameStart()` regex matches only the date+time
prefix; sub-agent files with the `_S{slot}-{idx}-{hash}` infix are NOT
filtered out by the file lister. The round-trip parse smoke confirmed
this — getLSLWindow consumed a Plan-51-06 writer-produced file directly
and returned 5 exchanges. The comment is aspirational/stale.

This is per D-Reuse correct (Phase 50 primitives unmodified). A future
plan may wish to either (a) revise the comment to match observed behavior
("Phase 51 sub-agent transcripts are also consumed by the parent-LSL
window logic"), or (b) add an explicit filter if the parent resolver
needs to distinguish parent vs. sub-agent windows.

Out of scope for this plan.
