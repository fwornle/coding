# Classification Decision Log (Foreign/Coding)

**Time Window**: 2026-03-21_1500-1600_c197ef<br>
**Project**: rapid-automations<br>
**Target**: CODING<br>
**Generated**: 2026-03-21T15:00:00.000Z<br>
**Decisions in Window**: 3

---

## Statistics

- **Total Prompt Sets**: 3
- **Classified as CODING**: 3 (100%)
- **Classified as LOCAL**: 0 (0%)
- **[Layer 0 (Session Filter) Decisions](#layer-0-session-filter)**: 0
- **[Layer 1 (Path) Decisions](#layer-1-path)**: 1
- **[Layer 2 (Keyword) Decisions](#layer-2-keyword)**: 2
- **[Layer 3 (Embedding) Decisions](#layer-3-embedding)**: 0
- **[Layer 4 (Semantic) Decisions](#layer-4-semantic)**: 0
- **Average Processing Time**: 38ms

---

## Layer 1: Path

**Decisions**: 1

### Prompt Set: [ps_1774102704174](../../../history/2026-03-21_1500-1600_c197ef_from-rapid-automations.md#ps_1774102704174)

**Time Range**: 2026-03-21T14:18:24.174Z → 2026-03-21T14:19:14.467Z<br>
**LSL File**: [2026-03-21_1500-1600_c197ef_from-rapid-automations.md](../../../history/2026-03-21_1500-1600_c197ef_from-rapid-automations.md#ps_1774102704174)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.95)

#### Layer-by-Layer Trace

✅ **Layer 1 (path)**
- Decision: coding
- Confidence: 0.98
- Reasoning: Coding operations detected (5): docs/puml/_standard-style.puml, docs/presentation/puml/_standard-style.puml, docs/puml (+2 more)
- Processing Time: 115ms

---

## Layer 2: Keyword

**Decisions**: 2

### Prompt Set: [ps_1774102486316](../../../history/2026-03-21_1500-1600_c197ef_from-rapid-automations.md#ps_1774102486316)

**Time Range**: 2026-03-21T14:14:46.316Z → 2026-03-21T14:18:05.986Z<br>
**LSL File**: [2026-03-21_1500-1600_c197ef_from-rapid-automations.md](../../../history/2026-03-21_1500-1600_c197ef_from-rapid-automations.md#ps_1774102486316)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.5525)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority of write operations target local project: /Users/Q284340/Agentic/_work/rapid-automations/docs/integrations/toolkit/index.md, /Users/Q284340/Agentic/_work/rapid-automations/docs/integrations/sandbox/index.md
- Processing Time: 0ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.5525
- Reasoning: Keyword analysis: 1 matches, score: 4/1
- Processing Time: 0ms

---

### Prompt Set: [ps_1774102486316](../../../history/2026-03-21_1500-1600_c197ef_from-rapid-automations.md#ps_1774102486316)

**Time Range**: 2026-03-21T14:14:46.316Z → 2026-03-21T14:18:20.836Z<br>
**LSL File**: [2026-03-21_1500-1600_c197ef_from-rapid-automations.md](../../../history/2026-03-21_1500-1600_c197ef_from-rapid-automations.md#ps_1774102486316)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.5525)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority of write operations target local project: /Users/Q284340/Agentic/_work/rapid-automations/docs/integrations/toolkit/index.md, /Users/Q284340/Agentic/_work/rapid-automations/docs/integrations/sandbox/index.md
- Processing Time: 0ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.5525
- Reasoning: Keyword analysis: 1 matches, score: 4/1
- Processing Time: 0ms

---

