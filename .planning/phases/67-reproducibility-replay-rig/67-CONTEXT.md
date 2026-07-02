# Phase 67: Reproducibility & Replay Rig - Context

**Gathered:** 2026-07-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Capture a run's **internal state** into a restorable `RunSnapshot`, and **record/replay
external state** so a repeat run starts from equivalent conditions and replays the same
external responses — making N=1 runs comparable modulo provider non-determinism.

**Internal state (REPRO-01):** git SHA + workspace dirty state, `.data/knowledge-graph/`
KB, `processOverrides` routing config, MCP server inventory + versions, prompt text,
`.planning/` state, agent-affecting env vars, agent binary version.

**External state (REPRO-02):** LLM provider responses (via `rapid-llm-proxy`),
`WebSearch`/`WebFetch` results, remote MCP replies, and the clock — recorded during a run,
replayed from fixtures.

**Sequencing:** First v7.4 phase by number, but deliberately built LAST (after Phase 75)
per the ROADMAP priority note — replay is only meaningful once attribution/scoring is
trustworthy, else replay faithfully reproduces wrong numbers.

**Out of scope:** correcting provider-side non-determinism (temperature/seed drift is
accepted); cross-machine portability of the LevelDB binary copy (snapshots are
same-host restore artifacts); UI for browsing snapshots (this is CLI/infra only).
</domain>

<decisions>
## Implementation Decisions

### Snapshot storage & KB capture
- **D-01:** RunSnapshots live in a **per-run directory** at `.data/run-snapshots/<task_id>/`.
- **D-02:** The KB is captured as a **full binary copy of the LevelDB directory**
  (`.data/knowledge-graph/`) for byte-exact restore (satisfies SC-2 literally) **AND** the
  km-core JSON export (`.data/knowledge-graph/exports/*.json`) for portability/inspection.
- **D-03:** Workspace dirty state = **git SHA + a git patch** of uncommitted changes (not a
  full working-tree copy). Research to confirm patch vs stash and binary/untracked handling.

### Restore target & safety
- **D-04:** Restore lands in an **isolated git worktree + a sandbox data dir** (separate
  `LLM_PROXY_DATA_DIR`) by default — it NEVER touches the live checkout or live KB. Safe to
  run casually.
- **D-05:** A **`--in-place` flag** covers the rare true byte-for-byte-in-live case, gated by
  an **automatic backup of current state + explicit confirmation**. No unguarded in-place path.

### Replay miss policy & matching
- **D-06:** On a replay miss (a request with no recorded fixture) → **hard-fail and surface
  it**. A miss is a real divergence from the recorded run; never silently mix live +
  recorded responses. This is the comparability guarantee.
- **D-07:** Request matching = **normalized content hash + per-key call ordinal**. Hash the
  normalized request (model + messages + params); track ordinal so identical repeated calls
  (e.g. retries) replay in recorded order. Robust to reordering of distinct calls.

### Channel scope
- **D-08:** **All five channels** ship in this phase: LLM (via proxy), WebSearch, WebFetch,
  remote MCP, and clock. Each tool boundary needs a record/replay tap. See risk note in
  code_context — WebSearch/WebFetch/MCP run in the Claude Code harness, not the proxy, so
  their tap point is an open research question (the LLM tap is straightforward at the proxy).

### Trigger & integration surface
- **D-09:** **Integrate with the Phase 68 measurement span.** Snapshot is auto-taken when a
  span opens (`measurement-start.mjs`), recording is ON during the span, and fixtures are
  archived at span close alongside the Run. Replay is driven by a **`--replay <snapshot>`
  flag** on `measurement-start.mjs`. Reuses `active-measurement.json` plumbing — one workflow.

### Claude's Discretion
- **Clock virtualization mechanism** — freeze-at-snapshot vs monotonic-offset replay;
  granularity of `Date.now()`/`new Date()` interception. Research to pick; must be
  deterministic on replay.
- **env-var allowlist** — which env vars count as "agent-affecting" (capture an allowlist,
  not the whole environment, to avoid leaking secrets into snapshots).
- **MCP inventory capture method** — how to enumerate connected MCP servers + versions at
  snapshot time (config file read vs live handshake).
- git patch encoding details (binary diffs, untracked files, submodule dirty state).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase requirements & roadmap
- `.planning/REQUIREMENTS.md` §REPRO-01, §REPRO-02 — the two requirements this phase discharges.
- `.planning/ROADMAP.md` → "Phase 67: Reproducibility & Replay Rig" — goal + 4 success criteria.

### Measurement span (integration anchor — D-09)
- `scripts/measurement-start.mjs` — span-open CLI; snapshot auto-capture + `--replay` flag hook here.
- `scripts/measurement-stop.mjs` — span-close orchestrator; fixture archival + Run linkage here.
- `.data/active-measurement.json` (runtime) — the single active-span state file; reuse its plumbing.

### LLM record/replay chokepoint (D-08 LLM channel)
- `_work/rapid-llm-proxy/proxy-bridge/server.mjs` — the runtime proxy bridge; all LLM
  traffic flows here. Record tap + replay-serve + hard-fail-on-miss live at this boundary.
