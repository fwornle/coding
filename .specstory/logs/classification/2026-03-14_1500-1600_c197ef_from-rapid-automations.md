# Classification Decision Log (Foreign/Coding)

**Time Window**: 2026-03-14_1500-1600_c197ef<br>
**Project**: rapid-automations<br>
**Target**: CODING<br>
**Generated**: 2026-03-14T15:00:00.000Z<br>
**Decisions in Window**: 2

---

## Statistics

- **Total Prompt Sets**: 2
- **Classified as CODING**: 2 (100%)
- **Classified as LOCAL**: 0 (0%)
- **[Layer 0 (Session Filter) Decisions](#layer-0-session-filter)**: 0
- **[Layer 1 (Path) Decisions](#layer-1-path)**: 0
- **[Layer 2 (Keyword) Decisions](#layer-2-keyword)**: 2
- **[Layer 3 (Embedding) Decisions](#layer-3-embedding)**: 0
- **[Layer 4 (Semantic) Decisions](#layer-4-semantic)**: 0
- **Average Processing Time**: 191ms

---

## Layer 2: Keyword

**Decisions**: 2

### Prompt Set: [ps_1773498072826](../../../history/2026-03-14_1500-1600_c197ef_from-rapid-automations.md#ps_1773498072826)

**Time Range**: 2026-03-14T14:21:12.826Z → 2026-03-14T17:21:02.662Z<br>
**LSL File**: [2026-03-14_1500-1600_c197ef_from-rapid-automations.md](../../../history/2026-03-14_1500-1600_c197ef_from-rapid-automations.md#ps_1773498072826)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.6224999999999999)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority of write operations target local project: /Users/Q284340/Agentic/_work/rapid-automations/.planning/phases/05-viewer/05-VALIDATION.md
- Processing Time: 231ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.6224999999999999
- Reasoning: Keyword analysis: 2 matches, score: 8/1
- Processing Time: 0ms

---

### Prompt Set: [ps_1773499095568](../../../history/2026-03-14_1500-1600_c197ef_from-rapid-automations.md#ps_1773499095568)

**Time Range**: 2026-03-14T14:38:15.568Z → 2026-03-14T17:21:03.575Z<br>
**LSL File**: [2026-03-14_1500-1600_c197ef_from-rapid-automations.md](../../../history/2026-03-14_1500-1600_c197ef_from-rapid-automations.md#ps_1773499095568)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.5525)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: "${INIT#@file:}"), /.claude/get-shit-done/bin/gsd-tools.cjs", HOME/.claude/get-shit-done/bin/gsd-tools.cjs", /dev/null, dev/null, /viewer/src/api/okbClient.ts, /viewer/src/store/slices/graphSlice.ts, /phases/05-viewer/05-01-SUMMARY.md, okb/viewer/src/api/okbClient.ts, okb/viewer/src/store/slices/graphSlice.ts, planning/phases/05-viewer/05-01-SUMMARY.md, /viewer/src/components/KnowledgeGraph/GraphVisualization.tsx, /viewer/src/components/KnowledgeGraph/NodeDetails.tsx, /viewer/src/components/Filters/SearchFilter.tsx, /phases/05-viewer/05-02-SUMMARY.md, okb/viewer/src/components/KnowledgeGraph/GraphVisualization.tsx, okb/viewer/src/components/KnowledgeGraph/NodeDetails.tsx, okb/viewer/src/components/Filters/SearchFilter.tsx, planning/phases/05-viewer/05-02-SUMMARY.md, //localhost:8090, //localhost:3002, //localhost:3002**, okb/viewer, layer/domain/ontologyClass, team/observations, entities/filters/navigation, layer/domain/ontology, circle/diamond/square, blue/amber, visual/interactive, ~15%, /objective, /Users/, /.claude/get-shit-done/workflows/execute-phase.md, /.claude/get-shit-done/references/ui-brand.md, /execution_context, /context, /process, claude/get-shit-done/workflows/execute-phase.md, claude/get-shit-done/references/ui-brand.md
- Processing Time: 150ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.5525
- Reasoning: Keyword analysis: 1 matches, score: 4/1
- Processing Time: 0ms

---

