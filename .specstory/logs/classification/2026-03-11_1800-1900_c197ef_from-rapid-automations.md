# Classification Decision Log (Foreign/Coding)

**Time Window**: 2026-03-11_1800-1900_c197ef<br>
**Project**: rapid-automations<br>
**Target**: CODING<br>
**Generated**: 2026-03-11T18:00:00.000Z<br>
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
- **Average Processing Time**: 108ms

---

## Layer 2: Keyword

**Decisions**: 1

### Prompt Set: ps_1773250920965

**Time Range**: 2026-03-11T17:42:00.965Z → 2026-03-11T18:00:01.126Z<br>
**LSL File**: `pending`<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.5175)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: "${INIT#@file:}"), /.claude/get-shit-done/bin/gsd-tools.cjs", HOME/.claude/get-shit-done/bin/gsd-tools.cjs", .planning/phases/01-graph-store-http-api/01-01-SUMMARY.md, /phases/01-graph-store-http-api/01-01-SUMMARY.md, /dev/null, planning/phases/01-graph-store-http-api/01-01-SUMMARY.md, dev/null, okb/src/store/graph-store.ts, /src/store/graph-store.ts, /src/store/persistence.ts, okb/src/store/persistence.ts, planning/phases/01-graph-store-http-api, ~15%, /objective, /Users/, /.claude/get-shit-done/workflows/execute-phase.md, /.claude/get-shit-done/references/ui-brand.md, /execution_context, /context, /process, claude/get-shit-done/workflows/execute-phase.md, claude/get-shit-done/references/ui-brand.md
- Processing Time: 108ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.5175
- Reasoning: Keyword analysis: 1 matches, score: 2/1
- Processing Time: 0ms

---

