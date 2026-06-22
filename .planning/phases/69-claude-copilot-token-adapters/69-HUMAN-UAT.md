---
status: partial
phase: 69-claude-copilot-token-adapters
source: [69-VERIFICATION.md]
started: 2026-06-22
updated: 2026-06-22
---

## Current Test

[awaiting human testing — requires running launchd daemons + real agent sessions]

## Tests

### 1. Live Claude emission
expected: With `com.coding.sub-agent-live-claude` running (`launchctl kickstart -k gui/$(id -u)/com.coding.sub-agent-live-claude`), trigger a real Claude Code session; per-turn + per-reasoning-step rows with `user_hash='cladpt'` appear in `.data/llm-proxy/token-usage.db`, each `tool_call_id` exactly once (no duplication — CR-01 fix), `task_id` stamped when a measurement span is active.
result: [pending]

### 2. Live Copilot emission
expected: With `com.coding.sub-agent-live-copilot` running (`launchctl kickstart -k gui/$(id -u)/com.coding.sub-agent-live-copilot`), complete a Copilot CLI session (fires `session.shutdown`); one `per-session-aggregate` row per model with `user_hash='copadt'` and a session-scoped `tool_call_id` (`<sessionUuid>:<model>` — CR-02 fix) appears. Two sessions on the same model both persist.
result: [pending]

### 3. Sweep + backfill
expected: Run `node scripts/sweep-sub-agents.mjs` (or the launchd sweep) against recent completed sessions; Claude + Copilot completed-session rows are emitted once (live/sweep dedup holds), `task_id` is backfilled by timestamp-join for in-window rows and left `''` for out-of-window. The optional live-coexistence WAL test passes against the running proxy: `LLM_PROXY_LIVE=1 node --test tests/token-adapters/wal-concurrency.test.mjs`.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
