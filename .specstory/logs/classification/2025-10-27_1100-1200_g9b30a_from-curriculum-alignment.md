# Classification Decision Log (Foreign/Coding)

**Time Window**: 2025-10-27_1100-1200_g9b30a<br>
**Project**: curriculum-alignment<br>
**Target**: CODING<br>
**Generated**: 2025-10-30T16:38:42.650Z<br>
**Decisions in Window**: 1

---

## Statistics

- **Total Prompt Sets**: 1
- **Classified as CODING**: 1 (100%)
- **Classified as LOCAL**: 0 (0%)
- **[Layer 0 (Session Filter) Decisions](#layer-0-session-filter)**: 0
- **[Layer 1 (Path) Decisions](#layer-1-path)**: 0
- **[Layer 2 (Keyword) Decisions](#layer-2-keyword)**: 0
- **[Layer 3 (Embedding) Decisions](#layer-3-embedding)**: 1
- **[Layer 4 (Semantic) Decisions](#layer-4-semantic)**: 0
- **Average Processing Time**: 84ms

---

## Layer 3: Embedding

**Decisions**: 1

### Prompt Set: [ps_2025-10-27T10:01:20.673Z](../../../history/2025-10-27_1100-1200_g9b30a_from-curriculum-alignment.md#ps_2025-10-27T10:01:20.673Z)

**Time Range**: 2025-10-27T10:01:20.673Z → 2025-10-27T10:01:23.594Z<br>
**LSL File**: [2025-10-27_1100-1200_g9b30a_from-curriculum-alignment.md](../../../history/2025-10-27_1100-1200_g9b30a_from-curriculum-alignment.md#ps_2025-10-27T10:01:20.673Z)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.5542321250000001)

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
- Processing Time: 1ms

✅ **Layer 3 (embedding)**
- Decision: coding
- Confidence: 0.5542321250000001
- Reasoning: Semantic similarity favors coding (coding_lsl=0.526, nano_degree=0.468, coding_infrastructure=0.467, curriculum_alignment=0.441)
- Processing Time: 83ms

---

