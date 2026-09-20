# HardcodedTeamDirectoryMap

**Type:** Detail

# HardcodedTeamDirectoryMap — Technical Insight Document

## What It Is

HardcodedTeamDirectoryMap describes a design pattern instantiated in `src/ontology/heuristics/EntityPatternAnalyzer.ts`, where team-ownership classification data — which team owns which directories, packages, and artifact naming conventions — is encoded directly as TypeScript object literals inside the class constructor rather than loaded from an external configuration file. The centerpiece is `teamDirectories`, a `Map<string, string[]>` mapping four teams (Coding, RaaS, ReSi, UI) to literal directory-prefix strings such as `'src/ontology'`, `'raas-service'`, `'virtual-target'`, and `'curriculum-alignment'`. This structure, and its siblings `artifactPatterns` and the `teamMappings` literal inside `inferEntityClass()`, together form the analyzer's classification catalog. The name of the component itself accurately captures its defining trait: a directory-to-team mapping that is fixed at compile time.

## Architecture and Design

This component is a direct architectural inversion of its parent, ConfigDrivenFeatureFlags, which describes a declarative, YAML/JSON-driven approach (e.g., `config/feature-profiles.yaml`) used elsewhere by OntologyClassifier and SensitivityClassifier. Here, the "declarative catalog" is TypeScript literals rather than a parseable external file, meaning team-ownership changes require code edits and rebuilds instead of config PRs — directly undermining the stated goal of shipping behavior changes without TypeScript edits.

The classification flow itself follows a two-step confidence-tiered fallback pattern, formalized in the Architectural Patterns notes: `checkLocalArtifact()` performs high-confidence (0.9) directory-prefix matching, falling back to `matchArtifactPattern()` for lower-confidence (0.75) regex-based matching. This tiering is analogous to the design documented in sibling ArtifactPatternRegistry, which independently notes that `teamDirectories` and `artifactPatterns` are structurally divergent (string-prefix vs. regex-based) lookup tables consumed by different methods, meaning a new artifact type may need edits in two places to achieve high-confidence classification.

## Implementation Details

`checkLocalArtifact()` iterates `teamDirectories.entries()` and returns on the first team whose prefix list matches via `dirs.some((dir) => artifact.startsWith(dir))`. Because `Map` iteration preserves insertion order, Coding is always checked before RaaS, ReSi, and UI — an implicit, unenforced precedence rule rather than an explicit tie-breaking policy, relevant only if prefixes were ever to overlap.

`inferEntityClass()` introduces a second, independent catalog: `teamMappings: Record<string, Record<string, string>>`, which additionally lists an "Agentic" team (Agent/RAG/LLM/Vector) absent from both `teamDirectories` and `artifactPatterns` — concrete evidence, echoed in sibling ArtifactExtractionHeuristics, that the three parallel hardcoded structures have already drifted out of sync.

`matchArtifactPattern()` compounds this redundancy: each team's `artifactPatterns` entry pairs `RegExp[]` with an `entityClassMap` keyed on short prefixes like `LSL`, `Constraint`, `Kubernetes`, `Lambda`. The regex test and the class-name lookup are performed as two independent operations over the same artifact string rather than being derived from a single match, risking silent divergence if only one is updated.

Upstream, `extractArtifacts()` runs four independent regexes (file paths, npm-scoped packages, suffix-based class names like `*Service`/`*Manager`, and bare directory prefixes), merging all results into a single `Set<string>` that discards provenance. `analyzeEntityPatterns()` then iterates this set in insertion order and returns on the first artifact that resolves via either matching method — making the analyzer's effective precision/recall an artifact of extraction-order control flow rather than an explicit, tunable ranking.

## Integration Points

As a child of ConfigDrivenFeatureFlags, this component's core role is to illustrate an anti-pattern relative to the config-driven convention. It shares its underlying data structures directly with siblings ArtifactPatternRegistry (which documents the `teamDirectories`/`artifactPatterns` dual-structure problem) and ArtifactExtractionHeuristics (which documents the "Agentic" team drift). Structurally analogous but independent is `scripts/knowledge-management/verify-patterns.sh`, which sources pattern names dynamically via `jq` against `$SHARED_MEMORY` (selecting `TransferablePattern` entities with `significance >= 8`) yet still hardcodes numeric compliance thresholds (`USESTATE_COUNT -gt 20`, `UNDOCUMENTED_FUNCTIONS -lt 10`), making it a partially declarative sibling case in a different subsystem. Note that the graphify XAML/C# fixtures (`DesignViewModel.cs`, `DesignView.xaml`) appearing in sampled files are unrelated retrieval noise and should not be treated as part of this component's design.

