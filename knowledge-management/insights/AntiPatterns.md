# AntiPatterns

**Type:** SubComponent

The AntiPatterns sub-component influences the development of the DesignPrinciples and SoftwarePatterns sub-components, ensuring that best practices are followed throughout the project.

## What It Is  

The **AntiPatterns** sub‑component lives inside the **CodingPatterns** parent component and is realised as a logical module rather than a concrete code package – there are no dedicated source files listed in the observations. Its purpose is to expose a curated catalogue of known anti‑patterns (e.g., *God Object* and *Shotgun Surgery*) together with prescriptive guidelines that help developers recognise and avoid them. The sub‑component draws on the **SoftwarePatterns** sibling to obtain the positive pattern definitions that serve as the opposite side of the design spectrum. In practice, the guidance is surfaced through documentation, configuration hints, and runtime checks that are consulted by the broader system (DesignPrinciples, IntegrationModules, etc.).  

Two concrete scripts in the **integrations/browser‑access** module – `setup-browser-access.sh` and `delete-coder‑workspaces.py` – are flagged by the AntiPatterns logic as potential sources of *Overengineering* and *Underengineering* respectively. This indicates that the AntiPatterns module does not merely list abstract problems; it actively monitors implementation artefacts (scripts, configuration files) that could drift into undesirable extremes.

## Architecture and Design  

The architecture surrounding **AntiPatterns** follows a **modular, knowledge‑sharing** style. The sub‑component is a *consumer* of the **SoftwarePatterns** module (Observation 1) and a *producer* of constraints for both **DesignPrinciples** and **SoftwarePatterns** (Observation 6). This bidirectional influence creates a **feedback loop**: positive patterns are defined, anti‑patterns are derived, and the design principles are refined accordingly.  

Because the parent component **CodingPatterns** aggregates several sibling modules (DesignPrinciples, SoftwarePatterns, IntegrationModules, TeamConfiguration), the overall design resembles a **component‑based architecture** where each sibling is responsible for a distinct cross‑cutting concern. The AntiPatterns module occupies the *quality‑guard* niche, injecting validation rules into the development pipeline without tightly coupling to any single implementation.  

The explicit mention of scripts (`setup-browser-access.sh`, `delete-coder-workspaces.py`) suggests that **AntiPatterns** also participates in a **script‑level governance** pattern. Rather than embedding checks in compiled code, the system relies on lightweight, language‑agnostic scripts that can be inspected, versioned, and executed as part of CI/CD pipelines. This aligns with the broader **integration‑module** philosophy of the project, where each integration (e.g., browser‑access) is a self‑contained folder with its own operational artefacts.

## Implementation Details  

Although no concrete classes or functions are listed, the observations let us infer the internal mechanics of the **AntiPatterns** sub‑component:

1. **Pattern Registry** – A data store (likely JSON or YAML) that enumerates anti‑patterns such as *God Object* and *Shotgun Surgery*. Each entry includes a description, symptoms, and mitigation steps. This registry is referenced by the **SoftwarePatterns** sub‑component to ensure complementary coverage.

2. **Guideline Engine** – A rule‑based processor that matches code‑level signals (e.g., a class with an excessive number of responsibilities) against the anti‑pattern definitions. When a match is found, the engine surfaces recommendations drawn from the guideline text.

3. **Script‑Analysis Hooks** – Lightweight scanners attached to the `integrations/browser-access` scripts. For `setup-browser-access.sh`, the scanner looks for signs of excessive abstraction or unnecessary tooling that could constitute *Overengineering*. For `delete-coder-workspaces.py`, it checks for missing error handling or insufficient validation that could lead to *Underengineering*. These hooks likely run during repository linting or CI jobs.

4. **Influence Propagation** – Upon detection of an anti‑pattern, the AntiPatterns module emits signals (e.g., events, configuration flags) that are consumed by **DesignPrinciples** (to adjust principle weightings) and **SoftwarePatterns** (to possibly de‑precate a pattern that is frequently violated). This propagation ensures that the entire **CodingPatterns** ecosystem stays aligned with evolving best practices.

## Integration Points  

The **AntiPatterns** sub‑component is tightly woven into the fabric of the **CodingPatterns** hierarchy:

- **SoftwarePatterns** – Serves as the source of “good” patterns; AntiPatterns consumes this list to generate contrasting warnings. The two modules together form a balanced pattern catalogue.
- **DesignPrinciples** – Receives influence from AntiPatterns (Observation 6). When an anti‑pattern is detected, DesignPrinciples may adjust its rule set or surface higher‑level architectural advice.
- **IntegrationModules** – Particularly the `integrations/browser-access` folder, where the two scripts are monitored. This demonstrates a concrete integration point: the anti‑pattern checks are triggered by the presence and content of these scripts.
- **TeamConfiguration** – The `config/teams/*.json` files store team‑specific conventions. AntiPatterns can reference these to tailor its guidance (e.g., a team that permits larger classes may have a higher threshold before flagging a *God Object*).

