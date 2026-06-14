---
status: partial
phase: 57-lower-ontology-project-tagging-foundation
source: [57-VERIFICATION.md]
started: 2026-06-14T22:50:00Z
updated: 2026-06-14T22:50:00Z
---

## Current Test

[awaiting human testing — discharges at next scheduled `ukb full`]

## Tests

### 1. 57-03 Task 4 — wave-analysis writer-path metadata.project verification
expected: After the next `ukb full` run, post-cutover entities (createdAt > 2026-06-14T20:00:00Z) in `.data/knowledge-graph/exports/general.json` all carry `metadata.project='coding'`. Legacy `metadata.team='coding'` still flows alongside (D-02 invariant preserved).

verification command:
```bash
# Coverage: 0 new entities should lack metadata.project
jq '[.nodes[] | select(.attributes.createdAt > "2026-06-14T20:00:00Z") | select(.attributes.metadata.project == null)] | length' \
  .data/knowledge-graph/exports/general.json
# Expected: 0

# Distribution: only valid Project values among new entities
jq -r '[.nodes[] | select(.attributes.createdAt > "2026-06-14T20:00:00Z")] | map(.attributes.metadata.project) | group_by(.) | map({project: .[0], count: length})' \
  .data/knowledge-graph/exports/general.json
# Expected: coding dominates; no null/undefined

# D-02 invariant: metadata.team='coding' still flows
jq '[.nodes[] | select(.attributes.createdAt > "2026-06-14T20:00:00Z") | .attributes.metadata.team] | unique' \
  .data/knowledge-graph/exports/general.json
# Expected: ["coding"] at minimum
```

result: [pending]

### 2. 57-04 Task 3 — L2 emission rate ≥18/20
expected: After the next `ukb full` run, the 20 most-recent online-learned entities carry `ontologyClass` values drawn from the 10 L2 classes shipped in `coding.lower.json`. The smoke gate passes:

verification command:
```bash
node scripts/check-l2-emission-rate.mjs --sample 20 --min 18
# Expected: exit 0; stderr line "[l2-emission-rate] sample=20, l2_emitted>=18, threshold=18, status=PASS"
```

result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
