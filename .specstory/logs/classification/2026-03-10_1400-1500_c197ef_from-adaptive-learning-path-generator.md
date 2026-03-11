# Classification Decision Log (Foreign/Coding)

**Time Window**: 2026-03-10_1400-1500_c197ef<br>
**Project**: adaptive-learning-path-generator<br>
**Target**: CODING<br>
**Generated**: 2026-03-10T14:00:00.000Z<br>
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
- **Average Processing Time**: 3ms

---

## Layer 2: Keyword

**Decisions**: 1

### Prompt Set: ps_1773150966422

**Time Range**: 2026-03-10T13:56:06.422Z → 2026-03-10T16:57:09.041Z<br>
**LSL File**: `pending`<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.6925)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: //127.0.0.1:3128/,, //127.0.0.1:3128/`, /`HTTPS_PROXY`), ~11, /Agentic/coding/bin/coding), /Users/, /.copilot/session-state/593d4b9e-7a3d-4bb7-951c-caa464ded533/files/paste-1773150965221.txt, Agentic/coding/bin/coding, copilot/session-state/593d4b9e-7a3d-4bb7-951c-caa464ded533/files/paste-1773150965221.txt
- Processing Time: 1ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.6925
- Reasoning: Keyword analysis: 4 matches, score: 12/1
- Processing Time: 2ms

---

