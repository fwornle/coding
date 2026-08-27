---
name: constraints
description: Check code or an action against this project's constraint rules, read compliance status and violation history, and add or amend rules. Use before writing code that might trip a guardrail, when a PreToolUse hook has blocked something and you need to see why, or when the user asks about constraints, guardrails or compliance. Replaces the former constraint-monitor MCP tools.
---

# /constraints

The `constraints` CLI (`bin/constraints`) is the query and authoring surface for this project's
guardrails. It runs **in-process on the host**, reusing `ConstraintEngine` — the same code the
`PreToolUse` / `UserPromptSubmit` hooks run — so it works even when `coding-services` is down.

- **Rules:** `$CODING_REPO/.constraint-monitor.yaml` (single canonical file, no cwd-walking)
- **Enforcement:** the hooks, not this CLI. This CLI *inspects*; the hooks *block*.

## When to use

- Before writing a file you suspect touches a rule (parallel versions, `console.*`, PlantUML
  naming, backup files) — cheaper than being blocked and retrying.
- After a hook blocks a tool call, to read the rule text and decide whether to fix or override.
- When the user asks "what constraints are active?", "why did that get blocked?", or asks to add
  or amend a rule.

## Commands

```bash
constraints list                       # every rule: ● enabled / ○ disabled, severity, message
constraints list --enabled-only

constraints check --file src/foo.ts    # read the file, check it, print violations
constraints check --file src/foo.ts --content 'const a = 1'   # check a snippet, keep the path label
cat buffer.ts | constraints check --file src/foo.ts           # stdin wins; --file is the path label

constraints status                     # compliance score, risk level, active violation count
constraints violations --limit 20      # recent violations and their metrics

constraints update rules.json          # array of {id, pattern, message, severity, enabled}
constraints update -                   # ...or the same JSON on stdin
```

`--json` on any command emits the raw payload. `--verbose` re-enables the engine's stderr logging.

## Reading the output

`check` exits **1** when it finds an `error` or `critical` violation and **0** otherwise, so it
composes directly:

```bash
constraints check --file src/foo.ts || echo "fix before writing"
```

Severity marks: 🛑 critical · ❌ error · ⚠️ warning · ℹ️ info.

## When a constraint fires

A constraint firing means a real issue. **Fix the code, don't reword around the rule** — swapping
to a different API that pattern-matches past the regex (`process.stderr.write` to dodge
`no-console-log`) preserves the behaviour the rule exists to prevent and is itself a violation.

For a genuine false positive, say so and ask the user, or include
`OVERRIDE_CONSTRAINT: <constraint-id>` in the prompt with a rationale.

Known gap: `file_pattern` on a rule is not currently applied, so file-scoped rules can fire on any
command text. That is a bug in the engine, not licence to reword the command.
