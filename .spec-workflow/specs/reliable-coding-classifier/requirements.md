# Requirements Document

## Introduction

The reliable coding classifier is a critical component that analyzes conversation exchanges to determine if they contain "coding-related" content. In this context, "coding-related" specifically means content belonging to the "coding" project (on this machine currently checked out to ~/Agentic/coding --> for the remainder of this document ~/Agentic/coding refers to this project. The path can and will of course be different on each installation/machine), which provides methods, tools, and infrastructure for coding activities using coding agents (e.g., Claude Code, GitHub Copilot) and building a "collective brain" knowledge management system.

### Project Context

The system operates with two distinct project types:

1. **Customer Project**: The local project where developers work on specific applications (e.g., a cooking app)
2. **Coding Project** (~/Agentic/coding): The support infrastructure containing scripts, services, and tools that enable effective coding processes

The "collective brain" captures contextual knowledge by observing team coding activities, especially coding agent interactions. This provides valuable insights about intentions, architectural choices, design decisions, and solutions for various coding tasks.

### The Classification Challenge

During development work in a customer project, developers may encounter issues with coding infrastructure tools and choose to fix them immediately. This creates mixed content in session logs:
- Customer project content (belongs in customer project logs)
- Coding infrastructure discussions (should be redirected to coding project logs)

Without proper classification, coding-related discussions get incorrectly logged in customer project history, creating confusion and losing valuable infrastructure insights.

## Alignment with Product Vision

This feature supports the core mission of the coding infrastructure by:
- Ensuring coding-related exchanges are properly captured and routed to the coding project
- Enabling accurate content analysis for knowledge management systems
- Supporting real-time logging capabilities that power developer workflow insights
- Maintaining cross-session continuity through reliable conversation classification

## Requirements

### Requirement 1: File Path-Based Classification (Primary Layer)

**User Story:** As a developer working in any project, I want file operations targeting the coding project filetree (~/Agentic/coding) to be immediately identified and routed to coding project logs, so that infrastructure-related activities are properly segregated from customer project work.

#### Acceptance Criteria

1. WHEN an exchange contains file operations (Read, Write, Edit, etc.) targeting paths under ~/Agentic/coding THEN the classifier SHALL identify it as coding-related with 100% accuracy
2. IF file operations target customer project paths THEN the classifier SHALL proceed to semantic analysis (next layer)
3. WHEN multiple file operations exist in one exchange THEN the classifier SHALL apply coding classification if ANY operation targets coding filetree

### Requirement 2: Semantic Analysis (Secondary Layer)

**User Story:** As a developer discussing coding infrastructure concepts within customer project sessions, I want semantic analysis to detect coding-related discussions even when no coding filetree operations occur, so that infrastructure insights are properly captured and routed.

#### Acceptance Criteria

1. WHEN file path analysis returns negative AND user prompts contain coding infrastructure terms THEN the classifier SHALL perform semantic analysis using the existing SemanticAnalyzer.js with configurable LLM providers (XAI/Grok or OpenAI)
2. IF semantic analysis indicates coding infrastructure discussion THEN the classifier SHALL route content to coding project logs
3. WHEN semantic confidence is below threshold OR API call fails/times out THEN the classifier SHALL proceed to keyword analysis (final layer)

### Requirement 3: Keyword Analysis (Final Layer)

**User Story:** As a system safeguard, I want a keyword-based fallback analysis that catches clear coding infrastructure indicators missed by semantic analysis, so that obvious coding discussions are never misclassified as customer project content.

#### Acceptance Criteria

1. WHEN semantic analysis returns negative THEN the classifier SHALL perform keyword matching against curated coding infrastructure terms
2. IF keywords (eg. LSL, session logging, statusLine, ...) indicate coding infrastructure discussion THEN the classifier SHALL route content to coding project logs
3. WHEN all three layers return negative THEN the classifier SHALL route content to customer project logs (default behavior)

### Requirement 4: Session Log Routing

**User Story:** As a developer working in any project, I want classified content to be automatically routed to appropriate session log files with proper naming conventions, so that content is organized correctly without manual intervention.

#### Acceptance Criteria

1. WHEN content is classified as customer project THEN the classifier SHALL route to `<customer-proj>/.specstory/history/<date>_<time-window>-session.md`, eg. 2025-09-11_0830-0930-session.md
2. IF content is classified as coding-related THEN the classifier SHALL route to `coding/.specstory/history/<date>_<time-window>-session-from-<customer-project>.md`, eg. 2025-09-11_0830-0930-session-from-nano-degree.md
3. WHEN no content exists for a time window THEN the classifier SHALL NOT create empty session files

### Requirement 5: Live Session Logging Integration

**User Story:** As a developer using live session logging, I want the classifier to operate after every user prompt "set" (from user prompt until coding agent returns control), so that content is routed in real-time without delaying the development workflow.

#### Acceptance Criteria

1. WHEN a user prompt set completes THEN the classifier SHALL analyze all associated responses and tool calls
2. IF classification determines coding content THEN the LSL system SHALL write to coding project session files
3. WHEN time windows exceed 60 minutes (configurable) THEN the LSL system SHALL create new session files

### Requirement 6: Performance and Reliability

**User Story:** As a performance-conscious developer, I want lightning-fast classification that doesn't impact live logging performance, so that the system remains responsive during active development sessions.

#### Acceptance Criteria

1. WHEN processing any exchange THEN the classifier SHALL complete analysis within 10ms maximum
2. IF handling batch processing of multiple exchanges THEN the classifier SHALL maintain sub-5ms per-exchange performance
3. WHEN running continuously in live mode THEN the classifier SHALL consume minimal system resources

