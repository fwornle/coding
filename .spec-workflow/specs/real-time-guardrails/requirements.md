# Real-Time Trajectory System Requirements Specification

## Product: Live Trajectory Monitoring and Intervention System
**Version:** 1.0.0  
**Date:** 2025-09-29  
**Status:** Draft

---

## 1. Executive Summary

### 1.1 Purpose
Replace the existing semantic trajectory analysis system with a real-time behavioral monitoring and intervention system that provides live trajectory tracking, multi-project coordination, and proactive guidance within the existing coding infrastructure.

### 1.2 Vision  
Transform the current 6-hourly semantic trajectory analysis into a live system that provides real-time trajectory awareness, intervention capabilities, and seamless multi-project collaboration while leveraging existing LSL and watchdog infrastructure.

### 1.3 Key Outcomes
- **Live trajectory tracking** replacing batch semantic analysis
- **Real-time intervention** capabilities with <10ms latency
- **Multi-project coordination** via existing LSL infrastructure
- **Zero new development** - enhancement of existing trajectory system
- **Rock-solid monitoring** integrated with existing 4-layer watchdog architecture

---

## 2. Problem Statement

### 2.1 Current State Limitations
- **Batch Trajectory Analysis**: Current system runs semantic analysis every 6 hours, missing real-time patterns
- **No Live Intervention**: Existing constraint monitor operates post-facto without preventing violations
- **Missing Real-Time Context**: No live conversation state tracking during active sessions
- **Delayed Trajectory Awareness**: Workflow phases and behavioral patterns only visible in retrospective analysis

### 2.2 User Pain Points
- Claude Code can deviate from optimal trajectory without real-time correction
- No live guidance to maintain productive workflow phases
- Trajectory insights only available after session completion
- Multi-project work lacks coordinated trajectory monitoring

### 2.3 Business Impact
- Lost productivity from suboptimal trajectory patterns
- Delayed detection of workflow inefficiencies
- Missed opportunities for real-time behavioral guidance
- Insufficient cross-project learning and coordination

---

## 3. Functional Requirements

### 3.1 Live Trajectory Monitoring (Enhancement of Existing System)
**Priority:** P0 - Critical

#### Requirements:
- **FR-001**: Extend existing Enhanced Transcript Monitor with real-time trajectory analysis
- **FR-002**: Replace 6-hourly semantic analysis with continuous trajectory tracking
- **FR-003**: Leverage existing LSL file watching infrastructure (<100ms latency)
- **FR-004**: Maintain trajectory context across sessions using existing session continuity detection
- **FR-005**: Persist trajectory state in existing `.specstory/trajectory/` structure

#### Acceptance Criteria:
- Trajectory changes detected within 100ms using existing file monitoring
- All message types correctly analyzed for trajectory phase transitions
- Context preserved using existing session continuation detection
- Zero disruption to existing LSL functionality

### 3.2 Configurable Fast Inference Engine
**Priority:** P0 - Critical

#### Requirements:
- **FR-006**: Configure inference provider via `.env` (default: Groq with gpt-oss:20b model)
- **FR-007**: Implement trajectory phase analysis prompts replacing existing semantic analysis
- **FR-008**: Classify trajectory states: exploring → implementing → verifying → blocked → off-track
- **FR-009**: Generate action summaries and trajectory insights (<50ms response time)
- **FR-010**: Support configurable trajectory analysis patterns

#### Acceptance Criteria:
- Groq API (default) or configured provider response time <50ms
- Trajectory classification accuracy >85% compared to existing system
- Seamless provider switching via environment configuration
- Clear trajectory reasoning and action summaries generated

### 3.3 Real-Time Intervention System
**Priority:** P0 - Critical

