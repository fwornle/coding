# Phase 7: Hierarchy Completeness - Research

**Researched:** 2026-03-04
**Domain:** Wave analysis discovery quality, file scoping, manifest auto-extension
**Confidence:** HIGH

## Summary

Phase 7 addresses four concrete gaps in the existing wave analysis pipeline that prevent comprehensive hierarchy discovery. The codebase is mature (Phases 5 and 6 complete) with well-defined agent contracts, so the work is surgical: fix file scoping in Wave 3, wire dead data (suggestedL3Children) into Wave 3 prompts, implement manifest write-back, and enhance prompts for self-sufficient descriptions. No new agents, no new wave steps, no orchestration changes.

The primary challenge is that 6 of 8 manifest components have `children: []`, meaning their entire L2 structure depends on LLM discovery from CGR file scoping -- and Wave 3's file scoping is critically broken (only uses L2 name as keyword, missing files when the L2 concept name does not appear in file paths). Additionally, Wave 2 already discovers and outputs `suggestedL3Children` via `childManifest`, but Wave 3's `executeWave3()` never reads them -- they are dead data.

**Primary recommendation:** Fix the three data flow gaps (file scoping, suggested children passthrough, manifest write-back) and enhance prompts for breadth-first discovery with self-sufficient descriptions. These are independent code changes that can be parallelized across plans.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- No fixed child count target per component -- LLM discovers naturally, quality filter removes junk
- Allow single or zero L2 children for simple components (e.g., CodingPatterns) -- no artificial minimums forced
- Complex components like SemanticAnalysis should naturally yield more children through better file scoping and prompts
- Self-sufficiency standard for each node: enough to orient a new developer -- they should know where to look and what to expect without drilling into children
- Discovered entities are written back to `component-manifest.yaml` so they seed future runs
- Discovered entries tagged with `discovered: true` in YAML -- distinguishable from curated entries
- The `discovered` tag is informational only -- no promotion workflow, no behavioral difference
- Manifest accumulates across runs: curated entries persist forever, discoveries are added each run
- Code evidence preferred: nodes traced to specific files/classes are kept as-is; nodes from pure LLM reasoning are kept but flagged as `inferred` for lower confidence
- Breadth-first priority -- Phase 7 focuses on discovering all sub-components; deep observations come from Phase 6's quality enforcement
- No extra deduplication step needed -- existing prompt instructions and graph dedup handle near-duplicates
- Full replace per run: each `ukb full` produces a complete fresh hierarchy in the knowledge graph
- Manifest accumulates separately: curated base grows with discoveries across runs, but KG entities are replaced each run
- All insight documents regenerated each run (consistent with full replace)
- No diff report between runs needed now -- existing structured summary is sufficient

