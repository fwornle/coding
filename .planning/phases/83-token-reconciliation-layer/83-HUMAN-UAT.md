---
status: partial
phase: 83-token-reconciliation-layer
source: [83-VERIFICATION.md]
started: 2026-07-07T03:55:00Z
updated: 2026-07-07T03:55:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Live Copilot BYOK Wire Row Identity (WR-06)

Run a measured copilot BYOK session (copilot routed through the proxy shim via
`COPILOT_PROVIDER_BASE_URL`), then inspect the token DB and reconciliation output.

expected: `token_usage.db` contains `user_hash='copadt'` rows with a non-empty
`tool_call_id` starting with `shim-`; the span's `reconciliation.json` shows
`matched >= 1` via the request-id path (not a vacuous structural value).
result: [pending]

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