#### Requirements:
- **FR-011**: Integrate with existing Claude Code hook system for trajectory intervention
- **FR-012**: Implement trajectory-based action guidance (<10ms response time)
- **FR-013**: Generate contextual redirection prompts when trajectory deviates
- **FR-014**: Support intervention thresholds configurable per trajectory state
- **FR-015**: Log intervention events in existing `.specstory/` logging structure

#### Acceptance Criteria:
- Hooks successfully provide trajectory-based guidance
- Intervention response time consistently <10ms
- Guidance prompts contextually relevant to current trajectory phase
- Existing hook infrastructure remains unaffected

### 3.4 Multi-Project Trajectory Coordination
**Priority:** P0 - Critical

#### Requirements:
- **FR-016**: Extend existing LSL multi-project architecture for trajectory coordination
- **FR-017**: Coordinate trajectory state across multiple concurrent coding sessions
- **FR-018**: Support cross-project trajectory learning and pattern sharing
- **FR-019**: Maintain project-specific trajectory histories with cross-referencing
- **FR-020**: Integrate with existing project-specific Enhanced Transcript Monitors

#### Acceptance Criteria:
- Trajectory coordination works seamlessly across existing multi-project setup
- Each project maintains independent trajectory state while sharing insights
- Cross-project patterns identified and utilized for trajectory optimization
- Zero interference between concurrent project trajectories

### 3.5 Enhanced Status Line Integration
**Priority:** P1 - High

#### Requirements:
- **FR-021**: Integrate real-time trajectory indicators with existing status line system
- **FR-022**: Display trajectory state icons (🔍EX, 📈ON, 📉OFF, ⚙️IMP, ✅VER, 🚫BLK)
- **FR-023**: Show trajectory phase transitions in existing status line format
- **FR-024**: Provide trajectory health metrics via existing health monitoring
- **FR-025**: Support trajectory status aggregation across multiple projects

#### Acceptance Criteria:
- Status indicators update within 500ms using existing infrastructure
- Trajectory states clearly represented in familiar status line format
- Health metrics integrate with existing 4-layer monitoring architecture
- Multi-project trajectory status available in coordinated view

### 3.6 LSL Redaction System Enhancement
**Priority:** P0 - Critical

