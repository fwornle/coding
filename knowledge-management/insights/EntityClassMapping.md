# EntityClassMapping

**Type:** Detail

[Architecture Notes] Team ownership inference is data-driven via two parallel structures in EntityPatternAnalyzer.ts (teamDirectories Map and artifactPatterns array with nested entityClassMap), with no single canonical registry — the same keyword-to-class mapping is duplicated across entityClassMap and inferEntityClass()'s local teamMappings.; Confidence scores are hardcoded constants (0.9 for direct path match, 0.75 for regex pattern match) rather than computed from match specificity or ambiguity, so a highly ambiguous substring match receives the same confidence as an unambiguous one.; verify-patterns.sh's compliance scoring is a standalone bash implementation independent of the TS ontology layer, meaning the 'canonical class name' convention (e.g. Logger) is verified through simple grep/rg counting rather than through any shared parser or the entityClassMap structures used elsewhere in the ontology.; extractArtifacts() constrains file-path detection to a fixed extension whitelist (ts/js/cpp/java/tsx/jsx/py/go/rs), creating a scope boundary that excludes fixture/demo files in other languages (e.g. .cs, .xaml) from ever being classified by this analyzer even when they follow an equivalent naming convention.

# EntityClassMapping — Technical Insight Document

## What It Is

`EntityClassMapping` is the keyword-to-class derivation convention implemented in `src/ontology/heuristics/EntityPatternAnalyzer.ts`, whereby a bare keyword (e.g. `Kubernetes`, `Lambda`, `MCP`, `Agent`, `Knowledge`) is mapped to a fully-qualified entity class name (e.g. `KubernetesCluster`, `AWSLambdaFunction`, `MCPAgent`, `AgentInstance`, `KnowledgeEntity`/`KnowledgeGraph`). This mapping is expressed as static, hand-maintained data — `entityClassMap` objects nested inside each `ArtifactPattern` (lines 14–18, 70–91), and a parallel `teamMappings` record inside `inferEntityClass()` (lines 185–210). Rather than being derived metadata computed from some canonical source, the suffix convention is duplicated inline wherever it's needed, making `EntityClassMapping` fundamentally a *convention encoded as repeated literals* rather than a single registry.

As the child concept of `NamingConventions`, it sits alongside sibling components `ArtifactPatternMatching` (the regex layer that feeds candidate artifact strings into the map) and `TeamDirectoryOwnership` (the path-based ownership cascade that takes precedence over it). Together these three form the ontology's team-inference heuristics stack.

## Architecture and Design

The overarching architectural pattern is **first-match-wins layered inference**: `analyzeEntityPatterns()` first calls `checkLocalArtifact()` (confidence 0.9, per `TeamDirectoryOwnership`), and only on failure falls back to `matchArtifactPattern()` (confidence 0.75, lines 143–172), which returns on the *first* regex match in `artifactPatterns` without collecting or ranking competing candidates. `EntityClassMapping` operates within this second tier — once a pattern matches, its `entityClassMap` supplies the resolved class name, and `inferEntityClassFromPattern()` (referenced but truncated) presumably performs the same brittle substring-containment check against `entityClassMap` keys.

This design encodes an implicit assumption that array-authoring order is an acceptable proxy for semantic team ownership. Because keys like `Agent`, `Knowledge`, `Function`, and `Event` are short common English words reused across multiple teams' `entityClassMap` objects — `Knowledge` maps to `KnowledgeEntity` for 'Coding' but `KnowledgeGraph` for 'Agentic' — the mapping is not injective. Whichever `ArtifactPattern` block is iterated first effectively arbitrates ambiguous cases, a fragile and undocumented precedence rule rather than a deliberate conflict-resolution strategy.

## Implementation Details

Mechanically, three code paths all need to agree for a new entity class to work correctly: the `patterns: RegExp[]` array (shared with sibling `ArtifactPatternMatching`), the `entityClassMap` record, and — if path-based inference also needs it — the `teamMappings` in `inferEntityClass()`. `extractArtifacts()` (lines 218–232) is the upstream producer of candidate strings, using a generic class-name regex `/[A-Z][a-zA-Z]+(Service|Agent|Manager|Engine|Handler|Analyzer|Classifier|Filter|Monitor)/g` alongside a file-path regex restricted to a fixed extension whitelist (`ts|js|cpp|java|tsx|jsx|py|go|rs`). This extension boundary means files like `.cs` or `.xaml` are structurally invisible to the analyzer.

Confidence scoring is hardcoded rather than computed: 0.9 for direct path matches, 0.75 for regex matches, regardless of how ambiguous or specific the underlying match actually is. An unambiguous `Kubernetes` match and a highly ambiguous bare `Agent` match receive identical confidence, since specificity is never measured.