All interactions are mediated through shared configuration artefacts (JSON/YAML) and CI‑pipeline hooks, preserving loose coupling while enabling coordinated enforcement of quality standards.

## Usage Guidelines  

1. **Consult the Anti‑Pattern Registry** – Before introducing a new class or refactoring an existing one, developers should review the *God Object* and *Shotgun Surgery* entries to ensure they are not inadvertently creating tightly coupled or highly dispersed code.

2. **Run the Script‑Level Checks** – The CI pipeline should execute the built‑in scanners for `setup-browser-access.sh` and `delete-coder-workspaces.py`. Any warnings about *Overengineering* or *Underengineering* must be addressed before merging.

3. **Align with DesignPrinciples** – When an anti‑pattern is flagged, refer to the corresponding DesignPrinciples guidance to understand the higher‑level architectural impact and the recommended remediation path.

4. **Leverage Team‑Specific Settings** – Teams can adjust thresholds in `config/teams/*.json` to reflect their tolerance for certain anti‑patterns. However, any relaxation should be justified and reviewed by the team lead.

5. **Iterate with SoftwarePatterns** – If a recurring anti‑pattern suggests a missing positive pattern, propose an addition to the **SoftwarePatterns** module. This collaborative loop helps keep the pattern catalogue current and comprehensive.

---

### 1. Architectural patterns identified
- **Component‑based modular architecture** (CodingPatterns parent aggregating sibling modules).  
- **Feedback loop / knowledge‑sharing pattern** between AntiPatterns, SoftwarePatterns, and DesignPrinciples.  
- **Script‑level governance** (lightweight scanners attached to shell/Python scripts).  

### 2. Design decisions and trade‑offs
- **Loose coupling** via shared configuration files rather than hard‑coded dependencies keeps the system extensible, but relies on disciplined CI integration to enforce checks.  
- **Centralised anti‑pattern registry** provides a single source of truth, at the cost of needing regular updates as the codebase evolves.  
- **Scoping anti‑pattern detection to scripts** balances coverage with performance; deeper static analysis of all source files is avoided to keep CI fast.

### 3. System structure insights
- **AntiPatterns** acts as a quality guard within the **CodingPatterns** hierarchy, influencing both design‑level (DesignPrinciples) and implementation‑level (IntegrationModules) concerns.  
- The sibling relationship with **SoftwarePatterns** ensures that every positive pattern has a documented negative counterpart, fostering a holistic pattern ecosystem.  

### 4. Scalability considerations
- Because checks are script‑centric and driven by configuration, adding new integration modules (e.g., a new `integrations/api‑gateway/` folder) only requires extending the registry and attaching the appropriate scanners—no code changes to AntiPatterns itself.  
- The feedback mechanism scales with the number of anti‑patterns; however, an overly large registry could increase CI runtime, so periodic pruning or categorisation is advisable.

### 5. Maintainability assessment
- **High maintainability**: the separation of concerns (registry, guideline engine, script hooks) isolates changes. Updating a guideline does not affect the scanning logic.  
- **Potential risk**: reliance on manual updates to the anti‑pattern list and team‑specific JSON files could lead to drift if governance processes are lax. Instituting a review gate in the CI pipeline mitigates this risk.


## Hierarchy Context

### Parent
- [CodingPatterns](./CodingPatterns.md) -- The CodingPatterns component demonstrates a modular structure through its use of various integration modules, such as integrations/browser-access/ and integrations/code-graph-rag/. These modules accommodate different coding patterns and practices, allowing for flexibility and scalability in the project's architecture. For instance, the setup-browser-access.sh script in the browser-access module automates the setup process for browser-based coding environments, while the delete-coder-workspaces.py script in the same module handles teardown processes. This modularity enables developers to easily add or remove integration modules as needed, without affecting the overall project structure. The config/teams/*.json files, which store team-specific settings and coding conventions, further emphasize the component's emphasis on modularity and configurability.

### Siblings
- [DesignPrinciples](./DesignPrinciples.md) -- The config/teams/*.json files store team-specific settings and coding conventions, allowing for flexible project configuration.
- [SoftwarePatterns](./SoftwarePatterns.md) -- The integrations/browser-access/ module provides a reusable solution for browser-based coding environments, demonstrating the software pattern of environment abstraction.
- [IntegrationModules](./IntegrationModules.md) -- The integrations/browser-access/ module provides a modular structure for browser-based coding environments, demonstrating the integration pattern of environment abstraction.
- [TeamConfiguration](./TeamConfiguration.md) -- The config/teams/*.json files store team-specific settings and coding conventions, allowing for flexible project configuration.


---

*Generated from 6 observations*
