# Classification Decision Log (Foreign/Coding)

**Time Window**: 2026-03-21_1500-1600_c197ef<br>
**Project**: rapid-automations<br>
**Target**: CODING<br>
**Generated**: 2026-03-21T15:00:00.000Z<br>
**Decisions in Window**: 8

---

## Statistics

- **Total Prompt Sets**: 8
- **Classified as CODING**: 8 (100%)
- **Classified as LOCAL**: 0 (0%)
- **[Layer 0 (Session Filter) Decisions](#layer-0-session-filter)**: 0
- **[Layer 1 (Path) Decisions](#layer-1-path)**: 2
- **[Layer 2 (Keyword) Decisions](#layer-2-keyword)**: 6
- **[Layer 3 (Embedding) Decisions](#layer-3-embedding)**: 0
- **[Layer 4 (Semantic) Decisions](#layer-4-semantic)**: 0
- **Average Processing Time**: 48ms

---

## Layer 1: Path

**Decisions**: 2

### Prompt Set: [ps_1774102704174](../../../history/2026-03-21_1500-1600_c197ef_from-rapid-automations.md#ps_1774102704174)

**Time Range**: 2026-03-21T14:18:24.174Z → 2026-03-21T14:19:14.467Z<br>
**LSL File**: [2026-03-21_1500-1600_c197ef_from-rapid-automations.md](../../../history/2026-03-21_1500-1600_c197ef_from-rapid-automations.md#ps_1774102704174)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.95)

#### Layer-by-Layer Trace

✅ **Layer 1 (path)**
- Decision: coding
- Confidence: 0.98
- Reasoning: Coding operations detected (5): docs/puml/_standard-style.puml, docs/presentation/puml/_standard-style.puml, docs/puml (+2 more)
- Processing Time: 115ms

---

### Prompt Set: [ps_1774102704174](../../../history/2026-03-21_1500-1600_c197ef_from-rapid-automations.md#ps_1774102704174)

**Time Range**: 2026-03-21T14:18:24.174Z → 2026-03-21T14:49:57.683Z<br>
**LSL File**: [2026-03-21_1500-1600_c197ef_from-rapid-automations.md](../../../history/2026-03-21_1500-1600_c197ef_from-rapid-automations.md#ps_1774102704174)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.95)

#### Layer-by-Layer Trace

✅ **Layer 1 (path)**
- Decision: coding
- Confidence: 0.98
- Reasoning: Coding operations detected (5): docs/puml/_standard-style.puml, docs/presentation/puml/_standard-style.puml, docs/puml (+2 more)
- Processing Time: 205ms

---

## Layer 2: Keyword

**Decisions**: 6

### Prompt Set: [ps_1774102486316](../../../history/2026-03-21_1500-1600_c197ef_from-rapid-automations.md#ps_1774102486316)

**Time Range**: 2026-03-21T14:14:46.316Z → 2026-03-21T14:18:05.986Z<br>
**LSL File**: [2026-03-21_1500-1600_c197ef_from-rapid-automations.md](../../../history/2026-03-21_1500-1600_c197ef_from-rapid-automations.md#ps_1774102486316)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.5525)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority of write operations target local project: /Users/Q284340/Agentic/_work/rapid-automations/docs/integrations/toolkit/index.md, /Users/Q284340/Agentic/_work/rapid-automations/docs/integrations/sandbox/index.md
- Processing Time: 0ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.5525
- Reasoning: Keyword analysis: 1 matches, score: 4/1
- Processing Time: 0ms

---

### Prompt Set: [ps_1774102486316](../../../history/2026-03-21_1500-1600_c197ef_from-rapid-automations.md#ps_1774102486316)

**Time Range**: 2026-03-21T14:14:46.316Z → 2026-03-21T14:18:20.836Z<br>
**LSL File**: [2026-03-21_1500-1600_c197ef_from-rapid-automations.md](../../../history/2026-03-21_1500-1600_c197ef_from-rapid-automations.md#ps_1774102486316)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.5525)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority of write operations target local project: /Users/Q284340/Agentic/_work/rapid-automations/docs/integrations/toolkit/index.md, /Users/Q284340/Agentic/_work/rapid-automations/docs/integrations/sandbox/index.md
- Processing Time: 0ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.5525
- Reasoning: Keyword analysis: 1 matches, score: 4/1
- Processing Time: 0ms

---

### Prompt Set: [ps_1774104499848](../../../history/2026-03-21_1500-1600_c197ef_from-rapid-automations.md#ps_1774104499848)

**Time Range**: 2026-03-21T14:48:19.848Z → 2026-03-21T14:48:37.182Z<br>
**LSL File**: [2026-03-21_1500-1600_c197ef_from-rapid-automations.md](../../../history/2026-03-21_1500-1600_c197ef_from-rapid-automations.md#ps_1774104499848)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.5175)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: .data, /dev/null, dev/null, integrations/operational-knowledge-management, /operational-knowledge-management, data/, persistence/export, data/okb/levelDB, graphology/leveldb
- Processing Time: 1ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.5175
- Reasoning: Keyword analysis: 1 matches, score: 2/1
- Processing Time: 0ms

---

### Prompt Set: [ps_1774103057602](../../../history/2026-03-21_1500-1600_c197ef_from-rapid-automations.md#ps_1774103057602)

**Time Range**: 2026-03-21T14:24:17.602Z → 2026-03-21T14:49:58.510Z<br>
**LSL File**: [2026-03-21_1500-1600_c197ef_from-rapid-automations.md](../../../history/2026-03-21_1500-1600_c197ef_from-rapid-automations.md#ps_1774103057602)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.535)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority of write operations target local project: /Users/Q284340/Agentic/_work/rapid-automations/hooks/sitemap_locales.py, /Users/Q284340/Agentic/_work/rapid-automations/mkdocs.yml
- Processing Time: 60ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.535
- Reasoning: Keyword analysis: 1 matches, score: 3/1
- Processing Time: 0ms

---

### Prompt Set: [ps_1774104499848](../../../history/2026-03-21_1500-1600_c197ef_from-rapid-automations.md#ps_1774104499848)

**Time Range**: 2026-03-21T14:48:19.848Z → 2026-03-21T14:49:58.569Z<br>
**LSL File**: [2026-03-21_1500-1600_c197ef_from-rapid-automations.md](../../../history/2026-03-21_1500-1600_c197ef_from-rapid-automations.md#ps_1774104499848)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.5175)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: .data, /dev/null, dev/null, integrations/operational-knowledge-management, /operational-knowledge-management, data/, persistence/export, data/okb/levelDB, graphology/leveldb
- Processing Time: 0ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.5175
- Reasoning: Keyword analysis: 1 matches, score: 2/1
- Processing Time: 0ms

---

### Prompt Set: [ps_1774104596100](../../../history/2026-03-21_1500-1600_c197ef_from-rapid-automations.md#ps_1774104596100)

**Time Range**: 2026-03-21T14:49:56.100Z → 2026-03-21T14:50:12.920Z<br>
**LSL File**: [2026-03-21_1500-1600_c197ef_from-rapid-automations.md](../../../history/2026-03-21_1500-1600_c197ef_from-rapid-automations.md#ps_1774104596100)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.535)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: /okb/, /dev/null, /okb/exports/, /okb/leveldb/, data/okb/, dev/null, data/okb/exports/, data/okb/leveldb/, /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/docker/docker-compose.yml, /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/docker/Dockerfile, data/okb/exports
- Processing Time: 0ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.535
- Reasoning: Keyword analysis: 1 matches, score: 3/1
- Processing Time: 0ms

---

