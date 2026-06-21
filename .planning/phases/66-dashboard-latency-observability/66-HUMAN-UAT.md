---
status: complete
phase: 66-dashboard-latency-observability
source: [66-VERIFICATION.md]
started: 2026-06-21T14:59:54Z
updated: 2026-06-21T15:30:00Z
---

## Current Test

[testing complete]

## Tests

### 1. LLM Latency tile badge flips green once the warm pool dominates the 1h window
expected: After the worker pool has been warm for ~1h, the `:3032` LLM Latency tile's sonnet/opus median reads ≤3s with a GREEN badge (the ~14s→≤3s speedup visibly landed). The threshold machinery is verified wired (green ≤3000 / amber ≤5000 / red >5000); this item confirms it flips green with live warm traffic rather than the current pre-pool ~90s reading.
result: issue
reported: "issue — the ≤3s threshold is wrong for a real-traffic median"
severity: major
evidence: "Live probe 2026-06-21 of /api/token-usage/recent (last ~50/model): sonnet n=33 median ~123s (min 20.7s, max 261s) — the FASTEST recent sonnet fallback call is 20.7s, none near 3s; opus no recent calls; haiku 1.1s (direct path, renders correctly). The dashboard is honestly reporting real latency — the defect is the threshold/metric: PERF-01's ≤3s bar measures warm-pool spawn OVERHEAD on a trivial `say OK` prompt, whereas the dashboard median measures full end-to-end completions over real prompts (legitimately 20–260s). A real-traffic sonnet median can never reach ≤3s, so the green bar is mis-calibrated for what the tile actually measures."

### 2. Regression signal path (SC-2) — pool-disabled drives the badge red
expected: With `LLM_PROXY_DISABLE_WORKER_POOL=1` set and a few sonnet fallback calls driven, the tile/column median climbs toward ~14s and the badge flips red within the window — confirming the figure tracks the same fallback-path telemetry the pool serves.
result: issue
reported: "issue / same root cause"
severity: major
evidence: "Subsumed by Test 1. The pool's contribution is spawn overhead (~14s/cold call); the live median is ~123s dominated by generation time, so disabling the pool adds ~14s on a ~123s baseline (~11%, lost in the 20–261s spread). The badge is already red regardless of pool state, so the regression signal is not cleanly attributable on a total-latency metric. The signal only works once the metric isolates the overhead the pool affects — same fix as Test 1."

## Summary

total: 2
passed: 0
issues: 2
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "The dashboard's claude-code latency column shows the warm-pool speedup as a median dropping to ≤3s (green) — PERF-03 / SC-1"
  status: failed
  reason: "User reported: issue — the ≤3s threshold is wrong for a real-traffic median. The ≤3s green bar was calibrated on PERF-01's trivial `say OK` warm probe (measures spawn overhead), but the tile median measures full real completions (sonnet median ~123s live, fastest 20.7s). The metric and threshold are mismatched: a real-traffic median can never reach ≤3s, so the speedup the pool delivers (spawn-overhead reduction, ~14s→~0) is not what the dashboard measures."
  severity: major
  test: 1
  artifacts: []
  missing: ["a metric that isolates the warm-pool's contribution (e.g. spawn/queue overhead, or time-to-first-token) rather than total end-to-end completion latency", "a threshold envelope calibrated to whatever metric is chosen"]
