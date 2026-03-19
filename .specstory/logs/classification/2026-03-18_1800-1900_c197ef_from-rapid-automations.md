# Classification Decision Log (Foreign/Coding)

**Time Window**: 2026-03-18_1800-1900_c197ef<br>
**Project**: rapid-automations<br>
**Target**: CODING<br>
**Generated**: 2026-03-18T18:00:00.000Z<br>
**Decisions in Window**: 8

---

## Statistics

- **Total Prompt Sets**: 8
- **Classified as CODING**: 8 (100%)
- **Classified as LOCAL**: 0 (0%)
- **[Layer 0 (Session Filter) Decisions](#layer-0-session-filter)**: 0
- **[Layer 1 (Path) Decisions](#layer-1-path)**: 3
- **[Layer 2 (Keyword) Decisions](#layer-2-keyword)**: 5
- **[Layer 3 (Embedding) Decisions](#layer-3-embedding)**: 0
- **[Layer 4 (Semantic) Decisions](#layer-4-semantic)**: 0
- **Average Processing Time**: 47ms

---

## Layer 1: Path

**Decisions**: 3

### Prompt Set: ps_1773853809419

**Time Range**: 2026-03-18T17:10:09.419Z → 2026-03-18T17:11:06.863Z<br>
**LSL File**: `pending`<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.95)

#### Layer-by-Layer Trace

✅ **Layer 1 (path)**
- Decision: coding
- Confidence: 0.98
- Reasoning: Coding operations detected (3): /Users/Q284340/Agentic/coding/.specstory/history/, /Users/Q284340/Agentic/coding/.specstory/history/2026-03-18_1800-1900_c197ef.md, /Users/Q284340/Agentic/coding/.specstory/history/2026-03-18_1700-1800_c197ef.md
- Processing Time: 1ms

---

### Prompt Set: ps_1773853809419

**Time Range**: 2026-03-18T17:10:09.419Z → 2026-03-18T17:18:10.676Z<br>
**LSL File**: `pending`<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.95)

#### Layer-by-Layer Trace

✅ **Layer 1 (path)**
- Decision: coding
- Confidence: 0.98
- Reasoning: Coding operations detected (3): /Users/Q284340/Agentic/coding/.specstory/history/, /Users/Q284340/Agentic/coding/.specstory/history/2026-03-18_1800-1900_c197ef.md, /Users/Q284340/Agentic/coding/.specstory/history/2026-03-18_1700-1800_c197ef.md
- Processing Time: 28ms

---

### Prompt Set: ps_1773853809419

**Time Range**: 2026-03-18T17:10:09.419Z → 2026-03-18T17:32:05.091Z<br>
**LSL File**: `pending`<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.95)

#### Layer-by-Layer Trace

✅ **Layer 1 (path)**
- Decision: coding
- Confidence: 0.98
- Reasoning: Coding operations detected (3): /Users/Q284340/Agentic/coding/.specstory/history/, /Users/Q284340/Agentic/coding/.specstory/history/2026-03-18_1800-1900_c197ef.md, /Users/Q284340/Agentic/coding/.specstory/history/2026-03-18_1700-1800_c197ef.md
- Processing Time: 88ms

---

## Layer 2: Keyword

**Decisions**: 5

### Prompt Set: ps_1773854158985

**Time Range**: 2026-03-18T17:15:58.985Z → 2026-03-18T17:18:09.091Z<br>
**LSL File**: `pending`<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.5525)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: .planning/, .planning/PROJECT.md, /dev/null, /PROJECT.md, planning/, dev/null, planning/PROJECT.md, .planning/milestones/, .planning/phases/, /milestones/, /phases/, planning/milestones/, planning/phases/, .planning/STATE.md, /STATE.md, planning/STATE.md, .planning/ROADMAP.md, /ROADMAP.md, planning/ROADMAP.md, /gsd:plan-phase`), Discuss/plan
- Processing Time: 121ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.5525
- Reasoning: Keyword analysis: 1 matches, score: 4/1
- Processing Time: 0ms

---

### Prompt Set: ps_1773854158985

**Time Range**: 2026-03-18T17:15:58.985Z → 2026-03-18T17:18:10.758Z<br>
**LSL File**: `pending`<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.5525)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: .planning/, .planning/PROJECT.md, /dev/null, /PROJECT.md, planning/, dev/null, planning/PROJECT.md, .planning/milestones/, .planning/phases/, /milestones/, /phases/, planning/milestones/, planning/phases/, .planning/STATE.md, /STATE.md, planning/STATE.md, .planning/ROADMAP.md, /ROADMAP.md, planning/ROADMAP.md, /gsd:plan-phase`), Discuss/plan
- Processing Time: 69ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.5525
- Reasoning: Keyword analysis: 1 matches, score: 4/1
- Processing Time: 0ms

---

### Prompt Set: ps_1773854286332

**Time Range**: 2026-03-18T17:18:06.332Z → 2026-03-18T17:32:01.395Z<br>
**LSL File**: `pending`<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.5525)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority of write operations target local project: /Users/Q284340/Agentic/_work/rapid-automations/.planning/ROADMAP.md, /Users/Q284340/Agentic/_work/rapid-automations/.planning/STATE.md
- Processing Time: 2ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.5525
- Reasoning: Keyword analysis: 1 matches, score: 4/1
- Processing Time: 0ms

---

### Prompt Set: ps_1773854158985

**Time Range**: 2026-03-18T17:15:58.985Z → 2026-03-18T17:32:05.160Z<br>
**LSL File**: `pending`<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.5525)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: .planning/, .planning/PROJECT.md, /dev/null, /PROJECT.md, planning/, dev/null, planning/PROJECT.md, .planning/milestones/, .planning/phases/, /milestones/, /phases/, planning/milestones/, planning/phases/, .planning/STATE.md, /STATE.md, planning/STATE.md, .planning/ROADMAP.md, /ROADMAP.md, planning/ROADMAP.md, /gsd:plan-phase`), Discuss/plan
- Processing Time: 65ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.5525
- Reasoning: Keyword analysis: 1 matches, score: 4/1
- Processing Time: 0ms

---

### Prompt Set: ps_1773854286332

**Time Range**: 2026-03-18T17:18:06.332Z → 2026-03-18T17:32:05.713Z<br>
**LSL File**: `pending`<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.5525)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority of write operations target local project: /Users/Q284340/Agentic/_work/rapid-automations/.planning/ROADMAP.md, /Users/Q284340/Agentic/_work/rapid-automations/.planning/STATE.md
- Processing Time: 0ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.5525
- Reasoning: Keyword analysis: 1 matches, score: 4/1
- Processing Time: 0ms

---

