# Phase 71: Experiment KB & Task Taxonomy - Context

**Gathered:** 2026-06-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Materialize every coding-agent task run as an **independent, queryable km-core entity** with rich tags, backed by a **new ontology** (`Experiment / Run / Route / Step / Decision / Outcome / Report`), and enforce a **curated task taxonomy v0** so that "compare runs" becomes "run a query." (KB-01, KB-02, KB-03)

**In scope:**
- A km-core ontology defining all 7 experiment classes + their relations (KB-01).
- A Run-write path: each measurement span, at close, becomes a Run entity carrying tags (`task_hash, task_class, agent, model, framework, spec_level, snapshot_id, trace_id`) sourced from `token_usage` + span data (KB-02).
- A task taxonomy v0 — closed 6-class enum (`refactor, bugfix, new-feature, migration, debug, docs`) with definitions (KB-03).
- Enforcement: a run cannot be *counted* without a `task_class` (SC-4).
- A coding-side run-close orchestrator that wires the currently-unwired `stopMeasurement()` to derive/prompt → enforce → write.
- A query helper (CLI/SDK) + 2-3 canned queries proving comparisons-as-queries works.
- A `coding experiments classify` resolver for the quarantine backlog.

**Out of scope (other phases / deferred):**
- `goal_sentence` capture + deterministic syntactic route heuristics → Phase 72.
- Semantic `goal_aligned_ratio` + 5-dimension success scoring → Phase 73.
- `Report` entity population + saved-query workflow + Performance dashboard tab → Phase 74 (KB-04, DASH-*).
- Populating `Route / Step / Decision` instances — schema-only this phase; their data sources land in Phases 72-73.
- `snapshot_id` source (the Phase-67 reproducibility/replay rig) — tag exists in schema, written null until 67 lands.
- Any change to the Phase-68 `token_usage` schema or `getActiveMeasurement()` contract (consumed as-is).
- Policy automation / auto-routing — v7.5.

</domain>

<decisions>
## Implementation Decisions

### Run KB store location & ontology packaging
- **D-01 (LOCKED):** Run entities live in a **dedicated, independent km-core GraphKMStore** (e.g. `.data/experiments/`), NOT the shared `.data/knowledge-graph/` observation store. Rationale: the shared store is actively churned by wave-analysis fuzzy-name dedup, the 5s-debounced exporter, and the `persistence.js` hydrate patch (per MEMORY.md) — those would mangle immutable, append-only Run records. There is no existing precedent for a second store, so this is new plumbing (km-core requires an explicit `ontologyDir` — see canonical refs / CLAUDE.md km-core rule).
- **D-02 (LOCKED):** The 7 classes ship as a **new standalone lower ontology file** (e.g. `.data/ontologies/experiment-ontology.json`, `extends: "upper"`), loaded as the dedicated store's `ontologyDir`. Experiment classes are kept OUT of `coding-ontology.json` so the obs-api / wave-analysis classifier never sees them (no auto-classification noise). Self-contained, matching the dedicated-store decision.
- **D-03 (LOCKED):** Queryability for this phase = **query helper + a few canned queries**. Ship a thin CLI/SDK reader over the experiment store (e.g. `coding experiments query --task-class=refactor --agent=claude`) PLUS 2-3 pre-baked example queries (e.g. "runs by task_class", "agent vs model cost") as a smoke test that the tags actually support meaningful comparison. The Phase-74 dashboard builds on top.
- **D-04 (LOCKED):** **Experiment = implicit/optional grouping.** Every Run stands alone and is queryable on its own tags (D2 single-Run principle). An Experiment is an OPTIONAL named grouping a user may attach later (e.g. "opus-vs-haiku-refactor-sweep"); it is NOT required to write a Run. The class + relation may ship in the ontology but is populated lazily/never this phase — the run-write path must not be blocked by experiment ceremony.

