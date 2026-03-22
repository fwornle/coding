# Classification Decision Log (Foreign/Coding)

**Time Window**: 2026-03-21_1600-1700_c197ef<br>
**Project**: rapid-automations<br>
**Target**: CODING<br>
**Generated**: 2026-03-21T16:00:00.000Z<br>
**Decisions in Window**: 13

---

## Statistics

- **Total Prompt Sets**: 13
- **Classified as CODING**: 13 (100%)
- **Classified as LOCAL**: 0 (0%)
- **[Layer 0 (Session Filter) Decisions](#layer-0-session-filter)**: 0
- **[Layer 1 (Path) Decisions](#layer-1-path)**: 4
- **[Layer 2 (Keyword) Decisions](#layer-2-keyword)**: 9
- **[Layer 3 (Embedding) Decisions](#layer-3-embedding)**: 0
- **[Layer 4 (Semantic) Decisions](#layer-4-semantic)**: 0
- **Average Processing Time**: 20ms

---

## Layer 1: Path

**Decisions**: 4

### Prompt Set: [ps_1774105992348](../../../history/2026-03-21_1600-1700_c197ef_from-rapid-automations.md#ps_1774105992348)

**Time Range**: 2026-03-21T15:13:12.348Z → 2026-03-21T15:32:12.599Z<br>
**LSL File**: [2026-03-21_1600-1700_c197ef_from-rapid-automations.md](../../../history/2026-03-21_1600-1700_c197ef_from-rapid-automations.md#ps_1774105992348)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.95)

#### Layer-by-Layer Trace

✅ **Layer 1 (path)**
- Decision: coding
- Confidence: 0.98
- Reasoning: Coding operations detected (1): .data/
- Processing Time: 27ms

---

### Prompt Set: [ps_1774106829952](../../../history/2026-03-21_1600-1700_c197ef_from-rapid-automations.md#ps_1774106829952)

**Time Range**: 2026-03-21T15:27:09.952Z → 2026-03-21T15:32:13.589Z<br>
**LSL File**: [2026-03-21_1600-1700_c197ef_from-rapid-automations.md](../../../history/2026-03-21_1600-1700_c197ef_from-rapid-automations.md#ps_1774106829952)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.95)

#### Layer-by-Layer Trace

✅ **Layer 1 (path)**
- Decision: coding
- Confidence: 0.98
- Reasoning: Coding operations detected (1): .data
- Processing Time: 35ms

---

### Prompt Set: [ps_1774105992348](../../../history/2026-03-21_1600-1700_c197ef_from-rapid-automations.md#ps_1774105992348)

**Time Range**: 2026-03-21T15:13:12.348Z → 2026-03-21T15:35:54.602Z<br>
**LSL File**: [2026-03-21_1600-1700_c197ef_from-rapid-automations.md](../../../history/2026-03-21_1600-1700_c197ef_from-rapid-automations.md#ps_1774105992348)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.95)

#### Layer-by-Layer Trace

✅ **Layer 1 (path)**
- Decision: coding
- Confidence: 0.98
- Reasoning: Coding operations detected (1): .data/
- Processing Time: 23ms

---

### Prompt Set: [ps_1774106829952](../../../history/2026-03-21_1600-1700_c197ef_from-rapid-automations.md#ps_1774106829952)

**Time Range**: 2026-03-21T15:27:09.952Z → 2026-03-21T15:35:54.651Z<br>
**LSL File**: [2026-03-21_1600-1700_c197ef_from-rapid-automations.md](../../../history/2026-03-21_1600-1700_c197ef_from-rapid-automations.md#ps_1774106829952)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.95)

#### Layer-by-Layer Trace

✅ **Layer 1 (path)**
- Decision: coding
- Confidence: 0.98
- Reasoning: Coding operations detected (1): .data
- Processing Time: 21ms

---

## Layer 2: Keyword

**Decisions**: 9

### Prompt Set: [ps_1774105992348](../../../history/2026-03-21_1600-1700_c197ef_from-rapid-automations.md#ps_1774105992348)

**Time Range**: 2026-03-21T15:13:12.348Z → 2026-03-21T15:13:17.959Z<br>
**LSL File**: [2026-03-21_1600-1700_c197ef_from-rapid-automations.md](../../../history/2026-03-21_1600-1700_c197ef_from-rapid-automations.md#ps_1774105992348)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.535)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: /okb, data/okb, data/okb/leveldb, integrations/operational-knowledge-management/.data/okb/exports, integration/operational-knowledge-management, integrations/operational-knowledge-management/.data/leveldb
- Processing Time: 0ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.535
- Reasoning: Keyword analysis: 1 matches, score: 3/1
- Processing Time: 0ms

---

### Prompt Set: [ps_1774105992348](../../../history/2026-03-21_1600-1700_c197ef_from-rapid-automations.md#ps_1774105992348)

**Time Range**: 2026-03-21T15:13:12.348Z → 2026-03-21T15:25:04.366Z<br>
**LSL File**: [2026-03-21_1600-1700_c197ef_from-rapid-automations.md](../../../history/2026-03-21_1600-1700_c197ef_from-rapid-automations.md#ps_1774105992348)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.535)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority of write operations target local project: /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/index.ts, /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/docker/docker-compose.yml, /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/.gitignore, /Users/Q284340/Agentic/_work/rapid-automations/docs/integrations/okb/deployment.md, /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/bin/okb.ts, /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/docker/entrypoint.sh, /Users/Q284340/Agentic/_work/rapid-automations/docs/integrations/okb/deployment.de.md
- Processing Time: 57ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.535
- Reasoning: Keyword analysis: 1 matches, score: 3/1
- Processing Time: 0ms

---

### Prompt Set: [ps_1774105992348](../../../history/2026-03-21_1600-1700_c197ef_from-rapid-automations.md#ps_1774105992348)

**Time Range**: 2026-03-21T15:13:12.348Z → 2026-03-21T15:27:13.041Z<br>
**LSL File**: [2026-03-21_1600-1700_c197ef_from-rapid-automations.md](../../../history/2026-03-21_1600-1700_c197ef_from-rapid-automations.md#ps_1774105992348)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.535)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority of write operations target local project: /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/index.ts, /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/docker/docker-compose.yml, /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/.gitignore, /Users/Q284340/Agentic/_work/rapid-automations/docs/integrations/okb/deployment.md, /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/bin/okb.ts, /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/docker/entrypoint.sh, /Users/Q284340/Agentic/_work/rapid-automations/docs/integrations/okb/deployment.de.md
- Processing Time: 27ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.535
- Reasoning: Keyword analysis: 1 matches, score: 3/1
- Processing Time: 0ms

---

### Prompt Set: [ps_1774106829952](../../../history/2026-03-21_1600-1700_c197ef_from-rapid-automations.md#ps_1774106829952)

**Time Range**: 2026-03-21T15:27:09.952Z → 2026-03-21T15:32:08.690Z<br>
**LSL File**: [2026-03-21_1600-1700_c197ef_from-rapid-automations.md](../../../history/2026-03-21_1600-1700_c197ef_from-rapid-automations.md#ps_1774106829952)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.535)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: .data, integrations/operational-knowledge-management/.data, /dev/null, /operational-knowledge-management/.data, dev/null, /okb, /operational-knowledge-management/.data/exports, /operational-knowledge-management/.data/leveldb, /operational-knowledge-management/.data/exports/$f.json, data/okb, integrations/operational-knowledge-management/.data/exports, integrations/operational-knowledge-management/.data/leveldb, integrations/operational-knowledge-management/.data/exports/$f.json, data/okb/leveldb, integrations/operational-knowledge-management
- Processing Time: 64ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.535
- Reasoning: Keyword analysis: 1 matches, score: 3/1
- Processing Time: 0ms

---

### Prompt Set: [ps_1774107126138](../../../history/2026-03-21_1600-1700_c197ef_from-rapid-automations.md#ps_1774107126138)

**Time Range**: 2026-03-21T15:32:06.138Z → 2026-03-21T15:32:12.242Z<br>
**LSL File**: [2026-03-21_1600-1700_c197ef_from-rapid-automations.md](../../../history/2026-03-21_1600-1700_c197ef_from-rapid-automations.md#ps_1774107126138)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.535)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: integrations/operational-knowledge-management/.data
- Processing Time: 0ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.535
- Reasoning: Keyword analysis: 1 matches, score: 3/1
- Processing Time: 0ms

---

### Prompt Set: [ps_1774107126138](../../../history/2026-03-21_1600-1700_c197ef_from-rapid-automations.md#ps_1774107126138)

**Time Range**: 2026-03-21T15:32:06.138Z → 2026-03-21T15:35:48.694Z<br>
**LSL File**: [2026-03-21_1600-1700_c197ef_from-rapid-automations.md](../../../history/2026-03-21_1600-1700_c197ef_from-rapid-automations.md#ps_1774107126138)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.535)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority of write operations target local project: /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/docker/docker-compose.yml, /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/docker/Dockerfile
- Processing Time: 1ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.535
- Reasoning: Keyword analysis: 1 matches, score: 3/1
- Processing Time: 0ms

---

### Prompt Set: [ps_1774107126138](../../../history/2026-03-21_1600-1700_c197ef_from-rapid-automations.md#ps_1774107126138)

**Time Range**: 2026-03-21T15:32:06.138Z → 2026-03-21T15:35:54.656Z<br>
**LSL File**: [2026-03-21_1600-1700_c197ef_from-rapid-automations.md](../../../history/2026-03-21_1600-1700_c197ef_from-rapid-automations.md#ps_1774107126138)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.535)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority of write operations target local project: /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/docker/docker-compose.yml, /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/docker/Dockerfile
- Processing Time: 0ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.535
- Reasoning: Keyword analysis: 1 matches, score: 3/1
- Processing Time: 0ms

---

### Prompt Set: [ps_1774107346676](../../../history/2026-03-21_1600-1700_c197ef_from-rapid-automations.md#ps_1774107346676)

**Time Range**: 2026-03-21T15:35:46.676Z → 2026-03-21T15:35:56.668Z<br>
**LSL File**: [2026-03-21_1600-1700_c197ef_from-rapid-automations.md](../../../history/2026-03-21_1600-1700_c197ef_from-rapid-automations.md#ps_1774107346676)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.535)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: integrations/operational-knowledge-management/viewer/dist/, /app/viewer/dist/, /operational-knowledge-management/viewer/dist/, /dev/null, dev/null, app/viewer/dist/, viewer/dist
- Processing Time: 0ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.535
- Reasoning: Keyword analysis: 1 matches, score: 3/1
- Processing Time: 0ms

---

### Prompt Set: [ps_1774107346676](../../../history/2026-03-21_1600-1700_c197ef_from-rapid-automations.md#ps_1774107346676)

**Time Range**: 2026-03-21T15:35:46.676Z → 2026-03-21T15:36:06.777Z<br>
**LSL File**: [2026-03-21_1600-1700_c197ef_from-rapid-automations.md](../../../history/2026-03-21_1600-1700_c197ef_from-rapid-automations.md#ps_1774107346676)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.535)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: integrations/operational-knowledge-management/viewer/dist/, /app/viewer/dist/, /operational-knowledge-management/viewer/dist/, /dev/null, dev/null, app/viewer/dist/, integrations/operational-knowledge-management/viewer, /operational-knowledge-management/viewer, /viewer/dist:/app/viewer/dist:ro`, viewer/dist
- Processing Time: 0ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.535
- Reasoning: Keyword analysis: 1 matches, score: 3/1
- Processing Time: 0ms

---

