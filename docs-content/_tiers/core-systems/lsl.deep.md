Real-time conversation monitoring and intelligent classification with zero data loss.

![LSL Architecture](../images/lsl-architecture.png)

![Adaptive LSL System](../images/adaptive-lsl-system.png)

## What It Does

- **Real-Time Monitoring** - Captures every coding agent conversation as it happens (Claude Code, Copilot CLI, OpenCode)
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

## Supervision & Recovery

The transcript monitor is managed by a priority-ordered supervisor chain:

| Priority | Supervisor | Role |
|----------|-----------|------|
| 1 | GlobalLSLCoordinator | Primary (per-session, launched by `coding`) |
| 2 | GlobalProcessSupervisor | Fallback (defers when coordinator active) |
| 3 | HealthPromptHook | Safety net (spawns coordinator if GPS exhausted) |

**Self-protection features:**

- **Periodic flush**: Writes accumulated exchanges every 5 minutes during long agent runs
- **Idle timeout with tmux guard**: Stays alive while tmux session exists (prevents restart budget waste)
- **Auto-recovery**: Prompt hook detects LSL down and spawns coordinator (rate-limited 1/min)

## Content Routing

**LOCAL Content** (Project-Specific):

- Stored in: `project/.specstory/history/YYYY/MM/`
- Format: `YYYY-MM-DD_HHMM-HHMM_<userhash>.jsonl`

**CODING Content** (Infrastructure):

- Redirected to: `coding/.specstory/history/YYYY/MM/`
- Format: `YYYY-MM-DD_HHMM-HHMM_<userhash>_from-<project>.jsonl`

