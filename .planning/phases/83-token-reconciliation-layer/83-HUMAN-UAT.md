---
status: accepted
phase: 83-token-reconciliation-layer
source: [83-VERIFICATION.md]
started: 2026-07-07T03:55:00Z
updated: 2026-07-13T00:00:00Z
operator_signoff: "accepted-with-documented-residual 2026-07-13 (v7.5 close-out): WR-06 code-level 26/26 verified; live copilot-BYOK UAT deferred — copilot provider returning 500 at close time. Phase 83 maps no REQUIREMENTS.md IDs; does not block v7.5."
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
result: [accepted — code-level 26/26 verified; live copilot-BYOK UAT deferred (provider 500 at close time), operator-accepted 2026-07-13]

## Summary

total: 1
passed: 0
issues: 0
pending: 0
accepted: 1
skipped: 0
blocked: 0

## Gaps
