# Tasks Document: Real-Time Trajectory System

## Phase 1: Enhanced Transcript Monitor Extension (Week 1)

- [x] 1. Extend Enhanced Transcript Monitor with trajectory analysis capabilities
  - File: scripts/enhanced-transcript-monitor.js
  - Add real-time trajectory state detection to existing message parsing
  - Integrate with existing session continuity detection mechanisms
  - Purpose: Enable real-time trajectory monitoring using existing file watching infrastructure
  - _Leverage: Existing FSWatcher, message parsing, session management_
  - _Requirements: FR-001, FR-002, FR-003_
  - _Prompt: Role: Senior JavaScript Developer specializing in file monitoring and real-time analysis | Task: Extend the existing Enhanced Transcript Monitor with real-time trajectory analysis capabilities by integrating trajectory state detection into the current message parsing pipeline, leveraging existing FSWatcher and session continuity systems | Restrictions: Must not disrupt existing LSL functionality, maintain all current file watching capabilities, preserve session continuity detection | Success: Real-time trajectory analysis working alongside existing monitoring, no degradation of LSL performance, trajectory states detected within 100ms_

- [x] 2. Configure fast inference engine with environment variables
  - File: Environment configuration (.env extensions)
  - Add TRAJECTORY_INFERENCE_PROVIDER, TRAJECTORY_INFERENCE_MODEL, TRAJECTORY_INFERENCE_API_KEY settings
  - Set Groq with gpt-oss:20b as default, support alternative providers
  - Purpose: Enable configurable fast inference for real-time trajectory analysis
  - _Leverage: Existing environment configuration patterns_
  - _Requirements: FR-006, FR-007, FR-010_
  - _Prompt: Role: DevOps Engineer with expertise in environment configuration and API integration | Task: Configure a fast inference engine system using environment variables with Groq gpt-oss:20b as default provider, supporting alternative providers through configuration, following existing environment patterns | Restrictions: Must follow existing .env conventions, support graceful fallback if provider unavailable, maintain API key security | Success: Configurable provider system working with Groq default, environment variables properly loaded, provider switching functional_

- [x] 3. Implement trajectory state persistence in .specstory structure
  - File: .specstory/trajectory/ directory creation and management
  - Create live-state.json, session-transitions.log, cross-project-insights.json
  - Integrate with existing .specstory file management patterns
  - Purpose: Persist trajectory state using existing project structure conventions
  - _Leverage: Existing .specstory management, file handling utilities_
  - _Requirements: FR-005, NFR-007_
  - _Prompt: Role: Backend Developer specializing in file system operations and data persistence | Task: Implement trajectory state persistence within the existing .specstory structure by creating trajectory-specific files and management systems that integrate with current file handling patterns | Restrictions: Must maintain existing .specstory conventions, ensure atomic file operations, handle concurrent access properly | Success: Trajectory state persisted reliably, no conflicts with existing .specstory operations, state recovery works across session restarts_

- [x] 4. Test real-time trajectory analysis with existing file watching
  - File: Test scenarios and validation scripts
  - Create test cases for trajectory state transitions using existing LSL patterns
  - Validate integration with current file monitoring systems
  - Purpose: Ensure trajectory analysis works correctly with existing infrastructure
  - _Leverage: Existing test patterns, LSL session examples_
  - _Requirements: FR-001, FR-002, FR-003_
  - _Prompt: Role: QA Engineer with expertise in real-time system testing and file monitoring | Task: Create comprehensive test scenarios for real-time trajectory analysis integration with existing file watching systems, validating trajectory state transitions using current LSL patterns | Restrictions: Must not interfere with production LSL operations, use existing test data patterns, ensure test isolation | Success: All trajectory transitions tested and working, existing file monitoring unaffected, test coverage above 85%_

## Phase 2: Multi-Project Coordination (Week 2)

- [ ] 5. Extend LSL multi-project architecture for trajectory coordination
  - File: Existing Global Health Monitoring and project registration systems
  - Add trajectory state synchronization to existing multi-project communication
  - Integrate with current project-specific Enhanced Transcript Monitors
  - Purpose: Enable cross-project trajectory coordination using existing architecture
  - _Leverage: Existing LSL multi-project infrastructure, Global Health Monitoring_
  - _Requirements: FR-016, FR-017, FR-020_
  - _Prompt: Role: Systems Architect with expertise in multi-process coordination and LSL systems | Task: Extend the existing LSL multi-project architecture to include trajectory state coordination by adding synchronization capabilities to current Global Health Monitoring and project registration systems | Restrictions: Must maintain existing multi-project stability, preserve project isolation where needed, follow current communication patterns | Success: Cross-project trajectory coordination working, existing multi-project operations unaffected, trajectory state synchronized across projects_

