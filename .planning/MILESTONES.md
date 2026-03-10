# Milestones

## v2.1 Wave Pipeline Quality Restoration (Shipped: 2026-03-10)

**Phases completed:** 6 phases (9-14), 20 plans
**Audit status:** tech_debt (Plan 14-03 deferred — workflow state management needs redesign before E2E verification is meaningful)

**Key accomplishments:**
- Full agent pipeline integration (semantic analysis, persistence, insight generation, ontology classification) into wave architecture
- All 6 KG operators restored (conv, aggr, embed, dedup, pred, merge)
- Content quality gate with QA validation and coordinator retry-with-feedback
- Pipeline observability with trace modal (LLM counts, timing, model info, data flow)
- Code-graph-rag integration as code-evidence source for wave agents
- Relationship diagrams and constraint validation gate (Plans 14-01, 14-02)

**Deferred to v3.0:**
- Plan 14-03: Wave 4 diagram wiring + Docker E2E verification
- Workflow state management redesign (fundamental architecture issue)
- Dashboard substep coloring (blocked by state management issues)
- "Batch" label rename (cosmetic, bundled with state machine work)

### Phases
| Phase | Name | Plans | Status |
|-------|------|-------|--------|
| 9 | Agent Pipeline Integration | 3/3 | Complete (2026-03-07) |
| 10 | KG Operations Restoration | 5/5 | Complete (2026-03-08) |
| 11 | Content Quality Gate | 3/3 | Complete (2026-03-09) |
| 12 | Pipeline Observability | 4/4 | Complete (2026-03-09) |
| 13 | Code Graph Agent Integration | 3/3 | Complete (2026-03-09) |
| 14 | Documentation Generation | 2/3 | Partial (14-03 deferred) |

## v1.0 UKB Pipeline Fix & Improvement (Shipped: 2026-03-03)

**Phases completed:** 2 phases (1 + 4), 9 plans
**Audit status:** tech_debt (12/12 executed requirements satisfied, Phases 2-3 deferred)

**Key accomplishments:**
- Multi-format pattern extraction parser (JSON + markdown + LLM retry) with generic name filtering
- Correct PascalCase entity naming across all 7 naming paths
- LLM-synthesized observations in all 4 observation creation methods
- Configurable analysisDepth parameter (surface/deep/comprehensive)
- TypeScript interfaces extended with hierarchy fields across 4 systems (KGEntity, SharedMemoryEntity, VKB Entity/Node)
- Component manifest (8 L1 + 5 L2 components) and ontology types (Component/SubComponent)

**Deferred to future milestones:**
- Phase 2: Insight Generation & Data Routing (7 requirements)
- Phase 3: Significance & Quality Ranking (2 requirements)

**Known gaps:**
- SC-2 (hierarchy field round-trip persistence) deferred to Phase 5
- 4 human verification items pending runtime confirmation

### Phases
| Phase | Name | Plans | Status |
|-------|------|-------|--------|
| 1 | Core Pipeline Data Quality | 7/7 | Complete (2026-03-02) |
| 2 | Insight Generation & Data Routing | 0/? | Deferred |
| 3 | Significance & Quality Ranking | 0/? | Deferred |
| 4 | Schema & Configuration Foundation | 2/2 | Complete (2026-03-01) |
