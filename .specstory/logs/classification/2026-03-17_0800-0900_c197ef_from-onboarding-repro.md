# Classification Decision Log (Foreign/Coding)

**Time Window**: 2026-03-17_0800-0900_c197ef<br>
**Project**: onboarding-repro<br>
**Target**: CODING<br>
**Generated**: 2026-03-17T08:00:00.000Z<br>
**Decisions in Window**: 5

---

## Statistics

- **Total Prompt Sets**: 5
- **Classified as CODING**: 5 (100%)
- **Classified as LOCAL**: 0 (0%)
- **[Layer 0 (Session Filter) Decisions](#layer-0-session-filter)**: 0
- **[Layer 1 (Path) Decisions](#layer-1-path)**: 0
- **[Layer 2 (Keyword) Decisions](#layer-2-keyword)**: 5
- **[Layer 3 (Embedding) Decisions](#layer-3-embedding)**: 0
- **[Layer 4 (Semantic) Decisions](#layer-4-semantic)**: 0
- **Average Processing Time**: 17ms

---

## Layer 2: Keyword

**Decisions**: 5

### Prompt Set: [ps_1773731708039](../../../history/2026-03-17_0800-0900_c197ef_from-onboarding-repro.md#ps_1773731708039)

**Time Range**: 2026-03-17T07:15:08.039Z → 2026-03-17T07:15:18.328Z<br>
**LSL File**: [2026-03-17_0800-0900_c197ef_from-onboarding-repro.md](../../../history/2026-03-17_0800-0900_c197ef_from-onboarding-repro.md#ps_1773731708039)<br>
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

### Prompt Set: [ps_1773732211220](../../../history/2026-03-17_0800-0900_c197ef_from-onboarding-repro.md#ps_1773732211220)

**Time Range**: 2026-03-17T07:23:31.220Z → 2026-03-17T07:23:42.589Z<br>
**LSL File**: [2026-03-17_0800-0900_c197ef_from-onboarding-repro.md](../../../history/2026-03-17_0800-0900_c197ef_from-onboarding-repro.md#ps_1773732211220)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.605)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: /task-id, /tool-use-id, /private/tmp/claude-502/-Users-, /output-file, /status, /summary, /task-notification, private/tmp/claude-502/-Users, Agentic--work-onboarding-repro/6f39981e-4955-456d-b277-fccdf5d2308d/tasks/blw5cag7s.output
- Processing Time: 0ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.605
- Reasoning: Keyword analysis: 2 matches, score: 7/1
- Processing Time: 0ms

---

### Prompt Set: [ps_1773732211220](../../../history/2026-03-17_0800-0900_c197ef_from-onboarding-repro.md#ps_1773732211220)

**Time Range**: 2026-03-17T07:23:31.220Z → 2026-03-17T08:04:05.861Z<br>
**LSL File**: [2026-03-17_0800-0900_c197ef_from-onboarding-repro.md](../../../history/2026-03-17_0800-0900_c197ef_from-onboarding-repro.md#ps_1773732211220)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.605)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: /task-id, /tool-use-id, /private/tmp/claude-502/-Users-, /output-file, /status, /summary, /task-notification, private/tmp/claude-502/-Users, Agentic--work-onboarding-repro/6f39981e-4955-456d-b277-fccdf5d2308d/tasks/blw5cag7s.output
- Processing Time: 2ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.605
- Reasoning: Keyword analysis: 2 matches, score: 7/1
- Processing Time: 1ms

---

### Prompt Set: [ps_1773731708039](../../../history/2026-03-17_0800-0900_c197ef_from-onboarding-repro.md#ps_1773731708039)

**Time Range**: 2026-03-17T07:15:08.039Z → 2026-03-18T05:41:56.144Z<br>
**LSL File**: [2026-03-17_0800-0900_c197ef_from-onboarding-repro.md](../../../history/2026-03-17_0800-0900_c197ef_from-onboarding-repro.md#ps_1773731708039)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.5875)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: //localhost:8080/api/health, /dev/null, //localhost:3001/api/health, 8080/api/health, dev/null, 3001/api/health, unconnected, //localhost:8080/api/entities, /dev/null), //localhost:8080/api/relations, 8080/api/entities, dev/null), 8080/api/relations, /tmp/vkb-entities.json, /tmp/vkb-relations.json, /tmp/vkb-entities.json')), tmp/vkb-entities.json, tmp/vkb-relations.json, tmp/vkb-entities.json')), /tmp/vkb-relations.json')), tmp/vkb-relations.json')), print(f'Relations:, //localhost:8080/api/entities/{urllib.parse.quote(name)}?team={team}", 8080/api/entities/{urllib.parse.quote(name)}?team={team}", //localhost:8080/api/stats, 8080/api/stats, /`to_entity_id`,
- Processing Time: 81ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.5875
- Reasoning: Keyword analysis: 2 matches, score: 6/1
- Processing Time: 1ms

---

### Prompt Set: [ps_1773732211220](../../../history/2026-03-17_0800-0900_c197ef_from-onboarding-repro.md#ps_1773732211220)

**Time Range**: 2026-03-17T07:23:31.220Z → 2026-03-18T05:41:56.166Z<br>
**LSL File**: [2026-03-17_0800-0900_c197ef_from-onboarding-repro.md](../../../history/2026-03-17_0800-0900_c197ef_from-onboarding-repro.md#ps_1773732211220)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.605)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: /task-id, /tool-use-id, /private/tmp/claude-502/-Users-, /output-file, /status, /summary, /task-notification, private/tmp/claude-502/-Users, Agentic--work-onboarding-repro/6f39981e-4955-456d-b277-fccdf5d2308d/tasks/blw5cag7s.output
- Processing Time: 0ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.605
- Reasoning: Keyword analysis: 2 matches, score: 7/1
- Processing Time: 0ms

---