### Claude's Discretion
- Whether to enrich the manifest with known sub-components or focus on better LLM prompts/file scoping for natural discovery
- Manifest auto-extension timing: during waves vs post-processing finalization step
- Filtering strictness per level (L2 vs L3 blocklists)
- File scoping improvements for Wave 3 (passing L1 keywords, using Wave 2's suggestedL3Children, directory structure heuristics)
- How to pass Wave 2's suggested L3 children into Wave 3 prompts (currently dead data)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| HIER-01 | L1 components have comprehensive sub-node coverage reflecting actual architecture | Fix Wave 3 file scoping (pass L1 keywords), wire suggestedL3Children, enhance Wave 2 prompts for breadth |
| HIER-02 | Sub-nodes represent real architectural aspects discovered from code analysis, not generic labels | Enhanced prompt examples, expanded L3 blocklist, code-evidence flagging in observations |
| HIER-03 | Component manifest is auto-extended based on wave analysis discoveries | New `writeManifestDiscoveries()` in component-manifest.ts, post-wave finalization step in WaveController |
| HIER-04 | Each hierarchy level provides self-sufficient knowledge useful at that granularity | Prompt enhancement for "orient a new developer" standard, self-sufficiency template in observation requirements |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| yaml | 2.8.2 | YAML parse + stringify for manifest read/write | Already in dependencies, supports `parse()` and `stringify()` |
| typescript | 5.8.3 | Strict TypeScript compilation | Project standard |
| LLMService | internal | Provider-agnostic LLM calls | Established pattern across all wave agents |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| graphology | 0.25.4 | In-memory graph for entity storage | Already used by GraphDatabaseAdapter |
| level | 10.0.0 | Persistent key-value store | Already used for KG persistence |
| fs/path (node) | built-in | File I/O for manifest write-back | Standard Node.js |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| yaml stringify | js-yaml | yaml 2.x is already installed and has better TypeScript support; js-yaml in devDependencies only as @types |
| Direct YAML file write | Separate discoveries file in .data/ | Adds complexity; user decided manifest accumulates directly |

## Architecture Patterns

### Recommended Project Structure (files to modify/create)

Files within `integrations/mcp-server-semantic-analysis/`:

- `src/agents/wave-controller.ts` -- Enhanced: file scoping, L3 data passthrough, manifest write-back orchestration
- `src/agents/wave2-component-agent.ts` -- Enhanced: prompt improvements for breadth, self-sufficiency
- `src/agents/wave3-detail-agent.ts` -- Enhanced: receive suggested children, improved file scoping, self-sufficiency
- `src/types/component-manifest.ts` -- New: writeManifestDiscoveries() function, discovered field on interface
- `src/types/wave-types.ts` -- Enhanced: Wave3Input gets suggestedChildren field
- `config/component-manifest.yaml` -- Modified at runtime by write-back (mount must change to rw)
- `docker/docker-compose.yml` -- Change config mount from `:ro` to `:rw`

### Pattern 1: Enhanced File Scoping for Wave 3
**What:** Pass L1 component keywords alongside L2 name when calling `getComponentFiles()` for Wave 3 agents
**When to use:** Every Wave 3 agent invocation
**Example:**
```typescript
// BEFORE (wave-controller.ts:336-338): only L2 name as keyword
const scopedFiles = await this.getComponentFiles(
  l2Entity.name,
  [l2Entity.name.toLowerCase()],
);

// AFTER: pass L1 keywords for broader file coverage
const l1Component = manifest.components.find(c => c.name === parentId);
const l1Keywords = l1Component?.keywords ?? [];
const scopedFiles = await this.getComponentFiles(
  l2Entity.name,
  [l2Entity.name.toLowerCase(), ...l1Keywords],
);
```

### Pattern 2: Wire suggestedL3Children into Wave 3
**What:** Collect `childManifest` entries from Wave 2 outputs and pass matching entries to Wave 3 agents
**When to use:** Wave 3 agent task construction in `executeWave3()`
**Example:**
```typescript
// In executeWave3(), collect all child manifest from Wave 2
const allL3Suggestions = wave2Result.agentOutputs.flatMap(o => o.childManifest);

// For each L2 entity, find its suggested L3 children
const suggestedChildren = allL3Suggestions.filter(
  c => c.parentId === l2Entity.name && c.level === 3,
);

const wave3Input: Wave3Input = {
  l2Entity,
  l1Entity: l1Entity ?? fallback,
  scopedFiles,
  suggestedChildren,  // NEW field
};
```

### Pattern 3: Manifest Write-Back (Post-Processing)
**What:** After all 3 waves complete, write discovered entities back to `component-manifest.yaml`
**When to use:** As a finalization step in WaveController.execute(), after wave 3 but before insight generation
**Example:**
```typescript
// In component-manifest.ts
export function writeManifestDiscoveries(
  discoveries: DiscoveredEntry[],
  configDir?: string,
): void {
  const dir = configDir || path.resolve(__dirname, '../../config');
  const manifestPath = path.join(dir, 'component-manifest.yaml');
  const manifest = loadComponentManifest(configDir);

  for (const discovery of discoveries) {
    const component = manifest.components.find(c => c.name === discovery.parentL1);
    if (!component) continue;

    if (!component.children) component.children = [];

    // Skip if already exists (curated or previously discovered)
    const exists = component.children.some(
      c => c.name.toLowerCase() === discovery.name.toLowerCase(),
    );
    if (exists) continue;

    component.children.push({
      name: discovery.name,
      level: 2,
      description: discovery.description,
      aliases: [],
      keywords: [discovery.name.toLowerCase()],
      discovered: true,
    });
  }

  const yamlContent = stringify(manifest, { lineWidth: 120 });
  fs.writeFileSync(manifestPath, yamlContent);
}
```

### Pattern 4: Self-Sufficiency Prompt Template
**What:** Each wave agent prompt instructs the LLM to produce self-sufficient descriptions
**When to use:** In Wave 2 and Wave 3 analysis prompts
**Example prompt addition:**
```
## Self-Sufficiency Standard
Each node's description and observations should orient a new developer:
- What does this sub-component DO? (purpose, not just existence)
- WHERE in the code does it live? (key files/directories)
- WHAT should the developer expect to find? (patterns, decisions, interfaces)
- A developer reading ONLY this node (not its children) should understand the scope.
```

### Anti-Patterns to Avoid
- **Forcing minimum child counts:** User explicitly decided no artificial minimums. Let LLM discover naturally and filter junk.
- **Deep observations in Phase 7:** Phase 7 is breadth-first. Phase 6's observation quality enforcement already handles depth.
- **Writing manifest inside Docker container with `:ro` mount:** Config is mounted read-only. Must change mount to `:rw` before write-back works.
- **Treating discovered entries differently at runtime:** The `discovered` tag is informational only -- no behavioral difference in wave execution.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML serialization | Custom YAML writer | `yaml` package `stringify()` | Already installed, handles edge cases (quoting, multiline, arrays) |
| Generic name filtering | Custom regex per-entity | Expand existing `genericNames` Set in Wave3DetailAgent | Blocklist pattern already established and tested |
| File scoping queries | Custom file-walking for L3 | Enhanced `getComponentFiles()` with L1 keywords | CGR Cypher is the established pattern, just needs better keywords |
| Observation validation | New validation framework | Existing `ensureMinimumObservations()` in each agent | Phase 6 established this pattern, already proven |

**Key insight:** Nearly all the infrastructure exists. Phase 7 is about wiring existing capabilities together (suggestedL3Children, keywords, file scoping) and adding the one missing capability (manifest write-back).

## Common Pitfalls

### Pitfall 1: Docker Read-Only Config Mount
**What goes wrong:** `component-manifest.yaml` is mounted as `:ro` in docker-compose.yml. Any attempt to write back from inside the container will fail with EACCES.
**Why it happens:** Config was originally read-only for safety. Phase 7 adds write-back.
**How to avoid:** Change the docker-compose volume from `:ro` to `:rw` for the config directory. Since the manifest is curated + machine-extended, read-write is appropriate.
**Warning signs:** `EACCES: permission denied` errors when `writeManifestDiscoveries()` runs.

### Pitfall 2: Manifest Write-Back Path Resolution Inside Docker
**What goes wrong:** The `loadComponentManifest()` resolves config path relative to `__dirname` (`dist/types/`). Inside Docker, this maps to `/coding/integrations/mcp-server-semantic-analysis/config/`. On host, it maps to the project path. Both paths must work correctly.
**Why it happens:** Bind-mount maps host path to container path transparently.
**How to avoid:** Use the same `path.resolve(__dirname, '../../config')` pattern for writes. The bind mount makes host and container paths equivalent.
**Warning signs:** Manifest file written to wrong location (e.g., `/coding/config/` instead of the bind-mounted path).

### Pitfall 3: Wave 2 childManifest Not Available in executeWave3
**What goes wrong:** `executeWave3(wave2Result)` receives `WaveResult` which contains `agentOutputs[].childManifest`, but the current code never accesses it. If the planner forgets to wire this, Wave 3 agents still run but without seed suggestions.
**Why it happens:** The original Phase 5 implementation deferred L3 seeding.
**How to avoid:** Explicitly access `wave2Result.agentOutputs.flatMap(o => o.childManifest)` in `executeWave3()` and pass matching entries per L2 entity.
**Warning signs:** Wave 3 agents log "(no source files available)" for most L2 entities, producing only 1-2 generic L3 nodes.

### Pitfall 4: L1 Keywords Not Passed to Wave 3 File Scoping
**What goes wrong:** `getComponentFiles()` for Wave 3 only uses `[l2Entity.name.toLowerCase()]`. If the L2 name is "BatchScheduler", it only finds files with "batchscheduler" in the path -- missing files like `batch-analysis.yaml`, `coordinator.ts`, etc.
**Why it happens:** Wave 3's `executeWave3()` does not have access to the manifest or L1 keywords. It only receives `wave2Result`.
**How to avoid:** Either pass the manifest to `executeWave3()` or store L1 keywords on the L1 entity passed through. The manifest approach is cleaner since it's already loaded in `execute()`.
**Warning signs:** Wave 3 agents produce few or zero L3 entities for components where the L2 name does not appear in file paths.

### Pitfall 5: ComponentManifestEntry Needs `discovered` Field
**What goes wrong:** The `ComponentManifestEntry` interface lacks a `discovered?: boolean` field. Writing discovered entries to YAML will include the field at runtime (JavaScript doesn't enforce interface constraints on serialization), but TypeScript compilation will fail if code references `entry.discovered`.
**Why it happens:** Phase 5 defined ComponentManifestEntry for read-only manifest consumption.
**How to avoid:** Add `discovered?: boolean` to the `ComponentManifestEntry` interface in `component-manifest.ts`.
**Warning signs:** TypeScript compilation error on `discovered` property.

### Pitfall 6: Submodule Build Required After Code Changes
**What goes wrong:** Code changes to TypeScript source files don't take effect until `npm run build` compiles them to `dist/`, AND Docker is rebuilt.
**Why it happens:** Docker copies `dist/` not `src/`. Forgetting the build step leaves stale compiled code.
**How to avoid:** After every code change: `cd integrations/mcp-server-semantic-analysis && npm run build && cd ../../docker && docker-compose build coding-services && docker-compose up -d coding-services`.
**Warning signs:** Changes appear in source but runtime behavior doesn't change.

## Code Examples

### Example 1: Enhanced getComponentFiles Call for Wave 3
```typescript
// Source: wave-controller.ts executeWave3() - ENHANCEMENT
// Current: line 336-338 uses only L2 name
// Fixed: pass L1 keywords from manifest for broader file coverage

private async executeWave3(
  wave2Result: WaveResult,
  manifest: ComponentManifest,  // NEW parameter
): Promise<WaveResult> {
  // ... existing code ...

  const agentTasks = l2Entities.map(l2Entity => {
    return async (): Promise<WaveAgentOutput> => {
      const parentId = l2Entity.parentId ?? '';
      const l1Entity = l1EntityMap.get(parentId);

      // ENHANCED: Use L1 keywords for broader file scoping
      const l1Component = manifest.components.find(c => c.name === parentId);
      const l1Keywords = l1Component?.keywords ?? [];
      const scopedFiles = await this.getComponentFiles(
        l2Entity.name,
        [l2Entity.name.toLowerCase(), ...l1Keywords],
      );

      // ENHANCED: Pass suggested L3 children from Wave 2
      const suggestedChildren = allL3Suggestions.filter(
        c => c.parentId === l2Entity.name && c.level === 3,
      );

      const wave3Input: Wave3Input = {
        l2Entity,
        l1Entity: l1Entity ?? { /* fallback */ },
        scopedFiles,
        suggestedChildren,
      };

      const agent = new Wave3DetailAgent(this.repositoryPath, this.team);
      return agent.execute(wave3Input);
    };
  });
  // ...
}
```

### Example 2: Wave3Input Type Enhancement
```typescript
// Source: wave-types.ts Wave3Input - ADD suggestedChildren
export interface Wave3Input {
  l2Entity: KGEntity;
  l1Entity: KGEntity;
  scopedFiles: string[];
  /** L3 children suggested by Wave 2 agent -- used as discovery seeds */
  suggestedChildren?: ChildManifestEntry[];
}
```

### Example 3: Wave3DetailAgent Using Suggested Children
```typescript
// Source: wave3-detail-agent.ts discoverL3Details() - USE suggestedChildren in prompt
const suggestedSection = input.suggestedChildren && input.suggestedChildren.length > 0
  ? `\n## Suggested Detail Nodes (from parent analysis)\n${input.suggestedChildren
      .map(c => `- ${c.name}: ${c.description}`)
      .join('\n')}\nValidate these against the source code. Keep those with evidence, discard those without.`
  : '';

// Inject into prompt after Source Files section
```

### Example 4: Manifest Write-Back Function
```typescript
// Source: component-manifest.ts - NEW function
import { stringify } from 'yaml';

interface DiscoveredManifestEntry {
  name: string;
  parentL1: string;
  description: string;
  keywords: string[];
}

export function writeManifestDiscoveries(
  discoveries: DiscoveredManifestEntry[],
  configDir?: string,
): number {
  const dir = configDir || path.resolve(__dirname, '../../config');
  const manifestPath = path.join(dir, 'component-manifest.yaml');
  const manifest = loadComponentManifest(configDir);
  let added = 0;

  for (const discovery of discoveries) {
    const component = manifest.components.find(c => c.name === discovery.parentL1);
    if (!component) continue;
    if (!component.children) component.children = [];

    const exists = component.children.some(
      c => c.name.toLowerCase() === discovery.name.toLowerCase(),
    );
    if (exists) continue;

    component.children.push({
      name: discovery.name,
      level: 2,
      description: discovery.description,
      aliases: [],
      keywords: discovery.keywords,
      children: [],
      discovered: true,
    });
    added++;
  }

  if (added > 0) {
    const header = '# Component Manifest - Authoritative source of truth for the L1/L2 component hierarchy.\n'
      + '# Curated entries are hand-authored. Entries with discovered: true were auto-added by wave analysis.\n\n';
    fs.writeFileSync(manifestPath, header + stringify(manifest, { lineWidth: 120 }));
  }

  return added;
}
```

### Example 5: Self-Sufficiency Prompt Enhancement
```typescript
// Added to Wave 2 and Wave 3 prompts
const selfSufficiencyBlock = `
## Self-Sufficiency Standard
Each node MUST be self-sufficient -- a developer reading ONLY this node should:
1. Know what this sub-component DOES (purpose and responsibility)
2. Know WHERE it lives in the codebase (key files and directories)
3. Know WHAT to expect (main classes, patterns, interfaces)
4. NOT need to drill into children to understand the scope

Write the description and observations as if this is the only documentation a new team member will read.`;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Flat batch analysis | Wave-based hierarchical analysis | Phase 5 (2026-03-04) | Entities organized in L0-L3 hierarchy |
| One-liner observations | 3+ specific observations with code artifacts | Phase 6 (2026-03-04) | Rich, verifiable entity knowledge |
| No manifest | component-manifest.yaml drives L0/L1/L2 | Phase 5 (2026-03-04) | Curated component structure |
| L2 only from manifest | Manifest + LLM discovery hybrid | Phase 5 (2026-03-04) | Better coverage for well-defined components |
| No L3 seeding | Wave 2 suggests L3 children (dead data) | Phase 5 (2026-03-04) | Needs wiring in Phase 7 |

**Deprecated/outdated:**
- Old flat `batch-analysis` DAG: replaced by WaveController in Phase 5
- `intelligentQuery` on CodeGraphAgent: does not exist; use `runCypherQuery` instead

## Open Questions

1. **Manifest enrichment vs. natural discovery -- which to prioritize?**
   - What we know: 6 of 8 components have empty `children: []`. Better file scoping + prompts should improve natural discovery. Pre-populating manifest with known sub-components would guarantee coverage.
   - What's unclear: Whether LLM discovery will consistently find the right sub-components with improved scoping alone.
   - Recommendation: Do both. Pre-populate the manifest with obvious known L2 children for the 6 empty components (low-effort, high-impact), AND improve file scoping/prompts for ongoing discovery. This is within Claude's discretion per CONTEXT.md.

2. **Manifest auto-extension timing**
   - What we know: User wants manifest to accumulate across runs. Write-back must happen after Wave 2 (L2 discoveries) and after Wave 3 (could tag L2 parents that had good L3 children).
   - What's unclear: Whether to write after each wave or as a single post-processing step.
   - Recommendation: Post-processing finalization step after all waves complete, before insight generation. This ensures all discoveries are available, avoids mid-run file conflicts, and follows the existing finalization pattern.

3. **Docker config mount: read-only to read-write**
   - What we know: Config is currently `:ro`. Write-back requires `:rw`.
   - What's unclear: Whether there's a security concern with making it read-write.
   - Recommendation: Change to `:rw`. The manifest is a curated + machine-extended file, not a secret. The semantic-analysis container is the only writer. Low risk.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None (no project test infrastructure) |
| Config file | none -- see Wave 0 |
| Quick run command | `cd integrations/mcp-server-semantic-analysis && npx tsc --noEmit` |
| Full suite command | `cd integrations/mcp-server-semantic-analysis && npm run build` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HIER-01 | L1 components have comprehensive sub-node coverage | smoke/manual | `ukb full` then check entity counts per L1 | N/A -- manual |
| HIER-02 | Sub-nodes represent real architectural aspects | smoke/manual | Check insight docs for specific names vs generic labels | N/A -- manual |
| HIER-03 | Manifest auto-extended with discoveries | smoke | Check `component-manifest.yaml` after `ukb full` for `discovered: true` entries | N/A -- manual |
| HIER-04 | Each level provides self-sufficient knowledge | manual-only | Human review of insight docs at each level | N/A -- manual |

### Sampling Rate
- **Per task commit:** `cd integrations/mcp-server-semantic-analysis && npx tsc --noEmit`
- **Per wave merge:** `npm run build` + Docker rebuild + `ukb full` smoke test
- **Phase gate:** Full `ukb full` run with real LLM, human review of output hierarchy

### Wave 0 Gaps
- No automated test framework exists. TypeScript compilation (`tsc --noEmit`) serves as the primary automated check.
- Validation for this phase is primarily smoke testing (run `ukb full`) and human review of outputs, consistent with Phases 5 and 6.
- No Wave 0 test setup needed -- the existing build + smoke test pattern is sufficient for this phase.

## Sources

### Primary (HIGH confidence)
- Direct code analysis of `wave-controller.ts`, `wave2-component-agent.ts`, `wave3-detail-agent.ts`, `component-manifest.ts`, `wave-types.ts`, `kg-operators.ts`, `wave1-project-agent.ts`
- `component-manifest.yaml` -- current manifest structure and content
- `docker-compose.yml` line 72 -- config mounted as `:ro`
- `package.json` dependencies -- yaml v2.8.2 already installed
- Phase 5 and Phase 6 verification reports -- established patterns confirmed working

### Secondary (MEDIUM confidence)
- `yaml` package API verified via Node.js REPL -- `stringify()` confirmed available and producing clean output

### Tertiary (LOW confidence)
- None -- all findings verified against source code

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already installed and in use
- Architecture: HIGH -- direct code analysis of all affected files
- Pitfalls: HIGH -- identified from code review and docker-compose inspection
- File scoping gap: HIGH -- confirmed by reading executeWave3() line 336-338

**Research date:** 2026-03-04
**Valid until:** Indefinite (codebase-specific research, not library-version dependent)