### Requirement 7: Validation and Testing

**User Story:** As a validation engineer, I want comprehensive testing capabilities built into the classifier, so that I can verify accuracy against known problematic cases and ensure reliability before deployment.

#### Acceptance Criteria

1. WHEN running validation tests THEN the classifier SHALL process the statusLine exchange correctly (currently fails in FastEmbeddingClassifier)
2. IF testing against historical false negatives THEN the classifier SHALL achieve 95%+ accuracy improvement over current system
3. WHEN debugging classification failures THEN the classifier SHALL provide detailed analysis of decision factors at each layer

### Requirement 8: Integration with Existing Infrastructure

**User Story:** As a system integrator, I want the classifier to seamlessly integrate with existing coding infrastructure components, so that we leverage proven systems rather than reinventing functionality.

#### Acceptance Criteria

1. WHEN semantic analysis is needed THEN the classifier SHALL use the existing SemanticAnalyzer.js class with its configurable LLM providers - this class, however, can be adjusted to better serve the needs of the task at hand - don't make a parallel solution (it has been created for this sole purpose of classifying coding agent items as we go along - a FAST and INEXPENSIVE semantic analysis system)
2. IF running on different machines THEN the classifier SHALL use environment variables (CODING_REPO, XAI_API_KEY, etc.) set by install.sh
3. WHEN integrating with LSL system THEN the classifier SHALL work with existing enhanced-transcript-monitor.js and generate-proper-lsl-from-transcripts.js - these two classes can be adjusted as needed... just don't make a parallel solution.

### Requirement 9: Operational Logging and Monitoring

**User Story:** As a system administrator, I want comprehensive logging of all classification decisions and system operations, so that I can analyze problems, debug issues, and understand classification patterns when things go wrong.

#### Acceptance Criteria

1. WHEN the classifier makes any decision THEN it SHALL log the decision details (input, layers evaluated, result, timing) to persistent log files in `.specstory/logs/` directory
2. IF any error occurs during classification THEN the system SHALL log full error details including stack traces, input data, and recovery attempts
3. WHEN analyzing logs retrospectively THEN administrators SHALL be able to trace the complete decision path for any classified exchange

### Requirement 10: Batch Processing and Retroactive Classification

**User Story:** As a developer, I want to retroactively process existing transcripts to generate proper LSL files with correct classification, so that historical data can be properly organized and past sessions can be analyzed with improved classification logic.

#### Acceptance Criteria

1. WHEN running in batch mode THEN the classifier SHALL use the EXACT SAME classification logic as live mode to ensure consistent results
2. IF processing a repository's transcript retroactively THEN the script SHALL generate both local session files and redirected coding session files as appropriate
3. WHEN batch processing completes THEN the system SHALL produce identical results to what live processing would have generated

### Requirement 11: Status Line Integration

**User Story:** As a Claude Code user, I want visual indication on the status line when content is being redirected to the coding project, so that I have immediate feedback about where my session data is being logged.

#### Acceptance Criteria

1. WHEN content is classified as coding-related THEN the status line SHALL display "→coding" indicator
2. IF classification is in progress THEN the status line SHALL show appropriate processing indicator
3. WHEN classification completes THEN the status line SHALL update within 100ms to reflect the routing decision

## Non-Functional Requirements

### Code Architecture and Modularity
- **Single Responsibility Principle**: The classifier focuses solely on coding-related content detection
- **Three-Layer Architecture**: File path analysis → semantic analysis → keyword fallback
- **Modular Design**: Separate components for parsing, path analysis, semantic API calls, keyword matching, and routing
- **Dependency Management**: Minimal dependencies - uses existing SemanticAnalyzer.js with configurable LLM providers
- **Clear Interfaces**: Unified API for live session integration and batch processing modes
- **Machine Agnostic**: No hard-coded paths - uses environment variables set during ./install.sh

### Performance
- Response time: <10ms per exchange (target: <5ms) for lightning-fast live logging
- Memory usage: <50MB constant footprint (no heavy embeddings required)
- CPU usage: <5% during continuous live session operation
- Batch processing: >100 exchanges per second for historical transcript processing
- Semantic analysis: Fast API call to configurable LLM provider (XAI/Grok, OpenAI) <2s timeout

### Security
- No sensitive data logging or exposure (integrated with redaction system)
- Secure handling of file paths and code snippets
- Protection against injection attacks through input validation
- API keys (GROK_API_KEY, OPENAI_API_KEY) stored in .env file, never in logs

### Reliability

- 95%+ accuracy on validation test set (significant improvement over current 0% accuracy)
- Zero false negatives on file operations targeting ~/Agentic/coding filetree
- Graceful handling of malformed exchanges from both live and batch sources
- Comprehensive error reporting and recovery with detailed layer analysis
- Robust routing to correct session log files with proper naming conventions
- Persistent operational logging for post-mortem analysis and debugging
- Identical classification results between live and batch processing modes
- Real-time status line updates for Claude Code users

### Usability

- Simple integration API requiring minimal configuration for Live Session Logging (LSL) system
- Built-in debugging and validation modes for testing against known failures
- Clear logging of classification decisions at each layer (file path, semantic, keyword)
- Easy deployment across different customer projects and coding infrastructure
- Configurable time window settings (default 60 minutes) for session file management
- Batch processing script for retroactive transcript classification and LSL generation
- Visual feedback via status line "→coding" indicator during live sessions
- Comprehensive operational logs accessible for troubleshooting and analysis