- [ ] 6. Implement cross-project trajectory learning and pattern sharing
  - File: Cross-project communication and insight sharing systems
  - Add trajectory pattern detection and sharing across project boundaries
  - Integrate with existing project-specific trajectory histories
  - Purpose: Enable cross-project learning while maintaining project independence
  - _Leverage: Existing cross-project communication channels_
  - _Requirements: FR-018, FR-019_
  - _Prompt: Role: Machine Learning Engineer with expertise in pattern recognition and distributed systems | Task: Implement cross-project trajectory learning by adding pattern detection and sharing capabilities that work across project boundaries while maintaining project independence | Restrictions: Must respect project boundaries, avoid pattern conflicts between projects, maintain performance across multiple projects | Success: Trajectory patterns shared appropriately across projects, no performance degradation, project independence maintained_

- [ ] 7. Test trajectory coordination across multiple concurrent sessions
  - File: Multi-project test scenarios and validation
  - Create test cases for concurrent trajectory coordination scenarios
  - Validate cross-project state synchronization and conflict resolution
  - Purpose: Ensure trajectory coordination works reliably across multiple projects
  - _Leverage: Existing multi-project test infrastructure_
  - _Requirements: FR-016, FR-017, FR-018_
  - _Prompt: Role: QA Engineer specializing in distributed system testing and concurrency | Task: Create comprehensive test scenarios for trajectory coordination across multiple concurrent sessions, validating state synchronization and conflict resolution mechanisms | Restrictions: Must simulate realistic multi-project scenarios, ensure test determinism, avoid resource conflicts during testing | Success: All multi-project trajectory scenarios tested successfully, conflict resolution working properly, no state corruption detected_

## Phase 3: Real-Time Intervention Integration (Week 3)

- [x] 8. Integrate trajectory analysis with Claude Code hook system
  - File: Existing Claude Code hook infrastructure integration
  - Add trajectory-based intervention capabilities to existing hook mechanisms
  - Integrate with current constraint monitor for coordinated guidance
  - Purpose: Enable real-time trajectory intervention using existing hook infrastructure
  - _Leverage: Existing Claude Code hooks, constraint monitor integration_
  - _Requirements: FR-011, FR-012, FR-015_
  - _Prompt: Role: Full-Stack Developer with expertise in hook systems and real-time intervention | Task: Integrate trajectory analysis with the existing Claude Code hook system by adding trajectory-based intervention capabilities that coordinate with the current constraint monitor | Restrictions: Must maintain existing hook functionality, ensure intervention doesn't interfere with current constraint monitoring, preserve hook performance | Success: Trajectory interventions working through existing hooks, coordination with constraint monitor functional, no degradation of existing hook performance_

- [ ] 9. Implement trajectory-based action guidance and redirection prompts
  - File: Intervention prompt generation and delivery systems
  - Create contextual guidance prompts based on trajectory state deviations
  - Integrate with existing correction prompt mechanisms
  - Purpose: Provide intelligent trajectory guidance using proven prompt delivery systems
  - _Leverage: Existing correction prompt infrastructure_
  - _Requirements: FR-013, FR-014_
  - _Prompt: Role: UX Developer with expertise in conversational interfaces and guidance systems | Task: Implement trajectory-based guidance prompts that provide contextual redirection when trajectory deviates, integrating with existing correction prompt delivery mechanisms | Restrictions: Must maintain existing prompt quality and delivery patterns, ensure prompts are contextually appropriate, avoid prompt fatigue | Success: Trajectory guidance prompts contextually relevant and helpful, delivery timing optimal, user feedback positive_

- [ ] 10. Add trajectory health monitoring to existing 4-layer watchdog system
  - File: System Monitor Watchdog extension and health monitoring integration
  - Extend existing 4-layer protection architecture with trajectory monitoring
  - Integrate trajectory health metrics with existing health file formats
  - Purpose: Ensure trajectory system reliability using proven monitoring architecture
  - _Leverage: Existing System Monitor Watchdog, 4-layer protection system_
  - _Requirements: FR-024, NFR-006, NFR-008_
  - _Prompt: Role: DevOps Engineer specializing in system monitoring and reliability | Task: Extend the existing 4-layer watchdog protection system to include trajectory health monitoring by integrating trajectory metrics with current health monitoring infrastructure | Restrictions: Must maintain existing watchdog reliability, follow current health file formats, ensure watchdog performance not degraded | Success: Trajectory monitoring integrated into 4-layer system, health metrics accurate and timely, watchdog reliability maintained_

## Phase 4: Status Line and Monitoring Enhancement (Week 4)

