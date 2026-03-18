# CodingConventions

**Type:** SubComponent

The integrations/copi/docs/STATUS-LINE-QUICK-REFERENCE.md file provides a quick reference for status line integration, which is an example of a coding convention

## What It Is  

**CodingConventions** is the documented set of coding standards, best‑practice recommendations, and usage patterns that govern the source‑level quality of the entire repository. The conventions are not implemented as executable code but are expressed in a collection of Markdown artefacts that live alongside the integrations that consume them. The primary locations where these conventions are defined are:

* `integrations/copi/USAGE.md` – the canonical usage guide for the **Copi** integration, illustrating the conventions in practice.  
* `integrations/code-graph-rag/CONTRIBUTING.md` – the contribution checklist that codifies the coding conventions that every new contribution must satisfy.  
* `integrations/copi/README.md`, `integrations/copi/INSTALL.md`, `integrations/copi/MIGRATION.md` – supplemental documentation that repeatedly references the same conventions (naming, file‑layout, status‑line handling, etc.).  
* `integrations/copi/docs/STATUS‑LINE‑QUICK‑REFERENCE.md` – a concrete example of a convention (the format of status‑line messages) that is expected to be followed by any code that emits UI feedback.  

These files together constitute the **CodingConventions** sub‑component. They are organised under the broader **CodingPatterns** component, which groups together higher‑level patterns such as hook‑configuration loading and lazy LLM initialization. The **CopiUsageGuidelines** child component is a direct specialization of the conventions for the Copi integration, while sibling components like **DevelopmentPractices** and **DesignPatterns** share the same documentation‑driven approach.

---

## Architecture and Design  

The architecture of **CodingConventions** is documentation‑centric. Rather than embedding rules in a static analysis tool or a language‑level framework, the project adopts a *documentation‑as‑code* pattern: every convention lives in a Markdown file that is version‑controlled alongside the source it governs. This pattern is evident from the repeated presence of the same conventions across multiple integration READMEs and the central `CONTRIBUTING.md` that aggregates them for all contributors.

Interaction between components follows a **shared‑knowledge** model. The parent component **CodingPatterns** defines the overarching philosophy (modular hook loading, lazy LLM init) and the sub‑component **CodingConventions** refines that philosophy into concrete, actionable rules. Sibling components such as **DevelopmentPractices** reference the same conventions when describing hook functions (`integrations/copi/docs/hooks.md`), demonstrating a *horizontal reuse* of the same documentation artefacts.

The design emphasizes **low coupling** and **high cohesion**: the conventions are isolated from the implementation code (no code symbols were discovered), yet they are tightly coupled to the integration points that must obey them. This makes the conventions easy to evolve without recompiling any binaries, while still providing a single source of truth for all developers.

---

## Implementation Details  

Although there are no executable symbols, the implementation of **CodingConventions** can be described in terms of its constituent documents:

| File | Role | Key Content |
|------|------|--------------|
| `integrations/copi/USAGE.md` | Primary usage guide | Step‑by‑step examples of how to apply naming, error‑handling, and status‑line conventions when using Copi. |
| `integrations/code-graph-rag/CONTRIBUTING.md` | Contribution checklist | Explicit bullet list of required linting, test coverage, and documentation updates that reflect the coding conventions. |
| `integrations/copi/docs/STATUS‑LINE‑QUICK‑REFERENCE.md` | Convention example | Precise syntax for status‑line messages (prefixes, severity levels, JSON payload shape). |
| `integrations/copi/INSTALL.md` & `MIGRATION.md` | Installation & migration | Guidelines that enforce version‑consistent naming, directory layout, and deprecation handling—each a concrete convention. |
| `integrations/copi/README.md` | Overview | Summarises the conventions and points developers to the detailed guidelines. |

The conventions are therefore *implemented* as reusable documentation fragments. They are referenced via relative links in the integration READMEs, ensuring that any change to a convention propagates automatically to all consuming integrations. The presence of a **CopiUsageGuidelines** child component shows that the parent **CodingConventions** can be specialized: the child simply re‑exports the same Markdown files under a narrower scope, adding Copi‑specific examples where needed.

---

## Integration Points  

**CodingConventions** ties into the rest of the system through several documented integration points:

1. **Contributing workflow** – The `CONTRIBUTING.md` file is consulted by the repository’s CI pipeline (e.g., a pre‑commit hook or GitHub Action) to verify that new PRs respect the conventions. Though the observation set does not list the CI script, the presence of a contribution guide strongly implies this coupling.

2. **Copi integration** – All Copi‑related artefacts (`README.md`, `INSTALL.md`, `MIGRATION.md`, `USAGE.md`) embed references to the conventions, making the Copi codebase a consumer of the standards. The child component **CopiUsageGuidelines** formalises this relationship.

3. **MCP constraint monitor** – The `integrations/mcp-constraint-monitor/README.md` mentions that the monitor “utilizes coding conventions and best practices,” indicating that its internal logging, error handling, and configuration files follow the same conventions defined elsewhere.

4. **Status‑line UI** – The quick‑reference document (`STATUS‑LINE‑QUICK‑REFERENCE.md`) is a shared contract used by any component that renders status information, such as the browser‑access MCP server (`integrations/browser-access/README.md`). This creates a cross‑integration contract enforced purely through documentation.

