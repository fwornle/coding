# LayeredDocsSubdirectoryStructure

**Type:** Detail

The same convention appears in integrations/mcp-constraint-monitor/docs/, which contains CLAUDE-CODE-HOOK-FORMAT.md, constraint-configuration.md, semantic-constraint-detection.md, semantic-detection-design.md, and status-line-integration.md — all flat files without subdirectories — suggesting the layered subdirectory pattern scales in only when an integration reaches sufficient documentation volume.

# LayeredDocsSubdirectoryStructure

## What It Is

LayeredDocsSubdirectoryStructure is a documentation organization convention applied within integration packages under the `integrations/` tree, most fully realized in `integrations/mcp-server-semantic-analysis/docs/`. In that location, the convention manifests as three named subdirectories — `architecture/`, `api/`, and `installation/` — each containing its own `README.md` (titled "Architecture Documentation - MCP Server Semantic Analysis", "API Reference - MCP Server Semantic Analysis", and "Installation Guide - MCP Server Semantic Analysis" respectively). Alongside these subdirectories, cross-cutting documents are placed as flat files directly under `docs/`, such as `integrations/mcp-server-semantic-analysis/docs/configuration.md` and `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md`.

As a Detail-level entity nested under the parent DocumentationConventions, this structure codifies a layered approach to documentation: topical subdirectories for content domains that warrant multi-document treatment, and flat files for cross-cutting concerns or design proposals. It coexists with its sibling PlantUmlDiagramConvention, which governs how diagram source files are stored (under `docs/puml/` directories) — together these conventions define a consistent shape for integration documentation across the repository.

## Architecture and Design

The architectural approach is a **hybrid hierarchical/flat layout** that distinguishes between two classes of documentation by structural position. Topical content domains that have grown to require multiple files are promoted into named subdirectories with their own `README.md` index, making each subdirectory's purpose self-describing through its title. The README-as-index pattern means that any tool or human navigating into `architecture/`, `api/`, or `installation/` immediately encounters a titled entry point rather than an undifferentiated file listing.

Cross-cutting or transitional content remains as flat files at the `docs/` root. This serves two distinct semantic purposes evident in the observations: stable reference material that doesn't belong to a single subdirectory (e.g., `configuration.md`) and proposal/design documents that may be in flux (e.g., `TIERED-MODEL-PROPOSAL.md`). The naming convention itself — uppercase with hyphens for proposals versus lowercase for stable reference — provides a secondary signal that distinguishes intent without requiring structural separation.

A key design decision is **deferred adoption**: the layered subdirectory pattern is not mandated universally. The contrasting case of `integrations/mcp-constraint-monitor/docs/` — which contains `CLAUDE-CODE-HOOK-FORMAT.md`, `constraint-configuration.md`, `semantic-constraint-detection.md`, `semantic-detection-design.md`, and `status-line-integration.md` as flat files without any subdirectories — demonstrates that the layered pattern scales in only when an integration's documentation volume warrants it. This avoids premature structuring for integrations whose documentation can be navigated linearly.

## Implementation Details

The convention is implemented purely through directory and file conventions rather than tooling or code. The concrete artifacts comprising the pattern at `integrations/mcp-server-semantic-analysis/docs/` are:

- `architecture/README.md` — titled "Architecture Documentation - MCP Server Semantic Analysis"
- `api/README.md` — titled "API Reference - MCP Server Semantic Analysis"
- `installation/README.md` — titled "Installation Guide - MCP Server Semantic Analysis"
- `configuration.md` — flat cross-cutting reference
- `TIERED-MODEL-PROPOSAL.md` — flat design proposal

Each subdirectory's `README.md` serves as the canonical entry point, and the title pattern "{Topic} - {Integration Name}" makes the file self-identifying out of context. The combination of `architecture/README.md` and a top-level `README.md` represents the minimum expected structure for a "fully layered" integration.

The parent DocumentationConventions context notes that the `architecture/` subdirectory's contents reference PlantUML sources, which under the sibling PlantUmlDiagramConvention are stored as `.puml` files in `docs/puml/` directories. Thus an integration adopting the full layered structure may have both `docs/architecture/` (containing the narrative architectural documents) and `docs/puml/` (containing the diagram sources that those documents embed or reference).

## Integration Points

The structure integrates with **automated validation and CI tooling**: the observations note that a valid integration `docs/` directory is expected to contain at minimum an `architecture/README.md` and a top-level `README.md`, with `mcp-server-semantic-analysis` serving as the reference implementation. This makes the convention machine-verifiable — tooling can walk `integrations/*/docs/` and assert presence of the minimum required artifacts.

