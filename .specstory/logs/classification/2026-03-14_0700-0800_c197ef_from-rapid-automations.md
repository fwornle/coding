# Classification Decision Log (Foreign/Coding)

**Time Window**: 2026-03-14_0700-0800_c197ef<br>
**Project**: rapid-automations<br>
**Target**: CODING<br>
**Generated**: 2026-03-14T07:00:00.000Z<br>
**Decisions in Window**: 4

---

## Statistics

- **Total Prompt Sets**: 4
- **Classified as CODING**: 4 (100%)
- **Classified as LOCAL**: 0 (0%)
- **[Layer 0 (Session Filter) Decisions](#layer-0-session-filter)**: 0
- **[Layer 1 (Path) Decisions](#layer-1-path)**: 3
- **[Layer 2 (Keyword) Decisions](#layer-2-keyword)**: 1
- **[Layer 3 (Embedding) Decisions](#layer-3-embedding)**: 0
- **[Layer 4 (Semantic) Decisions](#layer-4-semantic)**: 0
- **Average Processing Time**: 183ms

---

## Layer 1: Path

**Decisions**: 3

### Prompt Set: ps_1773471366684

**Time Range**: 2026-03-14T06:56:06.684Z → 2026-03-14T07:20:22.202Z<br>
**LSL File**: `pending`<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.95)

#### Layer-by-Layer Trace

✅ **Layer 1 (path)**
- Decision: coding
- Confidence: 0.98
- Reasoning: Coding operations detected (15): /Users/Q284340/Agentic/coding/integrations/mcp-constraint-monitor, /Users/Q284340/Agentic/coding/integrations/mcp-constraint-monitor/src/, /Users/Q284340/Agentic/coding/integrations/mcp-constraint-monitor/src/config/ (+12 more)
- Processing Time: 136ms

---

### Prompt Set: ps_1773471366684

**Time Range**: 2026-03-14T06:56:06.684Z → 2026-03-14T07:20:48.659Z<br>
**LSL File**: `pending`<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.95)

#### Layer-by-Layer Trace

✅ **Layer 1 (path)**
- Decision: coding
- Confidence: 0.98
- Reasoning: Coding operations detected (15): /Users/Q284340/Agentic/coding/integrations/mcp-constraint-monitor, /Users/Q284340/Agentic/coding/integrations/mcp-constraint-monitor/src/, /Users/Q284340/Agentic/coding/integrations/mcp-constraint-monitor/src/config/ (+12 more)
- Processing Time: 135ms

---

### Prompt Set: ps_1773471366684

**Time Range**: 2026-03-14T06:56:06.684Z → 2026-03-14T08:53:49.760Z<br>
**LSL File**: `pending`<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.95)

#### Layer-by-Layer Trace

✅ **Layer 1 (path)**
- Decision: coding
- Confidence: 0.98
- Reasoning: Coding operations detected (15): /Users/Q284340/Agentic/coding/integrations/mcp-constraint-monitor, /Users/Q284340/Agentic/coding/integrations/mcp-constraint-monitor/src/, /Users/Q284340/Agentic/coding/integrations/mcp-constraint-monitor/src/config/ (+12 more)
- Processing Time: 459ms

---

## Layer 2: Keyword

**Decisions**: 1

### Prompt Set: ps_1773471366684

**Time Range**: 2026-03-14T06:56:06.684Z → 2026-03-14T07:00:00.136Z<br>
**LSL File**: `pending`<br>
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
- Processing Time: 1ms

---

