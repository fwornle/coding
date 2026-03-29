# Pitfalls Research

**Domain:** Mastra.ai integration into existing coding agent infrastructure (LSL, multi-agent, Docker services)
**Researched:** 2026-03-28
**Confidence:** MEDIUM-HIGH (combination of verified mastra docs, existing codebase analysis, and known TUI/tmux issues)

## Critical Pitfalls

### Pitfall 1: Dual Storage Backend Divergence (Mastra Memory vs Graphology/LevelDB)

**What goes wrong:**
Mastra's observational memory requires one of three storage backends: `@mastra/pg`, `@mastra/libsql`, or `@mastra/mongodb`. The existing coding system uses Graphology + LevelDB for its knowledge graph. Adding mastra memory creates two parallel persistence layers that can drift out of sync, with observations in mastra's store and entities in Graphology having no referential integrity.

**Why it happens:**
Mastra's storage is purpose-built for its thread/observation model and cannot use arbitrary backends. Developers naturally add mastra's storage alongside the existing one, intending to "bridge them later," but the bridge never gets built or breaks silently.

**How to avoid:**
Use `@mastra/libsql` with a local file (e.g., `.data/mastra-memory/observations.db`) for mastra's storage -- it requires no additional server process and sits alongside the existing LevelDB. Define a clear boundary: mastra owns observations/reflections, the existing pipeline owns knowledge entities. Build a one-directional feed where mastra observations become inputs to the UKB wave-analysis pipeline, not bidirectional sync.

**Warning signs:**
- Observations exist in mastra storage but never appear in the knowledge graph
- UKB pipeline produces entities that contradict mastra's observations
- Two different "memory status" endpoints with no shared view

**Phase to address:**
Phase 1 (foundation) -- storage architecture must be decided before any integration code is written.

---

### Pitfall 2: LSL Verbatim-to-Observation Conversion Loses Actionable Detail

**What goes wrong:**
Mastra's observer compresses messages at 5-40x ratios. When converting existing verbatim LSL transcripts (Claude JSONL, Copilot events.jsonl, OpenCode SQLite) to observations, the compression discards tool call details, file paths, error messages, and exact code snippets that the existing pipeline relies on for knowledge extraction. The UKB wave-analysis pipeline, which currently reads raw transcripts, silently produces shallower entities.

**Why it happens:**
Mastra's observer is optimized for conversational memory -- retaining decisions and key events -- not for code-level forensics. The existing pipeline extracts patterns from exact tool invocations and error traces. These details look "redundant" to the observer but are load-bearing for downstream analysis.

**How to avoid:**
Never replace verbatim LSL with observations as a wholesale swap. Run observations in parallel: keep verbatim logs for the UKB pipeline and generate observations as a separate enrichment layer. For the batch converter (historical .specstory files), produce observations that supplement the original files rather than replacing them. Tag observations with source transcript references so the original can be retrieved.

**Warning signs:**
- Knowledge entities after conversion have fewer observations than before
- Pattern extraction misses tool-use patterns that were previously detected
- Batch converter output is dramatically smaller than input (expected compression) but downstream quality drops

**Phase to address:**
Phase 2 (LSL refactoring) -- the converter must be built with dual-output from day one. Do NOT remove verbatim logging in the same phase as adding observations.

---

### Pitfall 3: Mastra Observer Blocks Conversation During Synchronous Observation

**What goes wrong:**
When unobserved messages hit the token threshold (default 30,000 tokens), the observer compresses them synchronously, blocking the agent conversation. For coding sessions with large tool outputs (file reads, test results, build logs), this threshold is hit quickly and the pause can last 10-30 seconds. Users experience the agent "freezing" mid-conversation.

**Why it happens:**
Mastra shipped async buffering in Feb 2026, but it has known issues: in subagent contexts the async buffer reportedly still blocks, and in resource scope async buffering is automatically disabled. The default configuration runs synchronous observation.

**How to avoid:**
Configure async buffering explicitly with conservative thresholds. For coding sessions (which are tool-heavy and generate large outputs), raise `messageTokens` to 50,000-60,000 and set `bufferTokens` to 0.3 to buffer more aggressively. Test with a real coding session that includes file operations, not just chat. If async buffering shows blocking behavior in the OpenCode plugin context, implement a wrapper that offloads observation to a background Node.js worker thread.

