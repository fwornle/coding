# Classification Decision Log (Foreign/Coding)

**Time Window**: 2026-03-21_1800-1900_c197ef<br>
**Project**: rapid-automations<br>
**Target**: CODING<br>
**Generated**: 2026-03-21T18:00:00.000Z<br>
**Decisions in Window**: 2

---

## Statistics

- **Total Prompt Sets**: 2
- **Classified as CODING**: 2 (100%)
- **Classified as LOCAL**: 0 (0%)
- **[Layer 0 (Session Filter) Decisions](#layer-0-session-filter)**: 0
- **[Layer 1 (Path) Decisions](#layer-1-path)**: 1
- **[Layer 2 (Keyword) Decisions](#layer-2-keyword)**: 1
- **[Layer 3 (Embedding) Decisions](#layer-3-embedding)**: 0
- **[Layer 4 (Semantic) Decisions](#layer-4-semantic)**: 0
- **Average Processing Time**: 72ms

---

## Layer 1: Path

**Decisions**: 1

### Prompt Set: [ps_1774114130779](../../../history/2026-03-21_1800-1900_c197ef_from-rapid-automations.md#ps_1774114130779)

**Time Range**: 2026-03-21T17:28:50.779Z → 2026-03-21T17:29:02.157Z<br>
**LSL File**: [2026-03-21_1800-1900_c197ef_from-rapid-automations.md](../../../history/2026-03-21_1800-1900_c197ef_from-rapid-automations.md#ps_1774114130779)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.95)

#### Layer-by-Layer Trace

✅ **Layer 1 (path)**
- Decision: coding
- Confidence: 0.98
- Reasoning: Coding operations detected (5): docs/puml/_standard-style.puml, docs/presentation/puml/_standard-style.puml, docs/puml (+2 more)
- Processing Time: 144ms

---

## Layer 2: Keyword

**Decisions**: 1

### Prompt Set: [ps_1774114115296](../../../history/2026-03-21_1800-1900_c197ef_from-rapid-automations.md#ps_1774114115296)

**Time Range**: 2026-03-21T17:28:35.296Z → 2026-03-21T17:28:46.005Z<br>
**LSL File**: [2026-03-21_1800-1900_c197ef_from-rapid-automations.md](../../../history/2026-03-21_1800-1900_c197ef_from-rapid-automations.md#ps_1774114115296)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.5175)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: HTTPS/SSE, graphology/levelDB, configured/applicable
- Processing Time: 0ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.5175
- Reasoning: Keyword analysis: 1 matches, score: 2/1
- Processing Time: 0ms

---

