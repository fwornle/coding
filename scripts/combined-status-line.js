#!/usr/bin/env node

/**
 * Combined Status Line: Constraint Monitor + Semantic Analysis
 * 
 * Shows status of both live guardrails and semantic analysis services
 */

import fs, { readFileSync, writeFileSync, existsSync } from 'fs';
import path, { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { getTimeWindow, getShortTimeWindow } from './timezone-utils.js';
import { lslListAll } from './lsl-paths.js';
import { UKBProcessManager } from './ukb-process-manager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = process.env.CODING_REPO || join(__dirname, '..');

// Identity passthrough. tmux right-aligns status-right against the pane's
// actual right edge on its own; any trailing characters we add (spaces,
// NBSP, anything) become the right-most cells and push our content left.
// Verified empirically by appending NBSPs and watching the time string
// shift one cell leftward per NBSP added.
//
// Earlier versions of this function did codepoint-targeted padding and
// added an "anti-strip" NBSP terminator. Both were attempts to mask a
// separate bug -- residue from previous wider renders persisting in the
// status-right area when content shrank between renders. The actual fix
// for that residue is the per-pane cache key
// (combined-status-line-cache-<project>-w<paneWidth>.txt) plus stopping
// from emitting trailing whitespace; once those landed, the padding became
// unnecessary and actually counter-productive.
//
// A residual 1-2 cell gap between the visible content and the pane's
// actual right edge remains. Mechanism unidentified -- not status-right-length,
// not status-justify, not window-status-separator. Likely tmux's internal
// margin around `#[range=right]`. The cells are empty (no stale text).
function padStatusLine(str) {
  return String(str);
}

// Visible-cell count for a status-line string. Treats tmux style markers
// (#[fg=...] etc.) as zero-width, drops zero-width combining characters,
// and — critically — counts emoji at TWO cells, matching what tmux and
// macOS/iTerm terminals actually render.
//
// Previous version counted every codepoint as 1 cell, which under-counted
// emoji width by a factor of two. With ~6 emojis in the status line that
// adds up to a ~6-12 cell deficit: the padder thinks the content is short
// and adds fewer leading spaces than needed, so the rendered line is wider
// than the pane and content gets pushed away from the right edge. Phase
// 34-05's [🧠] badge pushed this past the visible-drift threshold.
function visibleCellWidth(s) {
  const stripped = String(s).replace(/#\[[^\]]*\]/g, '');
  // Codepoint-by-codepoint iteration with VS16 lookahead — needed because
  // U+FE0F (emoji variation selector) following an Ambiguous-Width base
  // codepoint promotes it to 2-cell emoji presentation in xterm.js / tmux,
  // even though the base codepoint alone would render as 1 cell. Without
  // the lookahead, "⚠" was counted at 1 cell while terminals actually
  // rendered "⚠️" (with VS16) at 2 cells — a 1-cell drift per occurrence
  // and the direct cause of the "07:538" / "07:054" trailing-digit residue.
  const chars = [...stripped];
  let width = 0;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const cp = ch.codePointAt(0);
    if (cp == null) continue;
    if (cp === 0xFE0F) continue;                          // emoji variation selector (consumed below via lookahead)
    if (cp >= 0x0300 && cp <= 0x036F) continue;           // combining diacriticals
    if (cp >= 0x200B && cp <= 0x200D) continue;           // ZWSP / ZWNJ / ZWJ

    // Lookahead for VS16 (U+FE0F): forces emoji presentation = 2 cells.
    const nextCp = i + 1 < chars.length ? chars[i + 1].codePointAt(0) : null;
    const hasVS16 = nextCp === 0xFE0F;

    // East Asian Width "Ambiguous" codepoints: tmux + xterm in a non-East-
    // Asian locale count these as 1 cell (NOT 2) despite their wide
    // visual rendering. Hand-picked from this script's emoji repertoire.
    // The original Wide-range catch-all below treated them as 2 cells,
    // which over-counted by 1 cell per occurrence and produced the
    // recurring trailing-residue artifact ("13:32865", "14:2625"):
    // tmux's cell-clear math used its own (smaller) wcwidth so cells the
    // script thought it was covering were left exposed from the
    // previous render. Peeling Ambiguous off Wide brings the two counts
    // back into agreement.
    //
    // Exception: if VS16 follows, emoji-presentation is forced — count 2.
    // To add new codepoints here, verify their EAW class via
    // https://www.unicode.org/Public/UCD/latest/ucd/EastAsianWidth.txt
    // AND confirm tmux's actual rendering in this user's terminal.
    const isAmbiguousNarrow =
      cp === 0x26A0 ||                                    // ⚠ warning sign
      cp === 0x2699 ||                                    // ⚙ gear
      cp === 0x23F8 ||                                    // ⏸ pause
      cp === 0x2501;                                      // ━ heavy horizontal
    if (isAmbiguousNarrow) {
      width += hasVS16 ? 2 : 1;
      continue;
    }

    // Confirmed EAW=Wide ranges. The 0x2600-0x27BF block contains both
    // Wide (✅⚫❌❗❓🚫) and Ambiguous (⚠⚙) codepoints — the explicit
    // Ambiguous list above peels off the latter before this catch-all.
    const isWide =
      (cp >= 0x1F300 && cp <= 0x1FAFF) ||   // misc pictographs, emoticons, symbols & pictographs ext-A
      (cp >= 0x2600  && cp <= 0x27BF)  ||   // misc symbols + dingbats (✅⚫❌)
      (cp >= 0x2300  && cp <= 0x23FF)  ||   // misc technical (⏰⏳)
      (cp >= 0x1F000 && cp <= 0x1F2FF) ||   // mahjong/domino/playing-card + enclosed alphanum
      (cp >= 0x1F680 && cp <= 0x1F6FF);     // transport & map symbols
    width += isWide ? 2 : 1;
  }
  return width;
}

// Left-pad a status-line payload with regular spaces so tmux always allocates
// the same number of cells for status-right, regardless of payload length.
//
// Why this is needed: tmux does NOT auto-clear cells when status-right content
// shrinks render-to-render. If a previous render filled N cells and the next
// render fills N-K cells, the rightmost K cells of the previous render leak
// through. This is the mechanism behind the "shifted left + leftover
// characters" bug, observed acutely when a transient SYS:ERR / SYS:TIMEOUT
// fallback (~10 cells) replaced the normal ~100-130 cell render. tmux's known
// limitation, not a producer bug; the only way to suppress it without
// patching tmux is to keep the producer's output cell-count constant.
//
// Padding is LEADING because trailing whitespace in tmux #(...) substitutions
// is stripped (and any non-stripped trailing chars push our content one cell
// leftward — see padStatusLine commentary above).
//
// Target cells: TMUX_PANE_WIDTH if available, else 200 (the
// status-right-length cap configured by tmux-session-wrapper.sh:49). tmux
// truncates content longer than status-right-length from the LEFT, so an
// over-pad never eats into the visible right-anchored content.
function leftPadToStableCellWidth(text, paneWidth) {
  const target = parseInt(paneWidth, 10) || 200;
  if (target <= 0) return text;
  const cur = visibleCellWidth(text);
  if (cur >= target) return text;
  return ' '.repeat(target - cur) + text;
}

// Load configuration
let config = {};
try {
  const configPath = join(rootDir, 'config', 'live-logging-config.json');
  if (existsSync(configPath)) {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  }
} catch (error) {
  console.error('Warning: Could not load configuration, using defaults');
}

class CombinedStatusLine {
  constructor() {
    this.cacheTimeout = config.status_line?.cache_timeout || 5000;
    this.lastUpdate = 0;
    this.statusCache = null;
    this.currentSessionId = null;
    this.config = config;

    // Agent type display configuration: icon prefix and tmux color for each agent type
    // Used in session display to visually distinguish which agent is active per project
    this.agentDisplay = {
      claude:   { prefix: '',  color: '' },           // Default (no prefix for claude — most common)
      opencode: { prefix: 'oc:', color: '' },          // OpenCode sessions
      copilot:  { prefix: 'cp:', color: '' },          // Copilot sessions
      mastra:   { prefix: '#[fg=colour13]M#[fg=default]:', color: 'colour13' }  // Mastra: magenta diamond
    };
  }

  async generateStatus() {
    try {
      const now = Date.now();
      if (this.statusCache && (now - this.lastUpdate) < this.cacheTimeout) {
        return this.statusCache;
      }

      // Per-step timing — stamped on `this` so the SYS:TIMEOUT handler can
      // dump it to .logs/csl-failures.jsonl. Without this, every timeout
      // was a black box ("why did it fire? no record anywhere").
      this._stepTimings = [];
      const timeStep = async (name, fn) => {
        const t0 = Date.now();
        this._lastStartedStep = name;
        try {
          const v = await fn();
          this._stepTimings.push({ name, ms: Date.now() - t0, ok: true });
          return v;
        } catch (e) {
          this._stepTimings.push({ name, ms: Date.now() - t0, ok: false, err: e.message });
          throw e;
        }
      };

      const constraintStatus      = await timeStep('constraint',      () => this.getConstraintStatus());
      const semanticStatus        = await timeStep('semantic',        () => this.getSemanticStatus());
      const knowledgeStatus       = await timeStep('knowledge',       () => this.getKnowledgeSystemStatus());
      const proxyStatus           = await timeStep('proxy',           () => this.getProxySystemStatus());
      const liveLogTarget         = await timeStep('liveLogTarget',   () => this.getCurrentLiveLogTarget());
      const redirectStatus        = await timeStep('redirect',        () => this.getRedirectStatus());
      const globalHealthStatus    = await timeStep('globalHealth',    () => this.getGlobalHealthStatus());
      const healthVerifierStatus  = await timeStep('healthVerifier',  () => this.getHealthVerifierStatus());
       const ukbStatus             = this.getUKBStatus();
       const networkStatus         = await timeStep('network',         () => this.getNetworkStatus());

       // Phase 33 plan 07: launchd's com.coding.health-coordinator KeepAlive
       // is the authoritative supervisor for the host-side health stack;
       // combined-status-line is purely display-only post-cutover. The
       // legacy ensure*Running spawn paths and the GPS heartbeat probe were
       // removed along with the four legacy daemons.

       const status = await this.buildCombinedStatus(constraintStatus, semanticStatus, knowledgeStatus, proxyStatus, liveLogTarget, redirectStatus, globalHealthStatus, healthVerifierStatus, ukbStatus, networkStatus);

      this.statusCache = status;
      this.lastUpdate = now;

      return status;
    } catch (error) {
      // CRITICAL: Log the actual error so we can debug!
      console.error(`ERROR in generateStatus: ${error.message}`);
      console.error(error.stack);
      return this.getErrorStatus(error);
    }
  }

  calculateTimeRemaining(sessionTimeRange) {
    if (!sessionTimeRange) return null;
    
    const match = sessionTimeRange.match(/(\d{2})(\d{2})-(\d{2})(\d{2})/);
    if (!match) return null;
    
    const [, startHour, startMin, endHour, endMin] = match;
    const now = new Date();
    const currentHour = now.getHours();
    const currentMin = now.getMinutes();
    
    // Calculate end time for today
    const endTime = new Date();
    endTime.setHours(parseInt(endHour), parseInt(endMin), 0, 0);
    
    // Calculate remaining minutes
    const currentTime = new Date();
    currentTime.setHours(currentHour, currentMin, 0, 0);
    
    const remainingMs = endTime.getTime() - currentTime.getTime();
    const remainingMinutes = Math.floor(remainingMs / (1000 * 60));
    
    return remainingMinutes;
  }

  async getCurrentLiveLogTarget() {
    try {
      // 1. Calculate current time tranche using the same timezone utilities as LSL
      const now = new Date();
      // JavaScript Date already returns local time when using getHours()
      const currentTranche = getShortTimeWindow(now); // Use short format for status line display
      
      if (process.env.DEBUG_STATUS) {
        console.error(`DEBUG: UTC time: ${now.getUTCHours()}:${now.getUTCMinutes()}`);
        console.error(`DEBUG: Local time (CEST): ${now.getHours()}:${now.getMinutes()}`);
        console.error(`DEBUG: Current tranche calculated: ${currentTranche}`);
      }
      
      // 2. Look for current tranche session files in BOTH coding and target project
      const today = new Date().toISOString().split('T')[0];
      const targetProject = process.env.TRANSCRIPT_SOURCE_PROJECT || process.cwd();
      const checkDirs = [
        join(rootDir, '.specstory/history'),           // Coding repo
        join(targetProject, '.specstory/history')      // Target project
      ];
      
      // Look specifically for current tranche session files (recurse YYYY/MM)
      for (const historyDir of checkDirs) {
        if (existsSync(historyDir)) {
          // Convert short format back to full format for file matching
          const fullTranche = getTimeWindow(now);
          const allMatching = lslListAll(historyDir, (name) =>
            name.includes(today) && name.endsWith('.md')
          );

          if (process.env.DEBUG_STATUS) {
            console.error(`DEBUG: Checking directory: ${historyDir}`);
            console.error(`DEBUG: All files in ${historyDir} matching today:`, allMatching.map(p => path.basename(p)));
          }

          const currentTrancheFiles = allMatching.filter(p => {
            const name = path.basename(p);
            return name.includes(fullTranche) && name.includes('session');
          });
          
          if (process.env.DEBUG_STATUS) {
            console.error(`DEBUG: Looking for files with: ${today} AND ${fullTranche} AND session.md`);
            console.error(`DEBUG: Found current tranche files:`, currentTrancheFiles);
          }
          
          if (currentTrancheFiles.length > 0) {
            // Found current tranche session file - calculate time remaining
            const remainingMinutes = this.calculateTimeRemaining(fullTranche);
            
            if (process.env.DEBUG_STATUS) {
              console.error(`DEBUG: Found current tranche file, remaining minutes: ${remainingMinutes}`);
            }
            
            if (remainingMinutes !== null && remainingMinutes <= 5 && remainingMinutes > 0) {
              return `🟠${currentTranche}-session(${remainingMinutes}min)`;
            } else if (remainingMinutes !== null && remainingMinutes <= 0) {
              return `🔴${currentTranche}-session(ended)`;
            } else {
              return `${currentTranche}-session`;
            }
          }
        }
      }
      
      // 3. No current tranche file found - show current time window with status
      // We should always show the current time window, not fall back to old sessions
      const fullTranche = getTimeWindow(now);
      const remainingMinutes = this.calculateTimeRemaining(fullTranche);
      
      if (process.env.DEBUG_STATUS) {
        console.error(`DEBUG: No session file for current tranche, showing time window with ${remainingMinutes} min remaining`);
      }
      
      if (remainingMinutes !== null && remainingMinutes <= 5 && remainingMinutes > 0) {
        return `🟠${currentTranche}(${remainingMinutes}min)`;
      } else if (remainingMinutes !== null && remainingMinutes <= 0) {
        return `🔴${currentTranche}(ended)`;
      } else {
        return `${currentTranche}`;
      }
      
      // 2. Check current transcript to predict target filename
      const os = await import('os');
      const homeDir = os.homedir();
      // Create transcript directory path based on current coding repo location
      const codingRepo = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || rootDir;
      const transcriptDirName = `-${codingRepo.replace(/[^a-zA-Z0-9]/g, '-')}`;
      const transcriptDir = join(homeDir, '.claude', 'projects', transcriptDirName);
      
      if (existsSync(transcriptDir)) {
        const files = fs.readdirSync(transcriptDir)
          .filter(file => file.endsWith('.jsonl'))
          .map(file => {
            const filePath = join(transcriptDir, file);
            const stats = fs.statSync(filePath);
            return { file, mtime: stats.mtime, size: stats.size };
          })
          .sort((a, b) => b.mtime - a.mtime);
        
        if (files.length > 0) {
          const mostRecent = files[0];
          const timeDiff = Date.now() - mostRecent.mtime.getTime();
          
          if (timeDiff < 600000) { // 10 minutes = active session
            // Show what the target live log filename would be
            const uuid = mostRecent.file.replace('.jsonl', '');
            const shortUuid = uuid.substring(0, 8);
            const now = new Date();
            const time = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
            
            if (process.env.DEBUG_STATUS) {
              console.error(`Active transcript: ${mostRecent.file}, target: ${time}_${shortUuid}_live-session.md`);
            }
            
            return `${time}_${shortUuid}`;
          }
        }
      }
      
      // 3. Generate expected target filename based on current time
      const currentTime = new Date();
      const timeId = `${String(currentTime.getHours()).padStart(2, '0')}${String(currentTime.getMinutes()).padStart(2, '0')}`;
      return timeId + '_TBD';
      
    } catch (error) {
      return '----';
    }
  }

  /**
   * Shared coordinator state probe. Five badge checks all need
   * GET /health/state — without memoization they each fire their own
   * synchronous curl, which under load (or during a tmux probe storm)
   * each hits the 2s --max-time ceiling and adds up to a SYS:TIMEOUT.
   * Memoizing on the instance collapses 5 probes into 1 per render.
   * (A fresh CombinedStatusLine is constructed per CSL run, so the
   * memo never lives longer than one render.)
   *
   * Uses node's fetch (not execSync curl) to skip the subprocess-spawn
   * cost. One retry on failure (~200ms delay) so a single transient
   * slow response doesn't cascade every coordinator-derived badge to
   * its "unreachable" state — that cascade produced jarring visual
   * oscillations (🏥⚠️ LSL🔴 📚❌ 🧠❌ flipping back to all-green
   * between renders).
   */
  async getCoordinatorState() {
    if (this._coordStatePromise) return this._coordStatePromise;
    this._coordStatePromise = (async () => {
      const url = process.env.HEALTH_COORDINATOR_URL || 'http://localhost:3034';
      const PER_ATTEMPT_MS = 1500;
      const RETRY_DELAY_MS = 150;
      let lastErr;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const r = await fetch(`${url}/health/state`, {
            signal: AbortSignal.timeout(PER_ATTEMPT_MS)
          });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return { ok: true, state: await r.json() };
        } catch (error) {
          lastErr = error;
          if (attempt < 2) {
            await new Promise(res => setTimeout(res, RETRY_DELAY_MS));
          }
        }
      }
      return { ok: false, error: lastErr?.message || 'unknown' };
    })();
    return this._coordStatePromise;
  }

  /**
   * Whether ANY tracked Claude session has a fresh LSL heartbeat (<5 min).
   * Used to discriminate "actually broken" from "user just walked away" so
   * coordinator-derived badges can show idle (⚫) instead of warning (⚠️/🔴)
   * when no observation activity is expected.
   */
  async isUserActive() {
    if (this._userActivePromise) return this._userActivePromise;
    this._userActivePromise = (async () => {
      const result = await this.getCoordinatorState();
      if (!result.ok) return false;
      const lsl = result.state.lsl || {};
      const FRESH_MS = 5 * 60 * 1000;
      const now = Date.now();
      return Object.values(lsl).some(entry => {
        if (!entry || entry.status === 'stopped') return false;
        const lastBeat = entry.lastBeat || 0;
        return lastBeat > 0 && (now - lastBeat) < FRESH_MS;
      });
    })();
    return this._userActivePromise;
  }

  /**
   * Freshest project-activity age (ms) across all tracked projects, derived
   * from the coordinator's `lsl[*].transcriptPath` mtime — the same signal
   * that drives the per-project activity bubbles. Used to map coordinator
   * "stale obs" verdicts onto the bubble lifecycle (🟢/🟠/🟤/⚫/💤) so a
   * cooling-down project doesn't fire a yellow alarm on the [📚] badge.
   * Returns null when no project has any observable signal.
   */
  async _freshestProjectActivityAgeMs() {
    if (this._freshestActivityAgePromise) return this._freshestActivityAgePromise;
    this._freshestActivityAgePromise = (async () => {
      const result = await this.getCoordinatorState();
      if (!result.ok) return null;
      const lslEntries = Object.values(result.state.lsl || {});
      let freshest = null;
      const now = Date.now();
      for (const entry of lslEntries) {
        if (!entry?.transcriptPath) continue;
        try {
          const age = now - fs.statSync(entry.transcriptPath).mtimeMs;
          if (freshest === null || age < freshest) freshest = age;
        } catch { /* skip unreadable paths */ }
      }
      return freshest;
    })();
    return this._freshestActivityAgePromise;
  }

  /**
   * Check LSL transcript monitor health for the CURRENT pane.
   *
   * Lookup precedence in coordinator state:
   *   1. (tmuxPane, project) — strongest, per-pane.
   *   2. (session_id, project) — when ETM and statusline share CLAUDE_SESSION_ID.
   *   3. (project) — any heartbeat for this project. Required because the
   *      ETM is a project-level singleton: when launched by a parent shell
   *      it tags heartbeats with its own session id (e.g. etm-PID-TS) and
   *      its own TMUX_PANE (or null), neither of which match a pane that
   *      attached later. Without this fallback the badge spuriously goes
   *      red even when the project is being monitored healthily.
   */
  async getLSLHealthStatus() {
    const sid = process.env.CLAUDE_SESSION_ID || process.env.SESSION_ID;
    const cwd = process.env.TRANSCRIPT_SOURCE_PROJECT
      || process.env.TMUX_PANE_PATH
      || process.cwd();
    const myProject = path.basename(cwd);
    const myTmuxPane = process.env.TMUX_PANE || null;
    const result = await this.getCoordinatorState();
    if (!result.ok) return 'down';
    const state = result.state;
    const evaluate = (entry) => {
      if (!entry) return null;
      if (entry.status === 'stopped') return 'down';
      // ETM emits status='degraded' when isSuspiciousActivity fires
      // (0 exchanges processed in >30 min uptime). The process is alive but
      // the pipeline is stalled — no LSL files, no observations. Surface
      // that as 'stale' so the badge actually warns instead of pretending
      // green just because the heartbeat is fresh.
      if (entry.status === 'degraded') return 'stale';
      const ageMs = Date.now() - (entry.lastBeat || 0);
      if (ageMs > 120_000) return 'stale';
      return 'healthy';
    };
    // Strongest signal: an entry pinned to THIS pane. If found, trust it
    // exclusively — pane-level distinctions matter (e.g. a dead pane
    // shouldn't go green just because a sibling pane is alive).
    if (myTmuxPane && myProject) {
      const e = Object.values(state.lsl || {}).find(x =>
        x && x.tmuxPane === myTmuxPane && x.projectName === myProject
      );
      if (e) return evaluate(e);
    }
    // Otherwise aggregate across all entries for this project. A stopped
    // ghost (e.g. an old ETM that the coordinator marked stopped after >15s
    // silence) shouldn't drag the badge red when a fresh ETM is heartbeating
    // for the same project. Take the best verdict.
    if (myProject) {
      const verdicts = Object.values(state.lsl || {})
        .filter(x => x && x.projectName === myProject)
        .map(evaluate)
        .filter(Boolean);
      if (verdicts.includes('healthy')) return 'healthy';
      if (verdicts.includes('stale')) return 'stale';
      if (verdicts.length > 0) return 'down';
    }
    return 'down';
  }

  async getConstraintStatus() {
    try {
      // Check if constraint monitor is running
      const servicesPath = join(rootDir, '.services-running.json');
      if (!existsSync(servicesPath)) {
        return { status: 'offline', compliance: 0, violations: 0 };
      }

      const services = JSON.parse(readFileSync(servicesPath, 'utf8'));
      const cmStatus = services.constraint_monitor;

      // If services file shows degraded, verify with actual API
      if (!cmStatus || cmStatus.status !== '✅ FULLY OPERATIONAL') {
        try {
          // Direct API health check to see if service has recovered
          const apiCheck = execSync('curl -s http://localhost:3031/api/health 2>/dev/null', {
            timeout: 2000,
            encoding: 'utf8'
          });
          const apiHealth = JSON.parse(apiCheck);

          if (apiHealth.status === 'healthy' && apiHealth.enforcement?.healthy) {
            // Service recovered - update the stale file
            services.constraint_monitor = {
              status: '✅ FULLY OPERATIONAL',
              dashboard_port: 3030,
              api_port: 3031,
              health: 'healthy',
              last_check: new Date().toISOString()
            };
            writeFileSync(servicesPath, JSON.stringify(services, null, 2));
            // Continue to get detailed status below
          } else {
            return { status: 'degraded', compliance: 0, violations: 0 };
          }
        } catch (apiError) {
          return { status: 'degraded', compliance: 0, violations: 0 };
        }
      }

      // Get detailed constraint status
      const constraintScript = join(rootDir, 'integrations/mcp-constraint-monitor/src/status/constraint-status-line.js');
      const result = execSync(`node "${constraintScript}"`, { 
        timeout: 3000, 
        encoding: 'utf8' 
      });
      
      const constraintData = JSON.parse(result);
      
      // Extract actual compliance score from the text if possible
      let actualCompliance = 8.5;
      const complianceMatch = constraintData.text.match(/🔒\s*(\d+\.?\d*)/);
      if (complianceMatch) {
        actualCompliance = parseFloat(complianceMatch[1]);
      }
      
      return { 
        status: 'operational', 
        text: constraintData.text,
        compliance: actualCompliance,
        violations: (() => {
          const violationMatch = constraintData.text.match(/⚠️\s*(\d+)/);
          return violationMatch ? parseInt(violationMatch[1]) : 0;
        })(),
        rawData: constraintData
      };
    } catch (error) {
      return { status: 'offline', compliance: 0, violations: 0, error: error.message };
    }
  }

  async getSemanticStatus() {
    try {
      // Check MCP semantic analysis connection
      const servicesPath = join(rootDir, '.services-running.json');
      let services = null;
      let needsRegeneration = false;

      if (!existsSync(servicesPath)) {
        needsRegeneration = true;
      } else {
        try {
          services = JSON.parse(readFileSync(servicesPath, 'utf8'));
          // Check for required semantic_analysis field
          if (!services.semantic_analysis) {
            needsRegeneration = true;
          }
        } catch (parseError) {
          needsRegeneration = true;
        }
      }

      // Self-healing: Regenerate the file if missing or invalid
      if (needsRegeneration) {
        services = await this.regenerateServicesFile();
        if (!services) {
          return { status: 'offline' };
        }
      }

      // Check semantic_analysis object (not in services array because it uses stdio transport)
      const semanticAnalysis = services.semantic_analysis;

      if (semanticAnalysis && semanticAnalysis.health === 'healthy') {
        return { status: 'operational' };
      } else if (semanticAnalysis) {
        return { status: 'degraded' };
      } else {
        return { status: 'offline' };
      }
    } catch (error) {
      return { status: 'offline', error: error.message };
    }
  }

  /**
   * Self-healing: Regenerate .services-running.json from health checks
   * Called when the file is missing or invalid
   */
  async regenerateServicesFile() {
    try {
      const servicesPath = join(rootDir, '.services-running.json');

      // Check which services are healthy
      const vkbHealthy = await this.checkHttpHealth('http://localhost:8080/health');
      const constraintHealthy = await this.checkHttpHealth('http://localhost:3031/api/health');
      const healthApiHealthy = await this.checkHttpHealth('http://localhost:3033/api/health');

      const servicesRunning = [];
      if (vkbHealthy) servicesRunning.push('vkb-server');
      if (constraintHealthy) servicesRunning.push('constraint-monitor');
      if (healthApiHealthy) servicesRunning.push('health-verifier');

      const status = {
        timestamp: new Date().toISOString(),
        services: servicesRunning,
        services_running: servicesRunning.length,
        constraint_monitor: {
          status: constraintHealthy ? '✅ FULLY OPERATIONAL' : '⚠️ DEGRADED MODE',
          dashboard_port: 3030,
          api_port: 3031,
          health: constraintHealthy ? 'healthy' : 'degraded',
          last_check: new Date().toISOString()
        },
        semantic_analysis: {
          status: '✅ OPERATIONAL',
          health: 'healthy'  // MCP via stdio - healthy if Claude session is active
        },
        vkb_server: {
          status: vkbHealthy ? '✅ OPERATIONAL' : '⚠️ DEGRADED',
          port: 8080,
          health: vkbHealthy ? 'healthy' : 'degraded',
          last_check: new Date().toISOString()
        },
        system_health_dashboard: {
          status: healthApiHealthy ? '✅ OPERATIONAL' : '⚠️ DEGRADED',
          dashboard_port: 3032,
          api_port: 3033,
          health: healthApiHealthy ? 'healthy' : 'degraded',
          last_check: new Date().toISOString()
        }
      };

      writeFileSync(servicesPath, JSON.stringify(status, null, 2));
      return status;
    } catch (error) {
      return null;
    }
  }

  /**
   * Helper: Check HTTP health endpoint
   */
  async checkHttpHealth(url) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);

      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal
      });

      clearTimeout(timeout);
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  async getKnowledgeSystemStatus() {
    // Phase A replacement (2026-05-09): the legacy
    // .health/<project>-transcript-monitor-health.json file stopped being
    // written at the Phase 33 cutover (the ETM POSTs heartbeats now), so
    // the [📚] badge had been frozen at ❌ for months. New source of truth
    // is the coordinator's `knowledge_pipeline` slice — observation /
    // digest / insight freshness derived from the obs_api consolidation
    // status endpoint. See health-coordinator.js:pollKnowledgePipeline.
    const result = await this.getCoordinatorState();
    if (!result.ok) return { status: 'unreachable', reason: result.error };
    const kp = result.state.knowledge_pipeline;
    if (!kp || !kp.status) {
      return { status: 'unreachable', reason: 'no knowledge_pipeline slice in /health/state' };
    }
    return {
      status: kp.status,
      lastObservationAt: kp.lastObservationAt,
      lastDigestAt: kp.lastDigestAt,
      lastInsightAt: kp.lastInsightAt,
      obsAgeMs: kp.obsAgeMs,
      digAgeMs: kp.digAgeMs,
      insAgeMs: kp.insAgeMs,
      totals: kp.totals,
      inflight: kp.inflight,
      reason: kp.reason
    };
  }

  async getProxySystemStatus() {
    // Phase 34 (D-12): the coordinator publishes proxy semantic-readiness +
    // networkMode + auto_heal_status under state.proxy. This drives the
    // [🧠] badge. See health-coordinator.js:pollProxySemantic +
    // evaluateAutoHealFSM (Plan 34-02 + 34-03).
    const result = await this.getCoordinatorState();
    if (!result.ok) return { status: 'unreachable', reason: result.error };
    const p = result.state.proxy;
    if (!p) {
      return { status: 'unreachable', reason: 'no proxy slice in /health/state' };
    }
    // Map (semantic_ok, semantic_strong_ok, auto_heal_status) → 7-state enum.
    // 3b: 'partial' is new — cheap haiku/copilot probe OK, but the configured
    // semantic pipeline (typically observation-writer's claude-code/sonnet)
    // is failing. Renders amber; cheap probe failure still shows red.
    let status;
    if (p.auto_heal_status === 'disabled') status = 'disabled';
    else if (p.auto_heal_status === 'cooldown') status = 'cooling';
    else if (p.semantic_ok === null) status = 'unknown';
    else if (p.semantic_ok !== true) status = 'degraded';
    else if (p.semantic_strong_ok === false) status = 'partial'; // 3b
    else status = 'healthy';
    return {
      status,
      semantic_ok: p.semantic_ok,
      semantic_strong_ok: p.semantic_strong_ok,
      networkMode: p.networkMode,
      auto_heal_status: p.auto_heal_status,
      kickstart_count: p.kickstart_count,
      reason: p.reason,
      semantic_strong_reason: p.semantic_strong_reason,
    };
  }

  async getNetworkStatus() {
    // Network environment detection from health coordinator.
    // Drives [N:...] and [P:...] badges in the statusline.
    const result = await this.getCoordinatorState();
    if (!result.ok) return { location: 'unknown', proxy_running: false, proxy_functional: false, internet_reachable: false };
    const n = result.state.network;
    if (!n) return { location: 'unknown', proxy_running: false, proxy_functional: false, internet_reachable: false };
    return n;
  }

  async getHealthVerifierStatus() {
    // Plan 33-04 retired host-side daemon writes to .health/verification-status.json;
    // the coordinator at :3034 is now the SoT. Read from there and synthesize
    // the verifier-shape fields the badge logic expects.
    const result = await this.getCoordinatorState();
    if (!result.ok) return { status: 'error', error: result.error };
    const state = result.state;

    const generatedAt = state.generated_at ? new Date(state.generated_at).getTime() : 0;
    const age = generatedAt ? (Date.now() - generatedAt) : Infinity;
    if (age > 180_000) {
      return { status: 'stale', lastUpdate: state.generated_at };
    }

    const services = state.services || [];
    const downServices = services.filter(s =>
      s && s.status && s.status !== 'running' && s.status !== 'unknown'
    );
    const dbStatus = state.databases?.status;
    const containerOk = !state.container?.healthcheck
      || state.container.healthcheck === 'healthy';

    const criticalCount = downServices.length
      + (dbStatus && dbStatus !== 'healthy' && dbStatus !== 'unknown' ? 1 : 0)
      + (containerOk ? 0 : 1);
    const overallStatus = criticalCount === 0 ? 'healthy' : 'degraded';

    return {
      status: 'operational',
      overallStatus,
      criticalCount,
      violationCount: 0,
      autoHealingActive: false,
      lastUpdate: state.generated_at
    };
  }

  /**
   * Get UKB (Update Knowledge Base) process status
   * Shows running/stale/frozen 13-agent workflows
   */
  getUKBStatus() {
    try {
      const ukbManager = new UKBProcessManager();
      const summary = ukbManager.getStatusSummary();

      return {
        status: summary.total > 0 ? 'active' : 'idle',
        running: summary.running,
        stale: summary.stale,
        frozen: summary.frozen,
        total: summary.total
      };
    } catch (error) {
      if (process.env.DEBUG_STATUS) {
        console.error(`DEBUG: UKB status check failed: ${error.message}`);
      }
      return { status: 'error', running: 0, stale: 0, frozen: 0, total: 0 };
    }
  }

  async getGlobalHealthStatus() {
    try {
      // Phase 33: source of truth for sessions/GCM is the coordinator
      // (`http://localhost:3034/health/state`), replacing the legacy
      // `.logs/statusline-health-status.txt` written by a host daemon that
      // no longer exists. Output shape is preserved unchanged so the
      // downstream Sessions Display rendering (per-project labels with
      // active-pane underline) works as before.
      const coord = await this.getCoordinatorState();
      if (!coord.ok) {
        return {
          status: 'error',
          gcm: { icon: '❌', status: 'error' },
          sessions: {},
          guards: { icon: '❌', status: 'error' }
        };
      }
      const state = coord.state;

      const result = {
        status: 'operational',
        gcm: { icon: '✅', status: 'healthy' },
        sessions: {},
        guards: { icon: '✅', status: 'healthy' }
      };

      // Map coordinator's lsl_by_project rollup → sessions map keyed by
      // full project name. For healthy ETMs, surface the graduated session
      // lifecycle icons (🟢🟠🟤⚫💤) by stat-ing each entry's transcript
      // file and bucketing the age. The Phase 33 coordinator only exposes
      // a 3-state rollup (healthy/degraded/stopped); the per-project
      // user-activity age (the signal cooling-down depends on) is computed
      // here client-side from `lsl[*].transcriptPath` mtime.
      //
      // Lifecycle thresholds (5 bands; match docs/health-system/status-line.md):
      //   <5m   🟢  Active   (bright green)
      //   <30m  🟠  Cooling  (orange)
      //   <6h   🟤  Fading   (brown)
      //   <24h  ⚫  Inactive (black)
      //   ≥24h  💤  Sleeping
      // Earlier 🌲/🫒/🪨 icons were retired: 🫒 (U+1FAD2) and 🪨 (U+1FAA8)
      // are Unicode 13.0 (2020) — too new for most tmux wcwidth tables, so
      // tmux counted them as 1 cell while VS Code's xterm.js / iTerm2
      // rendered them as 2 cells, leaving recurring trailing residue at
      // the right edge of status-right. The replacement set sticks to
      // colored circles (U+1F7E0-U+1F7E4, Unicode 12.0) paired with
      // explicit codepoint-widths overrides in ~/.tmux.conf so tmux and
      // the terminal renderer agree on 2 cells per icon. 🟡 and 🔴 are
      // intentionally OMITTED from this lifecycle ladder — they are
      // reserved for unhealthy ETM states (warning / critical) which
      // bypass the lifecycle path entirely.
      const rollup = state.lsl_by_project || {};
      const lslEntries = Object.values(state.lsl || {});
      const agenticDir = dirname(process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || rootDir);
      const claudeProjectsDir = process.env.HOME ? join(process.env.HOME, '.claude', 'projects') : null;
       const transcriptAgeMs = (projectName) => {
        // Preferred: state.lsl carries explicit transcriptPaths from ETM
        // heartbeats. When multiple sessions target the same project
        // (e.g. Claude + OpenCode), pick the FRESHEST transcript — the
        // most recently active session should drive the project icon.
        let freshestAge = null;
        for (const entry of lslEntries) {
          if (entry?.projectName !== projectName || !entry?.transcriptPath) continue;
          try {
            const age = Date.now() - fs.statSync(entry.transcriptPath).mtimeMs;
            if (freshestAge === null || age < freshestAge) freshestAge = age;
          } catch { /* skip unreadable paths */ }
        }
        // Fallback: scan the project's Claude transcript dir and specstory
        // history directly. Some ETMs heartbeat without a transcriptPath
        // (e.g. before any session activity has been observed). Without
        // this fallback, the age is null → ⚫ for sessions with no signal.
        //
        // Path encoding: forward-encode (`/` and `_` → `-`), mirroring
        // health-coordinator.js's encodeClaudeProjectDir.
        if (claudeProjectsDir && agenticDir) {
          const candidates = [
            join(agenticDir, projectName),
            join(agenticDir, '_work', projectName),
          ];
          // Claude .jsonl transcripts
          for (const projectPath of candidates) {
            const encoded = projectPath.replace(/[\/_]/g, '-');
            const dir = join(claudeProjectsDir, encoded);
            if (!existsSync(dir)) continue;
            try {
              const jsonls = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));
              for (const f of jsonls) {
                const age = Date.now() - fs.statSync(join(dir, f)).mtimeMs;
                if (freshestAge === null || age < freshestAge) freshestAge = age;
              }
            } catch { /* try next candidate */ }
          }
          // OpenCode / specstory transcripts — these live in the project's
          // .specstory/history/<YYYY>/<MM>/ dir as .md files, written in
          // real time by OpenCode sessions.
          for (const projectPath of candidates) {
            const specstoryDir = join(projectPath, '.specstory', 'history');
            if (!existsSync(specstoryDir)) continue;
            try {
              const now = new Date();
              const yearMonth = join(String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'));
              const monthDir = join(specstoryDir, yearMonth);
              if (!existsSync(monthDir)) continue;
              const mds = fs.readdirSync(monthDir).filter(f => f.endsWith('.md'));
              for (const f of mds) {
                const age = Date.now() - fs.statSync(join(monthDir, f)).mtimeMs;
                if (freshestAge === null || age < freshestAge) freshestAge = age;
              }
            } catch { /* skip */ }
          }
        }
        return freshestAge;
      };
      const ageToActivityIcon = (ageMs) => {
        // null age (no transcript anywhere on disk) is genuinely unknown.
        // Treat it as Inactive ⚫ rather than Active 🟢 — better to
        // under-promise activity than to over-promise it, and the user
        // can tell at a glance that this session has no observable signal.
        if (ageMs === null) return '⚫';
        if (ageMs < 5 * 60_000) return '🟢';
        if (ageMs < 30 * 60_000) return '🟠';
        if (ageMs < 6 * 60 * 60_000) return '🟤';
        if (ageMs < 24 * 60 * 60_000) return '⚫';
        return '💤';
      };
      // Freshest ETM heartbeat age for a project. Used to promote the
      // transcript-derived icon to 🟢 when the ETM is actively observing
      // activity that doesn't manifest as new .jsonl writes — e.g. a
      // long-running agent turn (one prompt that takes 25 min to complete)
      // or a non-Claude session (OpenCode/Copilot) whose transcript path
      // isn't a real file. Returns null if no running heartbeat is present.
      const heartbeatAgeMs = (projectName) => {
        let latestBeat = 0;
        for (const e of lslEntries) {
          if (e?.projectName !== projectName) continue;
          if (e.status === 'stopped') continue;
          if (e.lastBeat && e.lastBeat > latestBeat) latestBeat = e.lastBeat;
        }
        return latestBeat > 0 ? Date.now() - latestBeat : null;
      };
      for (const [projectName, status] of Object.entries(rollup)) {
        let icon;
        let activityAgeMs = null;
        if (status === 'healthy') {
          activityAgeMs = transcriptAgeMs(projectName);
          icon = ageToActivityIcon(activityAgeMs);
          // Heartbeat promotion: if the transcript-derived icon is not
          // already Active but the ETM is heartbeating fresh (<5min),
          // override to 🟢. The transcript is updated only at prompt
          // boundaries, so a session in the middle of a long agent turn
          // looks idle by mtime but is actually in full swing. The
          // heartbeat is the canonical "user/agent is here right now"
          // signal — but ONLY when the transcript is moderately stale
          // (< 45min, i.e. a long agent turn). When the transcript is
          // hours old, the user is genuinely idle — the ETM heartbeat
          // just means the monitor process is alive (e.g. after laptop
          // wake from sleep), not that the user is active.
          if (icon !== '🟢' && activityAgeMs !== null && activityAgeMs < 45 * 60_000) {
            const hbAge = heartbeatAgeMs(projectName);
            if (hbAge !== null && hbAge < 5 * 60_000) {
              icon = '🟢';
            }
          }
        } else if (status === 'degraded' || status === 'stale' || status === 'warning') {
          icon = '🟡';
        } else {
          icon = '🔴';
        }
        // All graduated activity icons (🟢🟠🟤⚫💤) reflect a healthy ETM
        // with varying user-activity age. Only 🟡 / 🔴 are unhealthy.
        const sessionStatus = icon === '🟡' ? 'warning'
                            : icon === '🔴' ? 'unhealthy'
                            : 'healthy';
        result.sessions[projectName] = { icon, status: sessionStatus, activityAgeMs };
      }

      // Sidecar: { projectName: transcriptPath } so status-line-fast.cjs can
      // patch lifecycle icons inline using fresh transcript mtimes — without
      // having to wait for the next async CSL refresh. This is what makes the
      // lifecycle icons snap on the very next tmux tick after user activity,
      // instead of lagging up to ~30s for the cache regen cycle to run.
      //
      // For projects whose coordinator entry lacks a transcriptPath
      // (e.g. an ETM spawned for an idle tmux session that hasn't sent
      // a prompt in this ETM's lifetime), fall back to scanning the
      // project's Claude transcript dir directly and recording the
      // freshest .jsonl. Without this, idle-but-tracked projects fall
      // out of the fast-path patch set and their icon freezes at
      // whatever the cache says.
      try {
        const projectsFile = join(rootDir, '.logs', 'combined-status-line-projects.json');
        const mapping = {};
        const seen = new Set();
        // Freshest lastBeat per project, used by the fast-path patcher to
        // mirror the heartbeat-promotion logic without having to re-poll
        // the coordinator on every tmux tick.
        const freshestBeat = new Map();
        for (const e of lslEntries) {
          if (!e?.projectName) continue;
          if (e.lastBeat && e.lastBeat > (freshestBeat.get(e.projectName) || 0)) {
            freshestBeat.set(e.projectName, e.lastBeat);
          }
        }
        // When multiple sessions target the same project (e.g. Claude +
        // OpenCode), pick the FRESHEST transcript so the most recently
        // active session drives the project icon in the fast-path patcher.
        for (const entry of lslEntries) {
          if (!entry?.projectName || !entry?.transcriptPath) continue;
          let mt = 0;
          try { mt = fs.statSync(entry.transcriptPath).mtimeMs; } catch { continue; }
          const prev = mapping[entry.projectName];
          if (!prev || mt > prev._mt) {
            mapping[entry.projectName] = {
              tp: entry.transcriptPath,
              hbTs: freshestBeat.get(entry.projectName) || 0,
              _mt: mt,  // internal; stripped before write
            };
          }
          seen.add(entry.projectName);
        }
        // Strip internal _mt before persisting
        for (const v of Object.values(mapping)) delete v._mt;
        // Fallback: for projects in rollup but with no transcriptPath,
        // look up via the same forward-encoded dir scan as transcriptAgeMs.
        for (const projectName of Object.keys(rollup)) {
          if (seen.has(projectName)) continue;
          if (!claudeProjectsDir || !agenticDir) continue;
          const candidates = [
            join(agenticDir, projectName),
            join(agenticDir, '_work', projectName),
          ];
          let bestPath = null;
          let bestMtime = 0;
          // Claude .jsonl transcripts
          for (const projectPath of candidates) {
            const encoded = projectPath.replace(/[\/_]/g, '-');
            const dir = join(claudeProjectsDir, encoded);
            if (!existsSync(dir)) continue;
            try {
              for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'))) {
                const p = join(dir, f);
                const m = fs.statSync(p).mtimeMs;
                if (m > bestMtime) { bestMtime = m; bestPath = p; }
              }
            } catch { /* try next candidate */ }
          }
          // OpenCode .specstory transcripts
          for (const projectPath of candidates) {
            const specDir = join(projectPath, '.specstory', 'history');
            if (!existsSync(specDir)) continue;
            try {
              const now = new Date();
              const monthDir = join(specDir, String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'));
              if (!existsSync(monthDir)) continue;
              for (const f of fs.readdirSync(monthDir).filter(f => f.endsWith('.md'))) {
                const p = join(monthDir, f);
                const m = fs.statSync(p).mtimeMs;
                if (m > bestMtime) { bestMtime = m; bestPath = p; }
              }
            } catch { /* skip */ }
          }
          if (bestPath) {
            mapping[projectName] = {
              tp: bestPath,
              hbTs: freshestBeat.get(projectName) || 0,
            };
          }
        }
        writeFileSync(projectsFile, JSON.stringify(mapping), 'utf8');
      } catch { /* best effort */ }

      return result;
    } catch (error) {
      return { 
        status: 'error',
        error: error.message,
        gcm: { icon: '❌', status: 'error' },
        sessions: {},
        guards: { icon: '❌', status: 'error' }
      };
    }
  }

  async getRedirectStatus() {
    try {
      // Only show redirect indicator when working OUTSIDE the coding project
      const codingPath = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || rootDir;
      const targetProject = process.env.TRANSCRIPT_SOURCE_PROJECT;
      
      // If target project is the coding project itself, no redirect needed
      if (!targetProject || targetProject.includes(codingPath)) {
        if (process.env.DEBUG_STATUS) {
          console.error(`DEBUG: Target is coding project (${targetProject}), no redirect needed`);
        }
        return { active: false };
      }
      
      // Check if current conversation involves coding by reading stdin JSON input
      const input = await this.readStdinInput();
      if (input && input.transcript_path) {
        return await this.analyzeConversationForCoding(input.transcript_path);
      }
      
      if (process.env.DEBUG_STATUS) {
        console.error(`DEBUG: No transcript path available for conversation analysis`);
      }
      
      return { active: false };
    } catch (error) {
      if (process.env.DEBUG_STATUS) {
        console.error(`DEBUG: Redirect analysis failed: ${error.message}`);
      }
      return { active: false };
    }
  }

  async readStdinInput() {
    try {
      // Read JSON input from stdin if available.
      // TTY: no stdin payload expected when invoked directly by a human.
      if (process.stdin.isTTY) return null;

      // Piped stdin without an explicit EOF (e.g. fast.cjs forgetting to
      // close the pipe) used to hang here for the full 8s SYS:TIMEOUT
      // window. Guard with a short race so this code path can NEVER be
      // the reason the statusline times out — at worst we miss a single
      // stdin payload and getRedirectStatus returns { active: false }.
      const STDIN_DEADLINE_MS = 200;
      const readPromise = (async () => {
        let data = '';
        for await (const chunk of process.stdin) {
          data += chunk;
        }
        return data;
      })();
      const timeoutPromise = new Promise(resolve =>
        setTimeout(() => resolve(null), STDIN_DEADLINE_MS)
      );
      const data = await Promise.race([readPromise, timeoutPromise]);
      if (data == null) return null; // deadline hit — no stdin payload
      return data.trim() ? JSON.parse(data) : null;
    } catch (error) {
      return null;
    }
  }

  resolveRelativePaths(input, workingDir) {
    // Helper to resolve relative paths in tool inputs using working directory context
    const resolved = { ...input };
    
    // Common file path fields in tool inputs
    const pathFields = ['file_path', 'path', 'command', 'glob'];
    
    for (const field of pathFields) {
      if (resolved[field] && typeof resolved[field] === 'string') {
        const value = resolved[field];
        // If it's a relative path and we have a working directory, resolve it
        if (!value.startsWith('/') && workingDir) {
          resolved[field] = `${workingDir}/${value}`;
        }
      }
    }
    
    return resolved;
  }

  async analyzeConversationForCoding(transcriptPath) {
    try {
      if (!existsSync(transcriptPath)) {
        return { active: false };
      }

      const transcript = readFileSync(transcriptPath, 'utf8');
      const lines = transcript.trim().split('\n').filter(line => line.trim());
      
      const codingPath = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || rootDir;
      const codingIndicators = [
        codingPath.toLowerCase(),
        '/coding/',
        'coding/',
        'combined-status-line',
        'transcript-monitor',
        'enhanced-transcript',
        'scripts/',
        '.js"',
        '.ts"',
        'status line',
        'statusline'
      ];

      // Find the most recent complete exchange (user prompt + assistant responses)
      let currentExchangeLines = [];
      let lastUserMessageIndex = -1;
      
      // First, find the last user message
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (!line.trim()) continue;
        
        try {
          const entry = JSON.parse(line);
          if (entry.type === 'user' && !entry.isMeta) {
            lastUserMessageIndex = i;
            break;
          }
        } catch (parseError) {
          continue;
        }
      }
      
      if (lastUserMessageIndex === -1) {
        return { active: false }; // No user messages found
      }
      
      // Collect the exchange: last user message + subsequent assistant responses
      for (let i = lastUserMessageIndex; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        
        try {
          const entry = JSON.parse(line);
          // Include the user message and any assistant responses that follow
          if (entry.type === 'user' || entry.type === 'assistant') {
            // Stop if we hit a new user message (unless it's the first one we found)
            if (entry.type === 'user' && i > lastUserMessageIndex) {
              break;
            }
            currentExchangeLines.push(line);
          }
        } catch (parseError) {
          continue;
        }
      }
      
      // Analyze the current exchange for coding activity with working directory context
      let currentWorkingDir = null;
      let foundCodingActivity = false;
      
      // Process entries to track working directory changes and detect coding activity
      for (const line of currentExchangeLines) {
        try {
          const entry = JSON.parse(line);
          
          // Update working directory context from transcript metadata
          if (entry.cwd) {
            currentWorkingDir = entry.cwd;
          }
          
          // Check both USER and ASSISTANT messages for redirect detection
          // Skip system messages (hooks, internal operations)
          if (entry.type === 'system') continue;
          
          // Only check user and assistant messages
          if (entry.type !== 'user' && entry.type !== 'assistant') continue;
          
          // Extract message content based on entry type
          let actualContent = '';
          if (entry.message && entry.message.content) {
            // Handle different content formats
            if (typeof entry.message.content === 'string') {
              actualContent = entry.message.content.toLowerCase();
            } else if (Array.isArray(entry.message.content)) {
              for (const item of entry.message.content) {
                if (item.type === 'text' && item.text) {
                  actualContent += item.text.toLowerCase() + ' ';
                } else if (entry.type === 'user' && item.type === 'tool_result') {
                  // Skip tool results for user messages (they contain previous outputs)
                  continue;
                } else if (entry.type === 'assistant' && item.type === 'tool_use') {
                  // Include tool usage from assistant messages for coding detection
                  let toolContent = JSON.stringify(item.input).toLowerCase();
                  
                  // Resolve relative paths using working directory context
                  if (currentWorkingDir && item.input && typeof item.input === 'object') {
                    const resolvedInput = this.resolveRelativePaths(item.input, currentWorkingDir);
                    toolContent = JSON.stringify(resolvedInput).toLowerCase();
                  }
                  
                  actualContent += toolContent + ' ';
                }
              }
            }
          } else if (entry.content && typeof entry.content === 'string') {
            actualContent = entry.content.toLowerCase();
          }
          
          // Skip if no actual content
          if (!actualContent) continue;
          
          // Check for coding indicators
          for (const indicator of codingIndicators) {
            if (actualContent.includes(indicator)) {
              if (process.env.DEBUG_STATUS) {
                console.error(`DEBUG: Found coding indicator "${indicator}" in ${entry.type} message`);
                console.error(`DEBUG: Working directory context: ${currentWorkingDir}`);
              }
              foundCodingActivity = true;
              break;
            }
          }
          
          // Also check if we're currently in the coding directory
          if (currentWorkingDir && currentWorkingDir.includes('/coding')) {
            if (process.env.DEBUG_STATUS) {
              console.error(`DEBUG: Working in coding directory: ${currentWorkingDir}`);
            }
            foundCodingActivity = true;
          }
          
          if (foundCodingActivity) break;
          
        } catch (parseError) {
          // Skip malformed JSON lines
          continue;
        }
      }
      
      if (foundCodingActivity) {
        return {
          active: true,
          target: 'coding',
          source: 'current_exchange',
          workingDir: currentWorkingDir
        };
      }
      
      return { active: false };
    } catch (error) {
      if (process.env.DEBUG_STATUS) {
        console.error(`DEBUG: Conversation analysis failed: ${error.message}`);
      }
      return { active: false };
    }
  }

  async ensureTranscriptMonitorRunning() {
    try {
      const projectPath = process.env.TRANSCRIPT_SOURCE_PROJECT;
      if (!projectPath) {
        return;
      }

      const ProcessStateManager = (await import('./process-state-manager.js')).default;
      const psm = new ProcessStateManager();
      await psm.initialize();

      try {
        if (await psm.isProjectStopped(projectPath)) {
          if (process.env.DEBUG_STATUS) {
            console.error('DEBUG: Project intentionally stopped, not restarting monitor');
          }
          return;
        }
      } catch {
        // Fail-open: if isProjectStopped check fails, continue.
      }

      const existingMonitor = await psm.getService('enhanced-transcript-monitor', 'per-project', { projectPath });

      if (existingMonitor && psm.isProcessAlive(existingMonitor.pid)) {
        if (process.env.DEBUG_STATUS) {
          console.error('DEBUG: Transcript monitor already running (PID:', existingMonitor.pid, ')');
        }
        return;
      }

      if (existingMonitor) {
        if (process.env.DEBUG_STATUS) {
          console.error('DEBUG: Registered monitor PID', existingMonitor.pid, 'is dead, cleaning up...');
        }
        await psm.unregisterService('enhanced-transcript-monitor', 'per-project', { projectPath });
      }

      if (process.env.DEBUG_STATUS) {
        console.error('DEBUG: Transcript monitor not running, starting...');
      }
      await this.startTranscriptMonitor();
    } catch (error) {
      if (process.env.DEBUG_STATUS) {
        console.error('DEBUG: Error checking transcript monitor:', error.message);
      }
    }
  }

  async startTranscriptMonitor() {
    try {
      const codingPath = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || rootDir;
      const monitorScript = join(codingPath, 'scripts', 'enhanced-transcript-monitor.js');

      if (!existsSync(monitorScript)) {
        return; // Script not found, skip auto-start
      }

      // Determine project path - MUST be explicit
      const projectPath = process.env.TRANSCRIPT_SOURCE_PROJECT;
      if (!projectPath) {
        if (process.env.DEBUG_STATUS) {
          console.error('DEBUG: Cannot start transcript monitor - no TRANSCRIPT_SOURCE_PROJECT set');
        }
        return; // Don't start without explicit project path
      }

      const { spawn } = await import('child_process');

      // Start monitor in background with proper environment
      const env = {
        ...process.env,
        CODING_TOOLS_PATH: codingPath,
        TRANSCRIPT_SOURCE_PROJECT: projectPath
      };

      // CRITICAL: Pass project path as argument, not just environment
      const monitor = spawn('node', [monitorScript, projectPath], {
        detached: true,
        stdio: 'ignore',
        env
      });

      monitor.unref(); // Allow parent to exit without waiting

      if (process.env.DEBUG_STATUS) {
        console.error('DEBUG: Started integrated transcript monitor with PID:', monitor.pid);
      }

      // CRITICAL: Register spawned process with PSM
      try {
        const ProcessStateManager = (await import('./process-state-manager.js')).default;
        const psm = new ProcessStateManager();
        await psm.initialize();

        await psm.registerService({
          name: 'enhanced-transcript-monitor',
          pid: monitor.pid,
          type: 'per-project',
          script: 'enhanced-transcript-monitor.js',
          projectPath: projectPath,
          metadata: {
            spawnedBy: 'combined-status-line',
            autoStarted: true
          }
        });

        if (process.env.DEBUG_STATUS) {
          console.error('DEBUG: Registered monitor with PSM');
        }
      } catch (psmError) {
        console.error('Failed to register monitor with PSM:', psmError.message);
        // Continue anyway - process is running even if registration failed
      }
    } catch (error) {
      if (process.env.DEBUG_STATUS) {
        console.error('DEBUG: Failed to start transcript monitor:', error.message);
      }
    }
  }

  /**
   * Ensure ALL transcript monitors are running for all discovered projects
   * This is a safety net in addition to the global supervisor
   */
  async ensureAllTranscriptMonitorsRunning() {
    try {
      const codingPath = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || rootDir;

      // Dynamic path computation - no hardcoded user paths
      const agenticDir = dirname(codingPath);
      const homeDir = process.env.HOME;
      const escapedAgenticPath = agenticDir.replace(/\//g, '-').replace(/^-/, '');
      const claudeProjectPrefix = `-${escapedAgenticPath}-`;

      // Rate limit: Only check every 60 seconds to avoid spawning storms
      const now = Date.now();
      if (this._lastAllMonitorCheck && now - this._lastAllMonitorCheck < 60000) {
        return;
      }
      this._lastAllMonitorCheck = now;

      const ProcessStateManager = (await import('./process-state-manager.js')).default;
      const psm = new ProcessStateManager({ codingRoot: codingPath });
      await psm.initialize();

      // Discover projects from multiple sources
      const projects = new Set();

      // Source 1: PSM registry
      try {
        const registry = await psm.getAllServices();
        const projectServices = registry.services?.projects || {};
        for (const projectPath of Object.keys(projectServices)) {
          if (projectPath.includes('/Agentic/')) {
            projects.add(projectPath);
          }
        }
      } catch {
        // Ignore PSM errors
      }

      // Source 2: Health files
      try {
        const healthDir = join(codingPath, '.health');
        if (existsSync(healthDir)) {
          const files = fs.readdirSync(healthDir);
          for (const file of files) {
            const match = file.match(/^(.+)-transcript-monitor-health\.json$/);
            if (match) {
              const projectPath = join(agenticDir, match[1]);
              if (existsSync(projectPath)) {
                projects.add(projectPath);
              }
            }
          }
        }
      } catch {
        // Ignore health file errors
      }

      // Source 3: Claude transcript directories with ACTIVE sessions only
      // Only spawn monitors for projects with actively-written transcripts (< 2 min)
      // This prevents orphaned monitors for sessions that closed without explicit stop
      try {
        if (!homeDir) throw new Error('HOME not set');
        const claudeProjectsDir = join(homeDir, '.claude', 'projects');
        if (existsSync(claudeProjectsDir)) {
          const dirs = fs.readdirSync(claudeProjectsDir);
          for (const dir of dirs) {
            if (!dir.startsWith(claudeProjectPrefix)) continue;
            const projectName = dir.slice(claudeProjectPrefix.length);
            if (projectName) {
              const projectPath = join(agenticDir, projectName);
              if (existsSync(projectPath)) {
                const transcriptDir = join(claudeProjectsDir, dir);
                const jsonlFiles = fs.readdirSync(transcriptDir).filter(f => f.endsWith('.jsonl'));
                if (jsonlFiles.length > 0) {
                  const latestMtime = Math.max(
                    ...jsonlFiles.map(f => fs.statSync(join(transcriptDir, f)).mtime.getTime())
                  );
                  // Active session: transcript written in last 2 minutes
                  if (Date.now() - latestMtime < 120000) {
                    projects.add(projectPath);
                  }
                }
              }
            }
          }
        }
      } catch {
        // Ignore Claude dir errors
      }

      // Check each project's monitor health
      for (const projectPath of projects) {
        // Skip projects that were intentionally stopped (prevents restart loops)
        try {
          if (await psm.isProjectStopped(projectPath)) {
            if (process.env.DEBUG_STATUS) {
              console.error(`DEBUG: Skipping ${basename(projectPath)}: intentionally stopped`);
            }
            continue;
          }
        } catch {
          // Fail-open: if check fails, continue with normal flow
        }

        const projectName = basename(projectPath);

        let needsRestart = false;
        let reason = '';

        const existingMonitor = await psm.getService('enhanced-transcript-monitor', 'per-project', { projectPath });
        if (!existingMonitor) {
          needsRestart = true;
          reason = 'no PSM entry';
        } else if (!psm.isProcessAlive(existingMonitor.pid)) {
          needsRestart = true;
          reason = `PID ${existingMonitor.pid} is dead`;
        }

        if (needsRestart) {
          if (process.env.DEBUG_STATUS) {
            console.error(`DEBUG: Restarting monitor for ${projectName}: ${reason}`);
          }

          // Use existing startTranscriptMonitor logic but with explicit project
          try {
            const monitorScript = join(codingPath, 'scripts', 'enhanced-transcript-monitor.js');
            if (existsSync(monitorScript)) {
              // Clean up dead PSM entry
              await psm.unregisterService('enhanced-transcript-monitor', 'per-project', { projectPath });

              const { spawn } = await import('child_process');
              const monitor = spawn('node', [monitorScript, projectPath], {
                detached: true,
                stdio: 'ignore',
                env: { ...process.env, CODING_REPO: codingPath, TRANSCRIPT_SOURCE_PROJECT: projectPath },
                cwd: codingPath
              });
              monitor.unref();

              await psm.registerService({
                name: 'enhanced-transcript-monitor',
                pid: monitor.pid,
                type: 'per-project',
                script: 'enhanced-transcript-monitor.js',
                projectPath,
                metadata: { spawnedBy: 'combined-status-line-all', restartedAt: new Date().toISOString() }
              });

              if (process.env.DEBUG_STATUS) {
                console.error(`DEBUG: Started monitor for ${projectName} (PID: ${monitor.pid})`);
              }
            }
          } catch (spawnError) {
            if (process.env.DEBUG_STATUS) {
              console.error(`DEBUG: Failed to restart monitor for ${projectName}: ${spawnError.message}`);
            }
          }
        }
      }
    } catch (error) {
      if (process.env.DEBUG_STATUS) {
        console.error('DEBUG: Error in ensureAllTranscriptMonitorsRunning:', error.message);
      }
    }
  }

  /**
   * Ensure statusline health monitor daemon is running (global singleton via PSM)
   * This is the "watcher of the watcher" - auto-restarts the health monitor if it dies
   */
  async ensureStatuslineHealthMonitorRunning() {
    try {
      const codingPath = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || rootDir;

      // Check PSM for existing healthy instance
      try {
        const ProcessStateManager = (await import('./process-state-manager.js')).default;
        const psm = new ProcessStateManager();
        await psm.initialize();

        // Clean up dead processes first
        await psm.cleanupDeadProcesses();

        // Check if statusline-health-monitor is running
        const isRunning = await psm.isServiceRunning('statusline-health-monitor', 'global');

        if (isRunning) {
          // Already running, nothing to do
          if (process.env.DEBUG_STATUS) {
            console.error('DEBUG: Statusline health monitor already running via PSM');
          }
          return;
        }
      } catch (psmError) {
        if (process.env.DEBUG_STATUS) {
          console.error('DEBUG: PSM check failed:', psmError.message);
        }
        // Fall through to status file check
      }

      // Fallback: Check status file freshness
      const statusFile = join(codingPath, '.logs', 'statusline-health-status.txt');

      if (existsSync(statusFile)) {
        const stats = fs.statSync(statusFile);
        const age = Date.now() - stats.mtime.getTime();

        // If status file updated in last 30 seconds, monitor is likely running
        if (age < 30000) {
          if (process.env.DEBUG_STATUS) {
            console.error('DEBUG: Status file fresh, monitor likely running');
          }
          return;
        }
      }

      // Monitor not running or stale - start it
      if (process.env.DEBUG_STATUS) {
        console.error('DEBUG: Statusline health monitor not detected, starting...');
      }
      await this.startStatuslineHealthMonitor();
    } catch (error) {
      if (process.env.DEBUG_STATUS) {
        console.error('DEBUG: Error checking statusline health monitor:', error.message);
      }
    }
  }

  /**
   * Start the statusline health monitor daemon
   */
  async startStatuslineHealthMonitor() {
    try {
      const codingPath = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || rootDir;
      const monitorScript = join(codingPath, 'scripts', 'statusline-health-monitor.js');

      if (!existsSync(monitorScript)) {
        console.error('DEBUG: Statusline health monitor script not found');
        return;
      }

      const { spawn } = await import('child_process');

      // Start monitor in daemon mode with auto-heal enabled
      const monitor = spawn('node', [monitorScript, '--daemon', '--auto-heal'], {
        detached: true,
        stdio: 'ignore',
        cwd: codingPath,
        env: {
          ...process.env,
          CODING_REPO: codingPath
        }
      });

      monitor.unref(); // Allow parent to exit without waiting

      if (process.env.DEBUG_STATUS) {
        console.error('DEBUG: Started statusline health monitor with PID:', monitor.pid);
      }

      // Note: The monitor will register itself with PSM on startup
      // We don't need to register it here since it has its own PSM integration

    } catch (error) {
      if (process.env.DEBUG_STATUS) {
        console.error('DEBUG: Failed to start statusline health monitor:', error.message);
      }
    }
  }


  // Phase 33 plan 07: the legacy host process-supervisor daemon is gone
  // (deleted in plan 33-07 cutover); launchd's com.coding.health-coordinator
  // KeepAlive is the authoritative supervisor for the host-side health
  // stack. The methods that used to probe the legacy supervisor's
  // heartbeat file and spawn it on demand were removed along with their
  // `.health/supervisor-heartbeat.json` dependency. combined-status-line
  // is now display-only.

  async buildCombinedStatus(constraint, semantic, knowledge, proxy, liveLogTarget, redirectStatus, globalHealth, healthVerifier, ukbStatus, network) {
    const parts = [];
    let overallColor = 'green';

    // Whether ANY Claude session has a fresh heartbeat. When the user is idle,
    // we suppress the "warning" verdict on coordinator-derived badges and show
    // ⚫ idle instead — "no recent activity" is expected during idle and
    // shouldn't paint the line yellow/red.
    const userActive = await this.isUserActive();

    // Store GCM status for health indicator (calculated first since health is first in display)
    const gcmIcon = globalHealth?.gcm?.icon || '🟡';
    const gcmHealthy = gcmIcon === '✅';


    // Unified Health Status - FIRST in status line
    // Merges GCM + Health Verifier into single indicator showing overall system health
    if (healthVerifier && healthVerifier.status === 'operational') {
      const criticalCount = healthVerifier.criticalCount || 0;
      const violationCount = healthVerifier.violationCount || 0;
      // Trust the verifier's verdict: when it has classified the run as
      // healthy (and isn't currently auto-healing), accepted/non-critical
      // violations should not flip the badge to yellow. Same fix pattern
      // as health-prompt-hook.js outputHealthContext().
      const verifierHealthy = healthVerifier.overallStatus === 'healthy'
        && !healthVerifier.autoHealingActive;

      if (criticalCount > 0) {
        parts.push('[🏥❌]'); // Critical - check dashboard
        overallColor = 'red';
      } else if (!gcmHealthy) {
        parts.push('[🏥🟡]'); // GCM unhealthy (independent of verifier)
        if (overallColor === 'green') overallColor = 'yellow';
      } else if (verifierHealthy || violationCount === 0) {
        parts.push('[🏥✅]'); // All healthy (GCM + services)
      } else {
        parts.push('[🏥🟡]'); // Non-accepted violations
        if (overallColor === 'green') overallColor = 'yellow';
      }
    } else if (healthVerifier && healthVerifier.status === 'stale') {
      parts.push('[🏥⏰]'); // Stale
      if (overallColor === 'green') overallColor = 'yellow';
    } else if (!gcmHealthy) {
      parts.push('[🏥🟡]'); // GCM unhealthy
      if (overallColor === 'green') overallColor = 'yellow';
    } else if (healthVerifier && healthVerifier.status === 'error') {
      parts.push('[🏥❌]'); // Error
      if (overallColor === 'green') overallColor = 'yellow';
    } else {
      parts.push('[🏥💤]'); // Offline
    }

    // Sessions Display (without separate GCM indicator - merged into 🏥)
    // Show all sessions - inactive ones display with dark icons (💤/⚫)
    // Only remove sessions when the Claude session is actually closed/exited
    if (globalHealth && globalHealth.status !== 'error') {
      const sessionEntries = Object.entries(globalHealth.sessions || {});

      if (sessionEntries.length > 0) {
        // TMUX_PANE_PATH is expanded per-window by tmux (#{pane_current_path})
        // so each window's statusbar underlines its own project.
        const currentProject = process.env.TMUX_PANE_PATH
          || process.env.TRANSCRIPT_SOURCE_PROJECT
          || process.cwd();
        const currentProjectName = currentProject.split('/').pop();
        const currentAbbrev = this.getProjectAbbreviation(currentProjectName);

        const sessionStatuses = sessionEntries
          .map(([project, health]) => {
            const abbrev = this.getProjectAbbreviation(project);
            const isCurrentProject = abbrev === currentAbbrev;
            const displayAbbrev = isCurrentProject ? `#[underscore]${abbrev}#[nounderscore]` : abbrev;
            // Add agent type prefix for non-Claude agents (mastra, opencode, copilot)
            const agentType = health.details ? this.extractAgentType(health.details) : null;
            const agentPrefix = agentType && this.agentDisplay[agentType] ? this.agentDisplay[agentType].prefix : '';
            if ((health.icon === '🟡' || health.icon === '🔴') && health.reason) {
              return `${agentPrefix}${displayAbbrev}${health.icon}(${health.reason})`;
            }
            return `${agentPrefix}${displayAbbrev}${health.icon}`;
          })
          .join('');

        parts.push(`[${sessionStatuses}]`);

        const hasUnhealthy = sessionStatuses.includes('🔴');
        const hasWarning = sessionStatuses.includes('🟡');
        if (hasUnhealthy) overallColor = 'red';
        else if (hasWarning && overallColor === 'green') overallColor = 'yellow';
      }
    }

    // LSL (Live Session Logging) — compact per-pane health badge.
    // Hidden when healthy to keep the line tight; the per-project labels
    // (rendered above as Sessions Display) already show per-project status.
    const lslStatus = await this.getLSLHealthStatus();
    if (lslStatus === 'down') {
      parts.push('[LSL🔴]');
      overallColor = 'red';
    } else if (lslStatus === 'stale') {
      parts.push('[LSL🟡]');
      if (overallColor === 'green') overallColor = 'yellow';
    }

    // Constraint Monitor Status
    if (constraint.status === 'operational') {
      // Convert compliance to percentage (0-10 scale to 0-100%)
      const compliancePercent = constraint.compliance <= 10 ?
        Math.round(constraint.compliance * 10) :
        Math.round(constraint.compliance);
      const score = `${compliancePercent}%`;
      const violationsCount = constraint.violations || 0;

      // Build constraint section: shield + score + optional violations.
      // The pre/post 🟡 spaces were anti-overlap workarounds back when
      // ⚠️ (U+26A0) had a cell-width mismatch between tmux's wcwidth and
      // xterm.js's rendered glyph — a 1-cell drift visually clobbered
      // adjacent characters. After moving warning indicators to 🟡
      // (U+1F7E1, EAW=Wide) AND adding the explicit codepoint-widths
      // override in ~/.tmux.conf, the cell count agrees across script,
      // tmux, and renderer — the spaces are no longer needed.
      let constraintPart = `[🔒${score}`;
      if (violationsCount > 0) {
        constraintPart += `🟡${violationsCount}`;
        overallColor = 'yellow';
      }
      constraintPart += `]`;
      parts.push(constraintPart);
    } else if (constraint.status === 'degraded') {
      parts.push('[🔒 🟡]');
      overallColor = 'yellow';
    } else {
      parts.push('[🔒 ❌]');
      overallColor = 'red';
    }

    // Knowledge pipeline (observation/digest/insight freshness via coordinator).
    // Source: state.knowledge_pipeline at /health/state.
    //
    // ObservationWriter fires on prompt-set completion, not continuously.
    // During a long-running assistant turn, obs age past 15 min is normal —
    // the next completion will write a fresh obs and the badge self-heals.
    // Mirror the project-activity bubble lifecycle (🟢/🟠/🟤/⚫/💤) for any
    // status within the natural async window (stale = 15 min–6 h, any
    // activity level; stalled = >6 h on a cooling project). Reserve loud
    // signals for truly broken cases:
    //   stalled + Active (>6 h with no obs while transcript is fresh)  → 🔴
    //   unreachable (obs_api itself down)                              → ❌ (yellow)
    // Per spec: yellow only for "broken and won't recover on next prompt".
    const freshestActivityAge = await this._freshestProjectActivityAgeMs();
    const projectActive = freshestActivityAge !== null && freshestActivityAge < 5 * 60_000;
    const lifecycleIcon = (() => {
      if (freshestActivityAge === null) return '⚫';
      if (freshestActivityAge < 5 * 60_000) return '🟢';
      if (freshestActivityAge < 30 * 60_000) return '🟠';
      if (freshestActivityAge < 6 * 60 * 60_000) return '🟤';
      if (freshestActivityAge < 24 * 60 * 60_000) return '⚫';
      return '💤';
    })();
    switch (knowledge.status) {
      case 'healthy':
        parts.push('[📚✅]');
        break;
      case 'stale':
        // 15 min – 6 h gap — within natural latency window. No alarm.
        parts.push(`[📚${lifecycleIcon}]`);
        break;
      case 'stalled':
        // >6 h gap. If a project is Active right now, the obs pipe is
        // broken (next prompt won't fix it after that long).
        if (projectActive) {
          parts.push('[📚🔴]');
          overallColor = 'red';
        } else {
          parts.push(`[📚${lifecycleIcon}]`);
        }
        break;
      case 'disabled':
        parts.push('[📚🔇]');
        break;
      case 'unknown':
        parts.push('[📚❓]');
        break;
      case 'unreachable':
      default:
        parts.push('[📚❌]');
        if (overallColor === 'green') overallColor = 'yellow';
        break;
    }

    // Network location badge: [N:CN] / [N:VPN] / [N:HOME] / [N:??]
    // Uses ASCII-only to avoid emoji-width issues.
    {
      const loc = network?.location || 'unknown';
      const locMap = { corporate: 'CN', vpn: 'VPN', open: 'OPEN', home: 'OPEN', unknown: '??' };
      const locLabel = locMap[loc] || loc.toUpperCase().slice(0, 4);
      parts.push(`[N:${locLabel}]`);
    }

    // Proxy status badge: [P:ON] / [P:OFF]
    // Reflects whether the local proxy (px/proxydetox) is running and functional.
    {
      const pxOn = network?.proxy_running && network?.proxy_functional;
      const pxLabel = network?.proxy_running ? (network?.proxy_functional ? 'ON' : 'ERR') : 'OFF';
      parts.push(`[P:${pxLabel}]`);
      if (network?.location === 'corporate' && !pxOn) {
        // On CN without working proxy — problem
        if (overallColor === 'green') overallColor = 'yellow';
      }
    }

    // Phase 34 (D-12): proxy semantic readiness drives [🧠] badge.
    // Source: state.proxy at /health/state (set by pollProxySemantic +
    // evaluateAutoHealFSM in health-coordinator.js).
    //
    // COLLISION NOTE (PATTERNS.md anomaly #1): the UKB workflow indicator
    // below ALSO opens with `[🧠`. We coexist by suffix shape — proxy
    // emits a single status emoji ([🧠✅] / [🧠🟡] / [🧠🚫] / [🧠🔇] /
    // [🧠❓] / [🧠❌]); UKB emits an N+icon counter form ([🧠1⏳2🟡]).
    // Visually distinguishable.
    switch (proxy?.status) {
      case 'healthy':
        parts.push('[🧠✅]');
        break;
      case 'partial':
        // 3b: cheap haiku probe OK, configured semantic pipeline failing
        // (typically observation-writer's claude-code/sonnet hitting an
        // Anthropic 429 with no in-bucket fallback). Always rendered amber
        // — this is real silent breakage, not a probe-window artifact, so
        // idle suppression doesn't apply. Uses 🟡 (not ⚠️) to avoid the
        // tmux/terminal cell-width mismatch on U+26A0+VS16 documented at
        // lines 60-61 / 1912 of this file, which leaks trailing chars
        // past the visible-drift threshold.
        parts.push('[🧠🟡]');
        if (overallColor === 'green') overallColor = 'yellow';
        break;
      case 'degraded':
        // Idle suppression: a degraded proxy semantic-probe during idle is
        // typically the probe-window missing rather than a real outage.
        if (!userActive) {
          parts.push('[🧠⚫]');
        } else {
          parts.push('[🧠🟡]');
          if (overallColor === 'green') overallColor = 'yellow';
        }
        break;
      case 'cooling':
        // The auto-heal cooldown state is transient; during idle it's not
        // a user-actionable problem — show idle instead of red.
        if (!userActive) {
          parts.push('[🧠⚫]');
        } else {
          parts.push('[🧠🚫]');
          overallColor = 'red';
        }
        break;
      case 'disabled':
        parts.push('[🧠🔇]');
        break;
      case 'unknown':
        parts.push('[🧠❓]');
        break;
      case 'unreachable':
      default:
        parts.push('[🧠❌]');
        if (overallColor === 'green') overallColor = 'yellow';
        break;
    }

    // UKB (Update Knowledge Base) Process Status - shows 13-agent workflow activity
    if (ukbStatus && ukbStatus.total > 0) {
      // Active workflows running
      let ukbPart = `[🧠`;
      if (ukbStatus.running > 0) {
        ukbPart += `${ukbStatus.running}⏳`;
      }
      if (ukbStatus.stale > 0) {
        ukbPart += `${ukbStatus.stale}🟡`;
        if (overallColor === 'green') overallColor = 'yellow';
      }
      if (ukbStatus.frozen > 0) {
        ukbPart += `${ukbStatus.frozen}🥶`;
        overallColor = 'red';
      }
      ukbPart += ']';
      parts.push(ukbPart);
    }
    // Don't show anything when no UKB processes are running (cleaner status line)

    // Add live log target with optional redirect indicator
    if (liveLogTarget && liveLogTarget !== '----') {
      let compactTarget = liveLogTarget
        .replace('-session', '')
        .replace('(ended)', '')
        .trim();

      // Include redirect target inside the log block if active
      let redirectSuffix = '';
      if (redirectStatus && redirectStatus.active) {
        const target = redirectStatus.target
          .replace('coding', 'cod')
          .replace('nano-degree', 'nano');
        redirectSuffix = `→${target}`;
      }

      parts.push(`[📋${compactTarget}${redirectSuffix}]`);
    } else if (redirectStatus && redirectStatus.active) {
      // Show redirect even without live log
      const target = redirectStatus.target
        .replace('coding', 'cod')
        .replace('nano-degree', 'nano');
      parts.push(`[→${target}]`);
    }
    
    // Append current time (HH:MM) so tmux doesn't need a separate %H:%M token
    // which would misalign due to emoji width miscalculation
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    parts.push(timeStr);

    const joined = parts.join(' ');
    const statusText = padStatusLine(joined);

    // Since Claude Code doesn't support tooltips/clicks natively,
    // we'll provide the text and have users run ./bin/status for details
    return {
      text: statusText,
      color: overallColor,
      helpCommand: './bin/status'
    };
  }

  /**
   * Extract agent type from health details string
   * Details format: "opencode (capture 5min)" or "mastra running (no capture)" etc.
   */
  extractAgentType(details) {
    if (!details) return null;
    const detailsLower = details.toLowerCase();
    for (const agentType of ['mastra', 'opencode', 'copilot']) {
      if (detailsLower.startsWith(agentType) || detailsLower.includes(agentType)) {
        return agentType;
      }
    }
    return null;
  }

  /**
   * Generate smart abbreviations for project names (shared with health monitor)
   */
  getProjectAbbreviation(projectName) {
    // Handle common patterns and generate readable abbreviations
    const name = projectName.toLowerCase();
    
    // Known project mappings
    const knownMappings = {
      'coding': 'C',
      'curriculum-alignment': 'CA',
      'nano-degree': 'ND',
      'curriculum': 'CU',
      'alignment': 'AL',
      'nano': 'N',
      'ui-template': 'UT',
      'balance': 'BL'
    };
    
    // Check for exact match first
    if (knownMappings[name]) {
      return knownMappings[name];
    }
    
    // Smart abbreviation generation
    if (name.includes('-')) {
      // Multi-word projects: take first letter of each word
      const parts = name.split('-');
      return parts.map(part => part.charAt(0).toUpperCase()).join('');
    } else if (name.includes('_')) {
      // Underscore separated: take first letter of each word  
      const parts = name.split('_');
      return parts.map(part => part.charAt(0).toUpperCase()).join('');
    } else if (name.length <= 3) {
      // Short names: just uppercase
      return name.toUpperCase();
    } else {
      // Long single words: take first 2-3 characters intelligently
      if (name.length <= 6) {
        return name.substring(0, 2).toUpperCase();
      } else {
        // For longer words, try to find vowels/consonants pattern
        const consonants = name.match(/[bcdfghjklmnpqrstvwxyz]/g) || [];
        if (consonants.length >= 2) {
          return consonants.slice(0, 2).join('').toUpperCase();
        } else {
          return name.substring(0, 3).toUpperCase();
        }
      }
    }
  }

  /**
   * Reverse mapping from abbreviation back to project name
   * Used for validating sessions against running monitors
   */
  getProjectNameFromAbbrev(abbrev) {
    // Reverse mapping of known abbreviations
    const reverseMapping = {
      'C': 'coding',
      'CA': 'curriculum-alignment',
      'ND': 'nano-degree',
      'CU': 'curriculum',
      'AL': 'alignment',
      'N': 'nano',
      'UT': 'ui-template',
      'BL': 'balance'
    };

    const upperAbbrev = abbrev.toUpperCase();
    return reverseMapping[upperAbbrev] || abbrev.toLowerCase();
  }

  /**
   * Synchronous check for running transcript monitors
   * Used for auto-correction when status file is stale
   */
  getRunningTranscriptMonitorsSync() {
    const runningProjects = new Set();

    try {
      // Use pgrep to find running enhanced-transcript-monitor processes
      // NOTE: On macOS, -lf shows full command; -af only shows PIDs (different from Linux)
      const psOutput = execSync('pgrep -lf "enhanced-transcript-monitor.js" 2>/dev/null || true', {
        encoding: 'utf8',
        timeout: 5000
      });

      if (psOutput && psOutput.trim()) {
        for (const line of psOutput.trim().split('\n')) {
          // Extract the LAST path argument (basename) as the project name
          // This handles nested projects like /Agentic/_work/pofo → pofo
          const argMatch = line.match(/enhanced-transcript-monitor\.js\s+(\S+)/);
          if (argMatch) {
            const projectName = basename(argMatch[1]);
            if (projectName && projectName !== 'enhanced-transcript-monitor.js') {
              runningProjects.add(projectName);
              continue;
            }
          }

          // Fallback patterns for edge cases
          const fallbackPatterns = [
            /\/Agentic\/(?:[^/\s]+\/)*([^\s/]+)\s*$/,
            /PROJECT_PATH=\S*\/([^\s/]+)\s*$/
          ];

          for (const pattern of fallbackPatterns) {
            const match = line.match(pattern);
            if (match) {
              runningProjects.add(match[1]);
              break;
            }
          }
        }
      }

      // Fallback: Check health files if pgrep found nothing
      // Health files updated in last 30 seconds indicate running monitor
      if (runningProjects.size === 0) {
        const healthDir = join(rootDir, '.health');
        if (existsSync(healthDir)) {
          const healthFiles = fs.readdirSync(healthDir)
            .filter(f => f.endsWith('-transcript-monitor-health.json'));

          for (const file of healthFiles) {
            const filePath = join(healthDir, file);
            const fileStats = fs.statSync(filePath);
            const fileAge = Date.now() - fileStats.mtime.getTime();

            // If health file updated in last 30 seconds, monitor is running
            if (fileAge < 30000) {
              const projectName = file.replace('-transcript-monitor-health.json', '');
              runningProjects.add(projectName);
            }
          }
        }
      }

    } catch (error) {
      if (process.env.DEBUG_STATUS) {
        console.error(`DEBUG: getRunningTranscriptMonitorsSync error: ${error.message}`);
      }
    }

    return runningProjects;
  }

  buildCombinedTooltip(constraint, semantic, knowledge) {
    const lines = ['⚙️ System Status Dashboard'];
    lines.push('━'.repeat(30));

    // Constraint Monitor Section
    lines.push('🔒  CONSTRAINT MONITOR');
    if (constraint.status === 'operational') {
      lines.push(`   ✅ Status: Operational`);
      lines.push(`   📊 Compliance: ${constraint.compliance}/10.0`);
      if (constraint.violations === 0) {
        lines.push(`   🟢 Violations: None active`);
      } else {
        lines.push(`   ⚠️  Violations: ${constraint.violations} active`);
      }
    } else if (constraint.status === 'degraded') {
      lines.push(`   ⚠️  Status: Degraded`);
      lines.push(`   📊 Compliance: Checking...`);
    } else {
      lines.push(`   ❌ Status: Offline`);
      lines.push(`   📊 Compliance: N/A`);
    }

    lines.push('');

    // Semantic Analysis Section
    lines.push('🧠 SEMANTIC ANALYSIS');
    if (semantic.status === 'operational') {
      lines.push(`   ✅ Status: Operational`);
      lines.push(`   🔍 Analysis: Ready`);
      lines.push(`   📈 Insights: Available`);
    } else if (semantic.status === 'degraded') {
      lines.push(`   ⚠️  Status: Degraded`);
      lines.push(`   🔍 Analysis: Limited`);
    } else {
      lines.push(`   ❌ Status: Offline`);
      lines.push(`   🔍 Analysis: Unavailable`);
    }

    lines.push('');

    // Knowledge Pipeline Section (observations / digests / insights)
    lines.push('📚 KNOWLEDGE PIPELINE');
    const fmtAge = (ms) => {
      if (ms == null) return 'never';
      const sec = Math.round(ms / 1000);
      if (sec < 60) return `${sec}s ago`;
      const min = Math.round(sec / 60);
      if (min < 60) return `${min}m ago`;
      const hr = Math.round(min / 60);
      if (hr < 48) return `${hr}h ago`;
      return `${Math.round(hr / 24)}d ago`;
    };
    const verdictIcon = ({
      healthy: '✅',
      stale: '⚠️',
      stalled: '🔴',
      unreachable: '❌',
      disabled: '🔇',
      unknown: '❓'
    })[knowledge.status] || '❌';
    lines.push(`   ${verdictIcon} Status: ${knowledge.status || 'unknown'}`);
    if (knowledge.totals) {
      lines.push(`   📦 Totals: obs=${knowledge.totals.observations} digests=${knowledge.totals.digests} insights=${knowledge.totals.insights}`);
      if (knowledge.totals.undigested != null) {
        lines.push(`   ⏸  Undigested: ${knowledge.totals.undigested} (past=${knowledge.totals.pendingPast}, today=${knowledge.totals.pendingToday})`);
      }
    }
    if (knowledge.obsAgeMs != null) {
      lines.push(`   📝 Last observation: ${fmtAge(knowledge.obsAgeMs)}`);
    }
    if (knowledge.digAgeMs != null) {
      lines.push(`   🧮 Last digest: ${fmtAge(knowledge.digAgeMs)}`);
    }
    if (knowledge.insAgeMs != null) {
      lines.push(`   💡 Last insight: ${fmtAge(knowledge.insAgeMs)}`);
    }
    if (knowledge.inflight) {
      lines.push(`   🔄 In-flight consolidation: ${JSON.stringify(knowledge.inflight)}`);
    }
    if (knowledge.reason) {
      lines.push(`   ℹ  ${knowledge.reason}`);
    }

    lines.push('');
    lines.push('━'.repeat(30));
    lines.push('🖱️  Click to open constraint dashboard');
    lines.push('🔄 Updates every 5 seconds');

    return lines.join('\n');
  }

  // REMOVED: Duplicate buggy ensureTranscriptMonitorRunning() method
  // The correct version is at line 962 which properly passes project path
  // This duplicate was spawning monitors WITHOUT project path arguments,
  // causing orphaned processes to create files in wrong directories

  getErrorStatus(error) {
    return {
      text: '🟡 SYS:ERR',
      color: 'red',
      tooltip: `System error: ${error.message || 'Unknown error'}`,
      onClick: 'open-dashboard'
    };
  }
}