**Warning signs:**
- Agent pauses for several seconds after a burst of tool calls
- Users report the agent "thinking" when they haven't asked a question
- Dashboard shows observation runs taking >5 seconds

**Phase to address:**
Phase 1 (mastra plugin integration) -- must be tuned during initial OpenCode plugin setup, not deferred.

---

### Pitfall 4: pi-tui Mouse/Keyboard Capture Conflicts with tmux Session Wrapper

**What goes wrong:**
Mastracode uses pi-tui for its TUI, which captures mouse events and uses extended keyboard protocols. The existing `coding` launcher runs agents inside tmux via `tmux_session_wrapper`. pi-tui's mouse capture conflicts with tmux's mouse handling -- scroll events get swallowed, copy/paste breaks, and tmux's pipe-pane capture (used for LSL) may receive garbled output or nothing at all from the alternate screen buffer.

**Why it happens:**
TUI frameworks that use the terminal alternate screen buffer (alt-screen) create a separate rendering context that tmux treats differently from the main buffer. When pi-tui requests mouse capture, tmux delivers mouse events to pi-tui instead of processing them as scroll/selection. The `AGENT_ENABLE_PIPE_CAPTURE=true` pattern used by OpenCode expects a simpler text stream, not alt-screen TUI output.

**How to avoid:**
Do NOT enable `AGENT_ENABLE_PIPE_CAPTURE` for mastracode. Instead, capture mastracode's conversation data through mastra's own observation API -- it already has lifecycle hooks (`onObservationStart`, `onObservationEnd`) that can feed the LSL system. For tmux integration, set `set -g mouse off` in the mastracode tmux session or configure pi-tui to disable mouse capture via env var or config flag (check pi-tui docs for `--no-mouse` or equivalent). Test the full flow: `coding --mastra` in tmux, scroll back, copy text, verify statusline updates.

**Warning signs:**
- Cannot scroll in the tmux pane running mastracode
- Copy/paste produces garbage or captures TUI control characters
- LSL pipe-pane capture file is empty or contains ANSI escape sequences instead of text
- Statusline stops updating because it cannot read mastracode's output

**Phase to address:**
Phase 3 (mastracode agent integration) -- must be solved before the agent config (`config/agents/mastra.sh`) is considered complete.

---

### Pitfall 5: Transcript Format Mismatch -- Three Agent Formats Plus a Fourth

