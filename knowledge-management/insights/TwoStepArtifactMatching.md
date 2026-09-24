# TwoStepArtifactMatching

**Type:** Detail

## What It Is

TwoStepArtifactMatching is the core matching algorithm implemented in `analyzeEntityPatterns` within `src/ontology/heuristics/EntityPatternAnalyzer.ts`, the Layer 1 (`layer: 1, layerName: 'EntityPatternAnalyzer'`) stage of a multi-layer team-ownership detection pipeline. It is not a standalone class but a design pattern realized inside the parent class `EntityPatternAnalyzer`: for each artifact string produced by `extractArtifacts`, it applies a two-rung fallback ladder — `checkLocalArtifact` first, `matchArtifactPattern` second — to determine which team owns that artifact, and returns on the first success.

## Architecture and Design

The defining pattern is a chain-of-responsibility / fallback ladder with fixed, hardcoded confidence per rung: `checkLocalArtifact` (directory-prefix match against `teamDirectories`, confidence 0.9) is tried first, and only if it returns null does `matchArtifactPattern` (regex match against the `artifactPatterns` array, confidence 0.75) get a chance. This encodes an architectural bias — directory-prefix evidence is privileged over naming-convention evidence — as a static number rather than a computed match-strength score.

Compounding this, the artifact loop itself short-circuits: the first artifact (out of the Set built by `extractArtifacts`) that satisfies either step wins, and the LayerResult is returned immediately. There is no aggregation, confidence-summing, or majority vote across the full artifact set extracted from a knowledge entry. Since `extractArtifacts` merges four independent regex passes (file paths, npm-scoped packages, class names, directory prefixes) into one `Set<string>` and Sets preserve insertion order, the order in which those regexes run becomes an implicit, undocumented priority mechanism whenever a knowledge entry mentions artifacts belonging to more than one team.

## Implementation Details

`extractArtifacts` performs four regex passes and merges all matches into a single ordered `Set<string>`, returned via `Array.from`. `analyzeEntityPatterns` iterates this array top-to-bottom, calling `checkLocalArtifact` then `matchArtifactPattern` per artifact, exiting on first hit. `checkLocalArtifact` iterates `this.teamDirectories.entries()` doing a `startsWith` prefix test, and on match invokes the private `inferEntityClass`, whose `teamMappings` table resolves an `entityClass` per team. `matchArtifactPattern` instead resolves `entityClass` via `inferEntityClassFromPattern` against the `entityClassMap` embedded in the matched `ArtifactPattern` entry (the structure documented under sibling ArtifactPatternTable, `EntityPatternAnalyzer.ts:47-107`).

Critically, these two entity-class resolution paths are structurally independent tables maintained in parallel rather than derived from one source of truth — a directory hit and a pattern hit for the "same" artifact are not guaranteed to agree on `entityClass` even if they'd agree on team. A further inconsistency: `teamMappings` defines an 'Agentic' key (Agent→AgentFramework, RAG→RAGSystem, LLM→LLMProvider, Vector→VectorStore) that is unreachable dead code, since `checkLocalArtifact` only iterates `teamDirectories`, whose constructor defines just four teams (Coding, RaaS, ReSi, UI) — a fifth team planned in classification but never wired into the directory list.

## Integration Points

TwoStepArtifactMatching is entirely internal to the parent `EntityPatternAnalyzer`, drawing on sibling structures that are not independent components despite descriptive naming: ArtifactPatternTable is simply the `this.artifactPatterns` array field consumed by `matchArtifactPattern` as a fallback classifier; TeamDirectoryRegistry is just the private `teamDirectories` Map field, not a separate registry class; ArtifactExtractionEngine is just the private `extractArtifacts` method. All are sub-structures of the same file/class, not decoupled components.

Downstream, the Layer-1 output (team/owner attribution) feeds workflows like the 'Second-Brain Vault Routing & Skill Architecture' work, where externally drafted feedback files must be merged into canonical per-person files — a wrong or ambiguous two-step match here determines misrouting. The 'Detail Roll-up Background Task' work record further notes that any consolidation pipeline downstream must verify completion via process exit code, since a silently-failed rollup would leave this component's mis-attributed entities in place undetected.

## Usage Guidelines

