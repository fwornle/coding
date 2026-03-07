# CommitMessageGuideline

**Type:** Detail

The CommitMessageGuideline suggests using a specific format for commit messages, such as including a brief summary and a detailed description of the changes.

## What It Is  

The **CommitMessageGuideline** is a documented convention that lives inside the broader **CodingConventions** component of the project.  Although no concrete file path is supplied in the observations, the guideline is conceptually situated alongside other coding‑style artifacts such as the `CodeFormatter` and the `CodeAnalysisTool`.  Its purpose is to prescribe a uniform structure for Git commit messages: a concise summary line followed by an optional, more detailed description of the change.  The guideline also mandates the use of the **imperative mood** (e.g., “Add feature X”, “Fix bug Y”) so that the commit history reads as a series of actionable statements.  By embedding this rule within the coding conventions, the project ensures that every contributor follows a shared narrative style, which in turn makes the history easier to scan, search, and reason about.

## Architecture and Design  

From the observations we can infer a **policy‑driven architectural approach**: the project centralises style‑related rules (formatting, static analysis, commit messages) under the umbrella component **CodingConventions**.  This component acts as a *domain‑specific language* for quality‑related concerns, and each sub‑entity—`CodeFormatter`, `CodeAnalysisTool`, and `CommitMessageGuideline`—represents a distinct policy.  No classic software design patterns (such as Strategy or Observer) are explicitly mentioned, but the separation of concerns mirrors the **Strategy pattern** in spirit: each policy can be swapped or extended without affecting the others.  

Interaction among the siblings is implicit.  The `CodeFormatter` enforces source‑code layout, the `CodeAnalysisTool` detects violations of the coding rules, and the `CommitMessageGuideline` supplies the textual‑commit rule that could be validated by a pre‑commit hook or a CI check.  All three share the same parent configuration source (the **CodingConventions** definition), which likely provides a single source of truth for tooling configuration files (e.g., `.editorconfig`, `eclipse-formatter.xml`, or custom YAML for commit checks).  This hierarchical arrangement encourages consistency across the development pipeline.

## Implementation Details  

The observations do not enumerate concrete classes, methods, or file locations for the **CommitMessageGuideline** itself, so we cannot point to a specific implementation artifact.  Nevertheless, the guideline’s content—summary line, detailed description, imperative mood—suggests a lightweight textual specification, possibly stored in a markdown (`CommitMessageGuideline.md`) or plain‑text (`COMMIT_GUIDELINE.txt`) file within the `docs/` or `coding-conventions/` directory.  In practice, tooling that enforces the guideline would read this file and apply its rules during commit creation or CI validation.  

Because the guideline is part of **CodingConventions**, any tooling that already consumes the parent configuration (e.g., the `CodeFormatter` reading the Eclipse formatter settings) could be extended to also consume the commit‑message rules.  A typical implementation might involve a small script or a Git hook (`prepare‑commit‑msg` or `commit‑msg`) that parses the guideline, checks the message against the required pattern (e.g., `^[A-Z][a-z]+: .+` for imperative phrasing) and fails the commit if the rule is violated.  This keeps the enforcement mechanism simple, language‑agnostic, and easy to maintain alongside the existing formatting and analysis tools.

## Integration Points  

The **CommitMessageGuideline** integrates with the development workflow at two natural touch‑points:

1. **Local Git Hooks** – A `commit‑msg` hook can read the guideline and validate each commit before it is recorded.  This hook would be distributed alongside the other convention assets (e.g., the Eclipse formatter configuration used by `CodeFormatter`) and could be installed automatically via a repository‑level script.

2. **Continuous Integration (CI) Pipeline** – The CI system can invoke the same validation logic as part of its quality‑gate checks, similar to how the `CodeAnalysisTool` runs static analysis.  By treating the guideline as a first‑class rule, CI can reject builds that contain non‑conforming commit messages, ensuring that the repository history remains clean even when developers bypass local hooks.

Both integration points rely on the shared configuration location provided by **CodingConventions**.  Because the sibling components already consume this configuration, adding the commit‑message rule does not introduce a new dependency chain; it merely extends the existing one.

## Usage Guidelines  

Developers should follow these practices when authoring commits:

* **Start with a short, imperative summary** not exceeding 50 characters.  The summary should describe *what* the change does, not *why* it was made (the “why” belongs in the detailed description or issue tracker).
* **Separate the summary from the body with a blank line**.  The body can be multiple paragraphs, each wrapped at 72 characters, providing context, rationale, and any relevant references (e.g., ticket numbers).
* **Maintain imperative mood throughout**—use verbs like “Add”, “Remove”, “Update”, “Fix”.  This creates a uniform narrative that reads like a to‑do list.
* **Avoid redundant prefixes** such as “Commit:” or “Changes:”.  The guideline’s purpose is to keep the message concise and action‑oriented.
* **Leverage tooling** – Enable the provided Git hook or CI check to automatically enforce the format.  If a commit fails validation, amend the message (`git commit --amend`) until it complies.

By adhering to these conventions, developers contribute to a commit history that is searchable, machine‑readable, and pleasant to navigate, reinforcing the overall quality goals set by **CodingConventions**.

---

### Summary of Architectural Insights  

| Aspect | Insight |
|--------|---------|
| **Architectural patterns identified** | Policy‑driven design; implicit Strategy‑like separation of concerns among `CodeFormatter`, `CodeAnalysisTool`, and `CommitMessageGuideline`. |
| **Design decisions and trade‑offs** | Centralising all style rules under **CodingConventions** simplifies configuration but requires disciplined propagation of updates to all tooling (hooks, CI). |
| **System structure insights** | Hierarchical: `CodingConventions` (parent) → siblings (`CodeFormatter`, `CodeAnalysisTool`, `CommitMessageGuideline`).  Shared configuration source enables consistent enforcement across the pipeline. |
| **Scalability considerations** | The guideline is text‑based and lightweight, so scaling to large teams or many repositories only requires distributing the same hook/CI script.  No performance impact on the build. |
| **Maintainability assessment** | High maintainability: a single source‑of‑truth document governs commit style; updates are localized and automatically reflected wherever the parent configuration is consumed. |


## Hierarchy Context

### Parent
- [CodingConventions](./CodingConventions.md) -- CodeFormatter.java uses the Eclipse Code Formatter to format the code according to the project's coding conventions.

### Siblings
- [CodeFormatter](./CodeFormatter.md) -- The CodeFormatter utilizes the Eclipse Code Formatter to format the code, as specified in the CodingConventions sub-component.
- [CodeAnalysisTool](./CodeAnalysisTool.md) -- The CodeAnalysisTool utilizes static analysis techniques to examine the code and detect violations of the coding conventions.


---

*Generated from 3 observations*