### task_class enforcement
- **D-05 (LOCKED):** **Auto-derive for /gsd runs, prompt for freeform.** /gsd runs infer a candidate `task_class` from phase/PLAN context and confirm; freeform runs prompt the operator at "Stop measurement." Most runs are /gsd → near-zero friction; explicit where context is absent.
- **D-06 (LOCKED):** **Quarantine queue (not silent)** for background/headless runs where no human is present and auto-derivation can't confidently resolve a class. The Run IS written but with `task_class='unclassified'` + a pending flag, and is **EXCLUDED from all query/comparison results** until resolved. Honors SC-4's "not optional metadata" (tracked + blocked from polluting comparisons) without stranding the close path or crashing autonomous/cron runs. NOT a hard block (would hang headless closes), NOT a silent best-effort guess (would pollute `WHERE task_class=X`).
- **D-07 (LOCKED):** **Close orchestration lives coding-side.** A coding-repo run-close path (CLI subcommand e.g. `coding measure stop`, auto-invoked at /gsd run-end) calls the proxy's `stopMeasurement()`, then runs derive/prompt + enforcement + Run-write against the experiment store. The generic `rapid-llm-proxy` submodule stays free of task-taxonomy / experiment-store knowledge (Phase-70 "proxy stays generic" principle).
- **D-08 (LOCKED):** **Quarantine resolver = `coding experiments classify` CLI + surfaced count.** Lists pending Runs, lets the operator assign `task_class` (re-including them in queries). A pending count is surfaced (e.g. at session start or in the close summary) so the backlog doesn't rot. Self-contained in Phase 71; a richer dashboard view is deferred to Phase 74.

### Taxonomy shape
- **D-09 (LOCKED):** **Closed enum, exactly 6 classes** — `{refactor, bugfix, new-feature, migration, debug, docs}`. Anything else is rejected at write (no free strings, no inline "other"). Maximizes query consistency (the whole point: `WHERE task_class=X` must partition cleanly). Adding a 7th class is a deliberate, versioned taxonomy change (v1), not an ad-hoc per-run decision.
- **D-10 (LOCKED):** **Dedicated taxonomy config file** is the single source of truth (e.g. `config/task-taxonomy.yaml` or `.json`): each class's id + human-readable definition + disambiguation examples. The write-path validator and the auto-derive logic both read it; docs render from it. Versioning to v1 is a single edit. Decoupled from the ontology schema.
- **D-11 (LOCKED):** **Deterministic keyword heuristic** for /gsd derivation (zero-LLM). Maps phase name / goal-sentence verbs to a class using the taxonomy file's disambiguation hints (e.g. "migration"→migration, "fix"→bugfix, "add/build"→new-feature). Cheap, transparent, consistent with Phase-72's zero-LLM route ethos. Operator confirms/overrides the guess. (NOT an LLM auto-classifier — avoids an unnecessary per-close LLM dependency.)

### Entity population depth
- **D-12 (LOCKED):** **Populate Run + a basic Outcome stub only.** Define all 7 classes in the ontology (satisfies KB-01), but this phase WRITES only Run entities (with tags) + a basic Outcome stub (token totals / closed-state). `Route / Step / Decision / Report` stay schema-only stubs until their phases (72-74) populate them. Avoids materializing data Phase 71 has no source for (route/score) and a per-run Step explosion in the store.
- **D-13 (LOCKED):** **All 8 tags always written; null/empty where no source.** The Run schema carries `task_hash, task_class, agent, model, framework, spec_level, snapshot_id, trace_id` always. Tags without a source this phase (notably `snapshot_id` → Phase-67 repro rig; `spec_level`) are written explicitly empty/null, not omitted — so later phases backfill into a stable, already-present field with no schema churn and early Runs share the shape of later Runs.
- **D-14 (LOCKED):** **Run keyed by `task_id`, with refreshable totals.** One Run per measurement span; stable id = the span's `task_id` → idempotent (re-close updates, never duplicates). Token aggregates are (re)computed by querying `token_usage WHERE task_id=X`, so a later proxy timestamp-join backfill + a cheap refresh recomputes complete totals. The Run-write is idempotent and self-healing against late-attributed orphan rows.

### Claude's Discretion (delegated to research/planning with guardrails)
- **Per-tag sourcing table** — research determines tag by tag which have a cheap source now (e.g. `task_hash` from goal_sentence/prompt, `framework` from agent type, `trace_id`) vs genuinely deferred (`snapshot_id`, `spec_level`). Guardrail: all 8 exist in the schema regardless (D-13).
- **Dedicated-store wiring mechanics** — exact `ontologyDir` resolution, LevelDB path, persistence/export config, and whether the experiment store needs its own launchd/persistence handling. Guardrail: must NOT share the `.data/knowledge-graph/` store or its churning paths (D-01).
- **`token_usage` aggregation helper shape** — no per-task aggregator exists yet (only `scripts/backfill-task-id-by-timestamp.mjs`). Build a thin `WHERE task_id=X` aggregation for the Run-write + refresh. Guardrail: read the proxy-owned DB read-only; do not add a second writer.
- **Heuristic verb→class mapping table** — the exact keyword map for D-11 derivation. Guardrail: driven by the taxonomy config file's disambiguation hints (D-10).
- **Outcome stub contents** — what minimal fields the Outcome stub carries at v0 (token totals + closed-state). Guardrail: no route/score data (those are Phases 72-73).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements + roadmap (acceptance source)
- `.planning/REQUIREMENTS.md` — KB-01, KB-02, KB-03 (and KB-04/DASH-* for downstream awareness).
- `.planning/ROADMAP.md` §"Phase 71: Experiment KB & Task Taxonomy" — goal + 4 success criteria; depends on Phase 68.
- `.planning/notes/v73-perf-measurement-exploration.md` — the design rationale: **D2** (single-Run-as-unit, comparisons-as-queries, taxonomy required, tag enforcement at run-end), D1 (snapshot/replay → `snapshot_id`), D3 (`goal_sentence`, Phase 72), the KB schema sketch (`Experiment/Run/Route/Step/Decision/Outcome/Report`).

