# Classification Decision Log (Foreign/Coding)

**Time Window**: 2025-10-26_0700-0800_g9b30a<br>
**Project**: curriculum-alignment<br>
**Target**: CODING<br>
**Generated**: 2025-10-27T12:42:31.325Z<br>
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
- **Average Processing Time**: 0ms

---

## Layer 2: Keyword

**Decisions**: 1

### Prompt Set: [ps_2025-10-26T06:52:45.292Z](../../../history/2025-10-26_0700-0800_g9b30a_from-curriculum-alignment.md#ps_2025-10-26T06:52:45.292Z)

**Time Range**: 2025-10-26T06:52:45.292Z → 2025-10-26T06:52:48.111Z<br>
**LSL File**: [2025-10-26_0700-0800_g9b30a_from-curriculum-alignment.md](../../../history/2025-10-26_0700-0800_g9b30a_from-curriculum-alignment.md#ps_2025-10-26T06:52:45.292Z)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.5875)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: /mcp-server-semantic-analysis/docs/images/tool-overview.png, /mcp-server-semantic-analysis/docs/images/mcp-server-architecture.png, /mcp-server-semantic-analysis/docs/images/agent-coordination-flow.png
- Processing Time: 0ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.5875
- Reasoning: Keyword analysis: 2 matches, score: 6/1
- Processing Time: 0ms

---