- [ ] 11. Integrate real-time trajectory indicators with existing status line system
  - File: Existing status line system enhancement
  - Add trajectory state icons (🔍EX, 📈ON, 📉OFF, ⚙️IMP, ✅VER, 🚫BLK) to current status display
  - Integrate with existing status line update mechanisms and formatting
  - Purpose: Provide visual trajectory awareness using familiar status line interface
  - _Leverage: Existing status line system, icon management, update mechanisms_
  - _Requirements: FR-021, FR-022, FR-023_
  - _Prompt: Role: Frontend Developer with expertise in status indicators and real-time UI updates | Task: Integrate real-time trajectory state indicators into the existing status line system by adding trajectory icons and state updates to current status display mechanisms | Restrictions: Must maintain existing status line performance and formatting, ensure trajectory indicators don't conflict with current status elements, follow existing icon conventions | Success: Trajectory indicators clearly visible in status line, updates happen within 500ms, existing status line functionality preserved_

- [ ] 12. Extend existing health monitoring with trajectory metrics
  - File: Existing health monitoring system enhancement
  - Add trajectory compliance scores and health metrics to current monitoring
  - Integrate with existing health file formats and reporting mechanisms
  - Purpose: Monitor trajectory system health using proven health monitoring infrastructure
  - _Leverage: Existing health monitoring, reporting mechanisms_
  - _Requirements: FR-024, FR-025_
  - _Prompt: Role: Monitoring Engineer with expertise in health metrics and system observability | Task: Extend the existing health monitoring system to include trajectory metrics by adding compliance scores and health indicators to current monitoring infrastructure | Restrictions: Must follow existing health file formats, maintain monitoring performance, ensure metrics are actionable and relevant | Success: Trajectory health metrics integrated with existing monitoring, metrics accurate and useful, monitoring performance maintained_

- [ ] 13. Extend LSL redaction system with GROQ_API_KEY
  - File: LSL redaction system and security mechanisms
  - Add GROQ_API_KEY to existing API key redaction patterns
  - Update redaction configuration to include Groq alongside XAI_API_KEY, ANTHROPIC_API_KEY
  - Purpose: Ensure trajectory system API keys are properly redacted in LSL logs
  - _Leverage: Existing LSL redaction patterns, security mechanisms_
  - _Requirements: Security requirement for API key protection_
  - _Prompt: Role: Security Engineer with expertise in data redaction and API key protection | Task: Extend the existing LSL redaction system to include GROQ_API_KEY alongside current API key redaction patterns, ensuring trajectory system API keys are properly protected in session logs | Restrictions: Must maintain existing redaction effectiveness, ensure no API keys leak through logs, follow current redaction patterns | Success: GROQ_API_KEY properly redacted in all LSL outputs, existing redaction functionality preserved, no API key leakage detected_

- [ ] 14. Remove/deprecate existing 6-hourly semantic analysis system
  - File: Existing trajectory generation scripts and scheduling mechanisms
  - Safely deprecate batch semantic analysis while preserving data and reports
  - Update documentation and configuration to reflect real-time system
  - Purpose: Complete transition from batch to real-time trajectory analysis
  - _Leverage: Existing trajectory data migration utilities_
  - _Requirements: Migration requirement for system transition_
  - _Prompt: Role: DevOps Engineer with expertise in system migration and deprecation | Task: Safely deprecate the existing 6-hourly semantic analysis system while preserving historical trajectory data and reports, updating all related documentation and configuration | Restrictions: Must not lose existing trajectory data, ensure smooth transition with no service interruption, maintain backward compatibility where needed | Success: Batch system cleanly removed, historical data preserved and accessible, real-time system fully operational, documentation updated_

## Success Criteria

### Phase 1 Success Metrics
- Real-time trajectory analysis functional within 100ms latency
- Configurable inference engine working with Groq default and alternatives
- Trajectory state persistence reliable and integrated with existing .specstory structure
- Zero disruption to existing LSL functionality

### Phase 2 Success Metrics  
- Multi-project trajectory coordination working across concurrent sessions
- Cross-project learning functional without performance degradation
- Trajectory state synchronization reliable and conflict-free
- Existing multi-project LSL operations unaffected

### Phase 3 Success Metrics
- Trajectory interventions integrated with existing Claude Code hooks
- Intervention latency consistently under 10ms
- Trajectory health monitoring integrated with 4-layer watchdog system
- Existing constraint monitoring coordination successful

### Phase 4 Success Metrics
- Trajectory indicators visible in existing status line within 500ms
- Trajectory health metrics integrated with existing monitoring
- GROQ_API_KEY properly redacted in all LSL outputs
- 6-hourly batch analysis system cleanly deprecated
- Complete transition to real-time trajectory system operational