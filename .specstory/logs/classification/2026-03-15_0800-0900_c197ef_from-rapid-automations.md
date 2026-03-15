# Classification Decision Log (Foreign/Coding)

**Time Window**: 2026-03-15_0800-0900_c197ef<br>
**Project**: rapid-automations<br>
**Target**: CODING<br>
**Generated**: 2026-03-15T08:00:00.000Z<br>
**Decisions in Window**: 1

---

## Statistics

- **Total Prompt Sets**: 1
- **Classified as CODING**: 1 (100%)
- **Classified as LOCAL**: 0 (0%)
- **[Layer 0 (Session Filter) Decisions](#layer-0-session-filter)**: 0
- **[Layer 1 (Path) Decisions](#layer-1-path)**: 0
- **[Layer 2 (Keyword) Decisions](#layer-2-keyword)**: 1
- **[Layer 3 (Embedding) Decisions](#layer-3-embedding)**: 0
- **[Layer 4 (Semantic) Decisions](#layer-4-semantic)**: 0
- **Average Processing Time**: 2ms

---

## Layer 2: Keyword

**Decisions**: 1

### Prompt Set: [ps_1773558174470](../../../history/2026-03-15_0800-0900_c197ef_from-rapid-automations.md#ps_1773558174470)

**Time Range**: 2026-03-15T07:02:54.470Z → 2026-03-15T07:03:05.148Z<br>
**LSL File**: [2026-03-15_0800-0900_c197ef_from-rapid-automations.md](../../../history/2026-03-15_0800-0900_c197ef_from-rapid-automations.md#ps_1773558174470)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.5175)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: graphology/levelDB
- Processing Time: 1ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.5175
- Reasoning: Keyword analysis: 1 matches, score: 2/1
- Processing Time: 1ms

---

