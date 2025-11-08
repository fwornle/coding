# Classification Decision Log (Foreign/Coding)

**Time Window**: 2025-11-08_1300-1400_g9b30a<br>
**Project**: curriculum-alignment<br>
**Target**: CODING<br>
**Generated**: 2025-11-08T13:00:00.000Z<br>
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
- **Average Processing Time**: 0ms

---

## Layer 1: Path

**Decisions**: 1

### Prompt Set: [ps_1762605038794](../../../history/2025-11-08_1300-1400_g9b30a_from-curriculum-alignment.md#ps_1762605038794)

**Time Range**: 2025-11-08T12:30:38.794Z → 2025-11-08T12:31:12.966Z<br>
**LSL File**: [2025-11-08_1300-1400_g9b30a_from-curriculum-alignment.md](../../../history/2025-11-08_1300-1400_g9b30a_from-curriculum-alignment.md#ps_1762605038794)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.95)

#### Layer-by-Layer Trace

✅ **Layer 1 (path)**
- Decision: coding
- Confidence: 0.98
- Reasoning: Majority (55.0%) of file operations target coding repo: specstory/history/*.md, dev/null, /Users/q284340/Agentic/coding/.specstory/history/*_from-curriculum-alignment.md, Users/q284340/Agentic/coding/.specstory/history/*_from-curriculum-alignment.md, /Users/q284340/Agentic/coding/.specstory/history/2025-11-07_1600-1700_g9b30a_from-curriculum-alignment.md, /Users/q284340/Agentic/coding/.specstory/history/2025-11-07_0900-1000_g9b30a_from-curriculum-alignment.md, specstory/history, coding/.specstory/history, Agentic/coding, Agentic/nano-degree, Agentic/coding/.specstory/history
- Processing Time: 0ms

---

## Layer 2: Keyword

**Decisions**: 1

### Prompt Set: [ps_1762605217549](../../../history/2025-11-08_1300-1400_g9b30a_from-curriculum-alignment.md#ps_1762605217549)

**Time Range**: 2025-11-08T12:33:37.549Z → 2025-11-08T12:33:38.640Z<br>
**LSL File**: [2025-11-08_1300-1400_g9b30a_from-curriculum-alignment.md](../../../history/2025-11-08_1300-1400_g9b30a_from-curriculum-alignment.md#ps_1762605217549)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.85)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (61.5%) of file operations target local project: /exit, /mcp, /curriculum-alignment, /Users/, /Agentic/curriculum-alignment, /Agentic/coding, /Agentic/curriculum-alignment), /Agentic/coding/claude-code-mcp-processed.json
- Processing Time: 0ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.85
- Reasoning: Keyword analysis: 7 matches, score: 25/1
- Processing Time: 0ms

---

