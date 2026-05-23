# Phase 51 — Context

**Title:** GSD wave-execution sub-agent transcripts are not captured as observations
**Filed:** 2026-05-23
**Severity:** High (data loss — entire categories of coding work are invisible to the knowledge pipeline)
**Status:** Filed (not yet planned)

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

1. **Backfill pass** that picks up sub-agent worktree transcripts
   under `/Users/Q284340/.claude/projects/-private-tmp/`, classifies
   them back to a project (via worktree path / parent session), and
   writes them as observations with appropriate provenance metadata.
2. **One-shot recovery** of the 2026-05-23 afternoon Phase 42 wave
   (58 unmonitored transcripts confirmed at filing time). Verify the
   resulting observations show up in the panel with correct
   `project = coding` and a clear `source = sub-agent-backfill` tag.
3. **Worktree cleanup race**: GSD removes the worktree after the
   wave completes. The sweep must run before cleanup OR
   `convert-transcripts` must copy/snapshot the transcript before it
   can be deleted. Decide between: pin the transcript file (hard
   link to a long-lived path at worktree creation) vs. cron the
   sweep aggressively enough to beat cleanup.

### Should

4. **Detector + scheduler**: launchd or cron job running the sweep
   every 10–15 min. Sub-agent transcripts are short-lived, so
   waiting longer risks losing them to worktree cleanup. Skip
   transcripts already converted (idempotency key: transcript UUID).
5. **Health-coordinator integration**: add a `sub_agent_backfill`
   field to `/health/state` showing last sweep time, transcripts
   captured, transcripts skipped (already converted). Surfaces a
   yellow badge if a sweep hasn't run in >30 min.
6. **Resolver/sweep sharing**: factor the "scan unusual paths for
   transcripts and convert them" primitive so Phase 50's LSL
   resolver and this phase's sub-agent sweep share the same code.

### Could

7. **Real-time spawn-time hook (Path A)** — once Path B has been
   running long enough to characterize worktree → project mapping
   patterns, build the spawn-time hook for real-time capture.
8. **Provenance richness**: when a sub-agent transcript references a
   PLAN.md path under `.planning/phases/<N>-<slug>/<N>-<NN>-PLAN.md`,
   set `metadata.phase = N`, `metadata.plan = NN` automatically so
   the dashboard can group sub-agent observations by phase/plan.

---

## Acceptance criteria

- [ ] After running the backfill on the live system today, the
      Observations panel shows the 2026-05-23 afternoon Phase 42
      sub-agent work (10+ observations from the 58 unmonitored
      transcripts, each tagged `source = sub-agent-backfill`).
- [ ] A subsequent wave-execution (any future phase) produces
      observations within ≤15 min of sub-agent completion (Path B
      sweep cadence).
- [ ] No double-capture: re-running the sweep is idempotent.
- [ ] The dashboard's knowledge-pipeline badge correctly reflects
      sub-agent activity (no longer goes "stale" during a wave
      that's actively producing sub-agent work).

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
