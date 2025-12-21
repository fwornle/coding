# Classification Decision Log (Foreign/Coding)

**Time Window**: 2025-12-20_1800-1900_g9b30a<br>
**Project**: curriculum-alignment<br>
**Target**: CODING<br>
**Generated**: 2025-12-20T18:00:00.000Z<br>
**Decisions in Window**: 2

---

## Statistics

- **Total Prompt Sets**: 2
- **Classified as CODING**: 2 (100%)
- **Classified as LOCAL**: 0 (0%)
- **[Layer 0 (Session Filter) Decisions](#layer-0-session-filter)**: 0
- **[Layer 1 (Path) Decisions](#layer-1-path)**: 1
- **[Layer 2 (Keyword) Decisions](#layer-2-keyword)**: 0
- **[Layer 3 (Embedding) Decisions](#layer-3-embedding)**: 1
- **[Layer 4 (Semantic) Decisions](#layer-4-semantic)**: 0
- **Average Processing Time**: 391ms

---

## Layer 1: Path

**Decisions**: 1

### Prompt Set: [ps_1766250405248](../../../history/2025-12-20_1800-1900_g9b30a_from-curriculum-alignment.md#ps_1766250405248)

**Time Range**: 2025-12-20T17:06:45.248Z → 2025-12-20T17:07:39.457Z<br>
**LSL File**: [2025-12-20_1800-1900_g9b30a_from-curriculum-alignment.md](../../../history/2025-12-20_1800-1900_g9b30a_from-curriculum-alignment.md#ps_1766250405248)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.95)

#### Layer-by-Layer Trace

✅ **Layer 1 (path)**
- Decision: coding
- Confidence: 0.98
- Reasoning: Majority (73.7%) of file operations target coding repo: /Users/q284340/Agentic/coding/.data/health/, Users/q284340/Agentic/coding/.data/health/, dev/null, /Users/q284340/Agentic/coding/.data/health/latest-verification.json, Users/q284340/Agentic/coding/.data/health/latest-verification.json, /Users/q284340/Agentic/coding/.data/, Users/q284340/Agentic/coding/.data/, 3033/api/health, 3033/api/verification/latest, 3033/api/status, /Users/q284340/Agentic/coding/integrations, tmp/health-verification-*.json, /Users/q284340/Agentic/coding/integrations/system-health-dashboard/server.js, /Users/q284340/Agentic/coding/scripts/health-verifier.js
- Processing Time: 1ms

---

## Layer 3: Embedding

**Decisions**: 1

### Prompt Set: [ps_1766250405248](../../../history/2025-12-20_1800-1900_g9b30a_from-curriculum-alignment.md#ps_1766250405248)

**Time Range**: 2025-12-20T17:06:45.248Z → 2025-12-20T17:07:24.225Z<br>
**LSL File**: [2025-12-20_1800-1900_g9b30a_from-curriculum-alignment.md](../../../history/2025-12-20_1800-1900_g9b30a_from-curriculum-alignment.md#ps_1766250405248)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.6167123000000001)

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
- Confidence: 0.6167123000000001
- Reasoning: Semantic similarity favors coding (coding_infrastructure=0.594, curriculum_alignment=0.549, coding_lsl=0.539, nano_degree=0.479)
- Processing Time: 779ms

---

