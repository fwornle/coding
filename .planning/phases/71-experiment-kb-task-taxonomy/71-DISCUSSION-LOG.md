# Phase 71: Experiment KB & Task Taxonomy - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-23
**Phase:** 71-experiment-kb-task-taxonomy
**Areas discussed:** Run KB store location, task_class enforcement, Taxonomy shape, Entity population depth

---

## Run KB store location

### Where should Run entities physically live?
| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated experiment store | Independent GraphKMStore (e.g. `.data/experiments/`), isolated from wave-analysis dedup/exporter/hydrate-patch churn | ✓ |
| Shared `.data/knowledge-graph/` store | Free VKB visualization + reuses infra, but Runs risk being deduped/rewritten | |
| Shared store, isolated namespace | One store + class-filter exclusion from churning paths — fragile | |

### How should the 7-class ontology be packaged?
| Option | Description | Selected |
|--------|-------------|----------|
| New standalone ontology file | `experiment-ontology.json` (extends upper), loaded as the dedicated store's ontologyDir; kept out of the obs-api classifier's view | ✓ |
| Append to `coding-ontology.json` | Single file, but couples experiment schema to observation schema + classifier noise | |
| You decide | Defer packaging to research | |

### What must queryability look like at end of Phase 71?
| Option | Description | Selected |
|--------|-------------|----------|
| CLI/SDK query helper | Thin reader over the experiment store | |
| Raw store access only | Defer all query ergonomics to Phase 74 | |
| Query helper + canned queries | Helper PLUS 2-3 pre-baked example queries as a smoke test | ✓ |

### What is an Experiment for v0?
| Option | Description | Selected |
|--------|-------------|----------|
| Implicit/optional grouping | Runs stand alone; Experiment is optional named grouping, not required to write a Run | ✓ |
| Every Run needs a parent Experiment | Re-introduces the predefined-shape friction D2 rejected | |
| Defer Experiment entirely | Define class, write zero instances | |

**User's choice:** Dedicated store + standalone ontology + query-helper-with-canned-queries + implicit Experiment.
**Notes:** Store separation driven by concrete MEMORY.md failure modes (fuzzy-name dedup, exporter churn, hydrate-patch staleness). The one place reusing existing infra was explicitly rejected.

---

## task_class enforcement

### How is task_class collected when a run closes?
| Option | Description | Selected |
|--------|-------------|----------|
| Auto-derive /gsd, prompt freeform | Infer+confirm for /gsd; prompt operator for freeform | ✓ |
| Always prompt explicitly | Mandatory question on every run | |
| LLM auto-classify + confirm | Adds an LLM call + cost to every close | |

### What happens on background/headless runs that can't auto-resolve?
| Option | Description | Selected |
|--------|-------------|----------|
| Quarantine queue, not silent | Run written `task_class='unclassified'` + pending flag, EXCLUDED from queries until resolved | ✓ |
| Hard block the close | Span won't archive — risks hanging headless closes / stale spans | |
| Best-effort derive, flag low-confidence | Never blocks, but a wrong silent guess pollutes queries | |

### Where does the close orchestration live?
| Option | Description | Selected |
|--------|-------------|----------|
| Coding-side run-close orchestrator | CLI `coding measure stop`, auto-invoked at /gsd end; proxy stays generic | ✓ |
| Bake into proxy `stopMeasurement()` | Couples generic proxy to coding's taxonomy/store | |
| Dashboard endpoint only | /gsd & headless runs have no dashboard in the loop | |

### How do quarantined Runs get resolved in Phase 71?
| Option | Description | Selected |
|--------|-------------|----------|
| CLI command + surfaced count | `coding experiments classify` + pending count surfaced | ✓ |
| Auto-prompt at next interactive close | Couples backlog clearing to doing another run | |
| Defer resolver to Phase 74 | Pending Runs unresolvable for several phases | |

