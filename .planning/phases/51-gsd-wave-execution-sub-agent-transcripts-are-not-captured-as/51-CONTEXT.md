# Phase 51 — Context

**Title:** Agent-agnostic sub-agent capture across LSL and observations
**Filed:** 2026-05-23 (initial) · scope broadened 2026-05-23 to cover LSL tier + agent-agnostic detection
**Severity:** High (data loss — entire categories of coding work are invisible to the knowledge pipeline)
**Status:** Filed (not yet planned)

> **Scope broadening (2026-05-23):** original framing was "backfill Claude Code sub-agent observations". Real
> requirement is broader — sub-agents should appear in **both LSL and observations**, in **real time**, for
> **claude code / opencode / copilot / mastra** alike. The Claude-Code-specific observation backfill is now
> just the immediate stopgap (Path B-claude) within a larger architecture; see the expanded scope below.

> **Statusline-bubble consequence (callout, 2026-05-24):** the tmux per-project bubble (`C🟢` / `KC⚫` etc.)
> and the `[📚]` badge both key off the *pinned parent transcript's* mtime via
> `combined-status-line-projects.json`. When a sub-agent is doing the work, the parent file's mtime sits
> frozen and both signals fade to ⚫ even though the user is actively confirming prompts inside the
> sub-agent (confirmed live this morning: parent age 32 227 s → ⚫, while a sub-agent transcript
> `<parent>/subagents/agent-a8ec1c2d9fabb5e25.jsonl` was just 56 s old → should be 🟢).
>
> An **interim mitigation shipped 2026-05-24** (commit follows this CONTEXT.md edit) folds sub-agent
> mtimes into the per-project freshness signal in three places — `_freshestProjectActivityAgeMs()`,
> `transcriptAgeMs()`, and the projects-mapping write (extended with a new `subMt` field consumed by
> `status-line-fast.cjs`). This unblocks the bubble symptom without waiting for the full registry.
>
> **The proper fix lives in this phase**: once the sub-agent registry (Must #2) exists, the mapping
> should source `subMt` from the registry instead of re-walking `<parent>/subagents/` on every tick,
> and Must #3 (LSL parity) makes sub-agent activity visible via the same parent signal that drives
> every other dashboard surface. Treat the 2026-05-24 mitigation as scaffolding — replace it during
> plan-phase, don't extend it.

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

---

## Implementation Decisions Locked During Discuss (2026-05-26)

<decisions>

The body above (filed 2026-05-23) captures scope. The decisions below
resolve residual gray areas downstream agents (researcher, planner)
need locked before they can act. Phase 50 closed earlier today
(2026-05-26) — the `lib/lsl/window.mjs` and `lib/lsl/scan-and-convert.mjs`
primitives are now landed and imported here unchanged per D-Reuse.

### D-Order: Path B (sweep) ships first, Path A (live hook) follows

Plan order:

1. **Plans for Path B (sweep tier):** agent-agnostic registry + sweep
   primitives (extending `lib/lsl/scan-and-convert.mjs` with the
   sub-agent-paths search list) + backfill of the 2026-05-23 ~25
   transcripts + LSL parity (sub-agent `.specstory` files written
   from the sweep using D-LSL-Filename). Ships the immediate value
   AND closes the data-loss gap for any future wave that the live
   tier misses.
2. **Plans for Path A (live tier), per agent:** claude/opencode/copilot/mastra
   each get their own plan based on the research mechanism from
   D-Research. Some agents may end up "sweep-only" if research
   shows no spawn hook is available (CONTEXT.md flagged Copilot
   as the likely sweep-only agent).
3. **Statusline replacement plan:** replace the 2026-05-24
   `_freshestProjectActivityAgeMs()` + `transcriptAgeMs()` +
   projects-mapping subMt-write mitigation with registry-sourced
   reads (see D-Statusline).
4. **Closure plan:** health-coordinator integration + final
   verification (the dashboard knowledge-pipeline badge stays
   "healthy" during an active wave + the AC table from this file).

**Rationale:** Path B unblocks the immediate symptom (sub-agent work
invisible in observations panel) WITHOUT needing per-agent
spawn-hook research to land. Path A is the "do it right" tier and
benefits from learning patterns from operating Path B in production
for a few wave runs first.

**Rejected alternative — Path A first:** would have meant 4 separate
hook plans before anything ships value. CONTEXT.md's own
recommendation matches D-Order.

### D-Research: Full mechanism research for all 4 agents upfront (4 parallel research subagents)

Plan-phase MUST spawn **4 parallel `gsd-phase-researcher` subagents**
during the research wave — one per agent (claude / opencode /
copilot / mastra). Each researcher produces a section in the phase
RESEARCH.md (or per-agent RESEARCH-{agent}.md if the planner
prefers granularity) covering:

- **Process model.** How does the agent spawn sub-agents? (subprocess
  spawn, in-process worker, async task, MCP server, etc.) Document
  the exact mechanism + invocation surface.
- **Transcript location.** Where on disk does each sub-agent's
  transcript / event-stream live? Include the directory pattern,
  any encoding of project cwd in path, file extension, and
  rotation/cleanup behavior.
- **Lifecycle events.** What signals are available at spawn /
  progress / complete? Process exit codes? Files closing? IPC
  events? MCP `notifications/initialized`?
- **Sub-agent-of-sub-agent recursion.** Does the agent allow
  recursive sub-agent spawning? If yes, how is the parent chain
  recoverable from the transcript?
- **Detection plan.** Concrete steps for Path A (spawn hook) AND
  Path B (sweep). For Path B specifically: the directory paths to
  add to the registry's `searchPaths` list and the cwd-parsing
  rule to map transcript → originating project.

**Why parallel:** the 4 researchers operate on different doc sets
and filesystem evidence. Parallel saves wall-clock time and
prevents one slow research thread from blocking the others. Each
research agent gets the same `<files_to_read>` template + an
agent-specific `<agent>` field.

**Recommendation for researcher prompts:** include a hard cap of 30
min per agent and 4 web fetches per agent. Output: a SHORT
"detection_plan" block per agent that the planner uses directly
to write the corresponding Path A / Path B plan.

**Out of scope for research:** how the agent encodes sub-agent
state (we don't care about the agent's internal data model, only
the externally-observable transcript / event surface).

### D-Backfill: Scope = the 2026-05-23 ~25 transcripts only

Backfill plan handles the documented incident (the 25 sub-agent
transcripts under `<parent>/subagents/agent-*.jsonl` from the
2026-05-23 afternoon Phase 42 wave). Does NOT sweep every historical
`/private/tmp/` transcript ever produced — that's a different scope
question (and most older transcripts have already been cleaned up
by GSD worktree removal anyway).

**Concrete inputs:** the existing `scripts/backfill-subagent-transcripts.mjs`
PoC seed (now factored into `lib/lsl/scan-and-convert.mjs` per Phase 50
D-Primitives) + the directory of the live `~/.claude/projects/-Users-Q284340-Agentic-coding/<parent>/subagents/`
sub-agent transcripts confirmed during the 2026-05-23 incident.

**Acceptance:** all 25 confirmed transcripts produce observation
rows tagged `metadata.source = "sub-agent-backfill"`,
`metadata.parent_session_id = <parent>`, `metadata.sub_index = <N>`,
`metadata.project = "coding"`. Idempotent — re-running the backfill
is a no-op (uniqueness key = sub-agent session UUID + message UUID
per CONTEXT.md AC #5).

**Out of scope** (filed deferred for follow-up):
- Sweeping pre-2026-05-23 sub-agent transcripts that may exist in stale `/private/tmp/` paths
- Cross-project backfill (only the `coding` project's sub-agent transcripts in scope here; other projects use their own GSD instances)

### D-LSL-Filename: Lock the proposed filename convention verbatim

The naming pattern in CONTEXT.md body is locked as the canonical
LSL filename for ALL agents (claude/opencode/copilot/mastra):

```
{YYYY-MM-DD}_{HHHH-HHHH}_S{parent-slot}-{sub-index}-{sub-hash}[-part{N}].md
```

Where:
- `S{parent-slot}` — slot number per active parent session per local LSL day (1-indexed)
- `{sub-index}` — 1-based index of sub-agent within parent's fan-out
- `{sub-hash}` — first 7 chars of the sub-agent's session id (NOT pid, NOT timestamp)
- `[-part{N}]` — existing hourly-chunk suffix (unchanged from parent LSL pattern)

**Agent-agnostic:** the source agent goes in the LSL frontmatter as
`agent: claude|opencode|copilot|mastra`, NOT in the filename. The
sweep path-walker treats all four identically once the registry
knows where each agent's transcripts live.

**Backward-compatible:** existing parent-session LSL files
(`{YYYY-MM-DD}_{HHHH-HHHH}_{userHash}.md` without `S{n}-` segment)
keep their current names. Only NEW sub-agent files use the
extended shape.

**Stable across agent restarts:** because `{sub-hash}` is derived
from the sub-agent's SESSION id (not pid, not spawn timestamp), a
sub-agent that survives a parent restart can be re-associated by
matching its session id. Also serves as the uniqueness gate
against same-slot collisions.

**Recursive sub-agent (Could #11) extension reserved but not
implemented:** if a sub-agent spawns its own sub-sub-agents, the
naming would extend to `S{slot}-{idx}-{sub-idx}`. The registry's
schema reserves a `parent_sub_hash` field for this; population
deferred until the failure mode is observed in the wild (per
CONTEXT.md Could #11 disposition).

### D-Statusline: Replace 2026-05-24 mitigation inside Phase 51

The 2026-05-24 statusline-bubble mitigation (sub-agent mtime folded
into `_freshestProjectActivityAgeMs()`, `transcriptAgeMs()`, and
the projects-mapping `subMt` write) is **scaffolding**. Phase 51
includes a dedicated cleanup plan (one of the final plans in the
phase) that:

- Sources `subMt` for each project from the new registry instead of
  re-walking `<parent>/subagents/` on every tick
- Removes the three mitigation hooks (`_freshestProjectActivityAgeMs`
  treats sub-agent mtimes the same as parent mtimes natively;
  `transcriptAgeMs` returns whichever is freshest from the
  registry; mapping writes `subMt` only when registry surfaces a
  current sub-agent)
- Verification: the per-project bubble (`C🟢 / KC⚫`) and the `[📚]`
  badge BOTH go green during an active sub-agent run (no mtime
  fade), AND the dashboard does not regress on the 2026-05-12
  tmux emoji-width fix (see `reference_tmux_emoji_width_fix.md`)

**Why inside this phase:** the registry IS the source of truth for
sub-agent state once Phase 51 ships. Leaving the 2026-05-24
mitigation in tree means two divergent code paths for sub-agent
freshness signal — future maintainer will not know which is
canonical. Cleanup in the same phase prevents drift.

### D-Reuse: Phase 50 primitives are imported unchanged

Phase 50 closed earlier today (2026-05-26) shipping
`lib/lsl/window.mjs` (getLSLWindow) and `lib/lsl/scan-and-convert.mjs`
(scanTranscriptsForUnconverted + convertTranscriptsToObservations).
Phase 51's plans MUST import these exactly — no signature changes,
no wrapper layers, no in-place rewrites. The Path B sweep extends
the primitives' `searchPaths` list config to include each agent's
sub-agent transcript directory; nothing in the primitives'
behavior changes.

**Phase 50 contract verification gates that Phase 51 must respect:**
- The exact exported function signatures (per `lib/lsl/window.mjs`
  and `lib/lsl/scan-and-convert.mjs` grep gates from Phase 50
  Plan 01 `<done>` blocks)
- The Phase 50 test suite (181 tests across 20 suites) must still
  pass after every Phase 51 plan. CI gate.

### D-Live-Sweep-Tags: Distinct metadata.source for the two tiers

Observations produced by:

- **Live tier (Path A spawn hook):** `metadata.source = "sub-agent"`
  (no suffix, indicates real-time capture)
- **Sweep tier (Path B post-hoc):** `metadata.source = "sub-agent-backfill"`
- **Both tiers:** `metadata.parent_session_id = <parent's claude
  session id>`, `metadata.sub_index = <N>` (1-based), `metadata.sub_hash =
  <7-char session id prefix>`, `metadata.agent = <claude|opencode|copilot|mastra>`,
  `metadata.project = <project name>`

**Why distinct:** lets the dashboard distinguish "real-time
captured, expected to be in panel within seconds" from
"sweep-recovered, expected within 15-30 min after sub-agent exit".
Operators can spot when the live tier is silently broken (sweep
should be the exception, not the norm).

### Claude's Discretion

The following are NOT locked and downstream agents have flexibility:

- The exact JSON schema for the agent-agnostic registry table
  (`Map<sub_hash, {parent_session_id, sub_index, agent, status,
  transcript_path, lsl_path, project}>` or a SQLite table — planner
  decides based on whether it needs persistence across coordinator
  restarts)
- launchd cadence for the periodic sweep (15 vs 20 vs 30 min —
  planner picks based on the wave-execution cadence patterns
  observed in 2026-05-23's afternoon)
- Whether the LSL writer for sub-agents is a separate Node script
  or a method on an existing class (planner discretion based on
  the existing LSL writer's architecture)
- Whether to use one researcher subagent per agent (4 parallel) or
  to colocate research into one researcher with 4 dispatch passes —
  D-Research mandates the parallel approach but planner can switch
  if context-budget constraints force serialization

</decisions>

---

## Canonical References

<canonical_refs>

**Downstream agents MUST read these before planning or implementing.**

### Phase 51 spec + this phase

- `.planning/phases/51-gsd-wave-execution-sub-agent-transcripts-are-not-captured-as/51-CONTEXT.md` (this file) — full spec including the decisions block above
- `.planning/ROADMAP.md` § Phase 51 — one-line summary

### Phase 50 (shared primitives — imported unchanged)

- `lib/lsl/window.mjs` — getLSLWindow primitive (don't modify; Phase 50 contract)
- `lib/lsl/scan-and-convert.mjs` — scanTranscriptsForUnconverted + convertTranscriptsToObservations (extend `searchPaths` config in Phase 51 plans, don't modify function bodies)
- `scripts/resolve-observations-from-lsl.mjs` — Phase 50 CLI (reference for CLI flag conventions, error handling, etc.)
- `.planning/phases/50-lsl-grounded-async-observation-resolver-backfill-ambiguous-r/50-01-SUMMARY.md` — implementation notes for the primitives, including the Format-B LSL labels + filename/anchor time skew fixes (Rule 1 deviations documented; may be relevant when parsing sub-agent transcripts)

### 2026-05-23 incident artifacts (Path B's first job)

- `~/.claude/projects/-Users-Q284340-Agentic-coding/<parent-session>/subagents/agent-*.jsonl` — the 25 confirmed sub-agent transcripts from the afternoon Phase 42 wave
- `scripts/backfill-subagent-transcripts.mjs` — the PoC seed (now factored into `lib/lsl/scan-and-convert.mjs`)
- `.planning/phases/42-offline-ukb-migration-b/42-06-SUMMARY.md` — the wave that surfaced the bug

### 2026-05-24 statusline mitigation (to be replaced)

- `scripts/combined-status-line-projects.json` — projects-mapping file with the `subMt` field
- `status-line-fast.cjs` — consumer of `subMt`
- `_freshestProjectActivityAgeMs()` + `transcriptAgeMs()` — sub-agent-mtime-folding helpers; locations TBD by researcher
- `[checkpoint]` heartbeats spec from `execute-phase.md:#2410` (heartbeats reference the parent transcript mtime — sub-agent activity must influence the parent signal once registry exists)

### Project conventions (from CLAUDE.md)

- `CLAUDE.md` § "Rebuilding After Code Changes" — `scripts/`, `lib/`, and host-side Node code don't need Docker rebuild; only `integrations/mcp-*` submodules do (sub-agent capture is host-side, so no submodule rebuild needed for most Phase 51 plans)
- `CLAUDE.md` § statusline rules — don't touch global statusline config; project-level `.claude/settings.local.json` only
- Memory `feedback_test_statusline_in_tmux.md` — statusline cleanup plan MUST verify in live tmux before staging, not just offline output
- Memory `reference_tmux_emoji_width_fix.md` — do NOT regress the 2026-05-12 codepoint-widths fix when modifying statusline rendering
- Memory `feedback_e2e_verify.md` — verify dashboard badge + bubble visually in browser, not just via DB query

### Phase 50 closure context

- `.planning/phases/50-lsl-grounded-async-observation-resolver-backfill-ambiguous-r/50-01-SUMMARY.md`
- `.planning/phases/50-lsl-grounded-async-observation-resolver-backfill-ambiguous-r/50-02-SUMMARY.md`
- `.planning/phases/50-lsl-grounded-async-observation-resolver-backfill-ambiguous-r/50-03-SUMMARY.md`
- `181 tests across 20 suites` — Phase 50 CI baseline; Phase 51 plans MUST keep this green

</canonical_refs>

---

## Code Context

<code_context>

### Reusable assets (from Phase 50)

- **`lib/lsl/window.mjs`** (Phase 50 Plan 01, 13468 B) — `getLSLWindow(observation, opts)`. Phase 51's sweep tier doesn't need this (transcripts have their own format), but the statusline-cleanup plan may use it to compute "freshness" from the LSL files
- **`lib/lsl/scan-and-convert.mjs`** (Phase 50 Plan 01, 11569 B) — `scanTranscriptsForUnconverted(searchPaths, opts)` + `convertTranscriptsToObservations(transcripts, opts)`. Phase 51 extends `searchPaths` to include sub-agent transcript directories per agent. NOT modified, only its caller's config changes
- **`scripts/resolve-observations-from-lsl.mjs`** (Phase 50 Plan 01) — CLI shape template (flag set, dry-run, idempotency, project filter pattern)
- **`scripts/lsl-resolver-job.sh`** + **launchd plist** (Phase 50 Plan 03) — pattern for the periodic background job that Path B's sweep will mirror (different command, same plist + installer shape)

### Existing seed scripts (still in tree, refactored into primitives by Phase 50)

- **`scripts/backfill-subagent-transcripts.mjs`** (5KB, 2026-05-23) — original PoC; remains as thin wrapper around `lib/lsl/scan-and-convert.mjs` for backward compat. Reference for the cwd-parsing rule that maps `/private/tmp/<uuid>/agent-<hash>/` → originating project
- **`scripts/convert-transcripts.js`** (10KB, 2026-04-19) — same pattern, parent transcripts

### Established patterns (from CONTEXT.md body + Phase 50 closure)

- **`lib/<category>/` plain ESM modules** — established (Phase 50 D-Primitives validated this is the right shape)
- **launchd plist + idempotent installer + wrapper script** — Phase 50 Plan 03 demonstrates the pattern (`launchd/com.coding.lsl-resolver.plist` + `scripts/install-lsl-resolver-launchd.sh` + `scripts/lsl-resolver-job.sh`). Path B's sweep job follows the same pattern
- **`.data/observations/observations.db` SQLite + WAL JSON metadata column** — Phase 50 wrote 7 new metadata keys (`lsl_*`). Phase 51 writes new keys (`source`, `parent_session_id`, `sub_index`, `sub_hash`, `agent`, `project`) — same idiom, no schema migration
- **`POST /api/complete` on `host.docker.internal:12435`** — LLM proxy. Phase 51 plans MAY need this if observation summarization is part of the sweep pipeline; reuse Phase 50's invocation shape

### Integration points

- **Health coordinator** (Phase 51 final closure plan) — surface `sub_agent_capture` block in `/health/state`: `live_registrations` count, `last_sweep_at`, `captured_vs_skipped`, plus the registry size. Read-only from coordinator's perspective; the registry writes itself
- **ETM (EnhancedTranscriptMonitor)** (Plan 1 — registry) — the registry's source-of-truth for sub-agent transcripts that ARE under ETM's watch path. Sub-agent transcripts OUTSIDE ETM (`/private/tmp/`, OpenCode/Copilot dirs) populate the registry via the periodic sweep
- **GSD wave-execute** (Path A claude-code plan) — the spawn-time hook injects into `Skill(skill="gsd-execute-phase")`'s worktree-creation step. Specific location TBD by research

</code_context>

---

## Deferred Ideas

<deferred>

- **Recursive sub-agent capture (Could #11)** — registry reserves a `parent_sub_hash` field per D-LSL-Filename but population is deferred until the failure mode is observed
- **Cross-project sweep** — D-Backfill scopes the sweep to the `coding` project only. Other projects use their own GSD instances and will need their own Phase 51-style rollouts when adopted
- **Provenance richness (Could #12)** — auto-set `metadata.phase = N`, `metadata.plan = NN` when a sub-agent transcript references a `.planning/phases/<N>-<slug>/<N>-<NN>-PLAN.md` path. Out of scope for Phase 51 closure; nice follow-up
- **Sub-agent lifecycle events (Could #13)** — emit `sub-agent.spawned` / `sub-agent.completed` to the coordinator for live wave progress without polling. Useful but not blocking
- **Pre-2026-05-23 historical backfill** — most stale `/private/tmp/` transcripts have been cleaned up. Out of scope per D-Backfill
- **Health-coordinator integration depth** — Phase 50 hit the same surface (Plan 03 Task 3 skipped because health-coordinator.js is a pure HTTP aggregator). Phase 51's health-coordinator closure plan must either (a) work via the aggregator's existing surface (counter pulled from observation API), or (b) accept the same architectural-drift caveat and skip. Planner decides

### Reviewed Todos (not folded)

- `2026-05-23-orphan-digest-observation-refs.md` (score 0.6, area "observability / data-integrity") — same as Phase 50: reviewed, not folded. Different failure mode (digest→observation FK integrity, not sub-agent capture). Belongs in its own phase

</deferred>

---

*Phase: 51 — gsd-wave-execution-sub-agent-transcripts-are-not-captured-as*
*Decisions augmented: 2026-05-26*
