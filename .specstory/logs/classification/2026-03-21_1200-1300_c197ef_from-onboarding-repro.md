# Classification Decision Log (Foreign/Coding)

**Time Window**: 2026-03-21_1200-1300_c197ef<br>
**Project**: onboarding-repro<br>
**Target**: CODING<br>
**Generated**: 2026-03-21T12:00:00.000Z<br>
**Decisions in Window**: 2

---

## Statistics

- **Total Prompt Sets**: 2
- **Classified as CODING**: 2 (100%)
- **Classified as LOCAL**: 0 (0%)
- **[Layer 0 (Session Filter) Decisions](#layer-0-session-filter)**: 0
- **[Layer 1 (Path) Decisions](#layer-1-path)**: 1
- **[Layer 2 (Keyword) Decisions](#layer-2-keyword)**: 1
- **[Layer 3 (Embedding) Decisions](#layer-3-embedding)**: 0
- **[Layer 4 (Semantic) Decisions](#layer-4-semantic)**: 0
- **Average Processing Time**: 1ms

---

## Layer 1: Path

**Decisions**: 1

### Prompt Set: [ps_1774091162664](../../../history/2026-03-21_1200-1300_c197ef_from-onboarding-repro.md#ps_1774091162664)

**Time Range**: 2026-03-21T11:06:02.664Z → 2026-03-21T12:08:48.510Z<br>
**LSL File**: [2026-03-21_1200-1300_c197ef_from-onboarding-repro.md](../../../history/2026-03-21_1200-1300_c197ef_from-onboarding-repro.md#ps_1774091162664)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.95)

#### Layer-by-Layer Trace

✅ **Layer 1 (path)**
- Decision: coding
- Confidence: 0.98
- Reasoning: Coding operations detected (1): /Users/Q284340/Agentic/coding/scripts/statusline-health-monitor.js
- Processing Time: 1ms

---

## Layer 2: Keyword

**Decisions**: 1

### Prompt Set: [ps_1774091622072](../../../history/2026-03-21_1200-1300_c197ef_from-onboarding-repro.md#ps_1774091622072)

**Time Range**: 2026-03-21T11:13:42.072Z → 2026-03-21T12:08:48.898Z<br>
**LSL File**: [2026-03-21_1200-1300_c197ef_from-onboarding-repro.md](../../../history/2026-03-21_1200-1300_c197ef_from-onboarding-repro.md#ps_1774091622072)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.5525)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority (100.0%) of file operations target local project: /Library/Containers/com.docker.docker/Data/vms/0/data, /Applications/Docker.app, /Users, /Volumes, /private, /tmp, /var/folders], Library/Containers/com.docker.docker/Data/vms/0/data, Applications/Docker.app, var/folders
- Processing Time: 0ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.5525
- Reasoning: Keyword analysis: 1 matches, score: 4/1
- Processing Time: 1ms

---

