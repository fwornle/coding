# Roadmap (fixture)

A throwaway fixture ROADMAP.md used by tests/experiments/goal-sentence.test.mjs to
exercise the ROADMAP fallback path of deriveGoalSentence. The extractor must locate
the `### Phase 72:` block and read the `**Goal**:` line within it — NOT the Phase 71
goal line above it.

### Phase 71: Earlier Phase
**Goal**: This is the wrong phase goal and must NOT be returned.
**Plans**: 1 plan

### Phase 72: Syntactic Route Quality
**Goal**: Fallback fixture goal sentence for phase seventy-two.
**Depends on**: Phase 71
**Plans**: 5 plans

### Phase 73: Later Phase
**Goal**: Also the wrong phase goal and must NOT be returned.
**Plans**: 1 plan
