---
id: subscription-limit-shortcircuit
created: 2026-07-11
priority: medium
area: health-coordinator / background-llm
---

# Short-circuit background LLM work when the proxy reports subscription limit

**Context:** 2026-07-11 the operator was at "subscription limit reached" overnight
yet background LLM work still attempted calls. The HID-presence gate
(`userActiveNow()` in scripts/health-coordinator.js, commit gating consolidation +
probes + sweep on real HID idle) now suppresses all of it while the human is away,
which covers the reported scenario.

**Still missing (this todo):** a *present-but-at-limit* short-circuit. When the
operator IS present but the Claude Max subscription cap is hit, the consolidation
trigger / probes still fire calls that fail with 429 / usage-limit.

**Design needed (signal source is the open question):**
- Either the rapid-llm-proxy exposes a `subscription_limit_reached` / retry-after
  status endpoint the coordinator can poll, OR
- The coordinator tracks recent /api/complete outcomes and treats a sustained
  usage-limit sentinel (distinct from a transient per-model 429 — see the existing
  429-vs-outage note at health-coordinator.js ~line 252/994) as a suppress signal.
- Then gate the consolidation trigger (health-coordinator.js:~652) and the synthetic
  probe on it, same as the HID gate. Preserve backlog; resume on limit reset.

**Acceptance:** with the proxy reporting limit reached, no consolidator-* or
synthetic say-OK calls are emitted; they resume automatically after reset.
