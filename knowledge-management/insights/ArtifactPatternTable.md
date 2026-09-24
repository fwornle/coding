# ArtifactPatternTable

**Type:** Detail

## What It Is

ArtifactPatternTable is the literal `this.artifactPatterns` array defined at `src/ontology/heuristics/EntityPatternAnalyzer.ts:47-107`, inside the parent class `EntityPatternAnalyzer`. It is not a separate class or module but a private, in-memory data structure: an array of four `ArtifactPattern` objects — one each for the Coding, RaaS, ReSi, and UI teams — conforming to an interface (`{team, patterns: RegExp[], entityClassMap: Record<string,string>}`) declared around line 16-20 of the same file. It exists to serve as the fallback classifier in EntityPatternAnalyzer's team-attribution logic, activated only when the higher-confidence lookup fails.

## Architecture and Design

The table is the concrete embodiment of two architectural patterns noted in the observations: a rule/dispatch table (static array of `{team, patterns, entityClassMap}` records replacing a switch/if-chain) and a two-tier fallback matching scheme shared with sibling TwoStepArtifactMatching. In that scheme, `checkLocalArtifact` (backed by the informally-named TeamDirectoryRegistry — really just the `teamDirectories` Map) is tried first, returning confidence 0.9 on a directory-prefix hit; only when it returns null does `matchArtifactPattern` consult ArtifactPatternTable, returning confidence 0.75. This tiering is deliberate: directory placement is treated as strong, near-certain evidence of team ownership, while regex pattern matching against class/product names is treated as weaker, more ambiguous evidence — a distinction that matters downstream, since the Second-Brain Vault Routing work record notes that lower-confidence attributions are exactly the case a history-preserving merge step must tolerate rather than blindly overwrite.

A notable structural weakness is duplication: the table's per-entry `entityClassMap` duplicates the same four team→class associations found in a separate `teamMappings` table used by `inferEntityClass` on the directory-match path. Nothing in the file unifies these two lookup structures into one shared constant.

## Implementation Details

Each of the four entries mixes two regex styles: suffix-style class-name patterns (Coding's `LSL(Session|Monitor|Classifier)`, `Constraint(Rule|Monitor|Hook)`, `MCP(Agent|Service|Tool)`, `Knowledge(Entity|Retriever|Extractor)`) and bare product/technology-name patterns (RaaS's `Prometheus(Metric)`, `Grafana(Dashboard)` alongside its class-style `Kubernetes(Cluster|Pod|Service)`). All regexes carry the case-insensitive `i` flag. These patterns are read solely by `matchArtifactPattern`, and each entry's `entityClassMap` is read solely by `inferEntityClassFromPattern` — two functions with narrow, single-purpose responsibilities.

Because the sibling ArtifactExtractionEngine's generic extraction regex (`[A-Z][a-zA-Z]+(Service|Agent|Manager|Engine|Handler|Analyzer|Classifier|Filter|Monitor)`, inside `extractArtifacts`) runs over the same content that ArtifactPatternTable's team-specific patterns test against, a string like `FunctionOrchestrator` can satisfy both a dedicated team pattern and the generic extractor simultaneously. This redundancy is rendered moot by `analyzeEntityPatterns`'s documented Set-ordering behavior: it returns on the first artifact/match found, so the table's per-team specificity never gets a chance to arbitrate ambiguous cases — whichever regex happens to fire first wins.

The table is constructed once, in the constructor, as literal `RegExp` objects — no external config, no I/O, no parsing per call — which the file's docstring ties directly to its claimed "<1ms response time."

## Integration Points

ArtifactPatternTable is consumed exclusively within EntityPatternAnalyzer: `matchArtifactPattern` reads `patterns`, `inferEntityClassFromPattern` reads `entityClassMap`, and both are invoked only after `checkLocalArtifact` (the TeamDirectoryRegistry equivalent) has already returned null for a given artifact, per the TwoStepArtifactMatching flow. Its output — a team label plus 0.75 confidence — feeds into `analyzeEntityPatterns`'s `LayerResult`, which the Knowledge Management Subsystem work record identifies as Layer 1 input to the broader capture → observations/insights → indexing → rollup → graph pipeline. The team enumeration here (Coding/RaaS/ReSi/UI) must stay in lockstep with the same four-team enumeration in `teamDirectories`; a fifth team, "Agentic," already exists in the unrelated `teamMappings` table but has not been added here or to `teamDirectories`, leaving the two-step matcher unable to recognize it.

## Usage Guidelines

