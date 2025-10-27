# Classification Decision Log (Foreign/Coding)

**Time Window**: 2025-10-25_2300-0000_g9b30a<br>
**Project**: curriculum-alignment<br>
**Target**: CODING<br>
**Generated**: 2025-10-27T19:10:18.522Z<br>
**Decisions in Window**: 3

---

## Statistics

- **Total Prompt Sets**: 3
- **Classified as CODING**: 3 (100%)
- **Classified as LOCAL**: 0 (0%)
- **[Layer 0 (Session Filter) Decisions](#layer-0-session-filter)**: 0
- **[Layer 1 (Path) Decisions](#layer-1-path)**: 0
- **[Layer 2 (Keyword) Decisions](#layer-2-keyword)**: 2
- **[Layer 3 (Embedding) Decisions](#layer-3-embedding)**: 1
- **[Layer 4 (Semantic) Decisions](#layer-4-semantic)**: 0
- **Average Processing Time**: 163ms

---

## Layer 2: Keyword

**Decisions**: 2

### Prompt Set: [ps_2025-10-25T21:12:16.685Z](../../../history/2025-10-25_2300-0000_g9b30a_from-curriculum-alignment.md#ps_2025-10-25T21:12:16.685Z)

**Time Range**: 2025-10-25T21:12:16.685Z → 2025-10-25T21:12:19.003Z<br>
**LSL File**: [2025-10-25_2300-0000_g9b30a_from-curriculum-alignment.md](../../../history/2025-10-25_2300-0000_g9b30a_from-curriculum-alignment.md#ps_2025-10-25T21:12:16.685Z)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.6575)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: /.specstory/history/*_from-curriculum-alignment.md),
- Processing Time: 1ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.6575
- Reasoning: Keyword analysis: 3 matches, score: 10/1
- Processing Time: 1ms

---

### Prompt Set: [ps_2025-10-25T21:26:51.078Z](../../../history/2025-10-25_2300-0000_g9b30a_from-curriculum-alignment.md#ps_2025-10-25T21:26:51.078Z)

**Time Range**: 2025-10-25T21:26:51.078Z → 2025-10-25T21:26:53.375Z<br>
**LSL File**: [2025-10-25_2300-0000_g9b30a_from-curriculum-alignment.md](../../../history/2025-10-25_2300-0000_g9b30a_from-curriculum-alignment.md#ps_2025-10-25T21:26:51.078Z)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.535)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: /presentation., /png
- Processing Time: 0ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.535
- Reasoning: Keyword analysis: 1 matches, score: 3/1
- Processing Time: 0ms

---

## Layer 3: Embedding

**Decisions**: 1

### Prompt Set: [ps_2025-10-25T21:15:39.402Z](../../../history/2025-10-25_2300-0000_g9b30a_from-curriculum-alignment.md#ps_2025-10-25T21:15:39.402Z)

**Time Range**: 2025-10-25T21:15:39.402Z → 2025-10-25T21:15:41.522Z<br>
**LSL File**: [2025-10-25_2300-0000_g9b30a_from-curriculum-alignment.md](../../../history/2025-10-25_2300-0000_g9b30a_from-curriculum-alignment.md#ps_2025-10-25T21:15:39.402Z)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.64822625)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: /images/mcp-server-architecture.png)
- Processing Time: 0ms

❌ **Layer 2 (keyword)**
- Decision: local
- Confidence: 0.1
- Reasoning: Keyword analysis: 0 matches, score: 0/1
- Processing Time: 0ms

✅ **Layer 3 (embedding)**
- Decision: coding
- Confidence: 0.64822625
- Reasoning: Semantic similarity favors coding (coding_infrastructure=0.620, coding_lsl=0.571, nano_degree=0.564, curriculum_alignment=0.561)
- Processing Time: 488ms

---

