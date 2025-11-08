# Classification Decision Log (Foreign/Coding)

**Time Window**: 2025-11-08_1400-1500_g9b30a<br>
**Project**: curriculum-alignment<br>
**Target**: CODING<br>
**Generated**: 2025-11-08T14:00:00.000Z<br>
**Decisions in Window**: 3

---

## Statistics

- **Total Prompt Sets**: 3
- **Classified as CODING**: 3 (100%)
- **Classified as LOCAL**: 0 (0%)
- **[Layer 0 (Session Filter) Decisions](#layer-0-session-filter)**: 0
- **[Layer 1 (Path) Decisions](#layer-1-path)**: 1
- **[Layer 2 (Keyword) Decisions](#layer-2-keyword)**: 2
- **[Layer 3 (Embedding) Decisions](#layer-3-embedding)**: 0
- **[Layer 4 (Semantic) Decisions](#layer-4-semantic)**: 0
- **Average Processing Time**: 0ms

---

## Layer 1: Path

**Decisions**: 1

### Prompt Set: [ps_1762607421670](../../../history/2025-11-08_1400-1500_g9b30a_from-curriculum-alignment.md#ps_1762607421670)

**Time Range**: 2025-11-08T13:10:21.670Z → 2025-11-08T13:10:23.264Z<br>
**LSL File**: [2025-11-08_1400-1500_g9b30a_from-curriculum-alignment.md](../../../history/2025-11-08_1400-1500_g9b30a_from-curriculum-alignment.md#ps_1762607421670)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.95)

#### Layer-by-Layer Trace

✅ **Layer 1 (path)**
- Decision: coding
- Confidence: 0.98
- Reasoning: Majority (51.5%) of file operations target coding repo: setup/warmup, lib/vkb-server/index.js, lib/service-starter.js, scripts/validate-mcp-startup.sh, scripts/batch-lsl-processor.js, coding/bin/coding, Agentic/coding/lib/vkb-server/index.js, scripts/process-state-manager.js, Agentic/coding/scripts/start-services-robust.js, lib/vkb-server/cli.js, stdout/stderr, Agentic/coding/lib/service-starter.js, Agentic/coding/scripts/validate-mcp-startup.sh, Agentic/coding/scripts/batch-lsl-processor.js, void/meaningless, interrupted/g, Agentic/coding
- Processing Time: 1ms

---

## Layer 2: Keyword

**Decisions**: 2

### Prompt Set: [ps_1762607044217](../../../history/2025-11-08_1400-1500_g9b30a_from-curriculum-alignment.md#ps_1762607044217)

**Time Range**: 2025-11-08T13:04:04.217Z → 2025-11-08T13:04:05.069Z<br>
**LSL File**: [2025-11-08_1400-1500_g9b30a_from-curriculum-alignment.md](../../../history/2025-11-08_1400-1500_g9b30a_from-curriculum-alignment.md#ps_1762607044217)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.6925)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: No file operations detected
- Processing Time: 0ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.6925
- Reasoning: Keyword analysis: 3 matches, score: 12/1
- Processing Time: 0ms

---

### Prompt Set: [ps_1762607539911](../../../history/2025-11-08_1400-1500_g9b30a_from-curriculum-alignment.md#ps_1762607539911)

**Time Range**: 2025-11-08T13:12:19.911Z → 2025-11-08T13:12:21.264Z<br>
**LSL File**: [2025-11-08_1400-1500_g9b30a_from-curriculum-alignment.md](../../../history/2025-11-08_1400-1500_g9b30a_from-curriculum-alignment.md#ps_1762607539911)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.5525)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: No file operations detected
- Processing Time: 0ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.5525
- Reasoning: Keyword analysis: 1 matches, score: 4/1
- Processing Time: 0ms

---