Because confidence values (0.9, 0.75) are fixed per rung rather than computed, callers should treat them as ordinal priority markers, not calibrated probabilities. Given the first-match-wins semantics in both the outer artifact loop and inner pattern loop, developers modifying `extractArtifacts` must be aware that regex ordering silently determines team attribution for multi-team knowledge entries — reordering the four regex passes is a behavioral change, not a refactor. Anyone adding a new team must update `teamDirectories`, `artifactPatterns`, and `teamMappings` in `inferEntityClass` together, since these are parallel, non-normalized tables prone to drift (as evidenced by the orphaned 'Agentic' entry). Finally, because `entityClass` is resolved differently depending on which of the two steps fires, consumers of LayerResult should not assume `entityClass` consistency across artifacts of the same conceptual type matched via different steps.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Relationships:**
- analyzeEntityPatterns (EntityPatternAnalyzer.ts) implements the two-step matching directly: for each artifact produced by extractArtifacts, it first calls checkLocalArtifact — a directory-prefix test against the teamDirectories Map, returning confidence 0.9 — and only when that returns null does it fall through to matchArtifactPattern, a regex test against the artifactPatterns array, returning confidence 0.75. The loop returns on the first artifact that satisfies either step, so a single early directory or pattern hit determines the whole LayerResult; later artifacts in the same knowledge entry are never even inspected once a match fires.

**Other:**
- extractArtifacts runs four independent regex passes (file paths, npm-scoped packages, Service/Agent/Manager/…/Monitor-suffixed class names, and bare directory prefixes) and merges every match into one `Set<string>` before returning `Array.from(artifacts)`. Because a JS Set preserves insertion order and analyzeEntityPatterns iterates that array top-to-bottom with an early return, the regex that happens to run first (file paths before npm packages before class names before directories) has an implicit priority over ownership attribution whenever a knowledge entry references artifacts from more than one team — there is no scoring, confidence-summing, or majority vote across the extracted set.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The 'Second-Brain Vault Routing & Skill Architecture' work record establishes that externally drafted personal-development feedback dropped into ~/Downloads/ as .md files must be merged into canonical per-person feedback files inside the second-brain-private vault, with history preserved and no data loss or duplication during the merge — this is the downstream task this component's Layer-1 team/owner attribution feeds, since a wrong or ambiguous two-step match here determines which canonical file a piece of incoming content gets routed into.
- The 'Detail Roll-up Background Task — Monitoring and Validation' work record establishes that any background job consolidating fine-grained records must have its completion actively verified via process exit code rather than assumed successful once launched; this generalizes to whatever consolidation pipeline sits downstream of EntityPatternAnalyzer's Layer-1 output, since a silently-failed rollup would leave mis-attributed or partially-attributed entities in place with no signal in this class itself.

## Hierarchy Context

### Parent
- [EntityPatternAnalyzer](./EntityPatternAnalyzer.md) -- [CGR] EntityPatternAnalyzer (class) in EntityPatternAnalyzer.ts

### Siblings
- [ArtifactPatternTable](./ArtifactPatternTable.md) -- [LLM+CGR] EntityPatternAnalyzer.ts:47-107 defines the artifact-pattern table itself: `this.artifactPatterns` is an array of four `ArtifactPattern` objects (interface at line ~16-20: `{team, patterns: RegExp[], entityClassMap: Record<string,string>}`), one per team — Coding, RaaS, ReSi, UI. This is the exact structure the parent's CGR observation calls 'regex against artifactPatterns, confidence 0.75' and is consumed only by `matchArtifactPattern`, which is reached only after `checkLocalArtifact` (the `teamDirectories` lookup) has already returned null for a given artifact — so the table is a fallback classifier, never the first-choice one.
- [TeamDirectoryRegistry](./TeamDirectoryRegistry.md) -- [LLM] No file in the supplied evidence defines a class, module, or export named "TeamDirectoryRegistry". The only structurally similar artifact is the private `teamDirectories` field on `EntityPatternAnalyzer` (src/ontology/heuristics/EntityPatternAnalyzer.ts) — a `Map<string, string[]>` built inline in the constructor, not a separate registry class. It is read exclusively by `checkLocalArtifact`, which iterates `this.teamDirectories.entries()` and does a directory-prefix `startsWith` test; there is no importable registry object, no CRUD surface, and no file dedicated to team-directory storage.
- [ArtifactExtractionEngine](./ArtifactExtractionEngine.md) -- [LLM+CGR] No file, class, or module named "ArtifactExtractionEngine" appears anywhere in the supplied code graph or code files. The only artifact-extraction logic present is the private `extractArtifacts()` method inside `EntityPatternAnalyzer` (src/ontology/heuristics/EntityPatternAnalyzer.ts), which the code graph confirms is a method of the Layer-1 class `EntityPatternAnalyzer`, not a standalone `ArtifactExtractionEngine` component. This strongly suggests "ArtifactExtractionEngine" is a descriptive label applied post-hoc to a sub-routine of EntityPatternAnalyzer rather than a distinct, separately-implemented entity.


---

*Generated from 9 observations*
