# Classification Decision Log (Foreign/Coding)

**Time Window**: 2026-03-22_0800-0900_c197ef<br>
**Project**: rapid-automations<br>
**Target**: CODING<br>
**Generated**: 2026-03-22T08:00:00.000Z<br>
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
- **Average Processing Time**: 94ms

---

## Layer 2: Keyword

**Decisions**: 1

### Prompt Set: [ps_1774162886320](../../../history/2026-03-22_0800-0900_c197ef_from-rapid-automations.md#ps_1774162886320)

**Time Range**: 2026-03-22T07:01:26.320Z → 2026-03-22T07:22:51.291Z<br>
**LSL File**: [2026-03-22_0800-0900_c197ef_from-rapid-automations.md](../../../history/2026-03-22_0800-0900_c197ef_from-rapid-automations.md#ps_1774162886320)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.57)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority of write operations target local project: /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/store/persistence.ts, /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/CLAUDE.md
- Processing Time: 94ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.57
- Reasoning: Keyword analysis: 2 matches, score: 5/1
- Processing Time: 0ms

---

