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
