---
id: json-export-missing-source-field
created: 2026-05-27
status: pending
priority: medium
tags: [phase-51, observation-export, source-tagging, ac-3]
discovered_in: phase-51, plan-51-16 HUMAN-UAT
---

# `.data/observation-export/observations.json` strips `metadata.source` field

Plan 51-14 (CR-03 fix) ensures the SQLite observations DB writes
`metadata.source='sub-agent'` for the live tier and `'sub-agent-backfill'`
for the historical tier. Verified via:

```bash
sqlite3 .observations/observations.db "SELECT COUNT(*) FROM observations WHERE json_extract(metadata,'\$.source')='sub-agent' AND created_at > 1779905466"
# → 3 (Phase 51 51-16 HUMAN-UAT, 2026-05-27 ~18:11 UTC baseline)
```

**However**, the JSON export at `.data/observation-export/observations.json`
does **NOT** carry the `source` field through. A parallel verification session
inspected the latest row in the export and reported:

> latest row at 18:26:38Z has source=None, schema has no source field at all

This causes downstream consumers that read the export (instead of the DB)
to falsely conclude that source tagging is not effective.

## Impact

- Any AC #3 verification that reads the JSON export will give a false negative
  (which is what happened during this UAT in a parallel session).
- Token-usage dashboards, observation viewer, and other consumers that derive
  from the export cannot distinguish `sub-agent` vs `sub-agent-backfill` vs
  regular observations.
- DOES NOT affect the live-logging pipeline itself — the writer-side tagging
  works correctly (confirmed in DB).

## Action

1. Locate the exporter (likely `src/live-logging/ObservationExporter.js` or
   similar — the live-claude log shows `[ObservationExporter] Safety merge
   for observations.json: kept 1971 historic + 359 current = 2330 total`
   during Phase 51 UAT).
2. Audit the row-shape projection that builds `observations.json`. Confirm
   whether `metadata.source` is intentionally excluded or accidentally dropped.
3. Add `metadata.source` to the projection and back-merge for historical rows
   that have it set in the DB.
4. Add a regression test: export a fixture row with `source='sub-agent'`,
   read back the JSON, assert the field round-trips.

## Context

- Discovered during Phase 51 Plan 51-16 HUMAN-UAT closure verification.
- The DB query path (used here) is authoritative; consumers reading the export
  need to either (a) join through the DB or (b) wait for this fix.
- The 3 fresh rows from the UAT probe are tagged `source='sub-agent'` in the DB
  and remain so on disk — only the export representation is missing the field.
