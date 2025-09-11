# Tasks Document

<!-- AI Instructions: For each task, generate a _Prompt field with structured AI guidance following this format:
_Prompt: Role: [specialized developer role] | Task: [clear task description with context references] | Restrictions: [what not to do, constraints] | Success: [specific completion criteria]_
This helps provide better AI agent guidance beyond simple "work on this task" prompts. -->

- [x] 1. Create ReliableCodingClassifier core implementation in src/live-logging/ReliableCodingClassifier.js
  - File: src/live-logging/ReliableCodingClassifier.js
  - Implement main classifier with three-layer architecture (PathAnalyzer → SemanticAnalyzer → KeywordMatcher)
  - Provide same interface as FastEmbeddingClassifier for drop-in replacement
  - Purpose: Create the core classification engine that replaces the failing FastEmbeddingClassifier
  - _Leverage: src/live-logging/SemanticAnalyzer.js, scripts/coding-keywords.json_
  - _Requirements: 1.1, 2.1, 8.1_
  - _Prompt: Role: Senior JavaScript Developer specializing in classification systems and performance optimization | Task: Create the core ReliableCodingClassifier implementing three-layer analysis following requirements 1.1, 2.1, and 8.1, leveraging existing SemanticAnalyzer.js and providing same interface as FastEmbeddingClassifier for seamless integration | Restrictions: Must maintain identical API to FastEmbeddingClassifier, do not create parallel SemanticAnalyzer implementation, ensure sub-10ms response time | Success: Classifier provides classify() and initialize() methods with same signatures, implements all three layers correctly, achieves target performance metrics_

- [x] 2. Implement PathAnalyzer (Layer 1) in src/live-logging/PathAnalyzer.js
  - File: src/live-logging/PathAnalyzer.js
  - Extract file paths from tool calls (Read, Write, Edit, etc.)
  - Check if paths belong to coding project filetree using environment variables
  - Purpose: Provide 100% accuracy file path detection for coding project operations
  - _Leverage: Environment variables (CODING_REPO, CODING_TOOLS_PATH)_
  - _Requirements: 1.1, 8.2_
  - _Prompt: Role: System Integration Developer with expertise in file system operations and path analysis | Task: Implement PathAnalyzer for file operation detection following requirements 1.1 and 8.2, using environment variables for machine-agnostic path detection | Restrictions: Must handle various path formats (absolute, relative, tilde), do not hard-code paths, ensure cross-platform compatibility | Success: Correctly identifies 100% of file operations targeting coding project, works across different machine configurations, handles all path edge cases_

- [x] 3. Create SemanticAnalyzerAdapter (Layer 2) in src/live-logging/SemanticAnalyzerAdapter.js
  - File: src/live-logging/SemanticAnalyzerAdapter.js
  - Adapt existing SemanticAnalyzer.js for classification use case
  - Extract coding confidence from semantic analysis results
  - Handle API timeouts and failures gracefully
  - Purpose: Provide semantic analysis layer with proper error handling and classification scoring
  - _Leverage: src/live-logging/SemanticAnalyzer.js_
  - _Requirements: 2.2, 8.1_
  - _Prompt: Role: AI Integration Developer with expertise in LLM API integration and error handling | Task: Create SemanticAnalyzerAdapter that wraps existing SemanticAnalyzer.js for classification use following requirements 2.2 and 8.1, with robust error handling and confidence scoring | Restrictions: Must reuse existing SemanticAnalyzer.js completely, do not modify original SemanticAnalyzer, handle all API failure scenarios gracefully | Success: Adapter properly extracts coding confidence scores, handles all error scenarios without crashing, maintains <2s timeout for semantic analysis_

- [x] 4. Implement KeywordMatcher (Layer 3) in src/live-logging/KeywordMatcher.js
  - File: src/live-logging/KeywordMatcher.js
  - Load curated keyword lists for coding infrastructure terms
  - Implement fast keyword matching with scoring
  - Provide fallback classification when semantic analysis fails
  - Purpose: Ensure obvious coding discussions are never missed through fast keyword detection
  - _Leverage: scripts/coding-keywords.json_
  - _Requirements: 3.1, 3.2_
  - _Prompt: Role: Search Algorithm Developer with expertise in text processing and pattern matching | Task: Implement fast keyword matching system following requirements 3.1 and 3.2, using curated keyword lists to provide reliable fallback classification | Restrictions: Must achieve sub-1ms matching time, avoid false positives, use only clear indicator keywords | Success: Keyword matching is extremely fast, provides high precision with minimal false positives, successfully catches obvious coding discussions missed by other layers_

