# Classification Decision Log (Foreign/Coding)

**Time Window**: 2025-09-23_1900-2000_g9b30a<br>
**Project**: curriculum-alignment<br>
**Target**: CODING<br>
**Generated**: 2025-10-30T06:15:36.120Z<br>
**Decisions in Window**: 4

---

## Statistics

- **Total Prompt Sets**: 4
- **Classified as CODING**: 4 (100%)
- **Classified as LOCAL**: 0 (0%)
- **[Layer 0 (Session Filter) Decisions](#layer-0-session-filter)**: 0
- **[Layer 1 (Path) Decisions](#layer-1-path)**: 0
- **[Layer 2 (Keyword) Decisions](#layer-2-keyword)**: 2
- **[Layer 3 (Embedding) Decisions](#layer-3-embedding)**: 2
- **[Layer 4 (Semantic) Decisions](#layer-4-semantic)**: 0
- **Average Processing Time**: 230ms

---

## Layer 2: Keyword

**Decisions**: 2

### Prompt Set: [ps_1758646979676](../../../history/2025-09-23_1900-2000_g9b30a_from-curriculum-alignment.md#ps_1758646979676)

**Time Range**: 1758646979676 → 1758647759830<br>
**LSL File**: [2025-09-23_1900-2000_g9b30a_from-curriculum-alignment.md](../../../history/2025-09-23_1900-2000_g9b30a_from-curriculum-alignment.md#ps_1758646979676)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.5525)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority of write operations target local project: /Users/q284340/Agentic/curriculum-alignment/frontend/src/components/auth/LoginForm.tsx, /Users/q284340/Agentic/curriculum-alignment/frontend/src/components/ui/alert.tsx, /Users/q284340/Agentic/curriculum-alignment/frontend/src/components/upload/FileUpload.tsx, /Users/q284340/Agentic/curriculum-alignment/frontend/src/components/ui/progress.tsx, /Users/q284340/Agentic/curriculum-alignment/frontend/src/components/error/ErrorBoundary.tsx, /Users/q284340/Agentic/curriculum-alignment/frontend/public/manifest.json, /Users/q284340/Agentic/curriculum-alignment/frontend/public/service-worker.js, /Users/q284340/Agentic/curriculum-alignment/frontend/public/offline.html, /Users/q284340/Agentic/curriculum-alignment/frontend/index.html, /Users/q284340/Agentic/curriculum-alignment/frontend/src/main.tsx
- Processing Time: 1ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.5525
- Reasoning: Keyword analysis: 1 matches, score: 4/1
- Processing Time: 1ms

---

### Prompt Set: [ps_1758646979676](../../../history/2025-09-23_1900-2000_g9b30a_from-curriculum-alignment.md#ps_1758646979676)

**Time Range**: 1758646979676 → 1758647759830<br>
**LSL File**: [2025-09-23_1900-2000_g9b30a_from-curriculum-alignment.md](../../../history/2025-09-23_1900-2000_g9b30a_from-curriculum-alignment.md#ps_1758646979676)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.5525)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority of write operations target local project: /Users/q284340/Agentic/curriculum-alignment/frontend/src/components/auth/LoginForm.tsx, /Users/q284340/Agentic/curriculum-alignment/frontend/src/components/ui/alert.tsx, /Users/q284340/Agentic/curriculum-alignment/frontend/src/components/upload/FileUpload.tsx, /Users/q284340/Agentic/curriculum-alignment/frontend/src/components/ui/progress.tsx, /Users/q284340/Agentic/curriculum-alignment/frontend/src/components/error/ErrorBoundary.tsx, /Users/q284340/Agentic/curriculum-alignment/frontend/public/manifest.json, /Users/q284340/Agentic/curriculum-alignment/frontend/public/service-worker.js, /Users/q284340/Agentic/curriculum-alignment/frontend/public/offline.html, /Users/q284340/Agentic/curriculum-alignment/frontend/index.html, /Users/q284340/Agentic/curriculum-alignment/frontend/src/main.tsx
- Processing Time: 0ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.5525
- Reasoning: Keyword analysis: 1 matches, score: 4/1
- Processing Time: 2ms

---

## Layer 3: Embedding

**Decisions**: 2

### Prompt Set: [ps_1758647759831](../../../history/2025-09-23_1900-2000_g9b30a_from-curriculum-alignment.md#ps_1758647759831)

**Time Range**: 1758647759831 → 1758654039030<br>
**LSL File**: [2025-09-23_1900-2000_g9b30a_from-curriculum-alignment.md](../../../history/2025-09-23_1900-2000_g9b30a_from-curriculum-alignment.md#ps_1758647759831)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.79565334)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority of write operations target local project: /Users/q284340/Agentic/curriculum-alignment/frontend/src/App.tsx, /Users/q284340/Agentic/curriculum-alignment/frontend/src/components/views/DashboardView.tsx, /Users/q284340/Agentic/curriculum-alignment/frontend/src/components/views/ComponentsTestView.tsx, /Users/q284340/Agentic/curriculum-alignment/frontend/src/store/slices/uiSlice.ts
- Processing Time: 0ms

❌ **Layer 2 (keyword)**
- Decision: local
- Confidence: 0.1
- Reasoning: Keyword analysis: 0 matches, score: 0/1
- Processing Time: 2ms

✅ **Layer 3 (embedding)**
- Decision: coding
- Confidence: 0.79565334
- Reasoning: Semantic similarity favors coding (coding_lsl=0.784, nano_degree=0.761, curriculum_alignment=0.756, coding_infrastructure=0.604)
- Processing Time: 533ms

---

### Prompt Set: [ps_1758647759831](../../../history/2025-09-23_1900-2000_g9b30a_from-curriculum-alignment.md#ps_1758647759831)

**Time Range**: 1758647759831 → 1758654039030<br>
**LSL File**: [2025-09-23_1900-2000_g9b30a_from-curriculum-alignment.md](../../../history/2025-09-23_1900-2000_g9b30a_from-curriculum-alignment.md#ps_1758647759831)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.79565334)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority of write operations target local project: /Users/q284340/Agentic/curriculum-alignment/frontend/src/App.tsx, /Users/q284340/Agentic/curriculum-alignment/frontend/src/components/views/DashboardView.tsx, /Users/q284340/Agentic/curriculum-alignment/frontend/src/components/views/ComponentsTestView.tsx, /Users/q284340/Agentic/curriculum-alignment/frontend/src/store/slices/uiSlice.ts
- Processing Time: 0ms

❌ **Layer 2 (keyword)**
- Decision: local
- Confidence: 0.1
- Reasoning: Keyword analysis: 0 matches, score: 0/1
- Processing Time: 1ms

✅ **Layer 3 (embedding)**
- Decision: coding
- Confidence: 0.79565334
- Reasoning: Semantic similarity favors coding (coding_lsl=0.784, nano_degree=0.761, curriculum_alignment=0.756, coding_infrastructure=0.604)
- Processing Time: 379ms

---

