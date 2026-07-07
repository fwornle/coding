
## 84-02 — stale `enhanced-redaction-system.js` references after `.cjs` rename

The redaction applier was renamed `.js` -> `.cjs` (Node 25 + root `type:module`
forces `.js` to ESM, breaking its CommonJS `module.exports`). Two deployment
shell scripts still reference the old `.js` name for the CLI-test invocation
(`node .../enhanced-redaction-system.js`), which was ALREADY non-functional under
`type:module` (ran as ESM, `module`/`require` undefined). Out of scope for 84-02
(deployment scripts, not the applier contract). Update the extension when either
script is next touched:

- `scripts/test-coding.sh:2169,2187`
- `scripts/deploy-enhanced-lsl.sh:232,274,361,515,533,793`
