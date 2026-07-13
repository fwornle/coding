# Phase 87: Interactive Spans & Branch Avenues - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-11
**Phase:** 87-interactive-spans-and-branch-avenues
**Areas discussed:** Avenue launch & variant matrix, Merge semantics, Comparison view, Origin snapshot fidelity

---

## Avenue launch & variant matrix

### Launch surface
| Option | Description | Selected |
|--------|-------------|----------|
| Dashboard fork action | Fork button in Control Center; backend calls experiment-run.mjs | |
| CLI / spec file | CLI/YAML drives creation; dashboard displays only | |
| Both — UI wraps CLI | Dashboard fork is primary UX, thin wrapper over a documented CLI/spec | ✓ |

### Variant matrix
| Option | Description | Selected |
|--------|-------------|----------|
| Pick individual variants | Curated small set of explicit avenues | |
| Full matrix sweep | Cross-product of chosen dimensions | |
| Both — curated default, sweep opt-in | Individual picks by default; sweep toggle expands to cross-product with count/cost preview | ✓ |

**Notes:** Sweep must show a count + cost/token preview before launch (matrix-explosion guardrail).

---

## Merge semantics of avenue branches

### Merge model
| Option | Description | Selected |
|--------|-------------|----------|
| Adoptable — user can merge a winner | Branches hold real code; track merged/unmerged/conflicts; promote winner to main | ✓ |
| Informational only | Read-only git merge signal; system never merges | |
| Throwaway isolation | Branches just isolate re-runs; prune after comparison | |

### Branch lifecycle
| Option | Description | Selected |
|--------|-------------|----------|
| Persist until explicitly pruned | Branches stay until a prune action; data in main .data regardless | ✓ |
| Persist with auto-expiry | Sweeper prunes after N days | |
| Prune on completion | Remove branch once data captured | |

---

## Comparison view (N-way vs pairwise)

### Compare view
| Option | Description | Selected |
|--------|-------------|----------|
| N-way group + drill to pairwise | Origin-grouped ranked panel; select two → 86-04 diff viewer | ✓ |
| Pairwise only (reuse 86-04) | Runs selectable, compare two at a time | |
| New N-way matrix only | Dense avenues×metrics matrix, no trajectory drill-down | |

### Rank axis
| Option | Description | Selected |
|--------|-------------|----------|
| Outcome score | Rank by success/outcome score; tokens/quality/wallclock secondary | ✓ |
| Tokens / cost | Rank by cost first | |
| User-selectable / no fixed default | Every column sortable, no privileged axis | |

---

## Origin snapshot fidelity

### Snapshot
| Option | Description | Selected |
|--------|-------------|----------|
| Reuse Phase 67 full RunSnapshot | SHA + workspace + KB + processOverrides + prompt + env via repro-restore rig | ✓ |
| Lighter capture (SHA + prompt + config) | Skip full KB/workspace snapshot | |
| You decide (per fairness needs) | Minimal snapshot that still guarantees fairness | |

### Varied axes (multi-select)
| Option | Description | Selected |
|--------|-------------|----------|
| Agent (claude/copilot/opencode/mastra) | Swap the coding agent | ✓ |
| Model (opus/sonnet/gpt-5/haiku…) | Swap the underlying model | ✓ |
| Framework | Swap the framework/harness dimension | ✓ |
| Prompt variants | Vary the initial prompt text | (deferred) |

**User's addition (free text):** Also vary **knowledge-injection on/off** — toggle injected observations/digests/insights/VKB info to see if injection improves/worsens outcomes. Clarified that **"framework" = SDD framework** (gsd, spec-workflow, … or no framework at all), not a code framework.

---

## Claude's Discretion
- Avenue execution isolation & parallelism (worktree-per-branch vs sequential; concurrency limits).
- Cross-branch measurement-data writeback mechanism (no collision, no double-counting).
- How the knowledge-injection on/off toggle is wired per-agent (reuse v6.0 injection seam).

## Deferred Ideas
- Varying the initial prompt text across avenues (prompt-variant experiments) — separate capability / future phase.
- The 18 phase-matched pending todos (VKB/observability/data-integrity, scores 0.4–0.6) — reviewed, not folded; unrelated to spans/avenues.
