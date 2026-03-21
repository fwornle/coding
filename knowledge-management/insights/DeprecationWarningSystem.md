# DeprecationWarningSystem

**Type:** Detail

By integrating deprecation warnings into the static code analysis process, the project ensures a proactive approach to code maintenance, enhancing its long-term sustainability and reducing technical d...

## What It Is  

The **DeprecationWarningSystem** lives inside the *CodeAnalysis* component of the project and is realized through PHPStan’s built‑in deprecation checking capability. All configuration for this subsystem is declared in the `phpstan.neon` file, which lives at the root of the repository (the same file that drives the sibling components *StaticCodeAnalysis* and *CodeQualityConfiguration*). By enabling the `checkDeprecations` rule in `phpstan.neon`, the system automatically scans the codebase for functions, methods, classes, or other symbols that have been marked as deprecated. When such symbols are encountered, PHPStan emits a **DeprecationWarning**, giving developers a clear signal that the affected code should be updated or replaced before it becomes a breaking change.

In practice, the DeprecationWarningSystem is a static‑analysis‑driven safeguard: it does not execute at runtime, but rather during the analysis phase executed by PHPStan. This proactive approach allows teams to address compatibility issues early, reducing the likelihood of sudden failures when underlying libraries or PHP versions drop support for the deprecated elements.

---

## Architecture and Design  

The architecture of the DeprecationWarningSystem is **configuration‑driven** and **composition‑based** within the broader *CodeAnalysis* component. The parent *CodeAnalysis* aggregates several analysis concerns—deprecation detection, general static analysis, and quality configuration—each represented by a sibling module. The deprecation subsystem does not introduce its own execution engine; instead, it **leverages PHPStan** as the underlying engine and merely toggles the relevant rule set via `phpstan.neon`.  

From the observations we can infer the following design characteristics:

1. **Declarative Configuration** – All behavior is defined in the `phpstan.neon` file. This eliminates hard‑coded logic in source files and makes the deprecation checks portable across environments.  
2. **Rule‑Based Static Analysis** – PHPStan treats deprecation detection as a rule that runs alongside other rules (e.g., type‑checking, dead‑code detection). The rule is part of the same analysis pipeline that the *StaticCodeAnalysis* sibling uses.  
3. **Proactive Maintenance Loop** – By surfacing deprecation warnings during CI or local developer runs, the system creates a feedback loop that encourages early remediation, aligning with the long‑term sustainability goals highlighted in the observations.

No explicit design patterns such as *Observer* or *Strategy* are mentioned in the source material, so the analysis stays within the boundaries of the observed configuration‑centric approach.

---

## Implementation Details  

The core implementation hinges on the `phpstan.neon` configuration file. Within this file the following keys are typical for enabling deprecation checks (the exact keys are inferred from standard PHPStan usage and are consistent with the observations):

```neon
includes:
    - vendor/phpstan/phpstan-deprecation-rules/extension.neon

parameters:
    level: max
    paths:
        - src
        - tests
    checkDeprecations: true   # activates the deprecation rule set
```

* **Extension Inclusion** – By including the deprecation‑rules extension, PHPStan registers a set of internal checks that inspect PHPDoc `@deprecated` tags, native `#[Deprecated]` attributes, and framework‑specific deprecation markers.  
* **Rule Activation** – The `checkDeprecations: true` flag (or its equivalent rule list) tells PHPStan to treat any discovered deprecated element as a warning rather than an error, matching the “DeprecationWarning” terminology used in the observations.  
* **Scope Definition** – The `paths` parameter defines the code boundaries that the deprecation scanner will traverse, ensuring that only the intended parts of the repository are analyzed.

Because the DeprecationWarningSystem is a logical layer on top of PHPStan, there are no dedicated classes or functions authored by the project for this purpose. Instead, the system’s “components” are the configuration entries that instruct PHPStan to perform the check. The *CodeAnalysis* component therefore acts as a **container** that bundles the configuration together with the execution scripts (e.g., a Composer script `phpstan analyse`) that run the analysis.

---

## Integration Points  

The DeprecationWarningSystem integrates tightly with two sibling subsystems:

