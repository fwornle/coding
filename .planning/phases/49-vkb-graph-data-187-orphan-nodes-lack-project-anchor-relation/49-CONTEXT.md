# Phase 49 — Context

**Title:** VKB graph data: 187 orphan nodes lack project-anchor relations (online + manual)
**Filed:** 2026-05-22
**Severity:** Medium-High (data integrity — 24% of graph entities are disconnected; degrades graph as a navigation surface)
**Status:** Filed (not yet planned)

---

## Bug

A live query against the VKB graph API (`localhost:8080`) shows that
**187 of 797 entities (~24%) have zero relations** — they appear in
the viewer as isolated nodes floating outside the connected mass.
The user's hypothesis ("maybe from an incomplete run") is plausible
and consistent with the breakdown below: most orphans are pipeline
products (online-learned details/subcomponents) and team-anchor
Projects that never received their `CollectiveKnowledge --includes-->`
parent edge.

### Live counts (2026-05-22)

| Metric | Value |
|---|---|
| Total entities | 797 |
| Total relations | 1000 |
| Orphan entities (in zero relations) | **187 (~24%)** |

### Breakdown

| Dimension | Counts |
|---|---|
| **By source** | online: **122**, manual: **65** |
| **By team** | coding: 117, rapid-automations: 34, sketcher: 11, onboarding-repro: 10, km-core: 6, unknown: 4, daFrankTeam: 3, ai-transformation-day-hackathon: 2 |
| **By type** | Detail: 29, SubComponent: 29, Process: 28, File: 16, Container: 16, Config: 15, Fault: 11, Service: 10, StaticDiagnostics: 10, **Project: 7**, Knowledge: 7, Port: 6, RuntimeDiagnostics: 2, Feature: 1 |
| **Manual orphans by team** | coding: 58, every other team: exactly 1 each |

### Two distinct patterns

1. **122 online-learned orphans.** Detail / SubComponent / Process /
   Service / Container / Config nodes minted by the live online
   learning pipeline (likely `persistence-agent` /
   `ObservationConsolidator` / batch analysis) that never received
   `Project → Component → SubComponent → Detail` hierarchical parent
   edges. The expected ontology (CollectiveKnowledge → Project →
   Component → SubComponent → Detail) is broken for these nodes.

2. **7 orphan `Project` nodes + the "1 manual orphan per non-coding
   team" symmetry.** Each non-coding team has exactly one orphan in
   the `manual` source bucket. With 7 `Project` orphans total, this
   strongly suggests the team-anchor Projects (Sketcher, Onboarding
   Repro, Km-Core, Unknown, DaFrankTeam, Ui, Ai-Transformation-Day-
   Hackathon, Rapid-Automations) are missing the `CollectiveKnowledge
   --includes--> <Project>` edge that the sample relation
   (`from: CollectiveKnowledge, to: Coding, relation_type: includes`)
   establishes only for the Coding team. Cross-team hierarchical
   wiring was never written by whatever seeded the original
   `Coding` link.

---

## Suspected root cause

Two writer paths, two different gaps:

- **Online path:** `src/live-logging/persistence-agent.*` or
  `ObservationConsolidator` creates new Detail/SubComponent nodes on
  observation roll-up but skips creating the
  `<Project> → <new node>` edge — likely a missed write or a
  schema-shape mismatch in how the parent is resolved.
- **Manual / batch path:** the UKB/manual seeder created team-anchor
  Projects (8 of them) but only wrote the `CollectiveKnowledge
  --includes--> Coding` relation, omitting the analogous edges for
  the other 7 teams. Likely a coding-centric seed script that wasn't
  re-run as new teams were added.

Files to inspect:

- `src/live-logging/persistence-agent.*` and any
  `ObservationConsolidator.*` synthesis path that creates entities.
- `scripts/migrate-hierarchy.js`,
  `scripts/migrate-to-hierarchical-graph.js`,
  `scripts/dedup-kg-entities.js` (already touch CollectiveKnowledge
  per earlier grep — they may also be the seeders or fixers for the
  team-anchor links).
- VKB API: `lib/vkb-server/api-routes.js`,
  `lib/vkb-server/data-processor.js`.

---

## Scope

### Must

1. **Repair existing orphans** with a one-shot migration that:
   - For each non-coding team-anchor Project, write
     `CollectiveKnowledge --includes--> <ProjectName>`.
   - For each online-learned orphan, attach it to its team's anchor
     Project via the appropriate hierarchical edge type
     (`contains` / `subComponentOf` / etc., matching the existing
     pattern in the graph).
2. **Fix the online writer path** so newly-created Detail /
   SubComponent / etc. nodes always get a parent edge on creation
   — fail loudly if the resolver can't find a parent rather than
   silently writing an orphan.
3. **Fix the seed script** so adding a new team also writes the
   `CollectiveKnowledge --includes--> <Team-Project>` edge.

### Should

4. **Add an invariant check** to the VKB server: a periodic (or on-
   write) probe that counts orphan entities by team/type and exposes
   the count via `/health/state` or `/api/orphans` so the dashboard
   can show a "graph integrity" badge.
5. **Add a regression test** that creates an online-learned entity
   and asserts it has a parent edge before the writer returns.

### Could

6. **Snapshot/export the current orphan list** before the migration
   so anything lost in the fixer is recoverable.

---

## Acceptance criteria

- [ ] After repair migration: live count of orphans drops to a
      bounded number explainable by deliberate root-level entities
      (e.g. just `CollectiveKnowledge` itself, if anything).
- [ ] After writer fix: creating a new online-learned Detail/SubComp
      node always produces ≥1 parent edge.
- [ ] After seed fix: adding a new team writes the `includes` edge
      from `CollectiveKnowledge` to the new team's anchor Project.
- [ ] Dashboard (or `/api/orphans`) surfaces the orphan count for
      ongoing visibility.

---

## Related

- Phase 47 (image-attachment text loss) — unrelated, same session.
- Phase 48 (System-node filter bug) — orthogonal viewer bug;
  fixing 48 alone doesn't help here, and fixing 49 alone doesn't
  help 48.
