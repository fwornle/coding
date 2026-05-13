# Agent Persistent Memory Files

**Type:** Fault

Agent Persistent Memory Files is part of the semantic analysis and knowledge management infrastructure

# Agent Persistent Memory Files

## What It Is

Agent Persistent Memory Files is a file-based memory store used by the agent runtime to persist context across conversations. It lives under `/Users/Q284340/.claude/projects/-Users-Q284340-Agentic-coding/memory/` and is structured as a flat directory of single-topic markdown files (`feedback_*.md`, `reference_*.md`, `project_*.md`, `user_*.md`) indexed by a top-level `MEMORY.md` manifest. The single source observation places it inside the project's semantic analysis and knowledge management infrastructure, and the working-memory insight (confidence 0.6) corroborates this: individual files keyed by type, surfaced through an index, with at least one known entry (`feedback_stale_runbooks_telemetry.md`) already on disk.

![Agent Persistent Memory Files — Architecture](images/agent-persistent-memory-files-architecture.png)

This is not a database; it is a deliberately plain-text, human-readable store. The choice to keep memory as discrete markdown files — rather than embedding it in a graph database alongside the UKB knowledge graph at `.data/knowledge-graph/` — separates *agent self-context* (preferences, feedback, project state) from *codebase-derived knowledge* (entities and relations harvested by the semantic-analysis pipeline). The two stores serve different lifecycles: knowledge graph entries can be regenerated from code, whereas memory files capture irrecoverable user intent.

## Architecture and Design

The architecture is an **index + leaf-file** pattern. `MEMORY.md` is the always-loaded index — a curated list of one-line pointers to topic files — and the topic files themselves are the leaves carrying frontmatter (`name`, `description`, `type`) plus the actual memory body. This is a classic manifest-and-blobs design: cheap to scan, cheap to update, and degrades gracefully if a leaf file is missing or malformed because the index entry still survives.

![Agent Persistent Memory Files — Class](images/agent-persistent-memory-files-class.png)

Four memory *types* (`user`, `feedback`, `project`, `reference`) act as a lightweight taxonomy. The taxonomy is enforced by naming convention (`feedback_*.md`, `reference_*.md`) and by the `type:` field in frontmatter, not by code — a deliberate trade-off that keeps the store inspectable with `cat` and `ls` at the cost of having no schema validator. The 200-line cap on `MEMORY.md` (already breached at 205 lines in the current snapshot) is the only hard structural constraint, and it is enforced by the agent runtime truncating reads rather than by any write-time check.

## Implementation Details

![Agent Persistent Memory Files — Sequence](images/agent-persistent-memory-files-sequence.png)

A write is a two-step operation: (1) create or update a leaf file with the frontmatter block followed by the body, then (2) add or update a one-line pointer in `MEMORY.md` of the form `- [Title](file.md) — one-line hook`. Reads are inverted — `MEMORY.md` is loaded automatically at conversation start, and individual leaf files are read on demand when their hook looks relevant to the current task. There is no caching layer, no merge logic, no concurrency control; the model is single-writer (the agent) operating on a local filesystem.

The observations do not name any code module that manages this store. From the directory layout and the agent instructions, the "implementation" appears to be policy rather than code: the agent itself follows the read/write protocol, and the host filesystem provides durability. This is why guidance lives in agent prompts (the system reminder defines the format) rather than in a library — there is no `MemoryWriter.ts` to point to in the observations.

## Integration Points

The most direct integration is with the conversation runtime, which loads `MEMORY.md` into context on every prompt. Beyond that, the observations and working memory connect this store to the broader knowledge-management surface: the UKB pipeline writes derived entities to `.data/knowledge-graph/`, the observation pipeline writes to `~/Agentic/coding/.observations/observations.db`, and the agent memory directory sits alongside both as a third, agent-private store. They share a project context (`coding`) but no shared schema or sync — memory files are intentionally isolated from the graph database.

![Agent Persistent Memory Files — Use-cases](images/agent-persistent-memory-files-use-cases.png)

Cross-references between memory files are by relative-path markdown links (e.g. `[feedback_green_nodes.md](feedback_green_nodes.md)`), so the store is internally navigable without any indexing service. Beyond that, the source observations do not describe a programmatic interface that other system components call — so any integration with constraint monitoring, statusline rendering, or the semantic-analysis MCP server would have to be inferred rather than documented, and that is outside the grounded evidence.

## Usage Guidelines

Write memory only for information that survives the current conversation — user role, feedback that should not need repeating, project state with a *why*, and pointers to external systems. Do **not** persist code patterns, git history, file paths, debugging recipes, or anything already in `CLAUDE.md`; those are derivable from the live repo and will rot in memory. Each memory file owns one topic and uses the frontmatter block as its self-description; `MEMORY.md` entries stay to one line under ~150 characters so the index does not exceed its 200-line load window.

Treat every memory record as a point-in-time claim. Before acting on a memory that names a function, flag, or file path, verify the symbol still exists — memories outlive refactors. When a recalled memory conflicts with current observation, trust the observation and update or delete the stale memory rather than acting on it. The store has no validator, so the agent is the only safeguard against duplicates, contradictions, and drift.

---

**Architectural patterns identified:** index-and-leaf manifest pattern; convention-over-configuration typing via filename prefix + frontmatter; separation of agent self-context from code-derived knowledge.

**Design decisions and trade-offs:** plain markdown over a database (inspectability, zero infra, at the cost of no schema enforcement or concurrency control); flat directory over hierarchy (simpler addressing, requires discipline to avoid duplicates); always-loaded index capped at ~200 lines (predictable context cost, but creates pressure to move detail out of `MEMORY.md` — already breached at 205 lines).

**System structure insights:** the store is policy-driven rather than code-driven — no implementing class is named in the observations, the contract lives in agent instructions; cross-file linking is by relative markdown paths, making the store self-navigable without an index service.

**Scalability considerations:** the 200-line ceiling on `MEMORY.md` is the binding constraint, not file count or total bytes; current state (205 lines) shows the index is already at its limit and needs leaf-file consolidation; leaf-file count scales freely because they are read on demand.

**Maintainability assessment:** high inspectability (any editor reads it), low enforcement (typos in frontmatter, duplicate entries, and stale pointers can accumulate silently); maintenance burden falls on the agent's read-before-write discipline and on periodic pruning of stale entries — there is no automated GC evident in the observations.

---

*Generated from 1 observations*
