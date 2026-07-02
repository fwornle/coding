# Phase 67: Reproducibility & Replay Rig - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-02
**Phase:** 67-reproducibility-replay-rig
**Areas discussed:** Snapshot storage & KB capture, Restore target & safety, Replay miss policy & channels, Trigger & integration surface

---

## Snapshot storage & KB capture

| Option | Description | Selected |
|--------|-------------|----------|
| Full LevelDB copy + JSON export | Per-run dir `.data/run-snapshots/<task_id>/`; KB = full binary LevelDB copy (byte-exact) + JSON export; dirty tree = git SHA + patch | ✓ |
| JSON export only | Capture just exports/*.json; portable, not byte-identical | |
| Git-snapshot everything | Commit workspace + serialized KB to a dedicated snapshot ref | |

**User's choice:** Full LevelDB copy + JSON export
**Notes:** Byte-for-byte (SC-2) taken literally for the KB; JSON export kept for portability/inspection.

---

## Restore target & safety

| Option | Description | Selected |
|--------|-------------|----------|
| Isolated worktree + sandbox data dir | Default restore never touches live checkout/KB; `--in-place` opt-in with backup+confirm | ✓ |
| In-place, guarded | Restore into live repo/KB with auto-backup + confirmation | |
| In-place, no guards | Fast, overwrites live state directly | |

**User's choice:** Isolated worktree + sandbox data dir
**Notes:** Must be safe to run casually — default path can never damage the live session. `--in-place` reserved for the rare true byte-for-byte-in-live case, gated by backup + confirm.

---

## Replay miss policy

| Option | Description | Selected |
|--------|-------------|----------|
| Hard-fail (strict) | Missing fixture aborts and surfaces; guarantees comparability | ✓ |
| Fall through to live | Hit real provider on miss; breaks determinism | |
| Deterministic stub | Return canned response on miss | |

**User's choice:** Hard-fail (strict)
**Notes:** A miss is a real divergence; never silently mix live + recorded responses.

---

## Request matching

| Option | Description | Selected |
|--------|-------------|----------|
| Content hash + call ordinal | Hash normalized request + per-key ordinal; robust to reordering of distinct calls | ✓ |
| Strict call ordinal only | Replay in exact recorded sequence | |
| Content hash only | Match on hash, ignore order | |

**User's choice:** Content hash + call ordinal
**Notes:** Ordinal disambiguates identical repeated calls (e.g. retries) while tolerating reordering of distinct calls.

---

## Channel scope

| Option | Description | Selected |
|--------|-------------|----------|
| All five now | LLM + WebSearch + WebFetch + remote MCP + clock | ✓ |
| LLM + clock first, rest stubbed | Ship dominant channel + clock; others record-interface-only | |
| LLM only | Just proxy LLM; defer clock + web/MCP | |

**User's choice:** All five now
**Notes:** Fully satisfies REPRO-02 in one phase. RISK flagged in CONTEXT: WebSearch/WebFetch/MCP run in the Claude Code harness (not the proxy), so their tap point is an open research question — research must resolve it before planning commits, with a "record-interface-present, replay-hard-fails-as-not-yet-captured" fallback if a channel has no viable tap.

---

## Trigger & integration surface

| Option | Description | Selected |
|--------|-------------|----------|
| Integrate with measurement span | Auto-snapshot at span open; recording on during span; `--replay` flag on measurement-start | ✓ |
| Standalone run-snapshot / run-replay CLIs | Dedicated scripts, independent of measurement | |
| Both: standalone core + span hook | Standalone primitives called by the span | |

**User's choice:** Integrate with measurement span
**Notes:** Reuses `active-measurement.json` plumbing and the existing start/stop CLIs — one workflow, one active-span reader.

---

## Claude's Discretion

- Clock virtualization mechanism (freeze-at-snapshot vs monotonic-offset; interception granularity).
- Agent-affecting env-var allowlist (avoid leaking secrets into snapshots).
- MCP inventory + version capture method (config read vs live handshake).
- git patch encoding details (binary diffs, untracked files, submodule dirty state).

## Deferred Ideas

- UI for browsing/diffing snapshots — future dashboard phase.
- Cross-machine snapshot portability — out of scope for v1 (LevelDB copy is same-host).
- Four keyword-matched todos reviewed and not folded (orphan-digest-refs, okm-api-contract, sub-agent-obs-gap, online-filter) — none relate to snapshot/replay.