Any change to team scope — adding, renaming, or retiring a team — requires editing this table directly, since it is hardcoded RegExp literals with no external data source; unlike `teamDirectories`'s plain path-prefix strings, this is a code change requiring redeploy, not a data update. When adding a new entity class mapping, developers must update both this table's `entityClassMap` and the parallel `teamMappings` table in `inferEntityClass` manually, as there's no shared constant enforcing consistency. Given the Set-ordering bug in `analyzeEntityPatterns`, adding a highly specific pattern here does not guarantee it will be evaluated preferentially over the generic extractor's matches — pattern specificity is effectively advisory, not authoritative, until that ordering issue is addressed. Finally, confidence values (0.9 for directory hits, 0.75 for pattern hits) are hardcoded in two places — the table definition and the call site — so any recalibration of confidence tiering must be applied consistently in both locations.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Relationships:**
- EntityPatternAnalyzer.ts:47-107 defines the artifact-pattern table itself: `this.artifactPatterns` is an array of four `ArtifactPattern` objects (interface at line ~16-20: `{team, patterns: RegExp[], entityClassMap: Record<string,string>}`), one per team — Coding, RaaS, ReSi, UI. This is the exact structure the parent's CGR observation calls 'regex against artifactPatterns, confidence 0.75' and is consumed only by `matchArtifactPattern`, which is reached only after `checkLocalArtifact` (the `teamDirectories` lookup) has already returned null for a given artifact — so the table is a fallback classifier, never the first-choice one.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The work record 'Second-Brain Vault Routing & Skill Architecture' establishes that externally drafted feedback files dropped in ~/Downloads/ must be merged into canonical per-person files in the second-brain-private vault while preserving history and avoiding duplication — this is the downstream consumer context that makes the artifact-pattern table's confidence tiering (0.9 for a directory hit, 0.75 for a pattern-table hit) meaningful: a lower-confidence pattern match is exactly the kind of ambiguous attribution that a history-preserving merge step (rather than an overwrite) needs to tolerate.
- The work record 'Knowledge Management Subsystem: Capture, Storage, Embedding, Rollup, and Graph' describes the end-to-end pipeline (capture → observations/insights → indexing → rollup → graph) that this table's team attribution feeds into as Layer 1 input; the table's four-team scope (Coding/RaaS/ReSi/UI) reflects the org structure known to the pipeline at the time this layer was written, and any org changes (new teams, renamed teams) would need corresponding edits to this table specifically, since nothing here derives team names from an external source of truth.

## Hierarchy Context

### Parent
- [EntityPatternAnalyzer](./EntityPatternAnalyzer.md) -- [CGR] EntityPatternAnalyzer (class) in EntityPatternAnalyzer.ts

### Siblings
- [TeamDirectoryRegistry](./TeamDirectoryRegistry.md) -- [LLM] No file in the supplied evidence defines a class, module, or export named "TeamDirectoryRegistry". The only structurally similar artifact is the private `teamDirectories` field on `EntityPatternAnalyzer` (src/ontology/heuristics/EntityPatternAnalyzer.ts) — a `Map<string, string[]>` built inline in the constructor, not a separate registry class. It is read exclusively by `checkLocalArtifact`, which iterates `this.teamDirectories.entries()` and does a directory-prefix `startsWith` test; there is no importable registry object, no CRUD surface, and no file dedicated to team-directory storage.
- [ArtifactExtractionEngine](./ArtifactExtractionEngine.md) -- [LLM+CGR] No file, class, or module named "ArtifactExtractionEngine" appears anywhere in the supplied code graph or code files. The only artifact-extraction logic present is the private `extractArtifacts()` method inside `EntityPatternAnalyzer` (src/ontology/heuristics/EntityPatternAnalyzer.ts), which the code graph confirms is a method of the Layer-1 class `EntityPatternAnalyzer`, not a standalone `ArtifactExtractionEngine` component. This strongly suggests "ArtifactExtractionEngine" is a descriptive label applied post-hoc to a sub-routine of EntityPatternAnalyzer rather than a distinct, separately-implemented entity.
- [TwoStepArtifactMatching](./TwoStepArtifactMatching.md) -- [LLM+CGR] analyzeEntityPatterns (EntityPatternAnalyzer.ts) implements the two-step matching directly: for each artifact produced by extractArtifacts, it first calls checkLocalArtifact — a directory-prefix test against the teamDirectories Map, returning confidence 0.9 — and only when that returns null does it fall through to matchArtifactPattern, a regex test against the artifactPatterns array, returning confidence 0.75. The loop returns on the first artifact that satisfies either step, so a single early directory or pattern hit determines the whole LayerResult; later artifacts in the same knowledge entry are never even inspected once a match fires.


---

*Generated from 9 observations*