The convention nests under the broader DocumentationConventions umbrella and works in tandem with its sibling PlantUmlDiagramConvention. Where LayeredDocsSubdirectoryStructure governs the **textual prose layout** (`architecture/`, `api/`, `installation/` plus flat files), PlantUmlDiagramConvention governs the **diagram source layout** (`docs/puml/`). Documents under `architecture/` typically reference or embed renderings from `docs/puml/`, creating a documented coupling between the two siblings.

The structure also implicitly integrates with each integration's identity: subdirectory READMEs incorporate the integration name into their titles (e.g., "- MCP Server Semantic Analysis"), so the documentation is portable and self-describing if extracted from its directory context.

## Usage Guidelines

When creating or evolving documentation for an integration under `integrations/`, follow these conventions:

1. **Start flat, layer when needed.** New integrations should begin with flat files directly under `docs/`, following the pattern of `integrations/mcp-constraint-monitor/docs/`. Only promote a topic into a named subdirectory when its content has grown to justify multiple files plus an index.

2. **Use the three canonical subdirectory names.** When layering is adopted, prefer the established names `architecture/`, `api/`, and `installation/` rather than inventing parallel taxonomies. This preserves predictability for both humans and CI validation.

3. **Always include a `README.md` in each subdirectory.** The README serves as the index and is what CI tooling and navigators expect. Title it in the form "{Topic} - {Integration Name}" to make the file self-describing.

4. **Reserve uppercase/hyphenated filenames for proposals and design documents.** Files like `TIERED-MODEL-PROPOSAL.md` signal in-flux content; stable reference material should use lowercase names like `configuration.md`. Keep these at the `docs/` root rather than burying them in topical subdirectories.

5. **Coordinate with PlantUmlDiagramConvention.** Architectural prose under `docs/architecture/` should reference diagram sources stored under `docs/puml/` rather than embedding diagram syntax inline, respecting the sibling convention.

6. **Meet the minimum bar for a "complete" integration.** At least a top-level `docs/README.md` and a `docs/architecture/README.md` should exist, matching the reference implementation in `integrations/mcp-server-semantic-analysis/`.

---

### Architectural Patterns Identified
- **README-as-index** for each named subdirectory
- **Hybrid hierarchical/flat layout** distinguishing topical domains from cross-cutting concerns
- **Self-describing titles** ("{Topic} - {Integration Name}") embedded in each README
- **Convention-over-configuration** validation: minimum artifacts (`README.md`, `architecture/README.md`) are expected rather than declared in a manifest

### Design Decisions and Trade-offs
- **Deferred structuring** trades immediate consistency for reduced overhead in small integrations; `mcp-constraint-monitor` remains flat while `mcp-server-semantic-analysis` is fully layered
- **Filename casing as a semantic channel** (uppercase for proposals, lowercase for stable) avoids needing a separate `proposals/` directory but relies on contributor discipline
- **Splitting prose from diagrams** across LayeredDocsSubdirectoryStructure and PlantUmlDiagramConvention separates concerns but introduces cross-directory references

### System Structure Insights
The convention forms one half of a two-part documentation standard under DocumentationConventions, with PlantUmlDiagramConvention covering the diagram-source dimension. Together they impose a predictable shape on every integration's `docs/` tree, enabling both human discoverability and CI-driven completeness checks.

### Scalability Considerations
The pattern scales by allowing per-integration adoption: small integrations stay flat (low cognitive overhead), and large integrations layer in subdirectories (avoiding flat-namespace collisions). The fixed taxonomy of `architecture/`, `api/`, `installation/` caps growth at the breadth dimension, while allowing depth (more files per subdirectory) to expand freely.

### Maintainability Assessment
Maintainability is high due to the simplicity of the rules — no specialized tooling is required to apply or interpret the convention. The CI-verifiable minimum structure (`architecture/README.md` + top-level `README.md`) provides automated guardrails against drift. The primary maintenance risk is inconsistency between integrations that have layered and those that have not; this is mitigated by treating layering as volume-triggered rather than mandatory, and by anchoring the reference implementation in `integrations/mcp-server-semantic-analysis/docs/`.


## Hierarchy Context

### Parent
- [DocumentationConventions](./DocumentationConventions.md) -- All architecture diagrams are stored as .puml files under docs/puml/ directories, as evidenced by the documentation listing showing integrations/mcp-server-semantic-analysis/docs/architecture/ containing multiple .md files that reference PlantUML sources.

### Siblings
- [PlantUmlDiagramConvention](./PlantUmlDiagramConvention.md) -- The parent L2 context explicitly states that all architecture diagrams are stored as .puml files under docs/puml/ directories, establishing this as a project-wide convention rather than a per-integration choice.


---

*Generated from 4 observations*
