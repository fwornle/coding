# InvalidatingCommitLinker

**Type:** Detail

Mapping commits to entities implies a code-ownership or file-overlap heuristic: the linker must determine which entities are 'touched' by a given commit's diff, which requires access to both the git history and the entity-to-source-file relationship already modelled in the KnowledgeManagement component.

## What It Is  

**InvalidatingCommitLinker** is the sub‑component responsible for populating the `invalidating_commits` field that lives inside **`EntityMetadata`**.  This field is the only place in the model where a concrete link between a code change (a Git commit) and an individual knowledge entity is stored.  The linker therefore bridges two orthogonal data sources: the **Git history** (commit hashes, timestamps, diff information) and the **entity‑to‑source‑file map** that is already maintained by the **KnowledgeManagement** subsystem.  By inserting commit identifiers directly into the `EntityMetadata` record, the system can compute a decay signal for a given entity without issuing a separate join or lookup – the information is available on the same row that stores the entity’s other staleness metadata.

The design is explicitly **incremental**: every time a new commit is observed, the linker updates the `invalidating_commits` collection for each affected entity.  This avoids the need for a bulk recomputation that would require re‑indexing the entire knowledge base after each change.  The result is a lightweight, read‑optimised representation where “every entity read” can instantly surface its latest decay signal, as described in the sub‑component description.

> **Location in the codebase** – the observations do not list concrete file paths or symbols, but the component lives under the **`KnowledgeDecayTracker`** package (the parent component) and is referenced from the **`KnowledgeDecayTracker`** class.  All interactions are mediated through the `EntityMetadata.invalidating_commits` attribute.

---

## Architecture and Design  

The architecture follows an **embedded‑metadata** pattern.  Rather than modelling a many‑to‑many relationship between entities and commits with a separate join table, the system stores a **compact, serialized list of commit references** directly inside each `EntityMetadata` row.  This design choice trades relational flexibility for **read‑time efficiency**: a single database fetch returns both the entity’s content and its complete invalidation history, eliminating extra round‑trips.

The component’s responsibilities can be visualised as a three‑stage pipeline:

1. **Commit Ingestion** – a watcher (outside the scope of the observations) detects new Git commits and supplies the raw diff.  
2. **Entity‑Touch Detection** – the linker consults the **KnowledgeManagement** mapping (entity ↔ source file) to decide which entities are “touched” by the diff. This heuristic is based on file‑overlap or code‑ownership information already present in the system.  
3. **Metadata Update** – for each touched entity, the linker serialises the new commit identifier and appends it to the `invalidating_commits` field, persisting the change in place.

The only explicit design pattern mentioned is **incremental update** (as opposed to batch recompute).  The component therefore behaves like a **synchroniser** that keeps the metadata in lock‑step with the source‑control stream.

Because the commit list lives inside `EntityMetadata`, the linker must also handle **compact serialization** (e.g., a JSON array, a delimited string, or a protobuf blob).  This keeps the record size modest and ensures that the “single‑record read” guarantee of the parent `KnowledgeDecayTracker` remains true.

---

## Implementation Details  

* **Data Model** – `EntityMetadata` contains an `invalidating_commits` attribute.  The attribute stores **serialized commit references** (hashes or internal IDs).  The exact serialization format is not disclosed, but the observation stresses “compact, embedded structure,” implying a lightweight encoding rather than a full object graph.

* **Linker Logic** – The **InvalidatingCommitLinker** is invoked each time a new commit arrives.  Its algorithm can be summarised as:

  ```text
  for each new_commit:
      diff = git.diff(new_commit)
      touched_files = diff.changed_paths
      for each file in touched_files:
          entities = KnowledgeManagement.lookup_entities(file)
          for each entity in entities:
              EntityMetadata[entity].invalidating_commits.append(serialize(new_commit))
  ```

  The key operations are:
  * **Git diff extraction** – obtaining the set of files altered by the commit.
  * **Entity‑to‑file resolution** – a lookup into the KnowledgeManagement component that maps source files to the knowledge entities that depend on them.
  * **In‑place metadata mutation** – appending the serialized commit reference to the entity’s `invalidating_commits` field and persisting the change.

* **Incremental Update vs. Bulk Re‑index** – The observations explicitly state that the linker “must update incrementally as new commits arrive rather than recomputed in bulk.”  This means the implementation avoids scanning the entire entity catalog on each commit; instead it performs a **targeted update** only for the subset of entities that intersect the diff.

* **Compact Storage** – Because the commit list is embedded, the linker likely caps the list size (e.g., retaining only the most recent N commits) or compresses it.  This prevents unbounded growth of the `EntityMetadata` row and keeps read latency low.