- [x] 5. Create ExchangeRouter for session file routing in src/live-logging/ExchangeRouter.js
  - File: src/live-logging/ExchangeRouter.js
  - Generate correct session file paths based on classification
  - Handle naming conventions for local vs redirected sessions
  - Integrate with time window management (60-minute windows)
  - Purpose: Route classified exchanges to appropriate session files with proper naming
  - _Leverage: Existing LSL file naming patterns_
  - _Requirements: 4.1, 4.2, 5.3_
  - _Prompt: Role: File System Developer with expertise in path generation and file organization | Task: Create ExchangeRouter for session file routing following requirements 4.1, 4.2, and 5.3, implementing proper naming conventions for local and redirected sessions | Restrictions: Must follow existing LSL naming patterns exactly, handle time window boundaries correctly, ensure no empty files are created | Success: Routes content to correct files with proper naming, handles time windows correctly, integrates seamlessly with existing LSL system_

- [x] 6. Implement OperationalLogger for comprehensive logging in src/live-logging/OperationalLogger.js
  - File: src/live-logging/OperationalLogger.js
  - Log all classification decisions with detailed decision paths
  - Provide structured logging for debugging and analysis
  - Store logs in .specstory/logs/ directory with rotation
  - Purpose: Enable comprehensive debugging and post-mortem analysis of classification decisions
  - _Leverage: Node.js fs module, existing logging patterns_
  - _Requirements: 9.1, 9.2, 9.3_
  - _Prompt: Role: DevOps Engineer with expertise in application logging and monitoring | Task: Implement comprehensive operational logging system following requirements 9.1, 9.2, and 9.3, providing structured logs for debugging and analysis | Restrictions: Must not log sensitive data, ensure log rotation to prevent disk space issues, maintain high performance during logging | Success: All classification decisions are logged with complete decision paths, logs are structured for easy analysis, system maintains performance with logging enabled_

- [x] 7. Create StatusLineIntegrator for Claude Code feedback in src/live-logging/StatusLineIntegrator.js
  - File: src/live-logging/StatusLineIntegrator.js
  - Integrate with combined-status-line.js for "→coding" indicator
  - Provide real-time feedback during classification
  - Update status within 100ms of classification completion
  - Purpose: Give users immediate visual feedback about content routing decisions
  - _Leverage: scripts/combined-status-line.js_
  - _Requirements: 11.1, 11.2, 11.3_
  - _Prompt: Role: UI/UX Developer with expertise in real-time user feedback systems | Task: Create StatusLineIntegrator for real-time user feedback following requirements 11.1, 11.2, and 11.3, integrating with existing status line infrastructure | Restrictions: Must not block classification process, ensure updates are atomic, follow existing status line patterns | Success: Status line updates reliably show routing decisions, updates occur within 100ms, integration doesn't impact classification performance_

- [x] 8. Modify enhanced-transcript-monitor.js to use ReliableCodingClassifier
  - File: scripts/enhanced-transcript-monitor.js (modify existing)
  - Replace FastEmbeddingClassifier with ReliableCodingClassifier
  - Update initialization and classification method calls
  - Maintain backward compatibility with existing logging pipeline
  - Purpose: Integrate the new classifier into live session monitoring
  - _Leverage: Existing transcript monitor structure_
  - _Requirements: 8.1, 8.3_
  - _Prompt: Role: Integration Specialist with expertise in legacy system modernization | Task: Replace FastEmbeddingClassifier with ReliableCodingClassifier in enhanced-transcript-monitor.js following requirements 8.1 and 8.3, maintaining full backward compatibility | Restrictions: Must preserve all existing functionality, maintain same API calls, ensure no breaking changes to dependent systems | Success: New classifier works seamlessly in place of old one, all existing functionality preserved, performance significantly improved_

- [x] 9. Update generate-proper-lsl-from-transcripts.js for batch processing
  - File: scripts/generate-proper-lsl-from-transcripts.js (modify existing)
  - Ensure batch processing uses same ReliableCodingClassifier instance
  - Verify consistent results between live and batch modes
  - Add progress reporting for large batch operations
  - Purpose: Enable retroactive transcript processing with improved classification
  - _Leverage: Existing batch processing structure, enhanced-transcript-monitor.js_
  - _Requirements: 10.1, 10.2, 10.3_
  - _Prompt: Role: Batch Processing Specialist with expertise in data migration and consistency | Task: Update batch LSL generator to use ReliableCodingClassifier following requirements 10.1, 10.2, and 10.3, ensuring identical results to live processing | Restrictions: Must use identical classifier instance as live mode, preserve all existing batch functionality, maintain processing performance | Success: Batch processing produces identical results to live processing, performance is maintained or improved, progress reporting works correctly_

