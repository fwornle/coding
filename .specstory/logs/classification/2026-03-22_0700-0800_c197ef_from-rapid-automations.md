# Classification Decision Log (Foreign/Coding)

**Time Window**: 2026-03-22_0700-0800_c197ef<br>
**Project**: rapid-automations<br>
**Target**: CODING<br>
**Generated**: 2026-03-22T07:00:00.000Z<br>
**Decisions in Window**: 11

---

## Statistics

- **Total Prompt Sets**: 11
- **Classified as CODING**: 11 (100%)
- **Classified as LOCAL**: 0 (0%)
- **[Layer 0 (Session Filter) Decisions](#layer-0-session-filter)**: 0
- **[Layer 1 (Path) Decisions](#layer-1-path)**: 2
- **[Layer 2 (Keyword) Decisions](#layer-2-keyword)**: 9
- **[Layer 3 (Embedding) Decisions](#layer-3-embedding)**: 0
- **[Layer 4 (Semantic) Decisions](#layer-4-semantic)**: 0
- **Average Processing Time**: 1ms

---

## Layer 1: Path

**Decisions**: 2

### Prompt Set: [ps_1774161080683](../../../history/2026-03-22_0700-0800_c197ef_from-rapid-automations.md#ps_1774161080683)

**Time Range**: 2026-03-22T06:31:20.683Z → 2026-03-22T07:00:03.783Z<br>
**LSL File**: [2026-03-22_0700-0800_c197ef_from-rapid-automations.md](../../../history/2026-03-22_0700-0800_c197ef_from-rapid-automations.md#ps_1774161080683)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.95)

#### Layer-by-Layer Trace

✅ **Layer 1 (path)**
- Decision: coding
- Confidence: 0.98
- Reasoning: Coding operations detected (2): node_modules/.bin/tsc, package.json
- Processing Time: 0ms

---

### Prompt Set: [ps_1774161080683](../../../history/2026-03-22_0700-0800_c197ef_from-rapid-automations.md#ps_1774161080683)

**Time Range**: 2026-03-22T06:31:20.683Z → 2026-03-22T07:22:50.117Z<br>
**LSL File**: [2026-03-22_0700-0800_c197ef_from-rapid-automations.md](../../../history/2026-03-22_0700-0800_c197ef_from-rapid-automations.md#ps_1774161080683)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.95)

#### Layer-by-Layer Trace

✅ **Layer 1 (path)**
- Decision: coding
- Confidence: 0.98
- Reasoning: Coding operations detected (2): node_modules/.bin/tsc, package.json
- Processing Time: 1ms

---

## Layer 2: Keyword

**Decisions**: 9

### Prompt Set: [ps_1774159207581](../../../history/2026-03-22_0700-0800_c197ef_from-rapid-automations.md#ps_1774159207581)

**Time Range**: 2026-03-22T06:00:07.581Z → 2026-03-22T06:00:34.762Z<br>
**LSL File**: [2026-03-22_0700-0800_c197ef_from-rapid-automations.md](../../../history/2026-03-22_0700-0800_c197ef_from-rapid-automations.md#ps_1774159207581)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.535)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: /dev/null, dev/null, integrations/operational-knowledge-management/.data/exports/, /operational-knowledge-management/.data/exports/, integrations/operational-knowledge-management/docker/docker-compose.yml, /operational-knowledge-management/docker/docker-compose.yml, integrations/operational-knowledge-management/docker, /operational-knowledge-management/docker, /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/.data/exports/raas.json, /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/.data/exports/kpifw.json, /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/.data/exports/general.json
- Processing Time: 0ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.535
- Reasoning: Keyword analysis: 1 matches, score: 3/1
- Processing Time: 0ms

---

### Prompt Set: [ps_1774159207581](../../../history/2026-03-22_0700-0800_c197ef_from-rapid-automations.md#ps_1774159207581)

**Time Range**: 2026-03-22T06:00:07.581Z → 2026-03-22T06:04:29.229Z<br>
**LSL File**: [2026-03-22_0700-0800_c197ef_from-rapid-automations.md](../../../history/2026-03-22_0700-0800_c197ef_from-rapid-automations.md#ps_1774159207581)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.535)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: /dev/null, dev/null, integrations/operational-knowledge-management/.data/exports/, /operational-knowledge-management/.data/exports/, integrations/operational-knowledge-management/docker/docker-compose.yml, /operational-knowledge-management/docker/docker-compose.yml, integrations/operational-knowledge-management/docker, /operational-knowledge-management/docker, /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/.data/exports/raas.json, /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/.data/exports/kpifw.json, /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/.data/exports/general.json
- Processing Time: 1ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.535
- Reasoning: Keyword analysis: 1 matches, score: 3/1
- Processing Time: 0ms

---

### Prompt Set: [ps_1774162727403](../../../history/2026-03-22_0700-0800_c197ef_from-rapid-automations.md#ps_1774162727403)

**Time Range**: 2026-03-22T06:58:47.403Z → 2026-03-22T07:00:00.862Z<br>
**LSL File**: [2026-03-22_0700-0800_c197ef_from-rapid-automations.md](../../../history/2026-03-22_0700-0800_c197ef_from-rapid-automations.md#ps_1774162727403)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.535)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: //localhost:8090/api/stats, /dev/null, 8090/api/stats, dev/null, /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/api/routes.ts, //localhost:8090/api/entities, //localhost:8090/api/entities/{nid}',, /{len(entities)}, 8090/api/entities, 8090/api/entities/{nid}',, purge/reset
- Processing Time: 1ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.535
- Reasoning: Keyword analysis: 1 matches, score: 3/1
- Processing Time: 1ms

---

### Prompt Set: [ps_1774159207581](../../../history/2026-03-22_0700-0800_c197ef_from-rapid-automations.md#ps_1774159207581)

**Time Range**: 2026-03-22T06:00:07.581Z → 2026-03-22T07:00:02.630Z<br>
**LSL File**: [2026-03-22_0700-0800_c197ef_from-rapid-automations.md](../../../history/2026-03-22_0700-0800_c197ef_from-rapid-automations.md#ps_1774159207581)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.535)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: /dev/null, dev/null, integrations/operational-knowledge-management/.data/exports/, /operational-knowledge-management/.data/exports/, integrations/operational-knowledge-management/docker/docker-compose.yml, /operational-knowledge-management/docker/docker-compose.yml, integrations/operational-knowledge-management/docker, /operational-knowledge-management/docker, /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/.data/exports/raas.json, /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/.data/exports/kpifw.json, /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/.data/exports/general.json
- Processing Time: 0ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.535
- Reasoning: Keyword analysis: 1 matches, score: 3/1
- Processing Time: 1ms

---

### Prompt Set: [ps_1774159468098](../../../history/2026-03-22_0700-0800_c197ef_from-rapid-automations.md#ps_1774159468098)

**Time Range**: 2026-03-22T06:04:28.098Z → 2026-03-22T07:00:03.424Z<br>
**LSL File**: [2026-03-22_0700-0800_c197ef_from-rapid-automations.md](../../../history/2026-03-22_0700-0800_c197ef_from-rapid-automations.md#ps_1774159468098)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.535)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: integrations/operational-knowledge-management/.data/exports/raas.json, connected, /operational-knowledge-management/.data/exports/raas.json, integrations/operational-knowledge-management/.data/exports/kpifw.json, /operational-knowledge-management/.data/exports/kpifw.json, /Users/Q284340/Agentic/_work/rapid-automations, /.data/exports/*.json', /okb*/.data/*.json', /dev/null, Users/Q284340/Agentic/_work/rapid-automations, data/exports/*.json', data/*.json', dev/null, /operational-knowledge-management/.data/exports/{domain}.json'), integrations/operational-knowledge-management/.data/exports/{domain}.json')
- Processing Time: 0ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.535
- Reasoning: Keyword analysis: 1 matches, score: 3/1
- Processing Time: 0ms

---

### Prompt Set: [ps_1774162727403](../../../history/2026-03-22_0700-0800_c197ef_from-rapid-automations.md#ps_1774162727403)

**Time Range**: 2026-03-22T06:58:47.403Z → 2026-03-22T07:00:04.865Z<br>
**LSL File**: [2026-03-22_0700-0800_c197ef_from-rapid-automations.md](../../../history/2026-03-22_0700-0800_c197ef_from-rapid-automations.md#ps_1774162727403)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.535)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: //localhost:8090/api/stats, /dev/null, 8090/api/stats, dev/null, /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/api/routes.ts, //localhost:8090/api/entities, //localhost:8090/api/entities/{nid}',, /{len(entities)}, 8090/api/entities, 8090/api/entities/{nid}',, purge/reset
- Processing Time: 0ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.535
- Reasoning: Keyword analysis: 1 matches, score: 3/1
- Processing Time: 0ms

---

### Prompt Set: [ps_1774159207581](../../../history/2026-03-22_0700-0800_c197ef_from-rapid-automations.md#ps_1774159207581)

**Time Range**: 2026-03-22T06:00:07.581Z → 2026-03-22T07:22:49.866Z<br>
**LSL File**: [2026-03-22_0700-0800_c197ef_from-rapid-automations.md](../../../history/2026-03-22_0700-0800_c197ef_from-rapid-automations.md#ps_1774159207581)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.535)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: /dev/null, dev/null, integrations/operational-knowledge-management/.data/exports/, /operational-knowledge-management/.data/exports/, integrations/operational-knowledge-management/docker/docker-compose.yml, /operational-knowledge-management/docker/docker-compose.yml, integrations/operational-knowledge-management/docker, /operational-knowledge-management/docker, /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/.data/exports/raas.json, /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/.data/exports/kpifw.json, /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/.data/exports/general.json
- Processing Time: 0ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.535
- Reasoning: Keyword analysis: 1 matches, score: 3/1
- Processing Time: 0ms

---

### Prompt Set: [ps_1774159468098](../../../history/2026-03-22_0700-0800_c197ef_from-rapid-automations.md#ps_1774159468098)

**Time Range**: 2026-03-22T06:04:28.098Z → 2026-03-22T07:22:50.063Z<br>
**LSL File**: [2026-03-22_0700-0800_c197ef_from-rapid-automations.md](../../../history/2026-03-22_0700-0800_c197ef_from-rapid-automations.md#ps_1774159468098)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.535)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: integrations/operational-knowledge-management/.data/exports/raas.json, connected, /operational-knowledge-management/.data/exports/raas.json, integrations/operational-knowledge-management/.data/exports/kpifw.json, /operational-knowledge-management/.data/exports/kpifw.json, /Users/Q284340/Agentic/_work/rapid-automations, /.data/exports/*.json', /okb*/.data/*.json', /dev/null, Users/Q284340/Agentic/_work/rapid-automations, data/exports/*.json', data/*.json', dev/null, /operational-knowledge-management/.data/exports/{domain}.json'), integrations/operational-knowledge-management/.data/exports/{domain}.json')
- Processing Time: 1ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.535
- Reasoning: Keyword analysis: 1 matches, score: 3/1
- Processing Time: 0ms

---

### Prompt Set: [ps_1774162727403](../../../history/2026-03-22_0700-0800_c197ef_from-rapid-automations.md#ps_1774162727403)

**Time Range**: 2026-03-22T06:58:47.403Z → 2026-03-22T07:22:51.175Z<br>
**LSL File**: [2026-03-22_0700-0800_c197ef_from-rapid-automations.md](../../../history/2026-03-22_0700-0800_c197ef_from-rapid-automations.md#ps_1774162727403)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.535)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: //localhost:8090/api/stats, /dev/null, 8090/api/stats, dev/null, /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/api/routes.ts, //localhost:8090/api/entities, //localhost:8090/api/entities/{nid}',, /{len(entities)}, 8090/api/entities, 8090/api/entities/{nid}',, /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/docker/llm-proxy.cjs, /tmp/llm-proxy.log, //localhost:8089/health, Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/docker/llm-proxy.cjs, tmp/llm-proxy.log, 8089/health, purge/reset
- Processing Time: 0ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.535
- Reasoning: Keyword analysis: 1 matches, score: 3/1
- Processing Time: 0ms

---

