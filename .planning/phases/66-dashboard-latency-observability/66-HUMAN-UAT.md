---
status: partial
phase: 66-dashboard-latency-observability
source: [66-VERIFICATION.md]
started: 2026-06-21T14:59:54Z
updated: 2026-06-21T14:59:54Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. LLM Latency tile badge flips green once the warm pool dominates the 1h window
expected: After the worker pool has been warm for ~1h, the `:3032` LLM Latency tile's sonnet/opus median reads ≤3s with a GREEN badge (the ~14s→≤3s speedup visibly landed). The threshold machinery is verified wired (green ≤3000 / amber ≤5000 / red >5000); this item confirms it flips green with live warm traffic rather than the current pre-pool ~90s reading.
result: [pending]

### 2. Regression signal path (SC-2) — pool-disabled drives the badge red
expected: With `LLM_PROXY_DISABLE_WORKER_POOL=1` set and a few sonnet fallback calls driven, the tile/column median climbs toward ~14s and the badge flips red within the window — confirming the figure tracks the same fallback-path telemetry the pool serves.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
