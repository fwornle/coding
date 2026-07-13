---
phase: 84-per-turn-context-revelation
verified: 2026-07-13
status: passed
method: live end-to-end gate (84-LIVE-GATE.md), operator-approved 2026-07-08
verification_of_record: 84-LIVE-GATE.md
---

# Phase 84 Verification — Per-Turn Context Revelation

**Verdict: `passed`** — the phase is verified by the operator-approved live end-to-end gate recorded in `84-LIVE-GATE.md` (2026-07-08). This document formalizes that live gate as the verification of record (closing the milestone-audit doc-gap: "no 84-VERIFICATION.md; functional substitute 84-LIVE-GATE.md is operator-approved").

## Verification of record

`84-LIVE-GATE.md` is the honest live proof of the full per-turn-context-revelation pipeline — **not inferred from file/DB inspection**; every artifact was produced by a real measured span through the redeployed proxy:

- **Pre-redeploy safety:** coordinator `location=open`, no strong-network failures confirmed before `launchctl kickstart` (T-84-09-02).
- **Proxy redeploy:** runtime `server.mjs` at HEAD with all 84-04/84-06 commits present (replacing the stale build).
- **One live measured span** (`ctx-live-84-09--copilot-openai--r0`, raw-body capture ON) → real gzipped context-turn artifacts → both read APIs (`/api/context-turns` on the proxy + vkb-server pass-through) → redaction of live secrets → honest explainer render.

The gate exercises the real capture → persist → gzip → read-API → redact → render chain end-to-end, which is the phase's goal.

## Status

Operator-approved (2026-07-08). Formalized as `status: passed` on 2026-07-13 during v7.5 milestone close-out — the live gate is accepted as the verification of record per the milestone-audit remediation.
