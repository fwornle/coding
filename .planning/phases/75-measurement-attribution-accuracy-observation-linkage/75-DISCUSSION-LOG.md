# Phase 75: Measurement Attribution Accuracy & Observation Linkage - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-29
**Phase:** 75-measurement-attribution-accuracy-observation-linkage
**Areas discussed:** Lineage signal + background handling, Foreground token capture, Canonical model rule, Observation re-capture

---

## Lineage signal + background handling (ATTR-01)

### Primary lineage signal

| Option | Description | Selected |
|--------|-------------|----------|
| Process allow/deny list | Denylist of known background daemons keyed off existing `process` field; simplest, no new plumbing, but brittle | |
| Explicit task_id at call site | Stamp each row with active task_id at the write seam; most precise, needs foreground calls through a stamping seam | |
| Both: stamp + denylist guard | Stamp task_id at the foreground capture seam as the positive signal AND apply a process denylist as a defensive filter | ✓ |

**User's choice:** Both: stamp + denylist guard

### Background-daemon rows in window

| Option | Description | Selected |
|--------|-------------|----------|
| Kept but segregated | Background rows stay associated with the Run but flagged as background; headline = foreground only; feed ATTR-02 second column | ✓ |
| Excluded entirely | Background rows dropped from the Run; cleaner numbers but loses concurrent-cost visibility | |

**User's choice:** Kept but segregated
**Notes:** Belt-and-suspenders attribution — positive task_id stamp where we control the seam, denylist catches the rest. Segregation preserves the data for the two-column ATTR-02 display.

---

## Foreground token capture (ATTR-03)

### When captured

| Option | Description | Selected |
|--------|-------------|----------|
| Batch at measurement stop | On stop, read transcript, buildClaudeTokenRows(), stamp task_id, deduped insert; reuses existing extraction | ✓ |
| Live during session | Tail the transcript live; real-time dashboard cost but much more plumbing | |
| Batch now, live later | Ship batch, defer live | |

**User's choice:** Batch at measurement stop

### Agent scope

| Option | Description | Selected |
|--------|-------------|----------|
| Claude Code only | Scope to the proven-broken agent; defer the other three | |
| All four agents | Build adapters for Copilot/OpenCode/Mastra too; matches cross-agent milestone framing | ✓ |
| Claude now, design for N | Claude only, but adapter-registry structured for drop-in later | |

**User's choice:** All four agents
**Notes:** Deliberate widening beyond the findings' Claude-only framing. Research must confirm per-agent which actually bypass the proxy (Claude does; OpenCode/Mastra may already be proxy-captured and only need task_id stamping, not a transcript adapter) to avoid double-counting. Live streaming deferred.

---

## Canonical model rule (ATTR-02)

### Derivation

| Option | Description | Selected |
|--------|-------------|----------|
| Foreground chat agent | Canonical = the agent/model that ran the measured session (from ATTR-03); background models never canonical | ✓ |
| Dominant by tokens | Today's behaviour (picked haiku for an Opus run); rejected by findings | |
| Foreground, fallback to dominant | Foreground when captured, dominant for legacy Runs | |

**User's choice:** Foreground chat agent

### Persistence

| Option | Description | Selected |
|--------|-------------|----------|
| On the Run entity at stop | Compute canonical + background list once at stop, write to Run.metadata; all surfaces read these fields | ✓ |
| Recompute per surface | Each surface re-derives at render; rejected — this caused finding B divergence | |

**User's choice:** On the Run entity at stop
**Notes:** Legacy Runs without ATTR-03 capture will show empty/unknown canonical until re-measured (pure foreground, no dominant fallback) — accepted as forward-looking.

---

## Observation re-capture (OBS-02)

### Trigger boundaries

| Option | Description | Selected |
|--------|-------------|----------|
| AskUserQuestion + tool batches | Re-capture on each operator decision AND significant tool-activity batches | ✓ |
| AskUserQuestion only | Decisions only; low noise but gaps in question-less stretches | |
| Boundaries + periodic flush | Decisions + tool batches + time-based flush | |

**User's choice:** AskUserQuestion + tool batches

### Event-time source

| Option | Description | Selected |
|--------|-------------|----------|
| Triggering exchange timestamp | Stamp with the transcript exchange/decision timestamp that triggered the observation | ✓ |
| Capture wall-clock time | Stamp with generation wall-clock; drifts on backfill/replay; rejected | |

**User's choice:** Triggering exchange timestamp
**Notes:** Acceptance is the operator's own session (transcript e0af5b8b): morning decisions 05:30–06:03Z must produce observations dated ~05:30–06:03Z, not all collapsed to the 21:00:43Z prompt-set start.

---

## Claude's Discretion

- Storage mechanism for the foreground/background discriminator (new `token_usage` column vs aggregation-time derivation) — least-invasive that survives re-aggregation.
- Concrete threshold for a "significant tool-activity batch" and the observation dedup key.
- Empty-canonical display string for legacy Runs.

## Deferred Ideas

- Live (in-session) foreground token streaming — batch-at-stop ships now; real-time during a running measurement is a follow-up.
- Periodic time-based observation flush — decision + tool-batch boundaries only this phase; wall-clock flush can be added if those prove insufficient.