- [-] 10. Create comprehensive test suite in test/classifier/
  - File: test/classifier/ReliableCodingClassifier.test.js
  - Write unit tests for all classifier components
  - Include integration tests with known failure cases (statusLine exchange)
  - Add performance benchmarks to verify <10ms requirement
  - Purpose: Ensure classifier reliability and catch regressions
  - _Leverage: Jest testing framework, existing test patterns_
  - _Requirements: 7.1, 7.2, 7.3_
  - _Prompt: Role: QA Engineer with expertise in JavaScript testing and performance validation | Task: Create comprehensive test suite covering all classifier components following requirements 7.1, 7.2, and 7.3, including known failure cases and performance benchmarks | Restrictions: Must test all three layers independently, include real exchange data for integration tests, maintain test independence and repeatability | Success: All components are thoroughly tested, known failure cases pass with new classifier, performance benchmarks confirm <10ms requirement_

- [ ] 11. Create validation script for historical accuracy in scripts/validate-classifier.js
  - File: scripts/validate-classifier.js
  - Process historical transcripts with manual ground truth classification
  - Generate accuracy reports comparing old vs new classifier
  - Identify and analyze any remaining classification errors
  - Purpose: Validate classifier performance against historical data and measure improvement
  - _Leverage: Existing transcript files in .specstory/history/_
  - _Requirements: 7.1, 7.2_
  - _Prompt: Role: Data Validation Specialist with expertise in classification accuracy measurement | Task: Create validation script for measuring classifier accuracy against historical data following requirements 7.1 and 7.2, generating comprehensive accuracy reports | Restrictions: Must use real historical data, provide statistically significant results, identify specific failure patterns for analysis | Success: Validation script accurately measures classifier performance, demonstrates significant improvement over FastEmbeddingClassifier, identifies areas for potential future improvement_

- [ ] 12. Create retroactive LSL regeneration script in scripts/retroactive-lsl-regenerator.js
  - File: scripts/retroactive-lsl-regenerator.js
  - Build standalone script for processing historical transcripts
  - Use same ReliableCodingClassifier engine for consistent results
  - Generate both local and redirected session files as appropriate
  - Purpose: Provide batch tool for improving historical session organization
  - _Leverage: ReliableCodingClassifier, existing transcript processing logic_
  - _Requirements: 10.1, 10.2, 10.3_
  - _Prompt: Role: CLI Tool Developer with expertise in batch data processing and user experience | Task: Create standalone retroactive LSL regeneration script following requirements 10.1, 10.2, and 10.3, using same classifier engine as live mode | Restrictions: Must produce identical results to live processing, provide clear progress feedback, handle large datasets efficiently | Success: Script processes historical transcripts correctly, generates proper LSL files with improved classification, provides excellent user experience with progress reporting_

- [ ] 13. Add operational monitoring and debugging tools in scripts/classifier-debug.js
  - File: scripts/classifier-debug.js
  - Create debugging tools for analyzing classification decisions
  - Provide log analysis and decision path visualization
  - Add performance monitoring and metrics collection
  - Purpose: Support troubleshooting and system monitoring in production
  - _Leverage: OperationalLogger output files_
  - _Requirements: 9.1, 9.2, 9.3_
  - _Prompt: Role: DevOps Tooling Developer with expertise in debugging and monitoring systems | Task: Create comprehensive debugging and monitoring tools following requirements 9.1, 9.2, and 9.3, providing analysis of operational logs and performance metrics | Restrictions: Must handle large log files efficiently, provide actionable debugging information, maintain tool performance | Success: Tools provide clear insights into classification decisions, help diagnose issues quickly, offer performance monitoring capabilities_

- [ ] 14. Final integration testing and deployment preparation
  - File: Multiple files (integration verification)
  - Perform end-to-end testing with live session monitoring
  - Verify all components work together correctly
  - Test error scenarios and recovery mechanisms
  - Document deployment procedures and troubleshooting
  - Purpose: Ensure complete system reliability before production deployment
  - _Leverage: All implemented components_
  - _Requirements: All requirements_
  - _Prompt: Role: Senior System Integration Engineer with expertise in production deployments and reliability testing | Task: Perform comprehensive integration testing covering all requirements, ensuring complete system reliability and documenting deployment procedures | Restrictions: Must test all error scenarios, verify all performance requirements, ensure no breaking changes to existing systems | Success: All components work together flawlessly, system meets all performance and reliability requirements, deployment documentation is complete and accurate_