Rotation appends a part index before the hash (`…-1_<userhash>.jsonl`). A part
is a *continuation*, not a standalone file — see [Session format](#session-format).

## Session format

Tranches are written as **pi session JSONL** — one JSON entry per line, the
format the `pi` agent reads natively. Only the *serialization* changed: hourly
files, the filename structure, the 5-layer classification, rotation and redirect
handling all behave exactly as before.

![LSL pi format pipeline](../images/lsl-pi-format-pipeline.png)

| Entry | Meaning |
|-------|---------|
| `session` / `session_info` | Tranche header (version 3) |
| `custom` → `lsl.tranche` | Window, date, agent, redirect origin |
| `custom` → `lsl.promptSet` | One user prompt and everything it caused |
| `message` | `user`, `assistant`, `toolResult` |

Every prompt set parents off the tranche spine rather than the previous set, so
removing one drops its whole subtree and nothing else — which is what lets the
monitor re-flush a set in place as a turn grows.

A `lsl.promptSet` carrying `synthesized: true` had its boundaries **inferred**
rather than read: the oldest layout has no prompt-set anchor, so consecutive
blocks were grouped by their repeated `**User Request:**`. The flag marks
structure the markdown never actually recorded.

### Converting the legacy corpus

`scripts/backfill-lsl-to-pi.mjs` converts existing markdown. The unit of work is
a **chain** — an hourly tranche plus its rotation parts — because rotation splits
mid-token: a part can begin inside a JSON fence opened by its predecessor, so it
cannot be parsed alone.

```bash
# Dry run is the DEFAULT — writing requires an explicit --write
node scripts/backfill-lsl-to-pi.mjs --all-history-repos
node scripts/backfill-lsl-to-pi.mjs --all-history-repos --write --commit
```

Safety properties, in the order they matter:

- Each history repo is tagged `pre-pi-format` before anything is touched, so
  `git reset --hard pre-pi-format` reverts a repo completely.
- Markdown is deleted only when git can restore it — a file that is untracked or
  locally modified is kept, whatever else happens.
- Every chain is verified before its markdown is removed. A chain that fails, or
  that converts to **nothing**, is quarantined with its markdown intact and a
  reason written to `.specstory/quarantine/`.
- Not every `.md` yields a `.jsonl`. A part in which no block *starts* belongs to
  its predecessor's blocks; those are recorded in `chain-map.json` as
  `absorbedInto`, so a missing output file is provably accounted for rather than
  merely absent.

Stop the ETM's committer for the duration of a bulk run. It commits the whole
history directory periodically, and will otherwise sweep the conversion into its
own commits — harmless, but it costs the per-month commit granularity that makes
a bad batch revert cleanly.

## Security Redaction

13 pattern types automatically sanitized:

- API keys and tokens
- Passwords and credentials
- URLs with embedded passwords
- Email addresses
- Corporate user IDs

Performance: <5ms overhead per exchange.

Redaction runs on **every** exchange, on the monitor's main thread, and rewrites
content *before* it reaches disk. Two consequences worth knowing:

- **A pathological pattern stops the monitor, without killing it.** A regex whose
  leading character class contains the literal separating it from a following
  class of the same alphabet backtracks catastrophically. `aws_secret_truncated`
  did exactly this: 200 KB redacted in 239 ms, 400 KB never finished. The process
  stayed alive at ~100% CPU, so `ps` and the service health checks looked fine —
  only the heartbeat stopped, and the coordinator marked LSL down after 15 s. See
  [Troubleshooting](#lsl-red-while-the-monitor-is-running).
- **A pattern that is too broad destroys data irreversibly.** Redaction happens at
  write time, so the original never reaches the file and no reader can recover it.
  `aws_secret_standalone` matched any 40-character token, which is exactly the
  shape of a git SHA — commit ids across the corpus read `<AWS_SECRET_REDACTED>`.

Both are fixed. When adding a pattern, bound its quantifiers and check it against
a large input; `tests/live-logging/ConfigurableRedactor.redos.test.js` guards this
with a **time bound** rather than a pattern assertion, so it keeps covering
patterns added later. Note the patterns live in **two** places — the JSON config
and a fallback table inside `ConfigurableRedactor.js` — and fixing one leaves the
other live.

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

## Transcript Sources

The monitor supports three transcript sources, auto-detected per project:

| Source | Format | Agent |
|--------|--------|-------|
| **Claude Code** | `.jsonl` files in `~/.claude/projects/` | Claude Code |
| **Copilot CLI** | `events.jsonl` in `~/.copilot/session-state/` | GitHub Copilot CLI |
| **OpenCode** | SQLite database (`~/.local/share/opencode/opencode.db`) | OpenCode |

All sources are normalized to a common exchange format before processing.

## Key Files

| File | Purpose |
|------|---------|
| `scripts/enhanced-transcript-monitor.js` | Core monitoring process (all 3 transcript sources) |
| `src/live-logging/ReliableCodingClassifier.js` | 5-layer classification |
| `src/live-logging/ConfigurableRedactor.js` | Security redaction |
| `src/live-logging/PiSessionWriter.js` | Emits pi session entries (shared by the monitor and the backfill) |
| `src/live-logging/LslMarkdownParser.js` | Parses the legacy markdown dialects |
| `scripts/backfill-lsl-to-pi.mjs` | Chain-oriented markdown → pi conversion |
| `monitoring/global-monitor-watchdog.js` | System-level watchdog |

## Troubleshooting

### Monitor not starting

```bash
# Check if running
ps aux | grep enhanced-transcript-monitor

# Check ETM heartbeat via coordinator (Phase 33+: .health/*.json files are
# no longer written; coordinator's lsl slice is the source of truth)
curl -fs http://localhost:3034/health/state \
  | jq '.lsl | to_entries | map(select(.key | endswith(":coding")))'

# Restart via coding command
coding --restart-monitor
```

### LSL red while the monitor is running

The statusline shows `[LSL🔴]` and the project letter turns yellow, but the
process is alive and the Health API is green. The monitor is **wedged**, not
crashed — most often in a redaction regex, since that runs on the main thread for
every exchange.

The distinguishing signal is CPU plus a stale heartbeat:

```bash
# Wedged looks like ~100% CPU in state R, with CPU time tracking elapsed time
/bin/ps -eo pid,%cpu,state,etime,time | grep enhanced-transcript-monitor

# The coordinator infers 'stopped' after >15s of heartbeat silence, so a wedged
# monitor reports stopped while ps still shows it running
curl -s localhost:3034/health/state | python3 -c \
  "import json,sys; print(json.load(sys.stdin)['lsl_by_project'])"

# Settle it: look for ArrayForEach -> StringPrototypeReplace -> RegExpReplace
sample <pid> 3
```

Recovery is `kill -9` on the wedged PID followed by
`launchctl kickstart -k gui/$(id -u)/com.coding.etm`; the monitor replays the
backlog it was stuck on. If it re-wedges on the same session, the trigger is
content-dependent (a long base64-like run) — fix the pattern rather than
restarting again.

Contrast with a **crash loop**, where the process is absent and `launchctl list`
shows a non-zero exit — most commonly a missing `node_modules/@fwornle/km-core`
symlink.

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
