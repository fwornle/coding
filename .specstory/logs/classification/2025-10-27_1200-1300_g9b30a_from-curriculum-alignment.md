# Classification Decision Log (Foreign/Coding)

**Time Window**: 2025-10-27_1200-1300_g9b30a<br>
**Project**: curriculum-alignment<br>
**Target**: CODING<br>
**Generated**: 2025-10-27T12:12:30.457Z<br>
**Decisions in Window**: 2

---

## Statistics

- **Total Prompt Sets**: 2
- **Classified as CODING**: 2 (100%)
- **Classified as LOCAL**: 0 (0%)
- **[Layer 0 (Session Filter) Decisions](#layer-0-session-filter)**: 0
- **[Layer 1 (Path) Decisions](#layer-1-path)**: 0
- **[Layer 2 (Keyword) Decisions](#layer-2-keyword)**: 0
- **[Layer 3 (Embedding) Decisions](#layer-3-embedding)**: 2
- **[Layer 4 (Semantic) Decisions](#layer-4-semantic)**: 0
- **Average Processing Time**: 89ms

---

## Layer 3: Embedding

**Decisions**: 2

### Prompt Set: [ps_2025-10-27T11:31:29.808Z](../../../history/2025-10-27_1200-1300_g9b30a_from-curriculum-alignment.md#ps_2025-10-27T11:31:29.808Z)

**Time Range**: 2025-10-27T11:31:29.808Z → 2025-10-27T11:31:32.241Z<br>
**LSL File**: [2025-10-27_1200-1300_g9b30a_from-curriculum-alignment.md](../../../history/2025-10-27_1200-1300_g9b30a_from-curriculum-alignment.md#ps_2025-10-27T11:31:29.808Z)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.679908975)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: No file operations detected
- Processing Time: 0ms

❌ **Layer 2 (keyword)**
- Decision: local
- Confidence: 0.1
- Reasoning: Keyword analysis: 0 matches, score: 0/1
- Processing Time: 0ms

✅ **Layer 3 (embedding)**
- Decision: coding
- Confidence: 0.679908975
- Reasoning: Semantic similarity favors coding (coding_lsl=0.664, curriculum_alignment=0.631, nano_degree=0.629, coding_infrastructure=0.618)
- Processing Time: 99ms

---

### Prompt Set: [ps_2025-10-27T11:55:43.425Z](../../../history/2025-10-27_1200-1300_g9b30a_from-curriculum-alignment.md#ps_2025-10-27T11:55:43.425Z)

**Time Range**: 2025-10-27T11:55:43.425Z → 2025-10-27T11:55:44.710Z<br>
**LSL File**: [2025-10-27_1200-1300_g9b30a_from-curriculum-alignment.md](../../../history/2025-10-27_1200-1300_g9b30a_from-curriculum-alignment.md#ps_2025-10-27T11:55:43.425Z)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.62666932)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: /presentation/images/complete-system-overview.png
- Processing Time: 1ms

❌ **Layer 2 (keyword)**
- Decision: local
- Confidence: 0.1
- Reasoning: Keyword analysis: 0 matches, score: 0/1
- Processing Time: 1ms

✅ **Layer 3 (embedding)**
- Decision: coding
- Confidence: 0.62666932
- Reasoning: Semantic similarity favors coding (coding_lsl=0.614, coding_infrastructure=0.602, nano_degree=0.587, curriculum_alignment=0.578)
- Processing Time: 76ms

---

