---
created: 2026-03-10T07:15:11.543Z
title: Replace console.log with proper logging
area: tooling
files:
  - scripts/enhanced-transcript-monitor.js (97 occurrences)
  - scripts/global-process-supervisor.js
  - scripts/process-state-manager.js
---

## Problem

The codebase uses `console.log` extensively in scripts that should use proper logging. The `no-console-log` constraint catches this on edits, but the pre-existing violations remain. The `enhanced-transcript-monitor.js` alone has 97 `console.log` calls. Other scripts like `global-process-supervisor.js` and `process-state-manager.js` also have them.

This causes friction: every edit to these files risks triggering the constraint, leading to workarounds rather than fixes.

## Solution

Audit all scripts for `console.log` usage and replace with:
- `process.stderr.write()` for always-on operational messages
- `this.debug()` or file-specific logger for debug-level messages
- `console.error()` is acceptable for error paths per Node.js conventions

Prioritize files by edit frequency:
1. `enhanced-transcript-monitor.js` (most edited, 97 occurrences)
2. `global-process-supervisor.js`
3. `process-state-manager.js`
4. Other scripts as encountered

Post-milestone cleanup — do after v2.1 milestone 14 completes.