**What goes wrong:**
The system already handles three transcript formats (Claude JSONL with v1/v2 variants, Copilot events.jsonl, OpenCode SQLite) via `transcript-formats.json` and per-agent `AGENT_TRANSCRIPT_FMT`. Adding mastracode introduces a fourth format (mastra's own observation/thread storage), but the existing transcript-to-observation converter infrastructure assumes it will receive raw transcripts. Mastracode's output is already partially processed by mastra's memory system, creating a double-observation problem where the converter re-summarizes already-summarized content.

**Why it happens:**
The converter pipeline was designed for "raw transcript in, observations out." Mastracode's conversations are already being observed by mastra's built-in memory. Feeding mastracode's conversation data through the same converter pipeline applies observation twice, further compressing already-compressed content and losing the detail that the first observation pass preserved.

**How to avoid:**
For mastracode, skip the transcript-to-observation converter entirely. Instead, tap mastra's observation API directly to extract the observation log and feed it to the UKB pipeline as pre-processed input. The `config/agents/mastra.sh` should set `AGENT_TRANSCRIPT_FMT="mastra-observations"` (a new format type) and the LSL coordinator should recognize this as "already observed, pass through." Add the format definition to `transcript-formats.json` with a flag like `"preObserved": true`.

**Warning signs:**
- Mastracode observations are much shorter and vaguer than Claude/Copilot observations
- Knowledge entities from mastracode sessions have fewer details than from other agents
- Observation count doubles when running the batch converter on mastracode history

**Phase to address:**
Phase 2 (converters) -- must be designed into the converter architecture, not bolted on after.

---

### Pitfall 6: Observer/Reflector Model Selection Causes Cost Explosion

**What goes wrong:**
Mastra's observer and reflector are background agents that make LLM calls. With the existing system already using multiple LLM providers (Groq, OpenAI, Anthropic, Google, xAI) tracked via BudgetTracker, adding two more background LLM consumers per active session can silently double the token spend. The observer processes every conversation, and for tool-heavy coding sessions it fires frequently.

**Why it happens:**
Mastra defaults to the agent's primary model for observation. If the coding agent uses Claude Opus, the observer also uses Opus at $15/M input tokens to summarize tool outputs that could be handled by a $0.10/M model. The cost is invisible because it happens in background agent calls that don't show up in the main conversation's token count. The existing BudgetTracker in `live-logging-config.json` has no awareness of mastra's internal LLM calls.

**How to avoid:**
Explicitly configure observer and reflector to use cheap, fast models. Use `ModelByInputTokens` to scale: Gemini Flash or GPT-4o-mini for observation, only stepping up to a more capable model for reflection. Add mastra's LLM calls to the BudgetTracker by implementing the lifecycle hooks to report token usage. Set `previousObserverTokens` budget cap (new in March 2026) to prevent observer context from growing unbounded.

**Warning signs:**
- API bills spike after enabling mastra integration
- BudgetTracker shows lower spend than actual provider dashboards
- Observer context grows to dominate prompt size in long sessions

**Phase to address:**
Phase 1 (mastra plugin) -- model selection and cost tracking must be configured at setup, not optimized later.

---

### Pitfall 7: Agent Config Adapter Pattern Breaks with Mastra's Auth Model

**What goes wrong:**
Mastracode uses OAuth login for Anthropic and OpenAI (built into pi-tui), which conflicts with the existing `coding` launcher's API key management via `.env` files and `CODING_TRANSCRIPT_FORMAT`/`CODING_AGENT` environment variables. The existing `agent_pre_launch()` pattern (see `opencode.sh`) sets model config via environment variables, but mastracode manages its own credentials through mastra's credential store.

**Why it happens:**
The `coding` launcher assumes agents accept configuration via environment variables (API keys, model selection, provider URLs). Mastracode's pi-tui handles auth internally with OAuth flows that open a browser. These two auth models collide: the launcher sets `ANTHROPIC_API_KEY` but mastracode ignores it in favor of its own OAuth token. VPN/corporate network detection (`INSIDE_CN`) that switches providers in `agent_pre_launch` has no effect on mastracode's internal provider selection.

**How to avoid:**
In `config/agents/mastra.sh`, implement `agent_pre_launch()` to detect whether mastracode already has cached credentials (check `~/.mastracode/` or equivalent). If credentials exist, skip OAuth. If not, warn the user that first run requires browser auth. For VPN/corporate network scenarios, pre-configure mastra's provider settings to use the corporate endpoint by writing/patching mastra's config file before launch rather than relying on environment variables. Document that `coding --mastra` requires initial interactive setup (cannot be fully headless on first run).

**Warning signs:**
- `coding --mastra` opens a browser unexpectedly during tmux launch
- VPN users connect to external Anthropic API instead of corporate endpoint
- API key rotation in `.env` has no effect on mastracode sessions

**Phase to address:**
Phase 3 (mastracode integration) -- must be solved in the agent config, with a clear first-run vs subsequent-run flow.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Run mastra storage as separate SQLite alongside LevelDB | Fast integration, no schema migration | Two truth sources, no unified query | Acceptable in Phase 1, must define bridge by Phase 2 |
| Skip BudgetTracker integration for mastra LLM calls | Faster initial deployment | Hidden cost growth, budget overruns | Never -- even basic token counting should be in Phase 1 |
| Disable pi-tui mouse capture globally | Quick tmux compatibility fix | Degrades mastracode UX for non-tmux users | Only as interim; make it conditional on tmux detection |
| Keep verbatim LSL and add observations without linking them | Both systems work independently | No way to trace observation back to source | Acceptable in Phase 1 if observation records include source file references |
| Use same model for observer as main agent | Simpler config | 10-50x cost for background summarization | Never for Opus/Sonnet-class models |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| @mastra/opencode plugin | Assuming it works out-of-box with custom OpenCode builds | The plugin hooks into OpenCode's lifecycle -- verify hook points exist in the `coding --opencode` variant; may need patching if OpenCode is customized |
| Mastra storage init | Forgetting to call `init()` on standalone storage | When using mastra storage outside the full Mastra framework, call `init()` explicitly on the store instance before any read/write |
| Observer token thresholds | Using defaults (30k tokens) for coding sessions | Coding sessions hit 30k in minutes due to tool outputs; raise to 50-60k or enable aggressive async buffering |
| Mastra thread scope | Not passing `threadId` to observe() | Missing threadId causes a hard error (by design, to prevent silent data sharing between threads) |
| Resource scope for cross-session memory | Enabling resource scope without prompt engineering | Resource scope is experimental; threads can continue each other's work unless system prompt explicitly prevents this |
| Claude 4.5 as observer model | Selecting Claude 4.5 Sonnet for observer/reflector | Claude 4.5 models reportedly don't work well as observer/reflector -- use GPT-4o-mini or Gemini Flash instead |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Observer context unbounded growth | Long sessions get progressively slower; observer prompt dominates token usage | Set `previousObserverTokens` budget cap (March 2026 feature) | After 2-3 hours of active coding session |
| Synchronous observation on large tool outputs | Agent freezes for 10-30s after file reads or test runs | Enable async buffering, raise messageTokens threshold | When tool outputs exceed 30k tokens in a burst |
| Resource-scope observation across many threads | Observation runs process all threads together, causing multi-second delays | Use thread scope unless cross-session memory is specifically needed | At >10 threads per resource |
| Batch converter processing all historical LSL at once | Memory exhaustion, hours-long processing | Process historical .specstory files in date-range batches; checkpoint progress | At >100 session files |
| Double-observation of mastracode transcripts | Wasted LLM calls, degraded observation quality | Skip converter for mastra-native sessions (preObserved flag) | Immediately upon enabling both systems |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Mastra observations stored in unencrypted SQLite without .gitignore | Observations contain compressed summaries of code discussions including secrets mentioned in conversation | Add mastra storage path to .gitignore; store in `.data/` alongside existing knowledge graph data |
| OAuth tokens cached in home directory | Mastracode's OAuth credentials persist at `~/.mastracode/` accessible to any process | Verify credential storage location; consider moving to system keychain |
| Observer/reflector see full conversation including API keys pasted in chat | Observations may contain compressed but recoverable secrets | Add observation post-processing to redact known secret patterns before storage |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No visibility into observation status | User doesn't know if memory is working or failing silently | Integrate mastra's `memory_status` diagnostic into the existing statusline (tmux status bar shows observation health) |
| Observer compression discards context user thought was remembered | "I told you about X earlier" fails because observer deemed it not important | Provide a `recall` tool that searches original messages, not just observations; document this limitation |
| First-run OAuth flow breaks tmux automation | `coding --mastra` hangs waiting for browser auth in headless tmux | Detect first-run, prompt user before tmux launch, or support pre-auth via CLI flag |
| Mixed agent sessions (switch from Claude to mastra mid-project) | Observations from one agent don't carry over; user repeats context | Use resource-scoped observations so all agents in the same project share memory (but beware experimental status) |

## "Looks Done But Isn't" Checklist

- [ ] **Mastra plugin installed:** Verify `.opencode/mastra.json` exists AND `init()` was called on storage -- missing init is a silent failure
- [ ] **LSL still works after adding observations:** Run `coding --lsl-validate` to confirm verbatim logging is unchanged -- observations should add to, not replace
- [ ] **BudgetTracker tracks mastra calls:** Check that observer/reflector LLM calls appear in the BudgetTracker totals, not just the main agent's calls
- [ ] **Mastracode tmux scroll works:** In the tmux session, press `Ctrl+B [` and scroll up -- if you see garbage or can't scroll, pipe-pane/alt-screen conflict exists
- [ ] **Batch converter handles all 3 formats:** Test converter with Claude JSONL (v1 AND v2), Copilot events.jsonl, AND OpenCode SQLite -- not just one format
- [ ] **Observations survive Docker restart:** Kill coding-services, restart, verify observations persist (storage must be bind-mounted or in persistent volume)
- [ ] **VPN detection works for mastracode:** Run `coding --mastra --dry-run` inside VPN to verify correct provider selection -- OAuth may bypass the env var provider switch

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Storage divergence (mastra vs Graphology) | MEDIUM | Export mastra observations via API, re-import as UKB pipeline input; establish sync bridge going forward |
| Verbatim LSL deleted during observation migration | HIGH | Restore from git (if .specstory is tracked) or backup; revert to dual-output mode |
| Observer blocks causing user frustration | LOW | Raise `messageTokens` threshold immediately; switch to async buffering; restart session |
| tmux/pi-tui incompatibility | LOW | Disable mouse capture in mastra agent config; fall back to non-tmux launch temporarily |
| Double-observation quality degradation | MEDIUM | Add `preObserved` flag to mastra transcript format; rebuild affected knowledge entities from original transcripts |
| Cost overrun from observer model | MEDIUM | Switch observer/reflector to Gemini Flash immediately; audit recent bills; set BudgetTracker alerts |
| OAuth credential conflict | LOW | Clear mastra credential cache; reconfigure with env-var-based auth if available |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Dual storage divergence | Phase 1 (foundation) | Both stores accessible from a single diagnostic endpoint; observations flow to UKB input |
| Verbatim-to-observation data loss | Phase 2 (LSL refactoring) | A/B comparison: knowledge entities from verbatim vs observation input should not lose detail categories |
| Observer blocking | Phase 1 (mastra plugin) | Timed test: 60s of tool-heavy conversation with <2s max pause |
| pi-tui/tmux conflict | Phase 3 (mastracode) | Manual test: scroll, copy, paste, statusline update all work in tmux session |
| Transcript format mismatch | Phase 2 (converters) | Converter correctly identifies and skips mastra-native sessions; no double-observation detected |
| Cost explosion | Phase 1 (mastra plugin) | BudgetTracker reports match provider dashboard within 10% after 24h of usage |
| Auth model conflict | Phase 3 (mastracode) | `coding --mastra --dry-run` succeeds in both VPN and public network without browser popup |

## Sources

- [Mastra Observational Memory Docs](https://mastra.ai/docs/memory/observational-memory) -- architecture, thresholds, limitations
- [Mastra Memory Overview](https://mastra.ai/docs/memory/overview) -- storage backends, configuration patterns
- [@mastra/opencode Plugin PR](https://github.com/mastra-ai/mastra/pull/12925) -- observe() API, lifecycle hooks, breaking changes
- [Mastra Blog: Announcing Observational Memory](https://mastra.ai/blog/observational-memory) -- compression ratios, performance benchmarks
- [Mastra Changelog 2026-03-13](https://mastra.ai/blog/changelog-2026-03-13) -- previousObserverTokens budget cap
- [Mastra Changelog 2026-02-04](https://mastra.ai/blog/changelog-2026-02-04) -- async buffering ship
- [GitHub Issue #14082: OM and AI SDK streaming](https://github.com/mastra-ai/mastra/issues/14082) -- async buffer blocking in subagent context
- [OpenCode Issue #16967: TUI broken in tmux](https://github.com/anomalyco/opencode/issues/16967) -- TUI rendering failures in tmux
- [OpenCode Issue #7926: Mouse capture in multiplexers](https://github.com/anomalyco/opencode/issues/7926) -- mouse capture disabling request
- [Mastra Code Announcement](https://mastra.ai/blog/announcing-mastra-code) -- pi-tui architecture, feature set
- [pi-mono GitHub](https://github.com/badlogic/pi-mono) -- pi-tui framework source
- [Mastra Storage Docs](https://mastra.ai/docs/memory/storage) -- libSQL, pg, mongodb backend details
- Existing codebase: `config/agents/opencode.sh`, `scripts/launch-agent-common.sh`, `config/live-logging-config.json`, `config/transcript-formats.json`

---
*Pitfalls research for: Mastra.ai integration into coding agent infrastructure*
*Researched: 2026-03-28*
