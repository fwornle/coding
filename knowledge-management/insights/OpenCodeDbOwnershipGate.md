# OpenCodeDbOwnershipGate

**Type:** Detail

## What It Is

`OpenCodeDbOwnershipGate` is the uid-ownership check implemented as `ownedDbPath(dbPath)` in `lib/lsl/token/opencode-token-rows.mjs`. It runs `fs.statSync(dbPath)` and, when `process.getuid` is available, compares the file's `st.uid` against `process.getuid()`, returning `''` and emitting a `[token-adapter-opencode] skipping non-owned ...` stderr line on mismatch. It is invoked as the very first line of `buildOpencodeTokenRows` (its parent component, `OpenCodeTokenExtraction`), making it a pre-open gate rather than a post-open validation: a non-owned or missing `opencode.db` short-circuits the entire extraction pass before any `better-sqlite3` handle is opened.

## Architecture and Design

The gate embodies a fail-closed-on-error, fail-open-on-platform design: a `statSync` failure (missing file, permission denied) returns `''` (closed, no read attempted), while on non-POSIX platforms where `process.getuid` doesn't exist, the uid branch is skipped entirely and the path is treated as owned. This same idiom appears in the sibling adapter's `isOwnedByMe` in `lib/lsl/live/copilot-events-tail.mjs`, sharing identical rationale and comparison shape — but the two are independently implemented rather than factored into a shared utility, representing a defense-in-depth (or duplicated-logic) choice over DRY.

The granularity of gating differs meaningfully by resource shape: `isOwnedByMe` gates per-session-directory inside `scanForLiveSessions`, so one non-owned session is skipped while siblings continue; `ownedDbPath` gates the single shared `opencode.db` file, so failure is total — `buildOpencodeTokenRows` returns `[]` for the entire store. This total-failure behavior interacts with the D-04 no-double-count invariant governed by `BYPASS_PROVIDERS`: because the gate runs before the per-record provider filter, a uid mismatch suppresses even legitimate `github-copilot` rows that would otherwise be reconstructed, since the module has no per-row uid data to make a finer-grained decision.

## Implementation Details

`ownedDbPath` is a small, dependency-light function: `statSync` plus a conditional uid comparison, with two possible failure exits (stat error, uid mismatch) and one success exit (return the path). It is called with a caller-suppliable `dbPath` parameter (`buildOpencodeTokenRows(dbPath = DEFAULT_OPENCODE_DB, ctx = {})`), making the gate generic rather than hardcoded — useful for testing against fixture DBs with controlled uid, though no such test file is present in the supplied code. On success it is silent; it writes to stderr only in its two failure branches, consistent with the module's stderr-only logging discipline (no `console` calls, per CLAUDE.md). This means a passing gate leaves no positive audit trail — indistinguishable operationally from the adapter never having run.

## Integration Points

The gate's sole consumer is `buildOpencodeTokenRows` in `OpenCodeTokenExtraction`, which treats an empty return as a signal to abort the whole scan and return `[]`, consistent with the surrounding module's never-throw extraction philosophy (malformed JSON, missing `part` table, and query failures are handled the same way). It has a structural but non-code relationship to `isOwnedByMe` in `copilot-events-tail.mjs` — same idiom, different resource granularity, no shared import. There is no relationship evident to the `TurnActivitySummary` sibling beyond residing in the same file and downstream pipeline.

## Usage Guidelines

Developers modifying ownership semantics must remember the check is duplicated, not shared: changes to the ownership contract require updating both `ownedDbPath` and `isOwnedByMe` independently. The gate is stat-then-open, so a TOCTOU window exists between the `statSync` check and later `db.prepare(...)` calls — inherent to this pattern, not unique to this component, but worth knowing before assuming atomicity. Because failure is total and silent on success, debugging "why did extraction return nothing" should include checking stderr for the `[token-adapter-opencode] skipping non-owned` line; its absence doesn't confirm the gate passed, only that it didn't explicitly fail. Finally, since the gate no-ops on non-POSIX platforms, it should not be relied upon as a security boundary on Windows deployments.


## Hierarchy Context

### Parent
- [OpenCodeTokenExtraction](./OpenCodeTokenExtraction.md) -- [LLM+CGR] `buildOpencodeTokenRows` in lib/lsl/token/opencode-token-rows.mjs is the core extraction function: it opens `~/.local/share/opencode/opencode.db` read-only via better-sqlite3, scans the most recent `MESSAGE_SCAN_LIMIT` (4000) rows of the `message` table by `rowid DESC`, and for each assistant message whose `providerID`/`provider` field is in `BYPASS_PROVIDERS = Set(['github-copilot'])` emits one `TokenUsageRow`-shaped object via `extractTokens(d)`. Messages from proxy-routed providers (e.g. `anthropic`) are explicitly skipped — this is the D-04 no-double-count invariant stated in the file's header comment: a message already captured as a proxy wire row must never be reconstructed a second time from OpenCode's own store.

### Siblings
- [TurnActivitySummary](./TurnActivitySummary.md) -- [LLM+CGR] `summarizeParts` in lib/lsl/token/opencode-token-rows.mjs is the concrete implementation of the turn-activity-summary concept: it walks a time-ordered array of parsed `part` blobs and builds a single string composed of a lead text snippet (the first `type: 'text'` part, capped to 140 chars via `snip`) followed by up to 8 tool-call descriptors rendered as `tool(arg)`, joined with `, ` and suffixed with a `+N` overflow marker when more than 8 tool calls occurred in the turn. The whole result is re-clamped to 240 chars by a final `snip(segs.join(' '), 240)` call — a double-bounding scheme (per-segment cap, then whole-string cap) that guarantees the summary can never grow unbounded even if a single tool argument or the lead text is unusually long.


---

*Generated from 9 observations*
