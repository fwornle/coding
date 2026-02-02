# LSL - Live Session Logging

Real-time conversation monitoring and intelligent classification with zero data loss.

![LSL Architecture](../images/lsl-architecture.png)

![Adaptive LSL System](../images/adaptive-lsl-system.png)

## What It Does

- **Real-Time Monitoring** - Captures every Claude conversation as it happens
- **Intelligent Classification** - 5-layer system routes content (LOCAL vs CODING)
- **Zero Data Loss** - 4-layer monitoring architecture ensures reliability
- **Multi-Project Support** - Handles multiple projects with foreign session tracking
- **Security Redaction** - Automatic sanitization of secrets and credentials

## 5-Layer Classification

![5-Layer Classification](../images/lsl-5-layer-classification.png)

| Layer | Name | Function | Speed |
|-------|------|----------|-------|
| 0 | Session Filter | Conversation context and bias tracking | Instant |
| 1 | PathAnalyzer | File operation pattern matching | <1ms |
| 2 | KeywordMatcher | Fast keyword-based classification | <10ms |
| 3 | EmbeddingClassifier | Semantic vector similarity | ~50ms |
| 4 | SemanticAnalyzer | LLM-powered deep understanding | <10ms (cached) |

Early exit optimization: Classification stops at first confident decision.

## 4-Layer Monitoring Architecture

| Layer | Component | Function |
|-------|-----------|----------|
| 1 | Watchdog | Top-level supervisor, restarts failed processes |
| 2 | Coordinator | Manages monitors across all projects |
| 3 | Verifier | Health checks, detects stuck processes |
| 4 | Self-Monitoring | Per-monitor health files with metrics |

## Content Routing

**LOCAL Content** (Project-Specific):

- Stored in: `project/.specstory/history/`
- Format: `YYYY-MM-DD_HHMM-HHMM_<userhash>.md`

**CODING Content** (Infrastructure):

- Redirected to: `coding/.specstory/history/`
- Format: `YYYY-MM-DD_HHMM-HHMM_<userhash>_from-<project>.md`

## Security Redaction

13 pattern types automatically sanitized:

- API keys and tokens
- Passwords and credentials
- URLs with embedded passwords
- Email addresses
- Corporate user IDs

Performance: <5ms overhead per exchange.

## Configuration

**File**: `config/live-logging-config.json`

```json
{
  "session_filter": {
    "enabled": true,
    "bias_threshold": 0.65,
    "window_size": 5
  },
  "embedding_classifier": {
    "enabled": true,
    "similarity_threshold": 0.65,
    "model": "Xenova/all-MiniLM-L6-v2"
  },
  "semantic_analyzer": {
    "enabled": true,
    "provider": "groq",
    "model": "llama-3.3-70b"
  }
}
```

## Key Files

| File | Purpose |
|------|---------|
| `scripts/enhanced-transcript-monitor.js` | Core monitoring process |
| `src/live-logging/ReliableCodingClassifier.js` | 5-layer classification |
| `src/live-logging/ConfigurableRedactor.js` | Security redaction |
| `monitoring/global-monitor-watchdog.js` | System-level watchdog |

## Troubleshooting

### Monitor not starting

```bash
# Check if running
ps aux | grep enhanced-transcript-monitor

# Check health file
cat .health/coding-transcript-monitor-health.json

# Restart via coding command
coding --restart-monitor
```

### LSL files not generated

```bash
# Verify monitor is processing
tail -50 .logs/transcript-monitor-test.log

# Check today's files
ls -la .specstory/history/ | grep "$(date +%Y-%m-%d)"

# Recover from transcripts
PROJECT_PATH=/path/to/project CODING_REPO=/path/to/coding \
  node scripts/batch-lsl-processor.js from-transcripts ~/.claude/projects/-path-to-project
```

### Classification issues

```bash
# Check classification logs
ls -la .specstory/logs/classification/

# Verify config
cat config/live-logging-config.json | jq '.embedding_classifier'
```
