# Phase 48 — Context

**Title:** VKB graph viewer: System-type nodes vanish when their owning team is unchecked
**Filed:** 2026-05-22
**Severity:** Medium (visual/UX bug — graph appears disconnected when filtering by team)
**Status:** Filed (not yet planned)

---

## Bug

In the VKB knowledge-graph viewer at `localhost:8080`
(`integrations/memory-visualizer/`), the central anchor node
`CollectiveKnowledge` (and presumably any other `entity_type='System'`
node) disappears as soon as its owning team (`coding`) is unchecked
in the Teams / Views panel — even though `CollectiveKnowledge`
is conceptually a cross-team anchor and the visualization's filter
*intends* to keep System nodes always visible.

---

## Confirmed instance

- Viewer URL: `http://localhost:8080`
- Reproduction:
  1. Open the viewer with default "Combined" Learning Source.
  2. Uncheck the "Coding" team in Teams / Views.
  3. Result: `CollectiveKnowledge` disappears from the canvas; visible
     team-anchor Projects (Sketcher, Rapid-Automations, Dafrankteam,
     Unknown, OnboardingRepro) no longer share any visible parent.
- Affected entity (live API at time of filing):
  ```json
  {
    "id": "coding:CollectiveKnowledge",
    "entity_type": "System",
    "team": "coding",
    "metadata": { "originalMetadata": { "ontology": { "ontologyName": "System", … } } }
  }
  ```

---

## Root cause

The viewer has TWO filter layers, and the *upstream* one strips System
nodes before the *downstream* "keep all System nodes" rule can save them.

### Upstream (server / client API layer) — the strip

`integrations/memory-visualizer/src/api/databaseClient.ts:262`
`loadKnowledgeGraph(team[], source)` issues **per-team** queries:

```ts
const teamResults = await Promise.all(
  team.map(t => Promise.all([
    this.queryEntities({ team: t, source, limit: 5000 }),
    this.queryRelations({ team: t })
  ]))
);
```

Each `queryEntities({ team })` filters at the DB by `entity.team = ?`.
Because `CollectiveKnowledge.team = "coding"`, unchecking the Coding
team means **no** per-team query ever returns it. The entity never
reaches the client.

Relations are also team-scoped (live sample relation has
`"team": "coding"`), so even if entities were rescued, the
`CollectiveKnowledge --includes--> <Project>` edges would still be
missing.

### Downstream (visualization filter) — the no-op rescue

`integrations/memory-visualizer/src/components/KnowledgeGraphVisualization.tsx:817-824`

```ts
if (selectedTeams && selectedTeams.length > 0) {
  filteredEntities = filteredEntities.filter(entity => {
    // System entities (like CollectiveKnowledge) belong to all teams
    if (entity.entityType === "System") return true;
    const entityTeam = entity.metadata?.team;
    return entityTeam && selectedTeams.includes(entityTeam);
  });
}
```

This rule is correct in spirit but operates on `filteredEntities`,
which has already been pruned upstream — there is nothing to keep.

---

## Scope

### Must

1. Ensure `entity_type='System'` nodes are returned regardless of
   which teams are selected. Preferred location: server-side
   `queryEntities` — always union System entities into the result set
   when a team filter is applied. Fallback: client-side extra query
   for `{ entityType: 'System' }` in `loadKnowledgeGraph` and merge.
2. Ensure the edges that connect System nodes to team anchors
   (e.g. `CollectiveKnowledge --includes--> Coding`,
   `CollectiveKnowledge --includes--> Sketcher`) are also returned so
   the System node isn't an isolated dot after the fix.
3. Manual repro: uncheck "Coding", verify `CollectiveKnowledge` stays
   visible and remains connected to whichever team anchors *are*
   still visible.

### Should

4. Audit other `entity_type='System'` rows (if any) and document them
   in the fix commit — confirm none rely on the broken behavior.
5. Add an integration test against `databaseClient.loadKnowledgeGraph`
   covering the multi-team-without-owning-team scenario.

### Could

6. Generalize: extend the same rule to other cross-cutting types if
   it makes sense (e.g. globally-shared `Knowledge` entries that
   shouldn't be team-scoped).

---

## Acceptance criteria

- [ ] With "Coding" unchecked and any other single team checked, the
      response from `loadKnowledgeGraph` includes both
      `CollectiveKnowledge` and the relation(s) that link it to the
      visible team-anchor Project(s).
- [ ] Regression test under `integrations/memory-visualizer/` covers
      the System-node preservation contract.

---

## Related

- Phase 47 (image-attachment text loss) — unrelated, filed in the
  same session.
- Phase 49 (orphan nodes) — separate concern; this fix won't address
  the 187 orphan nodes from the data-integrity bug.
