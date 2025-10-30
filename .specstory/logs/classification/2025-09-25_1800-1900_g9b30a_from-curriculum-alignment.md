# Classification Decision Log (Foreign/Coding)

**Time Window**: 2025-09-25_1800-1900_g9b30a<br>
**Project**: curriculum-alignment<br>
**Target**: CODING<br>
**Generated**: 2025-10-30T06:15:38.026Z<br>
**Decisions in Window**: 10

---

## Statistics

- **Total Prompt Sets**: 10
- **Classified as CODING**: 10 (100%)
- **Classified as LOCAL**: 0 (0%)
- **[Layer 0 (Session Filter) Decisions](#layer-0-session-filter)**: 0
- **[Layer 1 (Path) Decisions](#layer-1-path)**: 0
- **[Layer 2 (Keyword) Decisions](#layer-2-keyword)**: 2
- **[Layer 3 (Embedding) Decisions](#layer-3-embedding)**: 8
- **[Layer 4 (Semantic) Decisions](#layer-4-semantic)**: 0
- **Average Processing Time**: 270ms

---

## Layer 2: Keyword

**Decisions**: 2

### Prompt Set: [ps_1758818207601](../../../history/2025-09-25_1800-1900_g9b30a_from-curriculum-alignment.md#ps_1758818207601)

**Time Range**: 1758818207601 → 1758818297278<br>
**LSL File**: [2025-09-25_1800-1900_g9b30a_from-curriculum-alignment.md](../../../history/2025-09-25_1800-1900_g9b30a_from-curriculum-alignment.md#ps_1758818207601)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.5525)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority of write operations target local project: /Users/q284340/Agentic/curriculum-alignment/.spec-workflow/specs/curriculum-alignment/tasks.md
- Processing Time: 0ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.5525
- Reasoning: Keyword analysis: 1 matches, score: 4/1
- Processing Time: 1ms

---

### Prompt Set: [ps_1758818207601](../../../history/2025-09-25_1800-1900_g9b30a_from-curriculum-alignment.md#ps_1758818207601)

**Time Range**: 1758818207601 → 1758818297278<br>
**LSL File**: [2025-09-25_1800-1900_g9b30a_from-curriculum-alignment.md](../../../history/2025-09-25_1800-1900_g9b30a_from-curriculum-alignment.md#ps_1758818207601)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.5525)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority of write operations target local project: /Users/q284340/Agentic/curriculum-alignment/.spec-workflow/specs/curriculum-alignment/tasks.md
- Processing Time: 0ms

✅ **Layer 2 (keyword)**
- Decision: coding
- Confidence: 0.5525
- Reasoning: Keyword analysis: 1 matches, score: 4/1
- Processing Time: 1ms

---

## Layer 3: Embedding

**Decisions**: 8

### Prompt Set: [ps_1758816137561](../../../history/2025-09-25_1800-1900_g9b30a_from-curriculum-alignment.md#ps_1758816137561)

**Time Range**: 1758816137561 → 1758817354951<br>
**LSL File**: [2025-09-25_1800-1900_g9b30a_from-curriculum-alignment.md](../../../history/2025-09-25_1800-1900_g9b30a_from-curriculum-alignment.md#ps_1758816137561)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.7802912)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority of write operations target local project: /Users/q284340/Agentic/curriculum-alignment/frontend/src/components/modals/UploadDocumentModal.tsx, /Users/q284340/Agentic/curriculum-alignment/frontend/src/services/api/programService.ts, /Users/q284340/Agentic/curriculum-alignment/frontend/src/services/auth/cognitoService.ts, /Users/q284340/Agentic/curriculum-alignment/frontend/src/hooks/useAuth.ts, /Users/q284340/Agentic/curriculum-alignment/frontend/src/App.tsx, /Users/q284340/Agentic/curriculum-alignment/frontend/src/store/slices/authSlice.ts, /Users/q284340/Agentic/curriculum-alignment/frontend/src/store/slices/websocketSlice.ts, /Users/q284340/Agentic/curriculum-alignment/frontend/src/hooks/useWebSocket.ts, /Users/q284340/Agentic/curriculum-alignment/frontend/src/store/index.ts
- Processing Time: 1ms

❌ **Layer 2 (keyword)**
- Decision: local
- Confidence: 0.1
- Reasoning: Keyword analysis: 0 matches, score: 0/1
- Processing Time: 2ms

✅ **Layer 3 (embedding)**
- Decision: coding
- Confidence: 0.7802912
- Reasoning: Semantic similarity favors coding (coding_lsl=0.779, curriculum_alignment=0.775, nano_degree=0.763, coding_infrastructure=0.639)
- Processing Time: 303ms

---

### Prompt Set: [ps_1758817354951](../../../history/2025-09-25_1800-1900_g9b30a_from-curriculum-alignment.md#ps_1758817354951)

**Time Range**: 1758817354951 → 1758817941597<br>
**LSL File**: [2025-09-25_1800-1900_g9b30a_from-curriculum-alignment.md](../../../history/2025-09-25_1800-1900_g9b30a_from-curriculum-alignment.md#ps_1758817354951)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.77474935)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority of write operations target local project: /Users/q284340/Agentic/curriculum-alignment/frontend/src/services/llm/llmService.ts, /Users/q284340/Agentic/curriculum-alignment/frontend/src/hooks/useLLM.ts, /Users/q284340/Agentic/curriculum-alignment/frontend/src/services/api/apiClient.ts, /Users/q284340/Agentic/curriculum-alignment/frontend/src/components/modals/LLMConfigModal.tsx, /Users/q284340/Agentic/curriculum-alignment/frontend/src/services/api/searchService.ts, /Users/q284340/Agentic/curriculum-alignment/frontend/src/hooks/useSearch.ts
- Processing Time: 0ms

❌ **Layer 2 (keyword)**
- Decision: local
- Confidence: 0.1
- Reasoning: Keyword analysis: 0 matches, score: 0/1
- Processing Time: 3ms

✅ **Layer 3 (embedding)**
- Decision: coding
- Confidence: 0.77474935
- Reasoning: Semantic similarity favors coding (coding_lsl=0.770, nano_degree=0.760, curriculum_alignment=0.748, coding_infrastructure=0.625)
- Processing Time: 281ms

---

### Prompt Set: [ps_1758818546834](../../../history/2025-09-25_1800-1900_g9b30a_from-curriculum-alignment.md#ps_1758818546834)

**Time Range**: 1758818546834 → 1758819020062<br>
**LSL File**: [2025-09-25_1800-1900_g9b30a_from-curriculum-alignment.md](../../../history/2025-09-25_1800-1900_g9b30a_from-curriculum-alignment.md#ps_1758818546834)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.7509257300000001)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority of write operations target local project: /Users/q284340/Agentic/curriculum-alignment/frontend/src/services/api/settingsService.ts
- Processing Time: 0ms

❌ **Layer 2 (keyword)**
- Decision: local
- Confidence: 0.1
- Reasoning: Keyword analysis: 0 matches, score: 0/1
- Processing Time: 1ms

✅ **Layer 3 (embedding)**
- Decision: coding
- Confidence: 0.7509257300000001
- Reasoning: Semantic similarity favors coding (coding_lsl=0.749, curriculum_alignment=0.745, nano_degree=0.678, coding_infrastructure=0.656)
- Processing Time: 415ms

---

### Prompt Set: [ps_1758819020063](../../../history/2025-09-25_1800-1900_g9b30a_from-curriculum-alignment.md#ps_1758819020063)

**Time Range**: 1758819020063 → 1758820090696<br>
**LSL File**: [2025-09-25_1800-1900_g9b30a_from-curriculum-alignment.md](../../../history/2025-09-25_1800-1900_g9b30a_from-curriculum-alignment.md#ps_1758819020063)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.789294135)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority of write operations target local project: /Users/q284340/Agentic/curriculum-alignment/frontend/src/hooks/useSettings.ts, /Users/q284340/Agentic/curriculum-alignment/frontend/src/hooks/index.ts, /Users/q284340/Agentic/curriculum-alignment/.spec-workflow/specs/curriculum-alignment/tasks.md, /Users/q284340/Agentic/curriculum-alignment/frontend/src/services/errorHandler.ts, /Users/q284340/Agentic/curriculum-alignment/frontend/src/components/ui/toast.tsx, /Users/q284340/Agentic/curriculum-alignment/frontend/src/components/ErrorBoundary.tsx, /Users/q284340/Agentic/curriculum-alignment/frontend/src/App.tsx, /Users/q284340/Agentic/curriculum-alignment/frontend/src/services/retryQueue.ts, /Users/q284340/Agentic/curriculum-alignment/frontend/src/services/offlineManager.ts, /Users/q284340/Agentic/curriculum-alignment/frontend/src/hooks/useOffline.ts, /Users/q284340/Agentic/curriculum-alignment/frontend/src/services/cache.ts, /Users/q284340/Agentic/curriculum-alignment/frontend/src/hooks/useOptimistic.ts, /Users/q284340/Agentic/curriculum-alignment/frontend/src/services/__tests__/cache.test.ts, /Users/q284340/Agentic/curriculum-alignment/frontend/src/services/__tests__/index.test.ts, /Users/q284340/Agentic/curriculum-alignment/INTEGRATION_VALIDATION.md
- Processing Time: 1ms

❌ **Layer 2 (keyword)**
- Decision: local
- Confidence: 0.1
- Reasoning: Keyword analysis: 0 matches, score: 0/1
- Processing Time: 4ms

✅ **Layer 3 (embedding)**
- Decision: coding
- Confidence: 0.789294135
- Reasoning: Semantic similarity favors coding (coding_lsl=0.781, nano_degree=0.766, curriculum_alignment=0.760, coding_infrastructure=0.623)
- Processing Time: 268ms

---

### Prompt Set: [ps_1758816137561](../../../history/2025-09-25_1800-1900_g9b30a_from-curriculum-alignment.md#ps_1758816137561)

**Time Range**: 1758816137561 → 1758817354951<br>
**LSL File**: [2025-09-25_1800-1900_g9b30a_from-curriculum-alignment.md](../../../history/2025-09-25_1800-1900_g9b30a_from-curriculum-alignment.md#ps_1758816137561)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.7802912)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority of write operations target local project: /Users/q284340/Agentic/curriculum-alignment/frontend/src/components/modals/UploadDocumentModal.tsx, /Users/q284340/Agentic/curriculum-alignment/frontend/src/services/api/programService.ts, /Users/q284340/Agentic/curriculum-alignment/frontend/src/services/auth/cognitoService.ts, /Users/q284340/Agentic/curriculum-alignment/frontend/src/hooks/useAuth.ts, /Users/q284340/Agentic/curriculum-alignment/frontend/src/App.tsx, /Users/q284340/Agentic/curriculum-alignment/frontend/src/store/slices/authSlice.ts, /Users/q284340/Agentic/curriculum-alignment/frontend/src/store/slices/websocketSlice.ts, /Users/q284340/Agentic/curriculum-alignment/frontend/src/hooks/useWebSocket.ts, /Users/q284340/Agentic/curriculum-alignment/frontend/src/store/index.ts
- Processing Time: 1ms

❌ **Layer 2 (keyword)**
- Decision: local
- Confidence: 0.1
- Reasoning: Keyword analysis: 0 matches, score: 0/1
- Processing Time: 3ms

✅ **Layer 3 (embedding)**
- Decision: coding
- Confidence: 0.7802912
- Reasoning: Semantic similarity favors coding (coding_lsl=0.779, curriculum_alignment=0.775, nano_degree=0.763, coding_infrastructure=0.639)
- Processing Time: 333ms

---

### Prompt Set: [ps_1758817354951](../../../history/2025-09-25_1800-1900_g9b30a_from-curriculum-alignment.md#ps_1758817354951)

**Time Range**: 1758817354951 → 1758817941597<br>
**LSL File**: [2025-09-25_1800-1900_g9b30a_from-curriculum-alignment.md](../../../history/2025-09-25_1800-1900_g9b30a_from-curriculum-alignment.md#ps_1758817354951)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.77474935)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority of write operations target local project: /Users/q284340/Agentic/curriculum-alignment/frontend/src/services/llm/llmService.ts, /Users/q284340/Agentic/curriculum-alignment/frontend/src/hooks/useLLM.ts, /Users/q284340/Agentic/curriculum-alignment/frontend/src/services/api/apiClient.ts, /Users/q284340/Agentic/curriculum-alignment/frontend/src/components/modals/LLMConfigModal.tsx, /Users/q284340/Agentic/curriculum-alignment/frontend/src/services/api/searchService.ts, /Users/q284340/Agentic/curriculum-alignment/frontend/src/hooks/useSearch.ts
- Processing Time: 0ms

❌ **Layer 2 (keyword)**
- Decision: local
- Confidence: 0.1
- Reasoning: Keyword analysis: 0 matches, score: 0/1
- Processing Time: 4ms

✅ **Layer 3 (embedding)**
- Decision: coding
- Confidence: 0.77474935
- Reasoning: Semantic similarity favors coding (coding_lsl=0.770, nano_degree=0.760, curriculum_alignment=0.748, coding_infrastructure=0.625)
- Processing Time: 284ms

---

### Prompt Set: [ps_1758818546834](../../../history/2025-09-25_1800-1900_g9b30a_from-curriculum-alignment.md#ps_1758818546834)

**Time Range**: 1758818546834 → 1758819020062<br>
**LSL File**: [2025-09-25_1800-1900_g9b30a_from-curriculum-alignment.md](../../../history/2025-09-25_1800-1900_g9b30a_from-curriculum-alignment.md#ps_1758818546834)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.7509257300000001)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority of write operations target local project: /Users/q284340/Agentic/curriculum-alignment/frontend/src/services/api/settingsService.ts
- Processing Time: 0ms

❌ **Layer 2 (keyword)**
- Decision: local
- Confidence: 0.1
- Reasoning: Keyword analysis: 0 matches, score: 0/1
- Processing Time: 1ms

✅ **Layer 3 (embedding)**
- Decision: coding
- Confidence: 0.7509257300000001
- Reasoning: Semantic similarity favors coding (coding_lsl=0.749, curriculum_alignment=0.745, nano_degree=0.678, coding_infrastructure=0.656)
- Processing Time: 444ms

---

### Prompt Set: [ps_1758819020063](../../../history/2025-09-25_1800-1900_g9b30a_from-curriculum-alignment.md#ps_1758819020063)

**Time Range**: 1758819020063 → 1758820090696<br>
**LSL File**: [2025-09-25_1800-1900_g9b30a_from-curriculum-alignment.md](../../../history/2025-09-25_1800-1900_g9b30a_from-curriculum-alignment.md#ps_1758819020063)<br>
**LSL Lines**: 0-0<br>
**Target**: 🌍 FOREIGN (coding)<br>
**Final Classification**: ✅ CODING (confidence: 0.789294135)

#### Layer-by-Layer Trace

❌ **Layer 1 (path)**
- Decision: local
- Confidence: 0.02
- Reasoning: Majority of write operations target local project: /Users/q284340/Agentic/curriculum-alignment/frontend/src/hooks/useSettings.ts, /Users/q284340/Agentic/curriculum-alignment/frontend/src/hooks/index.ts, /Users/q284340/Agentic/curriculum-alignment/.spec-workflow/specs/curriculum-alignment/tasks.md, /Users/q284340/Agentic/curriculum-alignment/frontend/src/services/errorHandler.ts, /Users/q284340/Agentic/curriculum-alignment/frontend/src/components/ui/toast.tsx, /Users/q284340/Agentic/curriculum-alignment/frontend/src/components/ErrorBoundary.tsx, /Users/q284340/Agentic/curriculum-alignment/frontend/src/App.tsx, /Users/q284340/Agentic/curriculum-alignment/frontend/src/services/retryQueue.ts, /Users/q284340/Agentic/curriculum-alignment/frontend/src/services/offlineManager.ts, /Users/q284340/Agentic/curriculum-alignment/frontend/src/hooks/useOffline.ts, /Users/q284340/Agentic/curriculum-alignment/frontend/src/services/cache.ts, /Users/q284340/Agentic/curriculum-alignment/frontend/src/hooks/useOptimistic.ts, /Users/q284340/Agentic/curriculum-alignment/frontend/src/services/__tests__/cache.test.ts, /Users/q284340/Agentic/curriculum-alignment/frontend/src/services/__tests__/index.test.ts, /Users/q284340/Agentic/curriculum-alignment/INTEGRATION_VALIDATION.md
- Processing Time: 0ms

❌ **Layer 2 (keyword)**
- Decision: local
- Confidence: 0.1
- Reasoning: Keyword analysis: 0 matches, score: 0/1
- Processing Time: 4ms

✅ **Layer 3 (embedding)**
- Decision: coding
- Confidence: 0.789294135
- Reasoning: Semantic similarity favors coding (coding_lsl=0.781, nano_degree=0.766, curriculum_alignment=0.760, coding_infrastructure=0.623)
- Processing Time: 343ms

---

