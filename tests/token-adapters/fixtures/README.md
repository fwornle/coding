# Token-adapter test fixtures (Phase 69)

Redacted, structurally-faithful sample logs that the Phase-69 Claude + Copilot
token-row adapters (Waves 1–3) consume in their unit tests.

## Provenance

| Field | Value |
|-------|-------|
| Capture source | live research-session captures verified in `69-RESEARCH.md` |
| Capture date | 2026-06-22 |
| Claude basis | 8 sessions / 999 usage records / 290 thinking blocks |
| Copilot CLI version | 1.0.63 |
| Redaction | all user-prompt text, signatures, and opaque reasoning blobs replaced with `[REDACTED]` / `[REDACTED_SIG]` / `[REDACTED_OPAQUE_BLOB]` |
| PII / real tokens | none remain — token counts are synthetic-but-plausible; uuids/requestIds are deterministic test sentinels (`00000000-...`, `req_TEST*`, `req_SUB*`), not real session identifiers |

## Files

### `claude-session-sample.jsonl`
A top-level Claude Code session transcript.

- **Path shape it represents:** `~/.claude/projects/<cwd>/<uuid>.jsonl` (the
  per-session top-level transcript; `isSidechain:false` on every record).
- **Contents:** 3 `assistant` records, each with a `usage` block carrying
  `input_tokens`, `output_tokens`, `cache_creation_input_tokens`,
  `cache_read_input_tokens`, plus a unique `requestId` (`req_TEST0001..0003`),
  a `uuid`, a `parentUuid`, and `isSidechain:false`. **Two** assistant records
  additionally carry a `content` array with a
  `{"type":"thinking","thinking":"…","signature":"…"}` block — with deliberately
  different thinking-text lengths so the D-05 reasoning-token *estimator* (derived
  from thinking-block content length, `tokens_estimated=1`) has distinct inputs.
  The Claude `usage` block carries **NO native reasoning-token field** (per
  RESEARCH); reasoning tokens for `per-reasoning-step` rows are ESTIMATED, never
  extracted.

### `claude-subagent-sample.jsonl`
A Claude **sub-agent** (sidechain) transcript.

- **Path shape it represents:**
  `~/.claude/projects/<cwd>/<uuid>/subagents/agent-<hex>.jsonl`
  (the `SUBAGENT_PATH_RE` shape in `lib/lsl/adapters/claude-jsonl-tree.mjs:38`).
- **Contents:** first record has `isSidechain:true` (the D-02 first-record gate);
  the two subsequent `assistant` records carry `usage` blocks + unique
  `requestId`s (`req_SUB00001/2`) so downstream parent-linkage tests can resolve
  `parent_call_id` from the `claude-jsonl-tree.mjs` tree resolution.

### `copilot-events-sample.jsonl`
A Copilot CLI `events.jsonl` session log (CLI 1.0.63 event vocabulary).

- **Path shape it represents:**
  `~/.copilot/session-state/<uuid>/events.jsonl`.
- **Contents:** the verified 1.0.63 event sequence — `session.start`,
  `user.message`, `assistant.turn_start`, `assistant.message` (carrying
  `reasoningOpaque` + tool requests but **NO token counts**), `assistant.turn_end`,
  `tool.execution_start` / `tool.execution_complete`, then `session.shutdown`.
  `session.shutdown.data.modelMetrics` has **two** models: `claude-opus-4.6`
  carries `usage.reasoningTokens`, while `claude-sonnet-4.6` **omits** the
  `reasoningTokens` key entirely — the Pitfall 5 coalescing target
  (`m.usage?.reasoningTokens ?? 0`). Per-session-aggregate (D-04) is the only
  viable tier: no per-turn event carries token usage at CLI 1.0.63.

## Re-probe note
The Copilot vocabulary + verdict are keyed to CLI 1.0.63. On a CLI version
change, re-run the vocabulary check (D-09) and refresh this fixture if newer
events begin carrying per-turn token payloads.