These points illustrate a **documentation‑driven contract** model: each integration reads the conventions from the shared Markdown files and implements them locally, without a runtime interface.

---

## Usage Guidelines  

Developers working within the repository should treat the Markdown files as the authoritative source for any style‑related decision. The practical rules distilled from the observations are:

* **Follow the contribution checklist** in `integrations/code-graph-rag/CONTRIBUTING.md` before opening a PR. This includes running any linting scripts, ensuring test coverage, and updating documentation to reflect any new or changed conventions.  
* **Adhere to the status‑line format** defined in `integrations/copi/docs/STATUS‑LINE‑QUICK‑REFERENCE.md`. All UI feedback must include the required prefix, severity level, and optional JSON payload.  
* **Consult `integrations/copi/USAGE.md`** for concrete examples of naming conventions, error‑handling patterns, and file‑structure expectations when adding or modifying Copi‑related code.  
* **When migrating** an existing component, use the step‑by‑step migration guide in `integrations/copi/MIGRATION.md` to ensure that deprecated patterns are replaced with the current conventions.  
* **For new integrations**, replicate the structure of the existing README/INSTALL/USAGE trio and embed links to the central conventions. This mirrors the pattern used across sibling components such as **DevelopmentPractices** and **DesignPatterns**.

By consistently referencing these documents, developers guarantee that code across the repo remains uniform, readable, and maintainable.

---

### Architectural Patterns Identified
1. **Documentation‑as‑Code** – conventions live in version‑controlled Markdown files.
2. **Shared‑Knowledge Contract** – multiple integrations consume the same documentation artefacts, creating a de‑facto interface.
3. **Horizontal Reuse** – sibling components (DesignPatterns, DevelopmentPractices) reference the same conventions, avoiding duplication.

### Design Decisions and Trade‑offs
* **Decision:** Encode standards in Markdown rather than a static‑analysis tool.  
  *Trade‑off:* Low implementation overhead and easy updates, but relies on developer discipline and CI enforcement rather than compile‑time guarantees.
* **Decision:** Keep conventions separate from executable code.  
  *Trade‑off:* Improves readability and reduces coupling, yet makes automated validation more complex.
* **Decision:** Provide a dedicated child component (**CopiUsageGuidelines**) to specialize the generic conventions.  
  *Trade‑off:* Enables targeted examples without fragmenting the core set of rules, but adds a layer of indirection for newcomers.

### System Structure Insights
* **CodingConventions** sits under the **CodingPatterns** parent, inheriting the broader philosophy of modular, reusable patterns.
* It is a leaf node in the documentation hierarchy, with **CopiUsageGuidelines** as its only child, indicating a focused specialization.
* Sibling components share the same documentation‑driven approach, suggesting a repository‑wide strategy for knowledge capture.

### Scalability Considerations
* Because conventions are plain text, scaling to dozens of integrations simply requires adding new Markdown links; there is no performance penalty.
* The model scales well for distributed teams: each developer can fetch the latest conventions via Git without additional tooling.
* Potential bottleneck: as the number of conventions grows, maintaining consistency may require stricter CI checks or a linter that parses the Markdown.

### Maintainability Assessment
* **High maintainability** – changes to a convention propagate automatically to all consumers, and the single source of truth reduces duplication.
* **Risk area** – reliance on human adherence; without automated enforcement, stale or divergent implementations can appear.
* **Mitigation** – integrate CI jobs that parse the key Markdown files (e.g., status‑line schema) and fail builds if code deviates, thereby coupling the documentation‑centric design with automated quality gates.

## Diagrams

### Relationship

![CodingConventions Relationship](images/coding-conventions-relationship.png)



## Architecture Diagrams

![relationship](../../.data/knowledge-graph/insights/images/coding-conventions-relationship.png)


## Hierarchy Context

### Parent
- [CodingPatterns](./CodingPatterns.md) -- [LLM] The CodingPatterns component utilizes a modular approach to hook management, as seen in the HookConfigLoader class in lib/agent-api/hooks/hook-config.js. This class loads and merges hook configurations, allowing for a flexible and scalable hook system. The ensureLLMInitialized() method in base-agent.ts further promotes efficient resource utilization by ensuring lazy LLM initialization. This pattern is also observed in the Wave agents, which follow a consistent structure for agent implementation, comprising a constructor, ensureLLMInitialized(), and execute() method.

### Children
- [CopiUsageGuidelines](./CopiUsageGuidelines.md) -- The integrations/copi/USAGE.md file provides detailed usage guidelines for the Copi integration, including examples and migration instructions.

### Siblings
- [DesignPatterns](./DesignPatterns.md) -- The HookConfigLoader class in lib/agent-api/hooks/hook-config.js loads and merges hook configurations, allowing for a flexible and scalable hook system
- [DevelopmentPractices](./DevelopmentPractices.md) -- The integrations/copi/docs/hooks.md file provides a reference for hook functions, which are utilized in the DevelopmentPractices sub-component
- [Integrations](./Integrations.md) -- The integrations/browser-access/README.md file describes the browser access MCP server, which is an example of an integration


---

*Generated from 7 observations*
