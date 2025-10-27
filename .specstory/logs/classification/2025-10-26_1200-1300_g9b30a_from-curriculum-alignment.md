# Classification Decision Log (Foreign/Coding)

**Time Window**: 2025-10-26_1200-1300_g9b30a<br>
**Project**: curriculum-alignment<br>
**Target**: CODING<br>
**Generated**: 2025-10-27T12:12:30.436Z<br>
**Decisions in Window**: 2

---

## Statistics

- **Total Prompt Sets**: 2
- **Classified as CODING**: 2 (100%)
- **Classified as LOCAL**: 0 (0%)
- **[Layer 0 (Session Filter) Decisions](#layer-0-session-filter)**: 0
- **[Layer 1 (Path) Decisions](#layer-1-path)**: 0
- **[Layer 2 (Keyword) Decisions](#layer-2-keyword)**: 1
- **[Layer 3 (Embedding) Decisions](#layer-3-embedding)**: 1
- **[Layer 4 (Semantic) Decisions](#layer-4-semantic)**: 0
- **Average Processing Time**: 121ms

---

## Layer 2: Keyword

**Decisions**: 1

### Prompt Set: [ps_2025-10-26T11:06:41.632Z](../../../history/2025-10-26_1200-1300_g9b30a_from-curriculum-alignment.md#ps_2025-10-26T11:06:41.632Z)

**Time Range**: 2025-10-26T11:06:41.632Z → 2025-10-26T11:06:44.196Z<br>
**LSL File**: [2025-10-26_1200-1300_g9b30a_from-curriculum-alignment.md](../../../history/2025-10-26_1200-1300_g9b30a_from-curriculum-alignment.md#ps_2025-10-26T11:06:41.632Z)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.5875)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: /Users/, /Agentic/coding/integrations/memory-visualizer.
- Processing Time: 1ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.5875
- Reasoning: Keyword analysis: 2 matches, score: 6/1
- Processing Time: 0ms

---

## Layer 3: Embedding

**Decisions**: 1

### Prompt Set: [ps_2025-10-26T11:14:25.308Z](../../../history/2025-10-26_1200-1300_g9b30a_from-curriculum-alignment.md#ps_2025-10-26T11:14:25.308Z)

**Time Range**: 2025-10-26T11:14:25.308Z → 2025-10-26T11:14:28.556Z<br>
**LSL File**: [2025-10-26_1200-1300_g9b30a_from-curriculum-alignment.md](../../../history/2025-10-26_1200-1300_g9b30a_from-curriculum-alignment.md#ps_2025-10-26T11:14:25.308Z)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.65442347)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: /docs/_standard-style.puml
- Processing Time: 0ms

❌ **Layer 2 (keyword)**
- Decision: local
- Confidence: 0.1
- Reasoning: Keyword analysis: 0 matches, score: 0/1
- Processing Time: 0ms

✅ **Layer 3 (embedding)**
- Decision: coding
- Confidence: 0.65442347
- Reasoning: Semantic similarity favors coding (coding_lsl=0.654, nano_degree=0.653, curriculum_alignment=0.645, coding_infrastructure=0.640)
- Processing Time: 240ms

---

