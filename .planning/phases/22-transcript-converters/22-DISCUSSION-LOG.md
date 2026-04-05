# Phase 22: Transcript Converters - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-03
**Phase:** 22-transcript-converters
**Areas discussed:** CLI interface, Normalization architecture, LLM routing, Batch processing
**Mode:** auto (all decisions auto-selected)

---

## CLI Interface Design

| Option | Description | Selected |
|--------|-------------|----------|
| Single CLI with subcommands | One script, multiple subcommands (claude, copilot, specstory, batch) | ✓ |
| Separate scripts per format | Individual scripts (convert-claude.js, convert-copilot.js, etc.) | |
| npm bin command | Install as `coding-convert` global command | |

**User's choice:** [auto] Single CLI with subcommands (recommended default)
**Notes:** Consistent with existing coding CLI pattern. Avoids script proliferation.

---

## Normalization Architecture

| Option | Description | Selected |
|--------|-------------|----------|
| Single normalizer with format parsers | One module, pluggable parsers per format → MastraDBMessage | ✓ |
| Separate normalizer per format | Three independent normalizers, each producing MastraDBMessage | |
| Adapter pattern on existing readers | Wrap StreamingTranscriptReader etc. with MastraDBMessage adapter | |

**User's choice:** [auto] Single normalizer with format parsers (recommended default)
**Notes:** CONV-04 explicitly requires "shared normalization layer, not three separate implementations"

---

## LLM Routing for observe()

| Option | Description | Selected |
|--------|-------------|----------|
| Route through coding LLM proxy | Use src/llm-proxy/llm-proxy.mjs on port 8089 | ✓ |
| Direct API keys in config | Set GOOGLE_GENERATIVE_AI_API_KEY etc. in environment | |
| Disable observe() LLM calls | Just store raw transcripts without LLM summarization | |

**User's choice:** [auto] Route through coding LLM proxy (recommended default)
**Notes:** Per Phase 20 D-01/D-03. Also fixes current GOOGLE_GENERATIVE_AI_API_KEY failure.

---

## Batch Processing Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Manifest with content hashes | JSON manifest tracking processed files + hashes | ✓ |
| Database-tracked | Store processing state in LibSQL alongside observations | |
| Timestamp-based | Process files newer than last conversion timestamp | |

**User's choice:** [auto] Manifest with content hashes (recommended default)
**Notes:** Simple, transparent, git-friendly. Hashes detect modified files.

---

## Claude's Discretion

- MastraDBMessage type shape
- Chunking strategy for large transcripts
- Progress reporting format
- observe() buffering strategy

## Deferred Ideas

- Real-time observation tap (Phase 23)
- Dashboard browsing endpoint (Phase 23)
- OpenCode SQLite converter (not in requirements)
