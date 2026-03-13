# Skills System

Skills are reusable workflow instructions that all supported coding agents (Claude Code, GitHub Copilot CLI, OpenCode) can use. A single skill definition propagates automatically to every agent.

![Skills System Architecture](images/skills-system.png)

---

## Adding a New Skill

1. Create a `.md` file in `.claude/commands/` with YAML frontmatter:

```markdown
---
name: my-skill
description: >
  Brief description of when this skill should be triggered.
  This text is used in the skill catalog for all agents.
---

# My Skill

Instructions the agent should follow when this skill is activated.
```

2. Run the propagation script:

```bash
./scripts/generate-agent-instructions.sh
```

That's it. The skill is now available in all three agents.

---

## How It Works Per Agent

| Agent | Mechanism | Location |
|-------|-----------|----------|
| **Claude Code** | Copied as global slash command | `~/.claude/commands/*.md` |
| **Copilot CLI** | Included in generated instructions | `.github/copilot-instructions.md` |
| **OpenCode** | Appended to project instructions | `CLAUDE.md` (auto-generated section) |

### Claude Code

Skills in `~/.claude/commands/` become slash commands invokable via `/skill-name`. Claude reads these natively — no transformation needed.

### GitHub Copilot CLI

Copilot reads `.github/copilot-instructions.md` for project-level instructions. The generator creates this file by combining:

- All rules from `CLAUDE.md` (with machine-specific paths sanitized)
- A catalog of all available skills with descriptions and file paths

Copilot can then read the referenced skill file when a task matches.

### OpenCode

OpenCode reads `CLAUDE.md` natively but has no slash command system. The generator appends an "Available Skills (Auto-Generated)" section to `CLAUDE.md` listing all skills with descriptions and file paths.

This section is idempotent — re-running the script replaces it rather than duplicating.

---

## Automatic Sync Points

The script runs automatically at two points:

- **`./install.sh`** — `install_skills()` runs during installation
- **`coding --<agent>`** — `ensure_agent_instructions()` in `agent-common-setup.sh` runs at every launch

This means skills stay current even if you add new ones between installs.

---

## Path Sanitization

Generated files never contain machine-specific paths. The `sanitize_paths()` function replaces:

- Absolute repo path → `$CODING_REPO`
- Home directory → `~`
- Username patterns → `~`

This makes `.github/copilot-instructions.md` safe to commit and share.

---

## Current Skills

| Skill | Trigger | Description |
|-------|---------|-------------|
| **documentation-style** | PlantUML, Mermaid, diagrams | Enforces naming conventions, style sheets, validation workflow |
| **playwright-cli** | Browser automation, screenshots, E2E tests | Drives Playwright from bash without MCP server |
| **sl** | Session continuity, "what was I doing" | Loads recent Live Session Logs for context |

---

## Script Reference

```bash
# Sync all skills to all agents (default — does everything)
./scripts/generate-agent-instructions.sh

# With explicit paths (used by install.sh and agent-common-setup.sh)
./scripts/generate-agent-instructions.sh <project_dir> <coding_repo>
```

The script:
1. Reads all `.md` files from `.claude/commands/`
2. Extracts descriptions from YAML frontmatter
3. Copies to `~/.claude/commands/` (Claude global)
4. Generates `.github/copilot-instructions.md` (Copilot)
5. Appends skill catalog to `CLAUDE.md` (OpenCode)

---

## Related

- [Agent Integration Guide](agent-integration-guide.md) — Adding new coding agents
- [Constraint Monitoring](constraints/) — PreToolUse hook enforcement
- [Getting Started](getting-started.md) — Installation and setup
