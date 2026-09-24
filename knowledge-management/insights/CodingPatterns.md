# CodingPatterns

**Type:** Component

## What It Is

CodingPatterns is a component of the Coding project that encodes the *conventions and disciplines* governing how development artifacts — documentation, diagrams, and verification workflows — are structured and maintained, rather than being a runtime code module itself. Its concrete manifestations live in documented rules (docs/puml/, docs/images/, docs-content/images/), architecture indices (docs/architecture/README.md and its family of topic files), root-level onboarding documents (CLAUDE.md, README.md, INSTALL_WINDOWS.md, docker/README.md), and executable tooling (scripts/knowledge-management/verify-patterns.sh). It is best understood as the project's <COMPANY_NAME_REDACTED>-layer for pattern consistency: it defines where things go, how to verify changes after major rewrites, and how to check that other coding patterns (Redux usage, logging conventions, install scripts) are actually followed.

## Architecture and Design

The component's architecture is a documentation-and-tooling convention system rather than a service or module hierarchy. It splits into three child components — DocumentationStyleGuide, ErrorTriageDiscipline, and PatternVerificationTooling — each addressing a distinct concern: artifact placement rules, post-rewrite verification discipline, and automated compliance checking, respectively.

![CodingPatterns — Architecture](images/coding-patterns-architecture.png)

A key design decision is the **paired-source convention**: every rendered diagram in docs/images/ (e.g., coding-system-architecture.png, constraint-monitor-dataflow.png) must have a same-named .puml source in docs/puml/, with the flat, non-namespaced docs/images/ directory relying entirely on this naming pairing for traceability — there is no per-component subdirectory structure. This is a deliberate trade-off favoring simplicity of the output tree at the cost of requiring discipline in naming; if a developer breaks the name pairing, the organizational index (the source tree) no longer maps to the output tree.

Another structural decision is the **two-tier documentation split**: root-level files (CLAUDE.md, README.md, INSTALL_WINDOWS.md, docker/README.md) address onboarding/operational concerns, while docs/architecture/ hosts deep, topic-scoped architectural material (adding-new-agent.md, llm-routing.md, memory-systems.md, token-usage.md, etc.), each covering a cross-cutting concern in isolation from the source code implementing it. This separation is itself an instance of the placement discipline CodingPatterns codifies: file location communicates intended audience and lifecycle stage.

## Implementation Details

DocumentationStyleGuide mandates that .puml sources live in docs/puml/, rendered .png outputs live in docs/images/, and that this tree is kept distinct from docs-content/images/, the MkDocs-served tree holding published site assets. A developer adding a new PlantUML diagram must place the source in docs/puml/, render it, and commit the output to docs/images/ — never mixing the two trees or co-locating a .puml with its rendered counterpart.

ErrorTriageDiscipline establishes a checklist-style verification workflow for the specific scenario following a large rewrite: engineers must actively distinguish pre-existing render errors from true regressions, reproducing against a pre-rewrite baseline (git stash, prior commit checkout, or tagged release) before filing or prioritizing bugs. This guards against two failure modes — wasting triage effort chasing unrelated pre-existing defects, or conversely dismissing a genuine regression as old news.

PatternVerificationTooling is implemented concretely in scripts/knowledge-management/verify-patterns.sh, which uses rg-based (ripgrep) checks to detect compliance with named patterns: ConditionalLoggingPattern (console.log vs Logger usage), ReduxStateManagementPattern (useState vs useSelector/useDispatch counts), NetworkAwareInstallationPattern (grep for check_network/timeout in install.sh), plus undocumented-function detection. Results are aggregated into a timestamped markdown report with a compliance score, making pattern adherence measurable rather than just documented.

![CodingPatterns — Relationship](images/coding-patterns-relationship.png)

## Integration Points

CodingPatterns sits alongside six sibling components under the Coding root — LiveLoggingSystem, LLMAbstraction, DockerizedServices, KnowledgeManagement, ConstraintSystem, and SemanticAnalysis — each representing a distinct infrastructure concern. Unlike those siblings, which describe runtime subsystems (e.g., ObservationWriter.js persistence in LiveLoggingSystem, model catalogue gating in LLMAbstraction, container restart baselines in DockerizedServices), CodingPatterns provides the cross-cutting conventions that documentation and verification for *any* of those subsystems should follow — for instance, docs/architecture/llm-routing.md documents LLMAbstraction concerns using the placement conventions this component defines. PatternVerificationTooling's checks (Redux state, logging, install scripts) implicitly touch code owned by other components even though the tooling itself belongs here.

## Usage Guidelines