**User's choice:** Auto-derive+prompt; quarantine queue; coding-side orchestrator; CLI resolver + count.
**Notes:** SC-4 "cannot close without a task_class" interpreted as "never silently dropped / excluded from comparisons until resolved" — honored without crashing autonomous/cron closes.

---

## Taxonomy shape

### Closed set or extensible?
| Option | Description | Selected |
|--------|-------------|----------|
| Closed enum, 6 classes | `{refactor, bugfix, new-feature, migration, debug, docs}`; anything else rejected | ✓ |
| 6 seeds + escape hatch | Inline custom values — fragments the query space | |
| Closed 6 + explicit 'other' bucket | Closed enum with a fixed catch-all member | |

### Where do the 6 definitions live?
| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated taxonomy config file | One artifact: id + definition + disambiguation; read by validator + derive + docs | ✓ |
| Inline in the experiment ontology | enum + per-value description on the Run class | |
| Config file + ontology enum references it | Source of truth in config, enum generated/synced — adds a sync step | |

### How should /gsd auto-derive determine the class?
| Option | Description | Selected |
|--------|-------------|----------|
| Deterministic keyword heuristic | Zero-LLM verb→class mapping using taxonomy hints; operator confirms | ✓ |
| Explicit task_class field in PLAN/ROADMAP | Most accurate, but a bigger artifact change | |
| Heuristic now, explicit field optional later | Incremental path to precision | |

**User's choice:** Closed-6 enum; dedicated config file as source of truth; deterministic heuristic derive.
**Notes:** Adding a 7th class = a deliberate versioned (v1) change, not ad-hoc. Heuristic consistent with Phase-72's zero-LLM ethos.

---

## Entity population depth

### What does Phase 71 actually populate?
| Option | Description | Selected |
|--------|-------------|----------|
| Run + Outcome only; rest schema-only | Define all 7, write Run + basic Outcome stub; Route/Step/Decision/Report schema-only | ✓ |
| Full per-run Step/Decision graph now | Richest, but no route/score source yet + Step explosion | |
| Run only; Outcome too deferred | Leanest, but Outcome (token totals) IS available now | |

### How to handle tags without a live source?
| Option | Description | Selected |
|--------|-------------|----------|
| Write all 8, null/empty where no source | Schema always carries 8 tags; unsourced written null — no later schema churn | ✓ |
| Only write sourced tags now | Leaner rows, but Run shape changes across phases | |
| You decide per-tag | Document a sourcing table; all 8 in schema regardless | |

### Run identity + late re-attributed rows?
| Option | Description | Selected |
|--------|-------------|----------|
| Run keyed by task_id, refreshable totals | One Run per span; totals recomputed via `WHERE task_id=X`; idempotent + self-healing | ✓ |
| Write once at close, accept snapshot | Late-backfilled rows silently missing | |
| Defer Run-write to a post-backfill sweep | Most accurate, but lag before Run is queryable + needs a sweep | |

**User's choice:** Run + Outcome-stub only; all 8 tags (null where no source); Run keyed by task_id with refreshable totals.
**Notes:** Refreshable totals required because the proxy timestamp-join backfill re-attributes orphan rows after close.

---

## Claude's Discretion

- Per-tag sourcing table (which tags have a cheap source now vs deferred; all 8 in schema regardless).
- Dedicated-store wiring mechanics (ontologyDir resolution, LevelDB path, persistence/export, launchd if needed).
- `token_usage` aggregation helper shape (`WHERE task_id=X`; read-only, no second writer).
- Heuristic verb→class mapping table (driven by the taxonomy config file).
- Outcome stub contents (token totals + closed-state; no route/score data).

## Deferred Ideas

- Route/Step/Decision instance population → Phases 72-73.
- `Report` entity + saved-query workflow → Phase 74 (KB-04).
- Richer quarantine/pending-runs dashboard view → Phase 74.
- `snapshot_id` population → needs Phase-67 repro rig.
- Taxonomy v1 (>6 classes) → future versioned change if evidence demands.
- Experiment grouping population → lazy/never in v0.
