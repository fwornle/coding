# Classification Decision Log (Foreign/Coding)

**Time Window**: 2025-10-27_0700-0800_g9b30a<br>
**Project**: curriculum-alignment<br>
**Target**: CODING<br>
**Generated**: 2025-10-27T19:10:18.555Z<br>
**Decisions in Window**: 6

---

## Statistics

- **Total Prompt Sets**: 6
- **Classified as CODING**: 6 (100%)
- **Classified as LOCAL**: 0 (0%)
- **[Layer 0 (Session Filter) Decisions](#layer-0-session-filter)**: 0
- **[Layer 1 (Path) Decisions](#layer-1-path)**: 0
- **[Layer 2 (Keyword) Decisions](#layer-2-keyword)**: 2
- **[Layer 3 (Embedding) Decisions](#layer-3-embedding)**: 4
- **[Layer 4 (Semantic) Decisions](#layer-4-semantic)**: 0
- **Average Processing Time**: 56ms

---

## Layer 2: Keyword

**Decisions**: 2

### Prompt Set: [ps_2025-10-27T06:27:28.990Z](../../../history/2025-10-27_0700-0800_g9b30a_from-curriculum-alignment.md#ps_2025-10-27T06:27:28.990Z)

**Time Range**: 2025-10-27T06:27:28.990Z → 2025-10-27T06:27:32.921Z<br>
**LSL File**: [2025-10-27_0700-0800_g9b30a_from-curriculum-alignment.md](../../../history/2025-10-27_0700-0800_g9b30a_from-curriculum-alignment.md#ps_2025-10-27T06:27:28.990Z)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.85)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: /Users/, /Agentic/coding/integrations/memory-visualizer., /docs/_standard-style.puml, /../../docs/puml/_standard-style.puml), /../../../docs/puml/_standard-style.puml), /images/viewer.png., /Views,, /auto/manual), /docs/puml, /docs/images, /docs/images/, /docs/imagesYour, /../../../docs/puml/_standard-style.puml, /knowledge-graph/, /puml/, /images/), /docs/puml/_standard-style.puml, /images/, /docs/puml/, /knowledge-graph/`, /../../../docs/puml/_standard-style.puml`, /Agentic/coding/integrations/memory-visualizer/docs/puml/architecture.puml`**, /Agentic/coding/integrations/memory-visualizer/docs/puml/data-flow.puml`**, /Agentic/coding/integrations/memory-visualizer/docs/puml/component-structure.puml`**, /Agentic/coding/integrations/memory-visualizer/docs/architecture.md`**, /Agentic/coding/integrations/memory-visualizer/docs/user-guide.md`**, /Mermaid, /Agentic/coding/integrations/memory-visualizer/docs/development.md`**, /Agentic/coding/integrations/memory-visualizer/README.md`**, /project, /auto/manual, /Views**, /Agentic/coding/docs/puml/`:, /../../docs/puml/_standard-style.puml`, /images/viewer.png, /puml/,, /docs/images**:, /Agentic/coding/docs/puml/`, /Agentic/coding/docs/images/`, /images/`
- Processing Time: 0ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.85
- Reasoning: Keyword analysis: 6 matches, score: 21/1
- Processing Time: 1ms

---

### Prompt Set: [ps_2025-10-27T06:41:42.644Z](../../../history/2025-10-27_0700-0800_g9b30a_from-curriculum-alignment.md#ps_2025-10-27T06:41:42.644Z)

**Time Range**: 2025-10-27T06:41:42.644Z → 2025-10-27T06:41:45.442Z<br>
**LSL File**: [2025-10-27_0700-0800_g9b30a_from-curriculum-alignment.md](../../../history/2025-10-27_0700-0800_g9b30a_from-curriculum-alignment.md#ps_2025-10-27T06:41:42.644Z)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.78)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: /history/*.md, /.specstory/history/*_from-, /Users/, /Agentic/coding), /.specstory/history/*_from-nano-degree.md, /.specstory/history/*_from-curriculum-alignment.md, /.specstory/history/*_from-*.md, /Agentic/nano-degree, /history, /Agentic/coding/.specstory/history/, /history/, /.specstory/history/\*_from-PROJECT.md
- Processing Time: 0ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.78
- Reasoning: Keyword analysis: 5 matches, score: 17/1
- Processing Time: 0ms

---

## Layer 3: Embedding

**Decisions**: 4

### Prompt Set: [ps_2025-10-27T06:22:14.830Z](../../../history/2025-10-27_0700-0800_g9b30a_from-curriculum-alignment.md#ps_2025-10-27T06:22:14.830Z)

**Time Range**: 2025-10-27T06:22:14.830Z → 2025-10-27T06:22:17.407Z<br>
**LSL File**: [2025-10-27_0700-0800_g9b30a_from-curriculum-alignment.md](../../../history/2025-10-27_0700-0800_g9b30a_from-curriculum-alignment.md#ps_2025-10-27T06:22:14.830Z)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.61249283)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: /docs/puml, /docs/images
- Processing Time: 0ms

❌ **Layer 2 (keyword)**
- Decision: local
- Confidence: 0.1
- Reasoning: Keyword analysis: 0 matches, score: 0/1
- Processing Time: 0ms

✅ **Layer 3 (embedding)**
- Decision: coding
- Confidence: 0.61249283
- Reasoning: Semantic similarity favors coding (coding_infrastructure=0.601, coding_lsl=0.601, curriculum_alignment=0.579, nano_degree=0.574)
- Processing Time: 68ms

---

### Prompt Set: [ps_2025-10-27T06:25:50.572Z](../../../history/2025-10-27_0700-0800_g9b30a_from-curriculum-alignment.md#ps_2025-10-27T06:25:50.572Z)

**Time Range**: 2025-10-27T06:25:50.572Z → 2025-10-27T06:25:53.326Z<br>
**LSL File**: [2025-10-27_0700-0800_g9b30a_from-curriculum-alignment.md](../../../history/2025-10-27_0700-0800_g9b30a_from-curriculum-alignment.md#ps_2025-10-27T06:25:50.572Z)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.5820833000000001)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: /docs/puml, /docs/images
- Processing Time: 0ms

❌ **Layer 2 (keyword)**
- Decision: local
- Confidence: 0.1
- Reasoning: Keyword analysis: 0 matches, score: 0/1
- Processing Time: 1ms

✅ **Layer 3 (embedding)**
- Decision: coding
- Confidence: 0.5820833000000001
- Reasoning: Semantic similarity favors coding (coding_lsl=0.579, nano_degree=0.572, curriculum_alignment=0.545, coding_infrastructure=0.501)
- Processing Time: 63ms

---

### Prompt Set: [ps_2025-10-27T06:33:34.495Z](../../../history/2025-10-27_0700-0800_g9b30a_from-curriculum-alignment.md#ps_2025-10-27T06:33:34.495Z)

**Time Range**: 2025-10-27T06:33:34.495Z → 2025-10-27T06:33:37.213Z<br>
**LSL File**: [2025-10-27_0700-0800_g9b30a_from-curriculum-alignment.md](../../../history/2025-10-27_0700-0800_g9b30a_from-curriculum-alignment.md#ps_2025-10-27T06:33:34.495Z)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.642406155)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: /docs/images
- Processing Time: 0ms

❌ **Layer 2 (keyword)**
- Decision: local
- Confidence: 0.1
- Reasoning: Keyword analysis: 0 matches, score: 0/1
- Processing Time: 0ms

✅ **Layer 3 (embedding)**
- Decision: coding
- Confidence: 0.642406155
- Reasoning: Semantic similarity favors coding (coding_lsl=0.640, nano_degree=0.635, coding_infrastructure=0.627, curriculum_alignment=0.608)
- Processing Time: 107ms

---

### Prompt Set: [ps_2025-10-27T06:44:05.244Z](../../../history/2025-10-27_0700-0800_g9b30a_from-curriculum-alignment.md#ps_2025-10-27T06:44:05.244Z)

**Time Range**: 2025-10-27T06:44:05.244Z → 2025-10-27T06:44:07.492Z<br>
**LSL File**: [2025-10-27_0700-0800_g9b30a_from-curriculum-alignment.md](../../../history/2025-10-27_0700-0800_g9b30a_from-curriculum-alignment.md#ps_2025-10-27T06:44:05.244Z)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.68357614)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: /docs/images
- Processing Time: 0ms

❌ **Layer 2 (keyword)**
- Decision: local
- Confidence: 0.1
- Reasoning: Keyword analysis: 0 matches, score: 0/1
- Processing Time: 0ms

✅ **Layer 3 (embedding)**
- Decision: coding
- Confidence: 0.68357614
- Reasoning: Semantic similarity favors coding (coding_lsl=0.668, coding_infrastructure=0.652, nano_degree=0.636, curriculum_alignment=0.627)
- Processing Time: 93ms

---

