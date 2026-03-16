# Classification Decision Log (Foreign/Coding)

**Time Window**: 2026-03-15_1800-1900_c197ef<br>
**Project**: onboarding-repro<br>
**Target**: CODING<br>
**Generated**: 2026-03-15T18:00:00.000Z<br>
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

### Prompt Set: ps_1773594632496

**Time Range**: 2026-03-15T17:10:32.496Z → 2026-03-16T05:45:52.237Z<br>
**LSL File**: `pending`<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.8325)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: /`hasAgentSession`:, /Agentic/_work/rapid-automations`, /🌲/🫒, Agentic/_work/rapid-automations
- Processing Time: 1ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.8325
- Reasoning: Keyword analysis: 6 matches, score: 20/1
- Processing Time: 1ms

---

### Prompt Set: ps_1773595504027

**Time Range**: 2026-03-15T17:25:04.027Z → 2026-03-16T05:45:52.528Z<br>
**LSL File**: `pending`<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.64)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: ~5s).
- Processing Time: 1ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.64
- Reasoning: Keyword analysis: 3 matches, score: 9/1
- Processing Time: 0ms

---