// Main execution
async function main() {
  try {
    // FAST PATH: If a recent cached render exists, output it immediately.
    // The full generateStatus() does heavy imports, PSM init, ensure* checks, and
    // API calls which can take >4s under load (especially with many Node processes).
    // The statusline-health-monitor daemon keeps the underlying data fresh every 15s,
    // so a 30s cache is safe. This ensures tmux always gets output within milliseconds.
    // TMUX_PANE_PATH or TRANSCRIPT_SOURCE_PROJECT identifies which project
    // this status render is for; cache is keyed per-project.
    const panePath = process.env.TMUX_PANE_PATH || process.env.TRANSCRIPT_SOURCE_PROJECT || '';
    const paneProject = panePath ? basename(panePath) : '';
    // Cache key includes pane width so two same-project panes don't share
    // a per-render cache. (padStatusLine itself no longer adapts to width --
    // tmux right-aligns -- but the cache content is per-render.)
    const paneWidth = process.env.TMUX_PANE_WIDTH || '';
    const cacheSuffix = paneProject
      ? `-${paneProject}${paneWidth ? `-w${paneWidth}` : ''}`
      : '';
    const cacheFile = join(rootDir, '.logs', `combined-status-line-cache${cacheSuffix}.txt`);
    try {
      if (existsSync(cacheFile)) {
        const stat = fs.statSync(cacheFile);
        const ageMs = Date.now() - stat.mtimeMs;
        if (ageMs < 30000) {
          // CRITICAL: do NOT .trim() — the producer pads to a fixed visual
          // cell count and ends with a non-ASCII NBSP terminator (so tmux's
          // `#(...)` substitution can't strip the trailing pad). Trimming
          // here strips the NBSP and the padding, dropping the line below
          // tmux's status-right-length and re-introducing the cell-drift
          // residue (the "07:407" / "12:411" leftover-digit bug). Strip the
          // line terminator only — same as combined-status-line-wrapper.js.
          const cached = readFileSync(cacheFile, 'utf8').replace(/\r?\n$/, '');
          if (cached.trimEnd()) {
            process.stdout.write(cached + '\n', () => process.exit(0));
            return;
          }
        }
      }
    } catch {
      // Cache read failed — fall through to full generation
    }

    const statusLine = new CombinedStatusLine();

    const timeout = setTimeout(() => {
      // Foolproof debug: append a JSON record of WHY the timeout fired so
      // we can see which sub-step blocked. Without this, the user sees
      // "SYS:TIMEOUT" and has no log to trace the root cause from.
      try {
        const entry = {
          ts: new Date().toISOString(),
          kind: 'csl-timeout',
          elapsedMs: 8000,
          lastStartedStep: statusLine._lastStartedStep || null,
          steps: statusLine._stepTimings || [],
          paneWidth,
          transcriptSourceProject: process.env.TRANSCRIPT_SOURCE_PROJECT || null,
          codingRepo: process.env.CODING_REPO || rootDir,
        };
        const logPath = join(rootDir, '.logs', 'csl-failures.jsonl');
        // Use appendFileSync to ensure the record lands even if the
        // process is about to exit(1). `fs` is the ESM default-import
        // namespace at the top of this file.
        fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
      } catch { /* logging must never throw */ }
      console.error('⚠️ SYS:TIMEOUT - Status line generation took >8s');
      // Pad short marker output so it overwrites the previous render's cells.
      const timeoutText = leftPadToStableCellWidth('🟡 SYS:TIMEOUT', paneWidth);
      process.stdout.write(timeoutText + '\n', () => process.exit(1));
    }, 8000);

    const status = await statusLine.generateStatus();

    clearTimeout(timeout);

    // Pad to a stable cell count so tmux repaints the full status-right area
    // every render — see leftPadToStableCellWidth() commentary at top of file.
    // Caching the padded form means readers (status-line-fast.cjs,
    // combined-status-line-wrapper.js) emit padded output too, with no
    // re-padding logic required on their side.
    const paddedText = leftPadToStableCellWidth(status.text, paneWidth);

    // Write cache for fast-path on subsequent invocations (keyed per-project)
    try { writeFileSync(cacheFile, paddedText, 'utf8'); } catch { /* best effort */ }

    // Claude Code status line expects plain text output
    // Rich features like tooltips may need different configuration
    // Use explicit stdout.write with callback to ensure complete flush before exit
    process.stdout.write(paddedText + '\n', () => {
      process.exit(0);
    });
  } catch (error) {
    // CRITICAL: Log actual error to stderr so we can debug, not silent failure!
    console.error(`⚠️ FATAL ERROR in status line generation: ${error.message}`);
    console.error(error.stack);
    // Pad the catch-all marker for the same reason as the success path.
    const errPaneWidth = process.env.TMUX_PANE_WIDTH || '';
    const errText = leftPadToStableCellWidth('🟡 SYS:ERR', errPaneWidth);
    process.stdout.write(errText + '\n', () => process.exit(1));
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

// Run main function
main();