* **StaticCodeAnalysis** – Shares the same `phpstan.neon` file, meaning that deprecation warnings appear alongside other static analysis findings (type errors, undefined variables, etc.). This unified output simplifies CI pipelines because a single PHPStan run yields a comprehensive health report.  
* **CodeQualityConfiguration** – Also manipulates `phpstan.neon` to adjust thresholds, ignore patterns, or enable additional rule sets. Changes made for overall code‑quality purposes automatically affect deprecation detection, ensuring consistent governance.

External dependencies are limited to the PHPStan package itself and any optional deprecation‑rules extension. The system’s interface to the rest of the application is the **command‑line invocation** (`vendor/bin/phpstan analyse`) which can be hooked into Composer scripts, Git hooks, or CI jobs. No runtime API or library calls are required, keeping the coupling minimal.

---

## Usage Guidelines  

1. **Keep `phpstan.neon` Up‑to‑Date** – Whenever a new library version is introduced, verify that its deprecation markers are correctly reflected in the configuration. If a new deprecation rule is needed, add the appropriate extension inclusion.  
2. **Treat Warnings as Action Items** – Although PHPStan emits deprecation notices as warnings, the development process should treat them as mandatory fixes before merging. This aligns with the proactive maintenance ethos described in the observations.  
3. **Scope Appropriately** – Adjust the `paths` list to include all production code (`src`) and any test utilities that might use deprecated APIs. Excluding irrelevant directories reduces noise.  
4. **CI Integration** – Add the PHPStan command to the CI pipeline and configure it to fail the build if any deprecation warning is present. This enforces the “reduce technical debt” objective automatically.  
5. **Document Exceptions** – If a deprecated element must be retained temporarily (e.g., for backward compatibility), document the rationale in code comments and consider using PHPStan’s `ignoreErrors` configuration to silence the specific warning, but do so sparingly.

---

### Architectural Patterns Identified  

* **Configuration‑Driven Architecture** – All behavior is expressed through `phpstan.neon`.  
* **Rule‑Based Static Analysis** – Deprecation detection is a rule within PHPStan’s analysis pipeline.

### Design Decisions and Trade‑offs  

* **Leverage Existing Tooling** – Using PHPStan avoids building a custom deprecation scanner, saving development effort and benefiting from community maintenance. The trade‑off is a reliance on PHPStan’s rule set and its update cadence.  
* **Warning vs. Error** – Emitting deprecations as warnings encourages early remediation without blocking builds, but may lead to complacency if teams ignore warnings. Enforcing strict CI policies mitigates this risk.

### System Structure Insights  

* The DeprecationWarningSystem is a **child** of *CodeAnalysis* and shares the same configuration artifact (`phpstan.neon`) with its siblings *StaticCodeAnalysis* and *CodeQualityConfiguration*.  
* It does not contain its own source files; its “implementation” lives entirely in configuration, making it lightweight and easy to evolve.

### Scalability Considerations  

Because the system scales with PHPStan, adding more code or additional deprecation sources only requires expanding the `paths` list or including extra rule extensions. The analysis time grows linearly with code size, but can be mitigated by parallelizing PHPStan runs or using caching (`--cache` flag).

### Maintainability Assessment  

The maintainability is high: the only artifact developers need to manage is a well‑documented `phpstan.neon` file. As long as the configuration stays in sync with the codebase and the team treats warnings seriously, the DeprecationWarningSystem contributes positively to long‑term sustainability and technical‑debt reduction, exactly as described in the source observations.

## Hierarchy Context

### Parent
- [CodeAnalysis](./CodeAnalysis.md) -- The project uses the PHPStan tool for static code analysis, which checks for errors, warnings, and deprecations, as configured in the phpstan.neon file.

### Siblings
- [StaticCodeAnalysis](./StaticCodeAnalysis.md) -- The phpstan.neon file defines the configuration for PHPStan, specifying the paths to scan and the rules to apply, which helps in maintaining code quality and adhering to coding standards.
- [CodeQualityConfiguration](./CodeQualityConfiguration.md) -- The phpstan.neon file serves as a central configuration point for PHPStan, allowing developers to easily manage and adjust the analysis settings without delving into complex code changes.

---

*Generated from 3 observations*
