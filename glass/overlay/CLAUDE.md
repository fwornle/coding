# CLAUDE.md - Project Development Guidelines

## 🚨🚨🚨 CRITICAL GLOBAL RULE: NO PARALLEL VERSIONS EVER 🚨🚨🚨

**This rule applies to ALL projects and must NEVER be violated.**

### ❌ NEVER CREATE FILES OR FUNCTIONS WITH EVOLUTIONARY NAMES:

- `v2`, `v3`, `v4`, `v5` (version suffixes)
- `enhanced`, `improved`, `better`, `new`, `advanced`, `pro`
- `simplified`, `simple`, `basic`, `lite`
- `fixed`, `patched`, `updated`, `revised`, `modified`
- `temp`, `temporary`, `backup`, `copy`, `duplicate`, `clone`
- `alt`, `alternative`, `variant`
- `final`, `draft`, `test`, `experimental`

### ✅ ALWAYS DO THIS INSTEAD:

1. **Edit the original file directly**
2. **Debug and trace to find the root cause**
3. **Fix the underlying problem, not create workarounds**
4. **Refactor existing code rather than duplicating it**

---

## 🚨 CRITICAL: MANDATORY DOCUMENTATION-STYLE SKILL USAGE

**ABSOLUTE RULE**: When working with PlantUML, Mermaid, or any documentation diagrams, you MUST invoke the `documentation-style` skill FIRST.

### When to Use

ALWAYS invoke the `documentation-style` skill when:

- Creating or modifying PlantUML (.puml) files
- Generating PNG files from PlantUML diagrams
- Working with Mermaid diagrams
- Creating or updating any documentation artifacts
- User mentions: diagrams, PlantUML, PUML, PNG, visualization, architecture diagrams

### How to Invoke

Before any diagram work, execute:

```text
Use Skill tool with command: "documentation-style"
```

### Why This Matters

- Enforces strict naming conventions (lowercase + hyphens only)
- Prevents incremental naming violations (no v2, v3, etc.)
- Ensures proper PlantUML validation workflow
- Applies correct style sheets automatically
- Prevents ASCII/line art in documentation

**ENFORCEMENT**: Any diagram work without first invoking this skill is a CRITICAL ERROR.

---

## 🚨 GLOBAL: MANDATORY VERIFICATION RULE

**CRITICAL**: NEVER CLAIM SUCCESS OR COMPLETION WITHOUT VERIFICATION

**ABSOLUTE RULE**: Before stating ANY result, completion, or success:

1. **ALWAYS run verification commands** to check the actual state
2. **ALWAYS show proof** with actual command output
3. **NEVER assume or guess** - only report what you can verify
4. **If verification shows failure**, report the failure accurately

**WHY THIS MATTERS**: False success claims waste time and break user trust. ALWAYS verify before reporting.

## Available Skills (Auto-Generated)

These skills are defined in `.claude/commands/` and provide reusable workflows.
Read the full skill file when a task matches its description.

- **/constraints** (`.claude/commands/constraints.md`): Check code or an action against this project's constraint rules, read compliance status and violation history, and add or amend rules. Use before writing code that might trip a guardrail, when a PreToolUse hook has blocked something and you need to see why, or when the user asks about constraints, guardrails or compliance. Replaces the former constraint-monitor MCP tools.
- **/documentation-style** (`.claude/commands/documentation-style.md`): Enforce consistent styling for documentation artifacts (PlantUML, Mermaid, markdown, PNG diagrams). Invoke BEFORE creating or modifying any .puml file, generating PNGs from PlantUML, working with Mermaid diagrams, or updating documentation artifacts — and whenever the user mentions diagrams, PlantUML, PUML, PNG, visualization, or architecture diagrams.
- **/experiment** (`.claude/commands/experiment.md`): Describe a cross-agent experiment in plain English (or with flags), then auto-run the matrix, compare, and render the ranked variant table
- **/graphify** (`.claude/commands/graphify.md`): Query and rebuild the project's code knowledge graph (graphify). Use for any question about the codebase — architecture, "what calls X", "where is Y", file/function relationships, data-flow tracing — instead of blind greps. The graph is a static graph.json served over MCP by the coding-graphify container; rebuild it with `graphify update` when it's stale.
- **/kgbench** (`.claude/commands/kgbench.md`): Run, resume, regrade and report the kgbench code-retrieval benchmark (coding-v1) across retrieval arms, agents and models — and diagnose the routing that decides which model actually answers. Also covers the Performance → Benchmarks dashboard sub-tab, the second front-end over the same scripts.
- **/playwright-cli** (`.claude/commands/playwright-cli.md`): Use this skill whenever the user wants to automate a browser, scrape web content, take screenshots or PDFs of pages, fill out forms, click through UI flows, or run end-to-end tests — without using an MCP server. This skill drives Playwright directly from the bash_tool via Node.js scripts. Trigger whenever the user says things like "open this URL", "screenshot this page", "scrape this site", "automate this form", "test this UI", "extract data from", "click through", "check if this page works", or any task that requires real browser interaction. Prefer this skill over web_fetch when JavaScript rendering, authentication, interaction, or visual output is needed.
- **/semantic** (`.claude/commands/semantic.md`): Run UKB knowledge-base workflows (wave-analysis and friends), manage the ontology, refresh stale knowledge entities, and reach the semantic-analysis tools. Use whenever the user says "ukb", "ukb full", "ukb debug", asks to run or check a knowledge workflow, or asks about ontology classes and entity refresh. Replaces the former semantic-analysis MCP tools.
- **/sl** (`.claude/commands/sl.md`): Load session logs (LSL) from current and coding projects for continuity