## Integration Points

`EntityClassMapping` is tightly coupled to sibling `ArtifactPatternMatching`, since the `ArtifactPattern` interface bundles `team`, `patterns`, and `entityClassMap` into one record that must be hand-synchronized — the 'Coding' team's `/MCP(Agent|Service|Tool)/i` regex but single `MCP: 'MCPAgent'` map entry silently collapses `MCPService` and `MCPTool` matches to the wrong class. It also depends on `TeamDirectoryOwnership`'s precedence: path matches short-circuit before entity-class regex resolution is even attempted.

Outside the TS ontology layer, `verify-patterns.sh` (`scripts/knowledge-management/verify-patterns.sh:29-31`) implements a parallel, independent convention-as-compliance-check for `Logger` as the canonical class of `ConditionalLoggingPattern`, using `console.log` vs `Logger.(log|debug|info|warn|error)` grep/rg counts. There is no shared verification layer between this bash heuristic and `EntityClassMapping`'s TS-side structures — each enforces naming conventions independently. Separately, the `DesignViewModel.cs`/`DesignView.xaml` fixture pair (`integrations/graphify/tests/fixtures/xaml_viewmodel/`) illustrates the same suffix-pairing idea (ViewModel/View via `d:DataContext`) in a language `EntityPatternAnalyzer` cannot parse, exposing a scope gap between where conventions are demonstrated and where they're enforced.

## Usage Guidelines

Any new entity class addition requires updating at minimum two locations — the `patterns: RegExp[]` array and the corresponding `entityClassMap` entry — and a third (`teamMappings`) if path-based inference also needs it; skipping any one silently produces incorrect classification rather than an error. Developers should avoid introducing short, common-word keys (like `Agent`, `Knowledge`, `Function`) into `entityClassMap` without checking for collisions across other teams' maps, since resolution order — not semantics — decides the outcome. Because confidence scores are hardcoded constants, they should not be treated as true reliability signals; a 0.75 regex match may be far less trustworthy than another 0.75 match depending on keyword ambiguity. Finally, if extending artifact detection to new languages or file types, the extension whitelist in `extractArtifacts()` must be updated explicitly — conventions demonstrated in fixtures like the XAML ViewModel/View pair will otherwise never be recognized by this analyzer.


## Hierarchy Context

### Parent
- [NamingConventions](./NamingConventions.md) -- [LLM] scripts/knowledge-management/verify-patterns.sh implements a self-contained compliance checker that greps the codebase for `console.log` calls versus `Logger.*` calls to enforce the ConditionalLoggingPattern naming/usage convention referenced in the parent CodingPatterns component. The script hardcodes its resolution of `CLAUDE_REPO` via `CODING_TOOLS_PATH`/`CODING_REPO` env vars with a fallback to a path derived two directories up from `SCRIPT_DIR`, which ties the script's correctness to its physical location at `scripts/knowledge-management/verify-patterns.sh` — moving the file would silently break the repo-root inference unless the env vars are set.

### Siblings
- [ArtifactPatternMatching](./ArtifactPatternMatching.md) -- [LLM] The `ArtifactPattern` interface in src/ontology/heuristics/EntityPatternAnalyzer.ts couples three independent concerns into a single record: a `team` string, an array of `RegExp` objects, and an `entityClassMap` keyed by keyword. This means the regex list and the entity-class lookup table are maintained as parallel structures that must be kept in sync by hand — for example the 'Coding' team's patterns array contains `/MCP(Agent|Service|Tool)/i` while its entityClassMap only maps the bare keyword `MCP: 'MCPAgent'`, silently collapsing `MCPService` and `MCPTool` matches to the same `MCPAgent` entity class in `inferEntityClassFromPattern`. This is a latent classification-accuracy bug rather than a crash risk, since the method still returns *a* class, just not necessarily the correct one.
- [TeamDirectoryOwnership](./TeamDirectoryOwnership.md) -- [LLM] EntityPatternAnalyzer.analyzeEntityPatterns() (src/ontology/heuristics/EntityPatternAnalyzer.ts) implements a two-step ownership inference cascade with an explicit confidence gradient: checkLocalArtifact() first tests whether an extracted artifact's path starts with one of the hard-coded directory prefixes in the teamDirectories Map (confidence 0.9), and only if that fails does matchArtifactPattern() fall back to regex matching against artifactPatterns (confidence 0.75). This ordering encodes a design assumption that a file's physical location is a stronger ownership signal than its name — but because both paths and class names are static, hand-maintained lists, the analyzer has no mechanism to detect drift when a file moves teams or a class is renamed without an accompanying update to this file.


---

*Generated from 9 observations*
