# Phase 21: Mastracode Agent Integration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-30
**Phase:** 21-mastracode-agent-integration
**Areas discussed:** Session launch flow, LSL capture method, Tmux statusline format, Error & recovery behavior

---

## Session Launch Flow

| Option | Description | Selected |
|--------|-------------|----------|
| Same pattern as OpenCode | Create config/agents/mastra.sh + scripts/launch-mastra.sh using existing framework | ✓ |
| Standalone launcher | Own launch script outside common framework | |
| You decide | Claude picks based on pi-tui requirements | |

**User's choice:** Same pattern as OpenCode (Recommended)
**Notes:** User consistently chose recommended options for consistency with existing agent infrastructure.

| Option | Description | Selected |
|--------|-------------|----------|
| Standard tmux layout | Same 2-pane layout as other agents | ✓ |
| Single pane - mastra only | Full terminal, services in background | |

**User's choice:** Standard tmux layout

| Option | Description | Selected |
|--------|-------------|----------|
| opencode with mastra plugin | Same binary, different config | |
| Separate mastracode binary | Dedicated CLI binary | |
| You decide after research | Let researcher determine | ✓ |

**User's choice:** You decide after research
**Notes:** Binary/CLI determination deferred to researcher.

| Option | Description | Selected |
|--------|-------------|----------|
| Full services | Start all coding services same as claude/copilot | ✓ |
| Minimal services | Only mastracode-specific services | |

**User's choice:** Full services

| Option | Description | Selected |
|--------|-------------|----------|
| Same directory as user | Launch in current working directory | ✓ |
| Fixed directory | Always start in coding repo root | |

**User's choice:** Same directory as user

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, parallel capable | Multiple agents simultaneously | ✓ |
| Exclusive - one at a time | Launching kills other agents | |

**User's choice:** Yes, parallel capable

| Option | Description | Selected |
|--------|-------------|----------|
| Agent adapter handles it | agent_pre_launch() guides first-run setup | ✓ |
| User handles manually | Show error and exit | |
| You decide after research | Depends on @mastra/opencode requirements | |

**User's choice:** Agent adapter handles first-run setup

| Option | Description | Selected |
|--------|-------------|----------|
| LLM proxy only | All calls through llm-proxy.mjs | ✓ |
| Proxy with API key fallback | Try proxy, fall back to direct keys | |

**User's choice:** LLM proxy only

---

## LSL Capture Method

| Option | Description | Selected |
|--------|-------------|----------|
| Mastra hooks -> file -> ETM | Hooks write transcript file, ETM reads it | ✓ |
| Mastra hooks -> HTTP/IPC -> ETM | Direct event delivery, no file | |
| Mastra hooks -> shared LibSQL | ETM polls/subscribes to LibSQL rows | |
| You decide after research | Researcher determines best hook pattern | |

**User's choice:** Mastra lifecycle hooks -> file -> ETM

| Option | Description | Selected |
|--------|-------------|----------|
| JSONL (same as Claude) | Reuse StreamingTranscriptReader | |
| Native mastra format | Dedicated reader for mastra's own format | ✓ |

**User's choice:** Native mastra format
**Notes:** User prefers authenticity over code reuse for format choice.

| Option | Description | Selected |
|--------|-------------|----------|
| Same convention | .specstory/history/ with standard naming | ✓ |
| Separate directory | .specstory/mastra/ | |

**User's choice:** Same convention

| Option | Description | Selected |
|--------|-------------|----------|
| Agent tag in filename | _from-mastra suffix | |
| Same filename, agent tag inside | Agent name in file header/metadata | ✓ |

**User's choice:** Same filename, agent tag inside
**Notes:** Agent identity in metadata, not filename. Cleaner naming.

---

## Tmux Statusline Format

| Option | Description | Selected |
|--------|-------------|----------|
| Unique color + icon | Own color/icon to distinguish from other agents | ✓ |
| Match OpenCode style | Similar to OpenCode but different icon | |

**User's choice:** Unique color + icon

**User's choice (info shown):** Same as all other agents — combined statusline + tmux-provided parts
**Notes:** User explicitly stated: no mastra-specific indicators. Same combined statusline pattern as all agents.

---

## Error & Recovery Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Same recovery as other agents | Auto-restart + health remediation + process supervisor | ✓ |
| Simpler recovery | Just restart on crash, no health monitoring | |

**User's choice:** Same recovery as other agents

| Option | Description | Selected |
|--------|-------------|----------|
| Warn and continue | Log warning, start anyway | ✓ |
| Block until proxy available | Wait for proxy health check | |

**User's choice:** Warn and continue

| Option | Description | Selected |
|--------|-------------|----------|
| Preserve all | Write to LibSQL as they happen, durable | ✓ |
| Batch and flush periodically | Buffer in memory, periodic flush | |

**User's choice:** Preserve all (write-through to LibSQL)

---

## Claude's Discretion

- Which binary/CLI mastracode uses (determined by researcher)
- Specific mastra lifecycle hook types and event schema
- Icon/color choice for statusline
- ETM reader implementation details for native mastra format

## Deferred Ideas

None — discussion stayed within phase scope