- `memory/reference_llm_proxy_bridge_flap.md` — confirms `proxy-bridge/server.mjs` (NOT
  src/dist) is the live runtime, and proxy log locations.

### Experiment / Run KB (snapshot targets + Run linkage)
- `lib/experiments/store.mjs` — km-core store factory (`openExperimentStore`).
- `lib/experiments/run-write.mjs` — `writeRun`; snapshot/fixture refs attach to the Run entity.
- `.data/knowledge-graph/` — live KB (LevelDB) — the D-02 binary-copy target.
- `.data/knowledge-graph/exports/*.json` — km-core JSON export — the D-02 portable copy.

### Codebase maps
- `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/INTEGRATIONS.md` — system layout
  + external integration surfaces (proxy, MCP, km-core).

### CLAUDE.md operational constraints
- `CLAUDE.md` — km-core `ontologyDir` requirement for any `resolveEntities` CLI; proxy
  endpoint/port facts (`/api/complete` on 12435, NOT 3033); submodule build pipeline.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Measurement-span plumbing** (`scripts/measurement-start.mjs` / `measurement-stop.mjs`,
  `getActiveMeasurement()` from the proxy dist): the snapshot + record/replay lifecycle
  hooks into the existing start/stop CLIs and `active-measurement.json` rather than a new
  daemon (D-09).
- **`lib/experiments/store.mjs` + `run-write.mjs`:** snapshot/fixture references can be
  persisted as attributes on the existing Run entity — no new KB store needed.
- **Proxy env resolution pattern** (`scripts/backfill-raw-observations.mjs`, referenced by
  measurement-start): reuse the same `LLM_PROXY_DATA_DIR` / dist-dir resolution for the
  sandbox data dir (D-04).

### Established Patterns
- **Proxy `/api/complete` on port 12435** is the single LLM boundary (per CLAUDE.md) — the
  natural, low-count record/replay tap for the LLM channel.
- **km-core LevelDB is single-owner** — a byte copy (D-02) must be taken while no writer
  holds the DB (snapshot at span open, before the run mutates it; restore into a sandbox dir
  so the live single-owner invariant is never violated — D-04).
- **Operator CLIs import the measurement surface from the LOCAL proxy dist**
  (`_work/rapid-llm-proxy/dist`), not the pinned tarball — keep one reader.

### Integration Points
- LLM record/replay: inside `_work/rapid-llm-proxy/proxy-bridge/server.mjs` (record on the
  response path; on replay, serve from fixture or hard-fail).
- Snapshot capture / restore: new module(s) invoked by `measurement-start.mjs`.
- Fixture archival + Run linkage: `measurement-stop.mjs` → `lib/experiments/run-write.mjs`.

### ⚠ Risk / open research
- **WebSearch/WebFetch/MCP taps (D-08):** these tools execute in the **Claude Code harness**,
  not through `rapid-llm-proxy`, so there is no in-repo chokepoint to intercept them the way
  there is for LLM. Recording/replaying them may require harness-level hooks that may not be
  available. Research MUST resolve the tap point before planning commits to all five channels;
  if a channel has no viable tap, fall back to "record interface present, replay hard-fails as
  not-yet-captured" and flag it — do NOT silently drop a channel (SC-4 comparability).
- **Clock capture:** `Date.now()`/`new Date()` are pervasive; a faithful replay clock needs a
  deterministic interception strategy (Claude's discretion, D-set above).

</code_context>

<specifics>
## Specific Ideas

- "Byte-for-byte" is taken literally for the KB via the LevelDB binary copy (D-02), and for
  the workspace via git SHA + patch (D-03) — semantic equivalence is not enough for SC-2.
- The rig must be **safe to run casually**: the default restore path can never damage the
  live session or KB (D-04). This is a hard constraint, not a nicety.
- Replay must be **honest about gaps**: a missing fixture fails loudly (D-06) rather than
  quietly degrading comparability.
</specifics>

<deferred>
## Deferred Ideas

- **UI for browsing/diffing snapshots** — a dashboard view of RunSnapshots and replay diffs
  is a separate capability; belongs in a future dashboard phase, not here.
- **Cross-machine snapshot portability** — the LevelDB binary copy is same-host; a portable
  format for sharing snapshots across machines is out of scope for v1.

### Reviewed Todos (not folded)
Four todos surfaced by phase-keyword matching, all reviewed and NOT folded — none concern
snapshot/replay (matched only on generic keywords like "phase"/"run"/"live"):
- `2026-05-23-orphan-digest-observation-refs.md` — data-integrity of digest refs; unrelated.
- `2026-06-10-okm-express-api-contract-bridge.md` — OKM/unified-viewer API contract; unrelated.
- `2026-06-10-sub-agent-dashboard-observability-gap.md` — sub-agent obs routing; unrelated.
- `2026-06-14-online-filter-hides-ck-truncates-trace.md` — unified-viewer filter; unrelated.

</deferred>

---

*Phase: 67-reproducibility-replay-rig*
*Context gathered: 2026-07-02*