## Usage Guidelines

Developers extending team coverage must edit and redeploy `EntityPatternAnalyzer.ts`, and must remember to update all three catalogs (`teamDirectories`, `artifactPatterns`, `teamMappings`) consistently — the existing "Agentic" divergence is a cautionary example of what happens when this isn't done. Anyone relying on classification confidence should understand that both the team-resolution order (Coding-first) and the artifact-extraction order are implicit, insertion-order-dependent behaviors, not explicit policies — care should be taken before introducing overlapping directory prefixes or assuming stable precedence. Given the parent's stated goal of config-driven behavior, any refactor should consider migrating these catalogs to an external file akin to `config/feature-profiles.yaml`, unifying the three redundant structures, and preserving extraction-source metadata in `extractArtifacts()` to enable explicit rather than incidental precision/recall tuning. The verify-patterns.sh script offers a related but separate opportunity to externalize its hardcoded numeric thresholds while keeping its existing JSON-driven pattern sourcing.


## Hierarchy Context

### Parent
- [ConfigDrivenFeatureFlags](./ConfigDrivenFeatureFlags.md) -- [LLM] The EntityPatternAnalyzer class in src/ontology/heuristics/EntityPatternAnalyzer.ts embodies the config-driven feature flags idea from the parent context, but inverted: instead of an external YAML/JSON file like config/feature-profiles.yaml, the classification rules are hardcoded as in-memory data structures (`teamDirectories: Map<string, string[]>` and `artifactPatterns: ArtifactPattern[]`) built inside the constructor. This is a notable deviation from the declarative-config convention described for OntologyClassifier and SensitivityClassifier elsewhere in the codebase — here the 'declarative catalog' is TypeScript object literals rather than a parseable file, meaning changes to team ownership (e.g., adding a new team or artifact pattern) require a code change and rebuild rather than a config PR, undermining the stated goal of behavior changes shipping without TypeScript/JS edits.

### Siblings
- [ArtifactPatternRegistry](./ArtifactPatternRegistry.md) -- [LLM] EntityPatternAnalyzer's constructor (src/ontology/heuristics/EntityPatternAnalyzer.ts) builds two parallel but structurally divergent lookup tables: `teamDirectories: Map<string, string[]>` (a flat list of path prefixes per team) and `artifactPatterns: ArtifactPattern[]` (an array of `{team, patterns: RegExp[], entityClassMap}` objects). These are consumed by two different private methods — `checkLocalArtifact()` iterates `teamDirectories.entries()` and does an `Array.prototype.some(dir => artifact.startsWith(dir))` check, while `matchArtifactPattern()` iterates `artifactPatterns` and runs `pattern.test(artifact)` for each regex. Maintaining team-ownership knowledge in two separate, differently-shaped structures (one string-prefix based, one regex based) means a new artifact type belonging to an existing team may need edits in both places to be reliably classified at high confidence (0.9) rather than falling through to the lower-confidence (0.75) regex tier.
- [ArtifactExtractionHeuristics](./ArtifactExtractionHeuristics.md) -- [LLM] EntityPatternAnalyzer.ts's constructor builds two hardcoded structures — `teamDirectories: Map<string, string[]>` and `artifactPatterns: ArtifactPattern[]` — that together encode a four-team ownership taxonomy (Coding, RaaS, ReSi, UI). This is a classic 'rules-as-data' design, but because the data lives in TypeScript literals rather than an external file, the class conflates the declarative catalog with the executable code, meaning the only way to extend team coverage (e.g., adding an 'Agentic' team, which is referenced in `inferEntityClass`'s `teamMappings` but absent from `artifactPatterns` and `teamDirectories`) is to edit and redeploy this file — an inconsistency that itself signals the catalog is already drifting out of sync internally.


---

*Generated from 10 observations*
