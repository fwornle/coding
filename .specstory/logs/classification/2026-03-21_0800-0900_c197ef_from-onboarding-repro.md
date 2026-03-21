# Classification Decision Log (Foreign/Coding)

**Time Window**: 2026-03-21_0800-0900_c197ef<br>
**Project**: onboarding-repro<br>
**Target**: CODING<br>
**Generated**: 2026-03-21T08:00:00.000Z<br>
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
- **Average Processing Time**: 2ms

---

## Layer 2: Keyword

**Decisions**: 2

### Prompt Set: [ps_1774079485325](../../../history/2026-03-21_0800-0900_c197ef_from-onboarding-repro.md#ps_1774079485325)

**Time Range**: 2026-03-21T07:51:25.325Z → 2026-03-21T07:51:37.188Z<br>
**LSL File**: [2026-03-21_0800-0900_c197ef_from-onboarding-repro.md](../../../history/2026-03-21_0800-0900_c197ef_from-onboarding-repro.md#ps_1774079485325)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.5525)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: No file operations detected
- Processing Time: 1ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.5525
- Reasoning: Keyword analysis: 1 matches, score: 4/1
- Processing Time: 0ms

---

### Prompt Set: [ps_1774079485325](../../../history/2026-03-21_0800-0900_c197ef_from-onboarding-repro.md#ps_1774079485325)

**Time Range**: 2026-03-21T07:51:25.325Z → 2026-03-21T07:51:41.192Z<br>
**LSL File**: [2026-03-21_0800-0900_c197ef_from-onboarding-repro.md](../../../history/2026-03-21_0800-0900_c197ef_from-onboarding-repro.md#ps_1774079485325)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.5525)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: /dev/null, dev/null
- Processing Time: 2ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.5525
- Reasoning: Keyword analysis: 1 matches, score: 4/1
- Processing Time: 0ms

---

