# Classification Decision Log (Foreign/Coding)

**Time Window**: 2025-10-21_0600-0700_g9b30a<br>
**Project**: curriculum-alignment<br>
**Target**: CODING<br>
**Generated**: 2025-10-21T04:28:30.455Z<br>
**Decisions in Window**: 2

---

## Statistics

- **Total Prompt Sets**: 2
- **Classified as CODING**: 2 (100%)
- **Classified as LOCAL**: 0 (0%)
- **[Layer 0 (Session Filter) Decisions](#layer-0-session-filter)**: 0
- **[Layer 1 (Path) Decisions](#layer-1-path)**: 0
- **[Layer 2 (Keyword) Decisions](#layer-2-keyword)**: 0
- **[Layer 3 (Embedding) Decisions](#layer-3-embedding)**: 2
- **[Layer 4 (Semantic) Decisions](#layer-4-semantic)**: 0
- **Average Processing Time**: 46ms

---

## Layer 3: Embedding

**Decisions**: 2

### Prompt Set: [ps_2025-10-21T04:27:59.420Z](../../../history/2025-10-21_0600-0700_g9b30a_from-curriculum-alignment.md#ps_2025-10-21T04:27:59.420Z)

**Time Range**: 2025-10-21T04:27:59.420Z → 2025-10-21T04:28:06.933Z<br>
**LSL File**: [2025-10-21_0600-0700_g9b30a_from-curriculum-alignment.md](../../../history/2025-10-21_0600-0700_g9b30a_from-curriculum-alignment.md#ps_2025-10-21T04:27:59.420Z)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.576804385)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: /plugin, /command-name, /command-message, /command-args
- Processing Time: 1ms

❌ **Layer 2 (keyword)**
- Decision: local
- Confidence: 0.1
- Reasoning: Keyword analysis: 0 matches, score: 0/1
- Processing Time: 0ms

✅ **Layer 3 (embedding)**
- Decision: coding
- Confidence: 0.576804385
- Reasoning: Semantic similarity favors coding (coding_infrastructure=0.546, coding_lsl=0.486, curriculum_alignment=0.484, nano_degree=0.482)
- Processing Time: 62ms

---

### Prompt Set: [ps_2025-10-21T04:27:59.420Z](../../../history/2025-10-21_0600-0700_g9b30a_from-curriculum-alignment.md#ps_2025-10-21T04:27:59.420Z)

**Time Range**: 2025-10-21T04:27:59.420Z → 2025-10-21T04:28:06.966Z<br>
**LSL File**: [2025-10-21_0600-0700_g9b30a_from-curriculum-alignment.md](../../../history/2025-10-21_0600-0700_g9b30a_from-curriculum-alignment.md#ps_2025-10-21T04:27:59.420Z)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.56805368)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: /local-command-stdout
- Processing Time: 0ms

❌ **Layer 2 (keyword)**
- Decision: local
- Confidence: 0.1
- Reasoning: Keyword analysis: 0 matches, score: 0/1
- Processing Time: 0ms

✅ **Layer 3 (embedding)**
- Decision: coding
- Confidence: 0.56805368
- Reasoning: Semantic similarity favors coding (coding_lsl=0.555, nano_degree=0.529, curriculum_alignment=0.508, coding_infrastructure=0.503)
- Processing Time: 28ms

---

