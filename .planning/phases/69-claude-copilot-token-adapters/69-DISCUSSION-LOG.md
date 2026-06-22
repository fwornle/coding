# Phase 69: Claude + Copilot Token Adapters - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-22
**Phase:** 69-claude-copilot-token-adapters
**Areas discussed:** Write path, Daemon strategy, Claude model, Copilot probe

---

## Write path — how host-side adapters INSERT into the proxy-owned token_usage SQLite

| Option | Description | Selected |
|--------|-------------|----------|
| Direct better-sqlite3 INSERT (WAL) | Adapters open token-usage.db directly and INSERT (same as 68 backfill opens it); rely on WAL for concurrency | |
| New proxy ingest endpoint | Add POST endpoint so proxy stays single DB writer | |
| Let the planner decide | Capture both as viable; pick based on WAL concurrency testing | ✓ |

**User's choice:** Let the planner decide.
**Notes:** Captured as Claude's Discretion with a guardrail — research MUST validate SQLite single-writer/WAL concurrency against the live proxy daemon and make it an acceptance criterion.

---

## Daemon strategy — extend Phase-51 supervisors vs dedicated token-adapter daemons

| Option | Description | Selected |
|--------|-------------|----------|
| Extend existing supervisors | sub-agent-live-{claude,copilot} + sweep also emit token rows from the same JSONL pass | |
| Dedicated token-adapter daemons | New launchd jobs sharing only the parsing primitives; independent lifecycle | |
| Let the planner decide | Lock parsing reuse; leave daemon packaging to planning | ✓ |

**User's choice:** Let the planner decide.
**Notes:** Parsing reuse (claude-jsonl-tree.mjs, copilot-events.mjs) locked regardless; only daemon-packaging/failure-isolation choice is open.

---

## Claude model — reasoning-step rows vs folded; sub-agent parent linkage

| Option | Description | Selected |
|--------|-------------|----------|
| Separate reasoning rows + parent_call_id | per-turn row PLUS distinct per-reasoning-step rows (reasoning_tokens); sub-agent → parent via parent_call_id from claude-jsonl-tree | ✓ |
| Fold reasoning into turn row | One per-turn row with reasoning_tokens inline; fewer rows, loses per-step granularity | |
| Let the planner decide | Lock separation + linkage; leave row cardinality | |

**User's choice:** Separate reasoning rows + parent_call_id. **(FIRM LOCK)**
**Notes:** Matches ADAPT-01 literally. Reuse existing parent_session_id resolution + isSidechain gate.

---

## Copilot probe — one-time vocabulary check vs runtime capability-probe

| Option | Description | Selected |
|--------|-------------|----------|
| One-time check informs plan | Enumerate event type: values + per-turn payload presence during planning; bake verdict into adapter; re-probe on CLI upgrade | |
| Runtime capability-probe | Adapter inspects each session at runtime, auto-upgrades to per-turn if payloads present, else per-session-aggregate | |
| Let the planner decide | Lock aggregate fallback + vocabulary enumeration; leave probe-timing | ✓ |

**User's choice:** Let the planner decide.
**Notes:** Aggregate fallback (session.shutdown.modelMetrics → per-session-aggregate) + the vocabulary-enumeration deliverable hold either way; v1.0.48 only persists lifecycle bookends today.

---

## Claude's Discretion

- Row write path (direct better-sqlite3 INSERT vs proxy ingest endpoint) — guardrail: validate WAL/single-writer concurrency.
- Daemon packaging (extend Phase-51 supervisors vs dedicated daemons) — guardrail: parsing reuse locked.
- Copilot probe timing (one-time vs runtime) — guardrail: aggregate fallback + vocabulary enumeration locked.

## Deferred Ideas

- OpenCode + Mastra adapters → Phase 70.
- Copilot per-turn upgrade beyond feasibility confirmation is bounded by what the installed CLI version persists.
- Reviewed-not-folded todos: sub-agent-dashboard-observability-gap, orphan-digest-observation-refs, okm-express-api-contract-bridge, hierarchy-wire-up-and-writer-enforcement (all weak keyword matches, none about token adapters).
