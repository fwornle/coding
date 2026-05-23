# Phase 51 — Context

**Title:** Agent-agnostic sub-agent capture across LSL and observations
**Filed:** 2026-05-23 (initial) · scope broadened 2026-05-23 to cover LSL tier + agent-agnostic detection
**Severity:** High (data loss — entire categories of coding work are invisible to the knowledge pipeline)
**Status:** Filed (not yet planned)

> **Scope broadening (2026-05-23):** original framing was "backfill Claude Code sub-agent observations". Real
> requirement is broader — sub-agents should appear in **both LSL and observations**, in **real time**, for
> **claude code / opencode / copilot / mastra** alike. The Claude-Code-specific observation backfill is now
> just the immediate stopgap (Path B-claude) within a larger architecture; see the expanded scope below.

---

## Bug

GSD wave-execution (`/gsd-execute-phase`) spawns parallel sub-agents
as separate `claude` CLI invocations in **worktree directories under
`/private/tmp/<uuid>/`**. Each sub-agent writes its own Claude Code
transcript to a project directory the **EnhancedTranscriptMonitor
(ETM) does not watch**, so the entire batch of sub-agent work
generates **zero observations** — no Intent/Approach/Artifacts/Result
records, no contribution to digests, insights, or the KG.

The ETM is path-scoped to a single project directory (e.g.
`/Users/Q284340/Agentic/coding`) and only reads transcripts under
`/Users/Q284340/.claude/projects/-Users-Q284340-Agentic-coding/`.
Sub-agent transcripts live under
`/Users/Q284340/.claude/projects/-private-tmp/*.jsonl` and are
invisible to it.

---

## Confirmed instance (2026-05-23 afternoon)

User ran `/gsd-execute-phase` for Phase 42 (offline-ukb-migration-b)
in wave-based parallel mode. Plans 42-01 through 42-06 executed
across multiple sub-agent worktrees over the course of the afternoon.

Live data at filing time:

| Location | Transcripts touched in last 4 h |
|---|---|
| `/Users/Q284340/.claude/projects/-Users-Q284340-Agentic-coding/` (ETM-watched) | 1 (the main session) |
| `/Users/Q284340/.claude/projects/-private-tmp/` (sub-agent worktrees — **no ETM**) | **58** |