### The Phase-68 TELEM contract (the storage + span surface the Run-write SOURCES from — consume as-is)
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts` — `TokenUsageRow` type + columns (`task_id, agent, model, provider, input/output/total_tokens, granularity_tier, reasoning_tokens, …`); the proxy-owned `.data/llm-proxy/token-usage.db` is the token source. Read-only from coding side.
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/measurement-span.ts` — `SpanRecord` shape (`{task_id, started_at, ended_at?, goal_sentence?, meta?}`), `getActiveMeasurement()` / `resolveLiveTaskId()` (single span reader), and **`stopMeasurement()` (`:207`)** — the archive-to-`.data/measurements/<task_id>.json` function that is currently EXPORTED BUT UNWIRED (no call site in coding); D-07's close orchestrator wires it.
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/index.ts` — barrel re-exports of the measurement-span SDK surface (`startMeasurement, stopMeasurement, getActiveMeasurement, resolveLiveTaskId, …`).
- `scripts/backfill-task-id-by-timestamp.mjs` — the timestamp-join sweep that re-attributes orphan `token_usage` rows AFTER close (the reason D-14 needs refreshable totals); also the canonical host-side `better-sqlite3` open pattern for `token-usage.db`.
- `.data/measurements/` — archived span files (e.g. `telem-live-68.json`); the Run-write reads these for span metadata.
- `.planning/phases/68-foundational-token-attribution-storage/68-VERIFICATION.md` — the verified TELEM contract (columns, single-reader, resolution rules).

### km-core ontology surface (where KB-01 lands)
- `.data/ontologies/coding-ontology.json` — reference shape for a lower ontology: top-level `meta` (`name/version/description/extends`) + `classes` (each with `description`, `extends`, `relationships`, `properties`). Model the new `experiment-ontology.json` on this.
- `.data/ontologies/upper.json` — the upper ontology that `experiment-ontology.json` extends.
- `.data/ontologies/schemas/ontology-schema.json` — JSON Schema validating ontology files.
- **CLAUDE.md km-core rule** — any CLI/service importing `resolveEntities` from `@fwornle/km-core` MUST construct `GraphKMStore` with an explicit `ontologyDir` (else default-class resolution throws). Add an acceptance grep for `ontologyDir` in any new CLI plan. Also: km-core node_modules `persistence.js` hydrate patch + the snapshot-restore-on-restart caveat (a reason D-01 keeps Runs out of the churned store).

### Prior-phase precedent (locked patterns this phase builds on)
- `.planning/phases/70-opencode-mastra-token-adapters/70-CONTEXT.md` — Phase-70 "proxy stays generic" principle (D-07 mirrors it); generic `agent` envelope passthrough; the proxy-as-sole-`token_usage`-owner model.
- `.planning/phases/69-claude-copilot-token-adapters/69-CONTEXT.md` — task_id resolution (live + timestamp-join backfill), host-side `better-sqlite3` write/read patterns, failure-isolation conventions.

### Project conventions
- `CLAUDE.md` — rapid-llm-proxy endpoint/port notes (`/api/complete` on 12435, NOT 3033), `no-console-log` (use `process.stderr.write`), submodule build pipeline (`npm run build` + docker rebuild for `integrations/*`), launchd daemon conventions.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`stopMeasurement()` (rapid-llm-proxy `measurement-span.ts:207`)** — exists, atomic temp-file + rename archive, but has NO call site in coding. D-07's coding-side close orchestrator is its first consumer.
- **`scripts/backfill-task-id-by-timestamp.mjs`** — canonical host-side `better-sqlite3` open pattern for `token-usage.db` + the orphan re-attribution logic that makes refreshable Run totals (D-14) necessary.
- **`.data/ontologies/coding-ontology.json` + `upper.json` + `ontology-schema.json`** — the template + validation surface for the new `experiment-ontology.json`.
- **`@fwornle/km-core` `GraphKMStore`** — the store class; instantiated repo-wide with `ontologyDir: path.join(repoRoot, '.data', 'ontologies')`. The experiment store points its `ontologyDir` at the experiment ontology instead.

### Established Patterns
- **Single shared GraphKMStore is the norm** (`.data/knowledge-graph/leveldb`, one instance reused across obs-api/wave-controller/coordinator/tools). Phase 71 deliberately BREAKS this norm with a second store (D-01) — no precedent exists, so the wiring (ontologyDir, LevelDB path, persistence) is net-new and must be planned explicitly.
- **Proxy is the sole `token_usage.db` writer.** Coding reads it read-only; never add a second writer (the experiment store is a separate km-core store, not a SQLite writer).
- **km-core needs explicit `ontologyDir`** or default-class resolution throws (CLAUDE.md). Acceptance grep for `ontologyDir` is mandatory in the CLI plan.

### Integration Points
- `stopMeasurement()` ← new coding-side close orchestrator (CLI `coding measure stop` + /gsd run-end hook).
- Run-write path → reads `.data/measurements/<task_id>.json` (span) + `token_usage WHERE task_id=X` (aggregate) → writes Run into the dedicated experiment store.
- Taxonomy config file ← read by the write-path validator (enforce closed-6) AND the deterministic derive heuristic.
- `coding experiments query` / `coding experiments classify` CLIs → read/update the experiment store.

</code_context>

<specifics>
## Specific Ideas

- The whole phase exists to make **comparisons-as-queries** real (notes D2). The tag set is the product surface — `task_class` is the partitioning key, so its enforcement (D-06/D-09) and curation (D-10) are the load-bearing decisions, not the ontology shape.
- "Cannot close without a task_class" (SC-4) is satisfied by **quarantine, not hard block** (D-06): the requirement is "not optional metadata," interpreted as "never silently dropped and excluded from comparisons until resolved" — which is honored without crashing headless closes.
- The dedicated store (D-01) is a deliberate departure from the repo's single-store norm, driven by concrete MEMORY.md-documented failure modes (fuzzy-name dedup, exporter churn, hydrate-patch staleness). This is the one place where reusing existing infra was explicitly rejected.
- A live verification (mirroring Phase 69/70's blocking human-verify) is expected: prove a real run close lands a Run in the experiment store with the enforced `task_class` + correct token totals, and that a headless run with no class lands in the quarantine queue (excluded from queries).

</specifics>

<deferred>
## Deferred Ideas

- **Route / Step / Decision instance population** — schema-only this phase (D-12); data sources land in Phases 72-73.
- **`Report` entity + saved-query workflow** — Phase 74 (KB-04).
- **Richer quarantine/pending-runs dashboard view** — Phase 71 ships the CLI resolver (D-08); the dashboard view is Phase 74.
- **`snapshot_id` population** — needs the Phase-67 reproducibility/replay rig; tag written null until then (D-13).
- **Taxonomy v1 (>6 classes)** — closed-6 is deliberate (D-09); expansion is a future versioned change if query evidence demands it.
- **Experiment grouping population** — class may ship but instances are lazy/never in v0 (D-04).

### Reviewed Todos (not folded)
All phase-matched todos are weak generic-keyword matches (score 0.6 on "phase"/"ontology"/"entities"/"agent"/"level") and none concern the experiment KB, Run-write path, or task taxonomy — same assessment Phase 70 made:
- `2026-06-10-okm-express-api-contract-bridge.md` — OKM Express ↔ unified-viewer API contract mismatch. Cross-system API gap, not experiment KB.
- `2026-06-10-sub-agent-dashboard-observability-gap.md` — worktree-isolated sub-agent observations don't reach dashboard. Observation-pipeline gap.
- `2026-06-14-online-filter-hides-ck-truncates-trace.md` — online learning-source filter / ancestry traces in unified-viewer. VKB filter concern.
- `2026-06-14-vkb-evidence-pattern-filter-asymmetry-and-ontology.md` — VKB Evidence/Pattern filter asymmetry + ontology cross-domain bleed. Observation-KB ontology, not the experiment ontology.

</deferred>

---

*Phase: 71-experiment-kb-task-taxonomy*
*Context gathered: 2026-06-23*