#### Requirements:
- **FR-026**: Extend existing LSL redaction system to include GROQ_API_KEY
- **FR-027**: Ensure GROQ_API_KEY is redacted alongside existing XAI_API_KEY, ANTHROPIC_API_KEY
- **FR-028**: Update LSL redaction patterns to handle Groq provider API keys
- **FR-029**: Maintain existing redaction effectiveness while adding Groq support
- **FR-030**: Document distinction between GROQ_API_KEY (Groq provider) and XAI_API_KEY (xAI's Grok)

#### Acceptance Criteria:
- GROQ_API_KEY properly redacted in all LSL session logs and outputs
- Existing API key redaction (XAI_API_KEY, ANTHROPIC_API_KEY) remains functional
- No Groq API keys leak through any LSL logging or monitoring systems
- Redaction patterns correctly distinguish between different provider keys

---

## 4. Non-Functional Requirements

### 4.1 Performance Requirements
- **NFR-001**: End-to-end intervention latency <10ms
- **NFR-002**: Vector search response time <3ms
- **NFR-003**: LLM analysis completion <50ms
- **NFR-004**: Dashboard rendering <1s
- **NFR-005**: Support 100+ concurrent sessions

### 4.2 Reliability Requirements
- **NFR-006**: 99.9% uptime for core intervention system
- **NFR-007**: Zero data loss for violation logs
- **NFR-008**: Automatic recovery from service failures
- **NFR-009**: Graceful degradation under high load

### 4.3 Security Requirements
- **NFR-010**: Encrypted storage for conversation context
- **NFR-011**: Secure API key management for Groq
- **NFR-012**: Audit logging for all interventions
- **NFR-013**: Role-based access control for configuration

### 4.4 Scalability Requirements
- **NFR-014**: Horizontal scaling for analysis workers
- **NFR-015**: Efficient context pruning for long sessions
- **NFR-016**: Configurable retention policies
- **NFR-017**: Support for distributed deployments

---

## 5. Technical Architecture

### 5.1 Enhanced Existing Components

#### 5.1.1 Enhanced Transcript Monitor Extensions
- Extend existing `scripts/enhanced-transcript-monitor.js` with trajectory analysis
- Leverage existing file watching infrastructure (FSWatcher)
- Add trajectory state tracking to existing message parsing pipeline
- Integrate with existing session continuity detection

#### 5.1.2 Configurable Fast Inference Engine
- Environment-configurable provider (default: Groq gpt-oss:20b)
- Replace existing semantic analysis scheduling with real-time analysis
- Extend existing MCP semantic analysis integration
- Action summary generation replacing batch trajectory reports

#### 5.1.3 Existing Hook System Integration
- Utilize existing Claude Code hook infrastructure
- Extend existing hook registration for trajectory intervention
- Integrate with existing constraint monitor for trajectory-based guidance
- Leverage existing correction prompt mechanisms

#### 5.1.4 LSL Multi-Project Architecture Extension
- Extend existing project-specific Enhanced Transcript Monitors
- Leverage existing Global Health Monitoring for trajectory coordination
- Utilize existing cross-project communication channels
- Integrate with existing 4-layer protection architecture

### 5.2 Data Architecture (Extending Existing)

#### 5.2.1 Existing File Structure Extensions
```bash
# Extend existing .specstory structure
.specstory/
├── history/                    # Existing LSL session files
├── trajectory/                 # Enhanced trajectory tracking
│   ├── live-state.json        # Real-time trajectory state
│   ├── session-transitions.log # Trajectory phase changes
│   └── cross-project-insights.json # Multi-project patterns
└── comprehensive-project-trajectory.md # Enhanced real-time report
```

#### 5.2.1 Environment Configuration Extensions
```bash
# Extend existing environment configuration
# Fast inference engine configuration
TRAJECTORY_INFERENCE_PROVIDER=groq              # Default: groq
TRAJECTORY_INFERENCE_MODEL=gpt-oss:20b          # Default model
TRAJECTORY_INFERENCE_ENDPOINT=                  # Optional custom endpoint
TRAJECTORY_INFERENCE_API_KEY=                   # Provider API key

# Real-time trajectory settings
TRAJECTORY_ANALYSIS_INTERVAL=100                # Real-time analysis interval (ms)
TRAJECTORY_INTERVENTION_THRESHOLD=0.8           # Intervention confidence threshold
TRAJECTORY_CROSS_PROJECT_SYNC=true              # Enable multi-project coordination

# Integration with existing LSL settings
TRANSCRIPT_SOURCE_PROJECT=                       # Existing project path
CODING_TOOLS_PATH=                              # Existing tools path  
TRAJECTORY_WATCHDOG_INTEGRATION=true            # Integrate with existing watchdog

# LSL redaction enhancement (CRITICAL for security)
LSL_REDACTION_KEYS="XAI_API_KEY,GROQ_API_KEY,ANTHROPIC_API_KEY,OPENAI_API_KEY,CLAUDE_API_KEY,GEMINI_API_KEY"  # Comprehensive API key redaction
```

### 5.3 Integration Points (Leveraging Existing)

#### 5.3.1 Existing Infrastructure Enhancement
- **Enhanced Transcript Monitors**: Add trajectory analysis capabilities
- **Global Health Monitoring**: Extend with trajectory health metrics
- **System Monitor Watchdog**: Include trajectory system monitoring
- **Status Line System**: Add real-time trajectory indicators
- **Existing MCP Services**: Leverage semantic analysis, constraint monitoring

#### 5.3.2 External Service Configuration
- **Groq API**: Default fast inference provider (configurable)
- **Existing Claude Code Hooks**: Trajectory intervention integration
- **Existing Health Files**: Trajectory state persistence
- **Existing LaunchAgent**: Watchdog integration for trajectory monitoring

---

## 6. Implementation Phases

### Phase 1: Enhanced Transcript Monitor Extension (Week 1)
- [ ] Extend existing Enhanced Transcript Monitor with trajectory analysis capabilities
- [ ] Configure fast inference engine (Groq default, environment configurable)
- [ ] Integrate trajectory state tracking with existing message parsing
- [ ] Test real-time trajectory analysis with existing file watching

### Phase 2: Multi-Project Coordination (Week 2)
- [ ] Extend existing LSL multi-project architecture for trajectory coordination
- [ ] Implement cross-project trajectory state synchronization
- [ ] Integrate with existing Global Health Monitoring for trajectory metrics
- [ ] Test trajectory coordination across multiple concurrent sessions

### Phase 3: Real-Time Intervention Integration (Week 3)
- [ ] Integrate trajectory analysis with existing Claude Code hook system
- [ ] Implement trajectory-based intervention prompts
- [ ] Add trajectory health monitoring to existing 4-layer watchdog system
- [ ] Test intervention system with existing constraint monitoring

### Phase 4: Status Line and Monitoring Enhancement (Week 4)
- [ ] Integrate real-time trajectory indicators with existing status line system
- [ ] Extend existing health monitoring with trajectory metrics
- [ ] Implement trajectory state persistence in existing `.specstory/` structure
- [ ] Remove/deprecate existing 6-hourly semantic analysis system

---

## 7. Success Metrics

### 7.1 Performance Metrics
- Intervention latency: <10ms (P95)
- Detection accuracy: >85%
- False positive rate: <10%
- System availability: >99.9%

### 7.2 User Metrics
- Violation prevention rate: >90%
- User satisfaction score: >4.5/5
- Trajectory adherence: >80%
- Configuration adoption: >75%

### 7.3 Business Metrics
- Reduced cleanup time: -50%
- Increased developer productivity: +30%
- Decreased critical violations: -80%
- Improved code quality: +25%

---

## 8. Risks and Mitigations

### 8.1 Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Groq API latency spikes | Medium | High | Implement fallback to local LLM |
| Hook integration complexity | High | Medium | Phased rollout with feature flags |
| Context storage growth | Medium | Medium | Implement sliding window pruning |
| False positive disruptions | Low | High | Configurable sensitivity levels |

### 8.2 Operational Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| User resistance to interventions | Medium | Medium | Gradual introduction with education |
| Configuration complexity | Medium | Low | Provide preset profiles |
| Performance degradation | Low | High | Load testing and monitoring |
| Data privacy concerns | Low | Medium | Clear data handling policies |

---

## 9. Dependencies

### 9.1 External Dependencies
- Configurable fast inference provider (default: Groq API) availability and performance
- Claude Code hook system stability and intervention capabilities
- Existing LSL file watching and monitoring infrastructure

### 9.2 Internal Dependencies
- Enhanced Transcript Monitor system (`scripts/enhanced-transcript-monitor.js`)
- Existing LSL multi-project architecture and Global Health Monitoring
- System Monitor Watchdog (`scripts/system-monitor-watchdog.js`) integration
- Existing status line system and 4-layer protection architecture
- Current constraint monitor and MCP semantic analysis services

---

## 10. Open Questions

1. **Fast Inference Rate Limits**: What are the rate limits for Groq (default) and alternative providers?
2. **Existing Hook Intervention Scope**: Can current Claude Code hooks handle trajectory-based interventions?
3. **Trajectory Context Window**: What's the optimal trajectory context size for real-time analysis?
4. **Cross-Project State Sync**: How to handle trajectory state conflicts across multiple project sessions?
5. **Backward Compatibility**: How to ensure existing trajectory reports remain functional during transition?
6. **Watchdog Integration Depth**: What level of trajectory monitoring should be integrated with existing 4-layer watchdog?

---

## 11. Appendices

### Appendix A: Live Trajectory State Definitions (Replacing Batch Analysis)

| State | Icon | Description | Transition Triggers | Integration Point |
|-------|------|-------------|-------------------|------------------|
| Exploring | 🔍EX | Information gathering phase | Read/search tool usage | Enhanced Transcript Monitor detection |
| On-Track | 📈ON | Productive trajectory progression | Successful task advancement | Existing status line indicators |
| Off-Track | 📉OFF | Deviating from optimal path | Excessive exploration, wrong direction | Hook-based intervention triggers |
| Implementing | ⚙️IMP | Active code modification | Edit/Write tool usage patterns | Existing file change monitoring |
| Verifying | ✅VER | Testing and validation phase | Test execution, validation tools | Existing health monitoring integration |
| Blocked | 🚫BLK | Intervention preventing action | High-confidence trajectory deviation | Existing constraint monitor integration |

### Appendix B: Enhanced Environment Configuration

```bash
# Replace existing trajectory configuration
# Fast inference engine settings (NEW)
TRAJECTORY_INFERENCE_PROVIDER=groq                    # Default: groq
TRAJECTORY_INFERENCE_MODEL=gpt-oss:20b                # Default model  
TRAJECTORY_INFERENCE_API_KEY=${GROQ_API_KEY}          # Provider API key
TRAJECTORY_ANALYSIS_INTERVAL=100                      # Real-time interval (ms)

# Integration with existing LSL settings (ENHANCED)
TRAJECTORY_LSL_INTEGRATION=true                       # Enable LSL integration
TRAJECTORY_MULTI_PROJECT=true                         # Multi-project coordination
TRAJECTORY_WATCHDOG_LEVEL=full                        # Watchdog integration depth

# Deprecate existing batch analysis settings
# TRAJECTORY_ANALYSIS_LEVEL=light                     # REMOVE - replaced by real-time
# TRAJECTORY_UPDATE_INTERVAL=86400000                 # REMOVE - replaced by continuous
```

### Appendix C: Performance Benchmarks (Leveraging Existing Infrastructure)

| Operation | Target | Acceptable | Maximum | Integration Point |
|-----------|--------|------------|---------|------------------|
| Trajectory Analysis | 50ms | 100ms | 200ms | Fast inference engine (Groq default) |
| Hook Intervention | 5ms | 10ms | 20ms | Existing Claude Code hooks |
| Context Update | 50ms | 100ms | 200ms | Enhanced Transcript Monitor |
| Status Line Update | 100ms | 500ms | 1000ms | Existing status line system |
| Cross-Project Sync | 200ms | 500ms | 1000ms | Existing LSL multi-project architecture |
| Watchdog Integration | 1s | 2s | 5s | Existing 4-layer monitoring system |

### Appendix D: Migration from Existing System

#### Deprecation Plan
- **Existing 6-hourly semantic analysis**: Replace with real-time trajectory monitoring
- **Batch trajectory reports**: Enhance with live trajectory state updates  
- **Manual trajectory generation**: Supplement with continuous tracking
- **Static trajectory insights**: Replace with dynamic intervention capabilities

#### Backward Compatibility
- Maintain existing `.specstory/comprehensive-project-trajectory.md` format
- Preserve existing trajectory report structure with enhanced real-time data
- Keep existing LSL session file formats and naming conventions
- Maintain existing multi-project coordination mechanisms

---

## Document Control

**Author:** Claude Code Assistant  
**Reviewers:** [To be added]  
**Approval:** [Pending]  
**Next Review:** [30 days from approval]

**Integration Notes:**
- This specification enhances existing trajectory and LSL systems rather than creating new infrastructure
- All proposed changes leverage existing monitoring, analysis, and intervention capabilities
- Implementation focuses on real-time enhancement of proven batch analysis system
- Multi-project coordination builds on existing LSL multi-project architecture