Developers adding diagrams must follow the DocumentationStyleGuide strictly: .puml in docs/puml/, rendered .png in docs/images/, never in docs-content/images/, and always preserving matching filenames between source and output since the flat docs/images/ directory has no other organizing structure. When a large rewrite lands and render errors surface, engineers should apply ErrorTriageDiscipline by reproducing against a pre-rewrite baseline before attributing the error to the rewrite. New root-level documents should be placed according to the two-tier convention — onboarding/operational material at the root, deep architectural material under docs/architecture/. Finally, before merging changes that touch logging, state management, or install scripts, run PatternVerificationTooling's verify-patterns.sh to obtain a compliance score and catch drift from ConditionalLoggingPattern, ReduxStateManagementPattern, and NetworkAwareInstallationPattern expectations.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- Documentation Style Guide for Diagrams and Markdown establishes mandatory formatting/placement rules: .puml sources live in docs/puml/, rendered .png files live in docs/images/, distinct from the MkDocs-served docs-content/images/ tree.
- Post-Rewrite Render Error Triage establishes a verification discipline for distinguishing pre-existing render errors from regressions after a large rewrite, ensuring fixes are prioritized correctly and false blame isn't assigned to unrelated recent changes.
- The Documentation Style Guide for Diagrams and Markdown establishes mandatory formatting, naming, and file-placement rules for diagram and markdown artifacts across the project: .puml source files must live in docs/puml/, and their rendered .png outputs must live in docs/images/. This is explicitly distinguished from the separate docs-content/images/ tree, which is served by MkDocs and holds a different class of assets (published documentation site images, not raw diagram exports). A new developer adding a PlantUML diagram must therefore know to place the source in docs/puml/, render it, and commit the output to docs/images/, never mixing the two trees or placing a .puml file directly alongside its rendered counterpart.
- Post-Rewrite Render Error Triage establishes a verification discipline specifically for the situation where a large rewrite has just landed and render errors are being observed: engineers must actively distinguish errors that pre-existed the rewrite from true regressions introduced by it, rather than assuming all currently-visible errors are new. This matters because misattributing a pre-existing defect to the rewrite wastes triage effort chasing unrelated code paths, while the inverse mistake (assuming a real regression is pre-existing) lets a genuine break go unfixed. The pattern implies a checklist-style workflow: reproduce against a pre-rewrite baseline (e.g. git stash, checkout prior commit, or a tagged release) before filing or prioritizing a bug against the new code.

## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 7 major components: LiveLoggingSystem: [SESSION] ObservationWriter.js (per the 'ObservationWriter — Semantic Dedup, Snapshot Promotion, and Raw Fallback Silent' record) mediates all observa; LLMAbstraction: [SESSION] 'LLM Model Catalogue — Endpoint-Gated Access Rules' establishes that the model catalogue must track which models are accessible via which AP; DockerizedServices: [SESSION] Docker Container Restart Verification Baseline establishes that before running docker-compose up -d, the current supervisor process list and; KnowledgeManagement: [SESSION] Wave Insight Persistence work record establishes that Wave 4 was writing 73 insight documents but zero Insight graph nodes, meaning History ; CodingPatterns: [SESSION] Documentation Style Guide for Diagrams and Markdown establishes mandatory formatting/placement rules: .puml sources live in docs/puml/, rend; ConstraintSystem: [SESSION] The Statusline Click-Report Feature record establishes that clicking the 'constraints' field in the tmux statusline opens or focuses the con; SemanticAnalysis: [SESSION] Pipeline CodingLowerOntologySource Emission Bug documents an unresolved defect where the pipeline emits a CodingLowerOntologySource referenc.

### Children
- [DocumentationStyleGuide](./DocumentationStyleGuide.md) -- [SESSION] Documentation Style Guide for Diagrams and Markdown: .puml sources must live in docs/puml/, distinct from rendered output locations.
- [ErrorTriageDiscipline](./ErrorTriageDiscipline.md) -- [SESSION] Post-Rewrite Render Error Triage: establishes verification discipline for distinguishing pre-existing render errors from regressions introduced by a large rewrite.
- [PatternVerificationTooling](./PatternVerificationTooling.md) -- [LLM] scripts/knowledge-management/verify-patterns.sh implements the actual PatternVerificationTooling: it runs rg-based checks for ConditionalLoggingPattern (console.log vs Logger usage), ReduxStateManagementPattern (useState vs useSelector/useDispatch counts), NetworkAwareInstallationPattern (grep for check_network/timeout in install.sh), and undocumented-function detection, aggregating results into a timestamped markdown report and a compliance score.

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- [SESSION] ObservationWriter.js (per the 'ObservationWriter — Semantic Dedup, Snapshot Promotion, and Raw Fallback Silent' record) mediates all observation persistence between ETM and the database, applying turn-aware semantic dedup and snapshot promotion, but [Raw] fallback observations generated on proxy timeout are logged as 'storing' yet have been repeatedly observed to silently fail to persist
- [LLMAbstraction](./LLMAbstraction.md) -- [SESSION] 'LLM Model Catalogue — Endpoint-Gated Access Rules' establishes that the model catalogue must track which models are accessible via which API surface (Responses API vs /chat/completions), since some models are gated per-endpoint and mismatched combinations must be rejected rather than silently allowed
- [DockerizedServices](./DockerizedServices.md) -- [SESSION] Docker Container Restart Verification Baseline establishes that before running docker-compose up -d, the current supervisor process list and container state should be captured as a baseline to compare against post-restart state and catch regressions like stale naming or misconfigured mounts
- [KnowledgeManagement](./KnowledgeManagement.md) -- [SESSION] Wave Insight Persistence work record establishes that Wave 4 was writing 73 insight documents but zero Insight graph nodes, meaning History UI (which filters to entityType='Insight') could never show batch results — fixed by explicitly creating Insight entities stamped with source/subsystem='wave-analysis'
- [ConstraintSystem](./ConstraintSystem.md) -- [SESSION] The Statusline Click-Report Feature record establishes that clicking the 'constraints' field in the tmux statusline opens or focuses the constraint-monitor dashboard tab, tying ConstraintSystem violation state directly into the click-driven statusline UX
- [SemanticAnalysis](./SemanticAnalysis.md) -- [SESSION] Pipeline CodingLowerOntologySource Emission Bug documents an unresolved defect where the pipeline emits a CodingLowerOntologySource reference in output despite documentation stating this source type should never be produced


---

*Generated from 7 observations*
