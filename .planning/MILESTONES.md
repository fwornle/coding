# Milestones

## v1.0 — UKB Pipeline Fix & Improvement

**Status:** Partially complete (Phase 1 done, Phases 2-3 deferred)
**Dates:** 2026-02-26 to 2026-03-01

### What Shipped
- Pattern extraction parser — handles both JSON and markdown LLM responses
- Entity naming — correct PascalCase, meaningful names
- Observation quality — LLM-synthesized from actual code analysis
- Deep analysis mode enabled across pipeline
- Garbage insight names fixed (removed forced "Pattern" suffix, added blocklist)
- Bold markdown formatting stripped from existing entities
- Knowledge purge: 339 → 126 entities

### What Was Deferred
- Insight document generation (INSD-01 through INSD-04)
- Data routing fixes (DATA-01, DATA-02)
- Significance scoring (QUAL-01, OBSV-03)
- Quality logging (QUAL-02)

### Key Decisions
- Fix existing pipeline surgically — architecture is sound
- Phase order follows pipeline execution order
- All fixes contained within `integrations/mcp-server-semantic-analysis`

### Phases
| Phase | Name | Plans | Status |
|-------|------|-------|--------|
| 1 | Core Pipeline Data Quality | 5/5 | Complete |
| 2 | Insight Generation & Data Routing | 0/? | Deferred |
| 3 | Significance & Quality Ranking | 0/? | Deferred |

**Last phase number used:** 3 (via GSD), but also 5 ad-hoc plans within Phase 1
