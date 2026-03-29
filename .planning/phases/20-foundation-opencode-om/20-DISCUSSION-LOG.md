# Phase 20: Foundation & OpenCode OM - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md -- this log preserves the alternatives considered.

**Date:** 2026-03-29
**Phase:** 20-foundation-opencode-om
**Areas discussed:** LLM proxy routing, Storage location & schema, Plugin install mechanism, Token budget design, OpenCode plugin hooks, Observation data model, OKM proxy architecture

---

## LLM Proxy Routing

| Option | Description | Selected |
|--------|-------------|----------|
| OKM proxy pattern | Port the LLM proxy from rapid-automations/OKM -- Docker container calls back to host agent's SDK | ✓ |
| UnifiedInferenceEngine | Use the existing coding inference engine (routes to Groq/xAI/etc via API keys) | |
| Direct mastra config | Let mastra use its own LLM config with API keys | |

**User's choice:** OKM proxy pattern
**Notes:** User specifically referenced the rapid-automations/OKM project as the source to port

### SDK Target

| Option | Description | Selected |
|--------|-------------|----------|
| Claude SDK (subscription) | Route through Claude Max/Pro subscription | |
| Copilot SDK (enterprise) | Route through GitHub Copilot Enterprise on VPN | |
| Network-adaptive (both) | Inside VPN -> Copilot, outside -> Claude | ✓ |

**User's choice:** Network-adaptive (both)
**Notes:** Same pattern as opencode.sh agent_pre_launch

---

## Storage Location & Schema

| Option | Description | Selected |
|--------|-------------|----------|
| .data/observations/ | Under existing .data/ convention | |
| Per-project .observations/ | Each project gets its own observation DB | ✓ |
| Centralized ~/.mastra/ | Mastra's default location | |

**User's choice:** Per-project .observations/

### DB Sharing

| Option | Description | Selected |
|--------|-------------|----------|
| Single shared DB | All agents write to one DB | ✓ |
| Per-agent DBs | Separate DB per agent | |
| You decide | Claude picks | |

**User's choice:** Single shared DB

---

## Plugin Install Mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| npm install (try first) | npm install @mastra/opencode, fall back to monorepo build | ✓ |
| Git submodule of mastra | Add mastra repo as git submodule | |
| Vendored copy | Copy integration source into this repo | |

**User's choice:** npm install (try first)

### Validation

| Option | Description | Selected |
|--------|-------------|----------|
| Package installed + import works | Check npm package exists and can be imported | |
| Full smoke test | Start OpenCode, verify DB created, hooks fire | ✓ |
| You decide | Claude picks | |

**User's choice:** Full smoke test

---

## Token Budget Design

| Option | Description | Selected |
|--------|-------------|----------|
| Config file per project | JSON/YAML in .observations/config.json | ✓ |
| Environment variables | MASTRA_OBSERVER_BUDGET, etc. | |
| Both (config + env override) | Config file + env override | |

**User's choice:** Config file per project

### Model Tier

| Option | Description | Selected |
|--------|-------------|----------|
| Fast/cheap (flash models) | Groq llama, gemini-flash -- background work | ✓ |
| Standard (Claude Haiku/Sonnet) | Balance quality and cost | |
| Network-adaptive tier | VPN -> Copilot, outside -> cheapest Claude | |

**User's choice:** Fast/cheap (flash models)

---

## OpenCode Plugin Hooks

| Option | Description | Selected |
|--------|-------------|----------|
| Independent parallel | LSL and mastra operate independently | ✓ |
| LSL feeds mastra | LSL captures first, feeds to observe() | |
| You decide | Claude determines | |

**User's choice:** Independent parallel

---

## Observation Data Model

| Option | Description | Selected |
|--------|-------------|----------|
| Separate system | Observations in LibSQL, LSL in .specstory/ | |
| Linked via session IDs | Cross-reference observations and LSL | |
| Observations replace LSL long-term | Observations become primary, LSL becomes backup | ✓ |

**User's choice:** Observations replace LSL long-term
**Notes:** For this milestone: both run additively. Strategic direction for future.

---

## OKM Proxy Architecture

| Option | Description | Selected |
|--------|-------------|----------|
| Copy into coding repo | Port proxy code from rapid-automations/OKM | ✓ |
| Shared npm package | Extract into shared package | |
| Git submodule reference | Add as submodule | |

**User's choice:** Copy into coding repo

---

## Claude's Discretion

- Schema migration strategy for LibSQL
- Exact observation fields/structure

## Deferred Ideas

None
