# Requirements: Coding Project v4.0

**Defined:** 2026-03-29
**Core Value:** Intelligent observational memory replacing verbatim logging — mastra.ai integration across all coding agents

## v4.0 Requirements

Requirements for mastra integration milestone. Each maps to roadmap phases.

### OpenCode OM

- [ ] **OCOM-01**: The mastra/opencode plugin is installed via `install.sh` (with corresponding uninstall in `uninstall.sh` and validation in `scripts/test-coding.sh`)
- [ ] **OCOM-02**: Observation storage uses LibSQL with configurable path and schema setup
- [ ] **OCOM-03**: Observer/reflector agents use the coding LLM proxy (Docker → host agent SDK) instead of direct API keys
- [ ] **OCOM-04**: Token budget limits are configurable per observer/reflector agent to control LLM costs

### Transcript Converters

- [ ] **CONV-01**: User can convert Claude .jsonl transcript files to mastra observations via CLI command
- [ ] **CONV-02**: User can convert Copilot events.jsonl transcript files to mastra observations via CLI command
- [ ] **CONV-03**: User can batch-convert git-tracked .specstory/ LSL files to mastra observations
- [ ] **CONV-04**: Converters normalize all 3 transcript formats to MastraDBMessage format before observation

### Mastracode Agent

- [ ] **MSTR-01**: User can start mastracode via `coding --mastra` with proper tmux session setup
- [ ] **MSTR-02**: Mastracode sessions appear in tmux statusline with LSL indicator and health monitoring
- [ ] **MSTR-03**: Enhanced-transcript-monitor captures mastracode conversations for LSL logging

### Live Observations

- [ ] **LIVE-01**: Enhanced-transcript-monitor produces mastra observations in real-time alongside verbatim LSL (additive, not replacing)
- [ ] **LIVE-02**: Observations are browsable via REST endpoint on the health dashboard

## Future Requirements

Deferred to future milestones. Tracked but not in current roadmap.

### Cross-Agent Memory

- **XAGT-01**: Observations from different agents (Claude, Copilot, OpenCode, Mastra) are unified into a shared memory space
- **XAGT-02**: Resource-scoped OM allows agents to share context about specific files/components

### Knowledge Graph Bridge

- **KGBR-01**: Observations feed into Graphology knowledge graph as entities
- **KGBR-02**: VKB viewer displays observation-derived entities alongside pipeline entities

## Out of Scope

| Feature | Reason |
|---------|--------|
| Cross-agent observation sharing (resource-scoped OM) | Marked experimental in mastra, defer until stable |
| Replacing verbatim LSL with observations | Additive only — LSL must continue unchanged |
| KG bridge (observations → Graphology entities) | Future milestone after observations are proven |
| Direct API key configuration for mastra LLM | Must use existing coding LLM proxy infrastructure |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| OCOM-01 | — | Pending |
| OCOM-02 | — | Pending |
| OCOM-03 | — | Pending |
| OCOM-04 | — | Pending |
| CONV-01 | — | Pending |
| CONV-02 | — | Pending |
| CONV-03 | — | Pending |
| CONV-04 | — | Pending |
| MSTR-01 | — | Pending |
| MSTR-02 | — | Pending |
| MSTR-03 | — | Pending |
| LIVE-01 | — | Pending |
| LIVE-02 | — | Pending |

**Coverage:**
- v4.0 requirements: 13 total
- Mapped to phases: 0
- Unmapped: 13 ⚠️

---
*Requirements defined: 2026-03-29*
*Last updated: 2026-03-29 after initial definition*