* **Error Handling & Idempotency** – While not mentioned, a robust implementation would need to guard against duplicate insertions (e.g., re‑processing the same commit) and ensure that partial failures do not leave the `invalidating_commits` field in an inconsistent state.  Such concerns would be addressed at the transaction or retry‑logic layer surrounding the linker.

---

## Integration Points  

* **Parent – KnowledgeDecayTracker**  
  `KnowledgeDecayTracker` owns the overall staleness calculation.  It reads `EntityMetadata.invalidating_commits` to derive a **decay signal** that reflects both elapsed time and concrete code changes.  The tracker therefore relies on the linker to keep this field up‑to‑date; any lag in the linker directly impacts decay accuracy.

* **Sibling – Other Decay Sources**  
  While the observations do not enumerate siblings, any other component that contributes to an entity’s decay (e.g., usage‑frequency trackers) will share the same `EntityMetadata` record.  The embedded commit list coexists with those other fields, preserving a **single‑source‑of‑truth** design.

* **Child – KnowledgeManagement**  
  The linker calls into **KnowledgeManagement** to resolve which entities correspond to a changed source file.  This dependency is crucial: the <USER_ID_REDACTED> of the mapping determines how precisely commits are linked to entities.  If KnowledgeManagement provides a fine‑grained, file‑level map, the linker can achieve high fidelity; a coarse‑grained map would result in over‑linking (more entities flagged than necessary).

* **External – Git Repository**  
  The source of commit data is the Git history.  The linker must have read access to the repository (or a service exposing diffs) and be able to retrieve commit hashes, timestamps, and the list of changed paths.  No direct coupling to Git internals is described, suggesting the existence of an abstraction layer that supplies the diff to the linker.

---

## Usage Guidelines  

1. **Treat `invalidating_commits` as read‑only outside the linker.**  Direct manipulation of the field bypasses the diff‑to‑entity mapping logic and can corrupt the decay signal.  All updates should flow through the `InvalidatingCommitLinker` API or its scheduled job.

2. **Ensure the KnowledgeManagement entity‑file map stays current.**  Since the linker relies on this map to decide which entities to update, any drift (e.g., after refactoring files without updating the map) will cause stale or missing links.  Synchronise the map whenever the codebase structure changes.

3. **Monitor the size of the embedded commit list.**  If the list grows unchecked, it can inflate the `EntityMetadata` row and degrade read performance.  Implement a retention policy (e.g., keep only the last N commits or commits within a time window) inside the linker.

4. **Run the linker in an incremental, idempotent fashion.**  The component should be safe to re‑process the same commit without duplicating entries.  This is essential for recovery after failures or when replaying a backlog of commits.

5. **Avoid bulk re‑indexing unless absolutely necessary.**  The design deliberately eschews full recomputation; a bulk rebuild would defeat the purpose of the embedded, incremental model and could cause temporary inconsistencies.

---

## Summary of Core Insights  

| Aspect | Insight |
|--------|---------|
| **Architectural patterns identified** | Embedded‑metadata (commit list inside `EntityMetadata`), Incremental update synchroniser, Compact serialization for in‑record storage. |
| **Design decisions and trade‑offs** | *Embedding* avoids join <USER_ID_REDACTED> → faster reads, but limits flexibility and requires careful size management. *Incremental* updates reduce compute cost → lower latency, but depend on accurate diff‑to‑entity mapping. |
| **System structure insights** | `InvalidatingCommitLinker` sits under `KnowledgeDecayTracker`, consumes mappings from `KnowledgeManagement`, and writes to `EntityMetadata`.  It is the sole producer of the `invalidating_commits` field. |
| **Scalability considerations** | Since updates are targeted, the component scales with the number of changed files per commit, not with total entity count.  However, unchecked growth of the embedded list can hurt storage and read performance; a retention policy is required. |
| **Maintainability assessment** | The logic is confined to a single component, making it easy to reason about.  Dependencies are limited to two well‑defined interfaces (Git diff provider, KnowledgeManagement map).  The main maintenance burden lies in keeping the entity‑file map accurate and managing the size of the serialized commit list. |

*The above document should serve as the authoritative reference for developers working with **InvalidatingCommitLinker** and its surrounding decay‑tracking ecosystem.*


## Hierarchy Context

### Parent
- [KnowledgeDecayTracker](./KnowledgeDecayTracker.md) -- KnowledgeDecayTracker embeds staleness state directly in EntityMetadata rather than a separate store, so every entity read returns its own decay signal without additional <USER_ID_REDACTED>


---

*Generated from 4 observations*
