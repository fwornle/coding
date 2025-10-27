# Classification Decision Log (Foreign/Coding)

**Time Window**: 2025-10-27_0800-0900_g9b30a<br>
**Project**: curriculum-alignment<br>
**Target**: CODING<br>
**Generated**: 2025-10-27T12:12:30.443Z<br>
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
- **Average Processing Time**: 102ms

---

## Layer 3: Embedding

**Decisions**: 1

### Prompt Set: [ps_2025-10-27T07:17:59.056Z](../../../history/2025-10-27_0800-0900_g9b30a_from-curriculum-alignment.md#ps_2025-10-27T07:17:59.056Z)

**Time Range**: 2025-10-27T07:17:59.056Z → 2025-10-27T07:18:01.463Z<br>
**LSL File**: [2025-10-27_0800-0900_g9b30a_from-curriculum-alignment.md](../../../history/2025-10-27_0800-0900_g9b30a_from-curriculum-alignment.md#ps_2025-10-27T07:17:59.056Z)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.611462525)

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
- Confidence: 0.611462525
- Reasoning: Semantic similarity favors coding (coding_lsl=0.608, nano_degree=0.600, curriculum_alignment=0.589, coding_infrastructure=0.585)
- Processing Time: 102ms

---

