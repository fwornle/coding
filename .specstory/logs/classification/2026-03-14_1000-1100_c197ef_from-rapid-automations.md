# Classification Decision Log (Foreign/Coding)

**Time Window**: 2026-03-14_1000-1100_c197ef<br>
**Project**: rapid-automations<br>
**Target**: CODING<br>
**Generated**: 2026-03-14T10:00:00.000Z<br>
**Decisions in Window**: 7

---

## Statistics

- **Total Prompt Sets**: 7
- **Classified as CODING**: 7 (100%)
- **Classified as LOCAL**: 0 (0%)
- **[Layer 0 (Session Filter) Decisions](#layer-0-session-filter)**: 0
- **[Layer 1 (Path) Decisions](#layer-1-path)**: 3
- **[Layer 2 (Keyword) Decisions](#layer-2-keyword)**: 4
- **[Layer 3 (Embedding) Decisions](#layer-3-embedding)**: 0
- **[Layer 4 (Semantic) Decisions](#layer-4-semantic)**: 0
- **Average Processing Time**: 91ms

---

## Layer 1: Path

**Decisions**: 3

### Prompt Set: [ps_1773478824201](../../../history/2026-03-14_1000-1100_c197ef_from-rapid-automations.md#ps_1773478824201)

**Time Range**: 2026-03-14T09:00:24.201Z → 2026-03-14T11:59:10.379Z<br>
**LSL File**: [2026-03-14_1000-1100_c197ef_from-rapid-automations.md](../../../history/2026-03-14_1000-1100_c197ef_from-rapid-automations.md#ps_1773478824201)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.95)

#### Layer-by-Layer Trace

✅ **Layer 1 (path)**
- Decision: coding
- Confidence: 0.98
- Reasoning: Coding operations detected (18): "${INIT#@file:}"), HOME/.claude/get-shit-done/bin/gsd-tools.cjs", .planning/phases (+15 more)
- Processing Time: 2ms

---

### Prompt Set: [ps_1773480046249](../../../history/2026-03-14_1000-1100_c197ef_from-rapid-automations.md#ps_1773480046249)

**Time Range**: 2026-03-14T09:20:46.249Z → 2026-03-14T11:59:11.063Z<br>
**LSL File**: [2026-03-14_1000-1100_c197ef_from-rapid-automations.md](../../../history/2026-03-14_1000-1100_c197ef_from-rapid-automations.md#ps_1773480046249)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.95)

#### Layer-by-Layer Trace

✅ **Layer 1 (path)**
- Decision: coding
- Confidence: 0.98
- Reasoning: Coding operations detected (11): "${INIT#@file:}"), HOME/.claude/get-shit-done/bin/gsd-tools.cjs", planning/phases/04-pattern-intelligence/*-RESEARCH.md (+8 more)
- Processing Time: 1ms

---

### Prompt Set: [ps_1773481304323](../../../history/2026-03-14_1000-1100_c197ef_from-rapid-automations.md#ps_1773481304323)

**Time Range**: 2026-03-14T09:41:44.323Z → 2026-03-14T11:59:11.849Z<br>
**LSL File**: [2026-03-14_1000-1100_c197ef_from-rapid-automations.md](../../../history/2026-03-14_1000-1100_c197ef_from-rapid-automations.md#ps_1773481304323)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.95)

#### Layer-by-Layer Trace

✅ **Layer 1 (path)**
- Decision: coding
- Confidence: 0.98
- Reasoning: Coding operations detected (33): "${INIT#@file:}"), HOME/.claude/get-shit-done/bin/gsd-tools.cjs", dev/null (+30 more)
- Processing Time: 1ms

---

## Layer 2: Keyword

**Decisions**: 4

### Prompt Set: [ps_1773478824201](../../../history/2026-03-14_1000-1100_c197ef_from-rapid-automations.md#ps_1773478824201)

**Time Range**: 2026-03-14T09:00:24.201Z → 2026-03-14T09:20:48.593Z<br>
**LSL File**: [2026-03-14_1000-1100_c197ef_from-rapid-automations.md](../../../history/2026-03-14_1000-1100_c197ef_from-rapid-automations.md#ps_1773478824201)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.5175)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority of write operations target local project: /Users/Q284340/Agentic/_work/rapid-automations/.planning/phases/04-pattern-intelligence/04-CONTEXT.md
- Processing Time: 144ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.5175
- Reasoning: Keyword analysis: 1 matches, score: 2/1
- Processing Time: 1ms

---

### Prompt Set: [ps_1773481304323](../../../history/2026-03-14_1000-1100_c197ef_from-rapid-automations.md#ps_1773481304323)

**Time Range**: 2026-03-14T09:41:44.323Z → 2026-03-14T09:53:32.530Z<br>
**LSL File**: [2026-03-14_1000-1100_c197ef_from-rapid-automations.md](../../../history/2026-03-14_1000-1100_c197ef_from-rapid-automations.md#ps_1773481304323)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.5175)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: "${INIT#@file:}"), /.claude/get-shit-done/bin/gsd-tools.cjs", HOME/.claude/get-shit-done/bin/gsd-tools.cjs", /dev/null, dev/null, /src/intelligence/clustering.ts, /src/intelligence/search.ts, okb/src/intelligence/clustering.ts, okb/src/intelligence/search.ts, /phases/04-pattern-intelligence/04-01-SUMMARY.md, planning/phases/04-pattern-intelligence/04-01-SUMMARY.md, /api/clusters`,, /api/search`,, /api/patterns/trending`,, /api/analyze/correlations`), planning/phases/04-pattern-intelligence, 7/30/90-day, api/clusters, api/search, api/patterns/trending, api/analyze/correlations, ~15%, /objective, /Users/, /.claude/get-shit-done/workflows/execute-phase.md, /.claude/get-shit-done/references/ui-brand.md, /execution_context, /context, /process, claude/get-shit-done/workflows/execute-phase.md, claude/get-shit-done/references/ui-brand.md
- Processing Time: 99ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.5175
- Reasoning: Keyword analysis: 1 matches, score: 2/1
- Processing Time: 0ms

---

### Prompt Set: [ps_1773478824201](../../../history/2026-03-14_1000-1100_c197ef_from-rapid-automations.md#ps_1773478824201)

**Time Range**: 2026-03-14T09:00:24.201Z → 2026-03-14T12:07:26.748Z<br>
**LSL File**: [2026-03-14_1000-1100_c197ef_from-rapid-automations.md](../../../history/2026-03-14_1000-1100_c197ef_from-rapid-automations.md#ps_1773478824201)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.5175)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority of write operations target local project: /Users/Q284340/Agentic/_work/rapid-automations/.planning/phases/04-pattern-intelligence/04-CONTEXT.md
- Processing Time: 150ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.5175
- Reasoning: Keyword analysis: 1 matches, score: 2/1
- Processing Time: 0ms

---

### Prompt Set: [ps_1773481304323](../../../history/2026-03-14_1000-1100_c197ef_from-rapid-automations.md#ps_1773481304323)

**Time Range**: 2026-03-14T09:41:44.323Z → 2026-03-14T12:07:28.877Z<br>
**LSL File**: [2026-03-14_1000-1100_c197ef_from-rapid-automations.md](../../../history/2026-03-14_1000-1100_c197ef_from-rapid-automations.md#ps_1773481304323)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.5175)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority of write operations target local project: /Users/Q284340/Agentic/_work/rapid-automations/okb/src/intelligence/clustering.ts, /Users/Q284340/Agentic/_work/rapid-automations/.planning/phases/04-pattern-intelligence/04-VERIFICATION.md
- Processing Time: 237ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.5175
- Reasoning: Keyword analysis: 1 matches, score: 2/1
- Processing Time: 0ms

---

