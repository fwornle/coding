# Phase 84: Per-Turn Context Revelation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-07
**Phase:** 84-per-turn-context-revelation
**Areas discussed:** Retention policy, Raw-body flag & privacy, Per-turn JSONL schema, Cache-explainer scope

---

## Retention policy

| Option | Description | Selected |
|--------|-------------|----------|
| Age-based, launchd sweep | Keep N days (14), delete older; dedicated launchd job decoupled from span close | ✓ |
| Count-based, inline at close | Keep last N spans, prune oldest at each close; no daemon | |
| Size-cap hybrid | Age default + hard total-size ceiling, prune oldest-first | |

**User's choice:** Age-based, launchd sweep.

| Option | Description | Selected |
|--------|-------------|----------|
| Configurable + never-throw | Retention window in config/env; sweep best-effort, never blocks close or crashes daemon | ✓ |
| Hardcoded default | Ship default as a constant, no config surface | |

**User's choice:** Configurable + never-throw.
**Notes:** → CONTEXT D-01, D-02.

---

## Raw-body flag & privacy

| Option | Description | Selected |
|--------|-------------|----------|
| Per-experiment flag, sibling file | Per-experiment YAML flag, default OFF, raw bodies to separate raw-bodies.jsonl.gz | ✓ |
| Global env var, inline | Global env var, raw bodies embedded inline in each line | |
| Both flags (global + per-exp) | Env kill-switch + per-experiment opt-in, sibling file | |

**User's choice:** Per-experiment flag, sibling file.

| Option | Description | Selected |
|--------|-------------|----------|
| Redact known auth keys | Mask a known set before writing | |
| Redact + allowlist bodies | Mask auth headers + keep only message content | |
| No redaction (local-only) | Store verbatim | |
| **(free text)** | **"use the ETM system's redaction code (configured redaction used to keep LSLs clean) — don't re-invent the wheel"** | ✓ |

**User's choice:** Reuse the existing configured LSL redaction rather than any of the offered options.
**Notes:** Located at `.specstory/config/redaction-patterns.json` (27 patterns: Anthropic/sk-/AWS keys, Bearer, JWT, Authorization, env-var secrets, PII). ⚠ Current applier `enhanced-redaction-system.js` only runs 4 hardcoded PII regexes and does not load the config — Phase 84 must rewire it to consume the full pattern file. → CONTEXT D-05, D-06.

---

## Per-turn JSONL schema

| Option | Description | Selected |
|--------|-------------|----------|
| Role + bytes + tool_use meta | role, byte size, tool_use name+size; no content | |
| + content hash | Above + short content hash per message | |
| + short preview | Above + first ~120 chars per message | (fallback) |
| **(free text)** | **"use live observations to explain what a turn is doing? digests? If not enough, I want 3 (short preview) as fallback... before we have nothing at all. Also the tools."** | ✓ |

**User's choice:** Semantic-first — reference the ETM observation/digest describing the turn; short-preview (option 3) as fallback when none correlates; always include the tools (tool_use names + sizes).

| Option | Description | Selected |
|--------|-------------|----------|
| Msg index + reuse breakdown taxonomy | Cache breakpoints as message indices; category reuses existing context-breakdown taxonomy | ✓ |
| Byte offset + new taxonomy | Breakpoints as byte offsets; fresh per-turn taxonomy | |

**User's choice:** Msg index + reuse breakdown taxonomy.
**Notes:** turn→observation correlation is time+task_id (observations are per-prompt-set, not per-request) — flagged as a research hand-off; preview fallback covers uncorrelated turns. → CONTEXT D-07, D-08.

---

## Cache-explainer scope

| Option | Description | Selected |
|--------|-------------|----------|
| Wire data + honest copy | Feed context-turns into existing explainer, fix numbers to real wire values, add "how caching works" copy; no new components | ✓ |
| New per-turn panel too | Above + a new per-turn detail panel now | |
| Data + API only, no UI | Ship persistence + read APIs only, defer all UI | |

**User's choice:** Wire data + honest copy (no new components; richer UI → Phase 86).

| Option | Description | Selected |
|--------|-------------|----------|
| Show N/A, label provider limit | Cache-write "N/A (provider reports no cache-creation)" for OpenAI-wire agents | ✓ |
| Infer write from deltas | Estimate cache-write from turn-over-turn input deltas | |
| Claude-only cache view | Show cache split only for claude | |

**User's choice:** Show N/A, label provider limit.
**Notes:** honest-measurement stance — never present inference as measurement. → CONTEXT D-11, D-12.

---

## Claude's Discretion

- Write timing (D-03): append plaintext per request during span, gzip + remove plaintext at span close — confirmed as the default with an explicit "say the word to change" offer; user proceeded.
- Exact JSONL field names/ordering, gzip level, config key names/paths.

## Deferred Ideas

- Richer per-turn UI (detail panel, stacked context band, cache-breakpoint viz) → Phase 86 (Timeline v2).
- Read-API line-size ceiling / pagination for very large spans — not decided; revisit if a span's file grows unwieldy.
- 15 low-score VKB/observability/km-core todos surfaced by todo-match — reviewed, not folded (separate workstream).