The most recent observation in the dashboard was at 13:38 CEST —
the prompt-set summary for the user's "execute all plans" instruction
itself. Everything the sub-agents did between 13:38 and ~17:00
(~3.5 h of real work, including the 12 unit tests reported in
STATE.md's `stopped_at: Phase 42-06 complete`) was never captured.

---

## Why nothing else looks wrong

The bug is invisible to existing health surfaces because the ETM
itself is healthy:

- Coding ETM (PID 38345) alive, advancing `lastProcessedUuid`,
  `lastUpdated` current to within the last minute.
- `health-coordinator.knowledge_pipeline.status = healthy` because
  the main session DID produce one observation at 13:38; the gap
  doesn't cross the 6-h stalled threshold.
- LLM proxy responsive (HTTP 200 in ~7 s on probe).
- `ObservationWriter` initializes cleanly with the new
  `_buildPriorContext` from commit `2f4cbf7d7`.

The ETM has no notion of "should I also be watching these other
transcripts?" — by design, it's a per-project singleton. Sub-agent
worktrees are entirely outside its frame of reference.

---

## What "sub-agent capture" means — both tiers, all four agents

Sub-agents must be visible in two places, with parity to what the parent
session gets today:

| Tier | Parent session today | Sub-agent today | Gap to close |
|---|---|---|---|
| **LSL** (verbatim `.specstory/history/*.md`) | written live, hourly chunks | nothing | live LSL files for each sub-agent |
| **Observations** (`/observations` panel) | written on prompt-set completion | nothing (this is what surfaced the bug) | live writes OR post-hoc sweep |

And it must work across all four supported agents:

| Agent | Sub-agent mechanism | Where its transcript lives |
|---|---|---|
| Claude Code | spawns `claude` CLI sub-process in a worktree (e.g. GSD wave-execute) | `~/.claude/projects/<encoded-cwd>/<parent>/subagents/agent-<hash>.jsonl` |
| OpenCode | (research needed — likely `~/.opencode/sessions/*` or similar) | TBD in research-phase |
| Copilot | (research needed — chat history under `~/.config/github-copilot/`?) | TBD in research-phase |
| Mastra | (research needed — Mastra workflows can spawn agents programmatically) | TBD in research-phase |

The first step of plan-phase is to **research each agent's sub-agent
mechanism** and produce a per-agent detection plan. Without that
research, any implementation will be Claude-Code-shaped and break for
the other three.

---

## Proposed LSL naming convention for sub-agents

Following the existing parent-session LSL pattern
`{YYYY-MM-DD}_{HHHH-HHHH}[-part{N}]_{userHash}.md`, sub-agent LSLs
should mirror that shape with a sub-agent designator inserted:

```
{YYYY-MM-DD}_{HHHH-HHHH}_S{parent-slot}-{sub-index}-{sub-hash}[-part{N}].md
```

Where:

- `S{parent-slot}` — designator for the parent session that spawned
  this sub-agent. `S1`, `S2`, etc. — slot number per active parent
  session within the local LSL day, so multiple concurrent parent
  sessions don't collide.
- `{sub-index}` — 1-based index within the parent's sub-agent set.
  E.g. if the parent fan-outs 7 wave-workers, they are `1`–`7`.
- `{sub-hash}` — short hash derived from the sub-agent's session id
  (so a sub-agent that survives a parent restart can be re-associated;
  also serves as the uniqueness gate against same-slot collisions).
- `[-part{N}]` — existing chunking suffix, unchanged.

Examples:
```
2026-05-23_1400-1500_S1-3-a7e8c41.md         # parent S1's 3rd sub-agent, first hour-chunk
2026-05-23_1500-1600_S1-3-a7e8c41-part2.md   # same sub-agent, second chunk
2026-05-23_1400-1500_S2-1-bf031de.md         # different parent's 1st sub-agent in same hour
```

Constraints:

- **Agent-agnostic shape** — the filename gives no hint of source
  agent (claude/opencode/copilot/mastra). Source agent goes in the
  LSL frontmatter as `agent: claude` etc., not in the filename.
- **Stable across agent restarts** — `{sub-hash}` is derived from
  the *sub-agent's* session id, not its PID or spawn timestamp.
- **Backward-compatible** — existing parent-session LSL files
  (no `_S{n}-…` segment) keep their current names; only new
  sub-agent files use the extended shape.
- **Discoverable from observations** — observations written from a
  sub-agent LSL carry `metadata.lsl_source` pointing at the file +
  line range, mirroring the parent-session convention.

---

## Live capture vs. backfill — both are needed

Even with real-time spawn-time hooks in place, a backfill path
remains necessary because:

1. **Worktree cleanup races.** GSD removes worktrees after a wave
   succeeds. If the spawn-time hook missed registration (race
   condition, supervisor down at the moment), the post-hoc sweep is
   the only recovery.
2. **Pre-deployment history.** All the work that happened BEFORE
   spawn-time hooks ship (including today's Phase 42 wave) needs
   the sweep to be visible at all.
3. **Cross-agent edge cases.** Some agents (Copilot) may not expose
   spawn-time hooks at all — those will be permanently sweep-only.

So the architecture has two ingest paths, not one:

- **Live tier** — spawn-time hook → live LSL writer + live
  ObservationWriter for each sub-agent. Real-time, matches parent
  session behavior.
- **Sweep tier** — periodic scan (cron / launchd, every 10-15 min)
  → bulk LSL synthesis from completed transcripts + bulk
  observation conversion via `convert-transcripts.js`. Catches
  whatever the live tier missed, idempotent.

---

## Two fix paths

### Path A — Spawn-time hook (the "do it right" fix)

When GSD wave-execute creates a worktree at
`/private/tmp/<uuid>/agent-<hash>/`, register the worktree with the
health-coordinator so an ETM is either:

- spawned per-worktree (one ETM per sub-agent for the lifetime of
  the wave), OR
- the existing coding-ETM is told "also watch transcripts under
  `/Users/Q284340/.claude/projects/-private-tmp/`" with a filter that
  ties them back to the originating project.

Pros: real-time capture; observations stream into the panel as the
sub-agents work; no separate backfill pass needed.

Cons: more moving parts. Requires GSD's wave-runner to know about
the health-coordinator. Per-worktree ETMs create N processes for an
N-wide wave. Path filtering ("which sub-agents belong to which
project?") is non-trivial.

### Path B — Post-hoc ingest (the cheap, fast fix)

At wave completion (or via a periodic sweep, e.g. every 10 min),
scan `/Users/Q284340/.claude/projects/-private-tmp/` for transcripts
modified since the last sweep, and convert them via
`scripts/convert-transcripts.js` (which already exists and
batch-converts transcripts to observations).

Map each sub-agent transcript back to its originating project by
reading the worktree path from the transcript's `cwd` or
`session_metadata` (whichever Claude Code writes). Tag the resulting
observations with `metadata.source = "sub-agent-backfill"`,
`metadata.worktree_path = ...`, `metadata.parent_session = ...` so
the panel can distinguish them.

Pros: minimal new infrastructure; reuses existing
`convert-transcripts.js`; naturally fits Phase 50's "ground-truth
backfill" theme — Phase 50's resolver could ingest sub-agent
transcripts on the same pass.

Cons: latency — observations don't appear in real time, only at
sweep boundaries. Worktrees that get cleaned up before the sweep
(GSD removes them on success) leave a permanent gap.

### Recommendation

Ship **Path B first** as the immediate stopgap (it recovers
afternoon-of-2026-05-23 work and any future waves with one sweep).
Plan **Path A** as a follow-on once the worktree-→-project mapping
is well understood from the sweep data.

---

## Scope

### Must

1. **Per-agent detection research** — produce a research artifact
   documenting how each of claude / opencode / copilot / mastra
   spawns sub-agents and where their transcripts/event-streams live.
   Without this, the rest of the work is Claude-shaped and fragile.
2. **Agent-agnostic sub-agent registry** — a single in-memory or
   `/health/state`-exposed table tracking `{ parent_session_id,
   sub_index, sub_hash, agent, status, transcript_path }` per
   sub-agent. All downstream code (LSL writer, observation writer,
   sweep) reads from this registry rather than each implementing
   its own per-agent discovery.
3. **LSL coverage**: live LSL files written for sub-agents following
   the naming convention above
   (`{YYYY-MM-DD}_{HHHH-HHHH}_S{slot}-{idx}-{hash}[-part{N}].md`).
   Frontmatter carries `agent`, `parent_session_id`, `sub_index`,
   `sub_hash`. Format matches existing parent LSL exactly so
   downstream tooling (Phase 50 resolver, classifier logs) works
   unchanged.
4. **Observation coverage**: sub-agent activity surfaces in
   `/observations` panel, tagged
   `metadata.parent_session_id = <id>`, `metadata.sub_index = <N>`,
   `metadata.source = "sub-agent"` (live tier) or
   `"sub-agent-backfill"` (sweep tier).
5. **Backfill path for already-broken history**: one-shot recovery
   of the 2026-05-23 afternoon Phase 42 wave (~25 sub-agent
   transcripts under `<parent>/subagents/agent-*.jsonl`). The
   `scripts/backfill-subagent-transcripts.mjs` proof-of-concept
   written 2026-05-23 in this session is the seed for this path —
   needs to be promoted to a maintained script and made
   agent-agnostic.
6. **Worktree cleanup race**: GSD removes worktrees after a wave
   succeeds. The sweep must run before cleanup OR transcripts must
   be snapshot-pinned (hard link to a long-lived path at worktree
   creation). Decide in plan-phase.

### Should

7. **Live tier (Path A): spawn-time hooks**, per-agent:
   - Claude Code: detect Task-tool sub-agent spawn or worktree
     creation; register the sub-agent's transcript path with the
     coordinator before any messages are written.
   - OpenCode/Copilot/Mastra: per the research artifact in Must #1.
8. **Sweep tier (Path B): periodic backfill**, agent-agnostic.
   launchd / cron job running every 10–15 min. Reads the registry
   from Must #2, scans for transcripts the live tier missed,
   converts via shared "scan-and-convert" primitive
   (also used by Phase 50's LSL resolver).
9. **Health-coordinator integration**: surface `sub_agent_capture`
   in `/health/state` — live tier registration count, last sweep
   time, captured vs. skipped, badge-relevant alerts.
10. **Shared primitives with Phase 50**: factor "scan unusual paths
    for transcripts and convert them" and "read transcript window
    by user-prompt count" so both phases share the same code.

### Could

11. **Recursive sub-agents** — handle the case where a sub-agent
    spawns its own sub-sub-agents. The naming convention's
    `S{slot}-{idx}` scheme can extend to `S{slot}-{idx}-{sub-idx}`,
    but the registry needs to track parent-of-parent. Defer until
    we see this in the wild.
12. **Provenance richness**: when a sub-agent transcript references
    a PLAN.md path under `.planning/phases/<N>-<slug>/<N>-<NN>-PLAN.md`,
    auto-set `metadata.phase = N`, `metadata.plan = NN` so the
    dashboard can group sub-agent observations by phase/plan.
13. **Sub-agent lifecycle events**: emit
    `sub-agent.spawned` / `sub-agent.completed` events to the
    coordinator so the dashboard can show live wave progress
    without polling.

---

## Acceptance criteria

- [ ] **Backfill**: 2026-05-23 afternoon Phase 42 sub-agent
      transcripts (25 confirmed under `<parent>/subagents/`) appear
      in `/observations`, tagged `metadata.source =
      "sub-agent-backfill"`, `metadata.project = "coding"`. The
      proof-of-concept `scripts/backfill-subagent-transcripts.mjs`
      run started 2026-05-23 17:xx UTC is the verification path.
- [ ] **LSL parity**: a fresh wave-execution produces sub-agent LSL
      files under `.specstory/history/{YYYY}/{MM}/` matching the
      proposed naming convention, with valid frontmatter
      (`agent`, `parent_session_id`, `sub_index`, `sub_hash`).
- [ ] **Observation parity**: the same wave produces observations
      visible in the panel within ≤15 min of sub-agent completion,
      tagged `metadata.parent_session_id`, `metadata.sub_index`.
- [ ] **Agent-agnostic**: the same wave run under OpenCode (then
      Copilot, then Mastra) produces equivalent LSL + observation
      output. No agent-specific code paths in the writers
      themselves — only in the detection layer (Must #1).
- [ ] **Idempotency**: re-running the sweep is a no-op for
      already-captured transcripts (uniqueness key = sub_hash +
      message UUID).
- [ ] **Dashboard truth**: the knowledge-pipeline badge no longer
      goes "stale" during an actively-running wave that's
      producing sub-agent work.

---

## Related

- **Phase 50 — LSL-grounded async observation resolver.** Strong
  plumbing overlap: both phases need to read transcripts from paths
  the ETM doesn't watch and convert them to observations. The
  `getLSLWindow` / `scan-and-convert` primitives should be shared.
- **`scripts/convert-transcripts.js`** — already exists, already
  batch-converts a transcript to observations. The sweep entry point
  is essentially "run this against every unmonitored sub-agent
  transcript".
- **Phase 47** — different bug (writer-path text loss with image
  attachments) but same family of "observation capture incomplete"
  symptoms. Unrelated mechanism.
- **2026-05-23 commits** `2f4cbf7d7` (pronoun resolution) and
  `2129be37b` (idle-aware probe cadence) — preserved here only
  because this gap was discovered while diagnosing the panel
  alongside those fixes; not causally related.
