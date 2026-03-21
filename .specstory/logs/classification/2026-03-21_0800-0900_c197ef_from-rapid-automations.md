# Classification Decision Log (Foreign/Coding)

**Time Window**: 2026-03-21_0800-0900_c197ef<br>
**Project**: rapid-automations<br>
**Target**: CODING<br>
**Generated**: 2026-03-21T08:00:00.000Z<br>
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
- **Average Processing Time**: 186ms

---

## Layer 1: Path

**Decisions**: 3

### Prompt Set: [ps_1774077340203](../../../history/2026-03-21_0800-0900_c197ef_from-rapid-automations.md#ps_1774077340203)

**Time Range**: 2026-03-21T07:15:40.203Z → 2026-03-21T07:16:36.924Z<br>
**LSL File**: [2026-03-21_0800-0900_c197ef_from-rapid-automations.md](../../../history/2026-03-21_0800-0900_c197ef_from-rapid-automations.md#ps_1774077340203)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.95)

#### Layer-by-Layer Trace

✅ **Layer 1 (path)**
- Decision: coding
- Confidence: 0.98
- Reasoning: Coding operations detected (2): /Users/Q284340/Agentic/coding/.specstory/history/, /Users/Q284340/Agentic/coding/.specstory/history/2026-03-21_0800-0900_c197ef.md
- Processing Time: 31ms

---

### Prompt Set: [ps_1774079099911](../../../history/2026-03-21_0800-0900_c197ef_from-rapid-automations.md#ps_1774079099911)

**Time Range**: 2026-03-21T07:44:59.911Z → 2026-03-21T07:47:08.014Z<br>
**LSL File**: [2026-03-21_0800-0900_c197ef_from-rapid-automations.md](../../../history/2026-03-21_0800-0900_c197ef_from-rapid-automations.md#ps_1774079099911)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.95)

#### Layer-by-Layer Trace

✅ **Layer 1 (path)**
- Decision: coding
- Confidence: 0.98
- Reasoning: Coding operations detected (2): tests/e2e, tests/e2e/dashboard
- Processing Time: 124ms

---

### Prompt Set: [ps_1774079099911](../../../history/2026-03-21_0800-0900_c197ef_from-rapid-automations.md#ps_1774079099911)

**Time Range**: 2026-03-21T07:44:59.911Z → 2026-03-21T11:11:46.926Z<br>
**LSL File**: [2026-03-21_0800-0900_c197ef_from-rapid-automations.md](../../../history/2026-03-21_0800-0900_c197ef_from-rapid-automations.md#ps_1774079099911)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.95)

#### Layer-by-Layer Trace

✅ **Layer 1 (path)**
- Decision: coding
- Confidence: 0.98
- Reasoning: Coding operations detected (4): /Users/Q284340/Agentic/coding, /Users/Q284340/Agentic/coding/node_modules, tests/e2e (+1 more)
- Processing Time: 535ms

---

## Layer 2: Keyword

**Decisions**: 1

### Prompt Set: [ps_1774076632863](../../../history/2026-03-21_0800-0900_c197ef_from-rapid-automations.md#ps_1774076632863)

**Time Range**: 2026-03-21T07:03:52.863Z → 2026-03-21T07:16:36.509Z<br>
**LSL File**: [2026-03-21_0800-0900_c197ef_from-rapid-automations.md](../../../history/2026-03-21_0800-0900_c197ef_from-rapid-automations.md#ps_1774076632863)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.57)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority of write operations target local project: /Users/Q284340/Agentic/_work/rapid-automations/docs/integrations/okb/index.md, /Users/Q284340/Agentic/_work/rapid-automations/docs/integrations/okb/cli.md, /Users/Q284340/Agentic/_work/rapid-automations/docs/integrations/okb/viewer.md, /Users/Q284340/Agentic/_work/rapid-automations/docs/integrations/okb/architecture.md, /Users/Q284340/Agentic/_work/rapid-automations/docs/integrations/okb/deployment.md, /Users/Q284340/Agentic/_work/rapid-automations/docs/integrations/okb/api-reference.md, /Users/Q284340/Agentic/_work/rapid-automations/docs/integrations/okb/ingestion.md, /Users/Q284340/Agentic/_work/rapid-automations/docs/integrations/okb/intelligence.md, /Users/Q284340/Agentic/_work/rapid-automations/docs/integrations/okb/ontology.md, /Users/Q284340/Agentic/_work/rapid-automations/docs/integrations/okb/skill-integration.md
- Processing Time: 51ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.57
- Reasoning: Keyword analysis: 2 matches, score: 5/1
- Processing Time: 2ms

---

