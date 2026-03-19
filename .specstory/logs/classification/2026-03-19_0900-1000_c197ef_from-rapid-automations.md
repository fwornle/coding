# Classification Decision Log (Foreign/Coding)

**Time Window**: 2026-03-19_0900-1000_c197ef<br>
**Project**: rapid-automations<br>
**Target**: CODING<br>
**Generated**: 2026-03-19T09:00:00.000Z<br>
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
- **Average Processing Time**: 221ms

---

## Layer 2: Keyword

**Decisions**: 1

### Prompt Set: ps_1773908990580

**Time Range**: 2026-03-19T08:29:50.580Z → 2026-03-19T08:30:01.016Z<br>
**LSL File**: `pending`<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.5525)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: /objective, /Users/, /.claude/get-shit-done/workflows/complete-milestone.md, /.claude/get-shit-done/templates/milestone-archive.md, /execution_context, /context, /gsd:audit-milestone`, /gsd:plan-milestone-gaps`, /gsd:new-milestone`, /process, /success_criteria, /critical_rules, claude/get-shit-done/workflows/complete-milestone.md, claude/get-shit-done/templates/milestone-archive.md, planning/ROADMAP.md, planning/REQUIREMENTS.md, planning/STATE.md, planning/PROJECT.md, planning/v, planning/milestones/v, updating/deleting
- Processing Time: 220ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.5525
- Reasoning: Keyword analysis: 1 matches, score: 4/1
- Processing Time: 1ms

---

