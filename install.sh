#!/bin/bash
# Agent-Agnostic Coding Tools - Universal Installation Script
# Supports: Claude Code (with MCP) and GitHub CoPilot (with fallbacks)
# Platforms: macOS, Linux, Windows (via WSL/Git Bash)
# Version: 2.0.0

# Check if script is being sourced or executed
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    # Script is being executed directly
    SCRIPT_EXECUTED=true
    set -euo pipefail
else
    # Script is being sourced
    SCRIPT_EXECUTED=false
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Installation configuration
# Save original CODING_REPO before overwriting (for sandbox detection)
ORIGINAL_CODING_REPO="${CODING_REPO:-}"
CODING_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_LOG="$CODING_REPO/install.log"

# Repository URLs - will be set based on CN/VPN detection
MEMORY_VISUALIZER_REPO_SSH=""
MEMORY_VISUALIZER_REPO_HTTPS=""
MEMORY_VISUALIZER_DIR="$CODING_REPO/integrations/memory-visualizer"

SEMANTIC_ANALYSIS_DIR="$CODING_REPO/integrations/mcp-server-semantic-analysis"

# Installation status tracking
INSIDE_CN=false
PROXY_WORKING=false
INSTALLATION_WARNINGS=()
INSTALLATION_FAILURES=()
SANDBOX_MODE=false
SKIP_ALL_SYSTEM_CHANGES=false
SKIPPED_SYSTEM_DEPS=()

# Unattended / CI controls (set by parse_args / env in main).
#   NON_INTERACTIVE  — never block on a prompt; take documented defaults.
#   ASSUME_YES       — auto-approve confirm_system_change prompts (--yes).
#   CI_LITE          — downgrade missing-infra HARD gates (Docker, agent CLI,
#                      core deps) to warnings so a portability run completes and
#                      reports a summary instead of aborting at the first gap.
#   DRY_RUN          — print the mutation manifest and exit 0 without touching
#                      anything (--dry-run).
NON_INTERACTIVE=false
ASSUME_YES=false
CI_LITE=false
DRY_RUN=false

# Which agent configuration scope the user chose. See ask_agent_scope().
#   wrapper — nothing outside this repo is configured; bin/coding injects
#             everything per-launch. Bare `claude`/`copilot`/`opencode` are
#             byte-for-byte unaffected. THIS IS THE DEFAULT.
#   global  — hooks/MCP are written into the user's global agent configs, so
#             bare sessions are observed too. Opt-in only.
CODING_AGENT_SCOPE="wrapper"

# ─────────────────────────────────────────────────────────────────────────────
# MUTATION MANIFEST
#
# Every change this installer can make OUTSIDE the repo is declared here, in one
# place, and printed before anything happens. It is declarative on purpose: a
# prose list drifts from reality within a release or two, and the user's whole
# basis for consent is that this list is complete.
#
# Format:  scope|path|action|reversible|why
#
# scope:  repo   — inside $CODING_REPO. Safe: deleting the repo removes it.
#         home   — under $HOME, ours alone. Reversible by uninstall.sh.
#         global — a config file SHARED with the user's own tools. Changing these
#                  affects how bare agents behave. Requires explicit opt-in.
#         system — background services that persist across logins.
#
# uninstall.sh consumes the same table, so the two cannot drift apart.
# ─────────────────────────────────────────────────────────────────────────────
mutation_manifest() {
    cat <<'MANIFEST'
repo|$CODING_REPO/node_modules|create|yes|Node dependencies
repo|$CODING_REPO/.env|append|yes|local settings (history repo URL, feature flags)
repo|$CODING_REPO/.npmrc|create|yes|proxy for npm, only if env vars are not honoured
repo|$CODING_REPO/.git/hooks/pre-commit|replace|yes|knowledge-snapshot guard (original saved as pre-commit.coding-orig)
repo|$CODING_REPO/lib/km-core|checkout|yes|git submodule required for session logging
home|~/bin/coding|symlink|yes|makes the `coding` command available on PATH
home|$SHELL_RC|one marker block|yes|exports CODING_REPO and adds bin/ to PATH
global|~/.claude/settings.json|merge hooks|yes|OPT-IN: adds hooks that run for EVERY claude session, in every project
global|~/.claude.json|merge mcpServers|yes|OPT-IN: MCP servers visible to bare `claude` everywhere
global|~/.claude/commands/|copy skills|yes|OPT-IN: slash commands available to bare `claude` everywhere
global|~/.config/opencode/opencode.json|merge plugins|yes|OPT-IN: plugins load in every opencode session
global|~/.copilot/settings.json|enableFileHooks|yes|OPT-IN (separate): lets repo hooks fire in ANY of your repos
system|~/Library/LaunchAgents/com.coding.llm-cli-proxy.plist|create+load|yes|OPT-IN: starts the LLM proxy at login (macOS)
system|~/.config/systemd/user/llm-cli-proxy.service|create+enable|yes|OPT-IN: starts the LLM proxy at login (Linux)
MANIFEST
}

# Print the manifest grouped by scope, with a hard visual break between what is
# safe and what needs consent.
print_impact_manifest() {
    echo ""
    echo -e "${PURPLE}════════════════════════════════════════════════════════════════════${NC}"
    echo -e "${PURPLE}  WHAT THIS INSTALLER WILL CHANGE ON YOUR MACHINE${NC}"
    echo -e "${PURPLE}════════════════════════════════════════════════════════════════════${NC}"

    local scope path action reversible why line
    local shown_header=""

    for scope in repo home global system; do
        local any=false
        while IFS='|' read -r s path action reversible why; do
            [[ "$s" == "$scope" ]] || continue
            # Only show rows that can actually apply here. Listing a systemd unit
            # on macOS (or a LaunchAgent on Linux) makes the manifest look
            # careless and undermines its purpose as a consent document.
            case "$path" in
                *LaunchAgents*) [[ "$PLATFORM" == "macos" ]] || continue ;;
                *systemd*)      [[ "$PLATFORM" == "linux" || "$PLATFORM" == "wsl" ]] || continue ;;
            esac
            if [[ "$any" == "false" ]]; then
                any=true
                case "$scope" in
                    repo)
                        echo ""
                        echo -e "${GREEN}▸ Inside the repo — removed entirely if you delete it${NC}"
                        ;;
                    home)
                        echo ""
                        echo -e "${CYAN}▸ In your home directory — ours alone, reverted by ./uninstall.sh${NC}"
                        ;;
                    global)
                        echo ""
                        echo -e "${YELLOW}────────────────────────────────────────────────────────────────────${NC}"
                        echo -e "${YELLOW}▸ SHARED with your own tools — changes how BARE agents behave${NC}"
                        echo -e "${YELLOW}  Skipped unless you opt in. Default is NO.${NC}"
                        ;;
                    system)
                        echo ""
                        echo -e "${YELLOW}▸ Background services that survive logout${NC}"
                        echo -e "${YELLOW}  Skipped unless you opt in. Default is NO.${NC}"
                        ;;
                esac
            fi
            # Expand $CODING_REPO / $SHELL_RC / ~ for display.
            local shown="${path/\$CODING_REPO/$CODING_REPO}"
            shown="${shown/\$SHELL_RC/$SHELL_RC}"
            shown="${shown/#\~/$HOME}"
            printf "    %-58s %s\n" "$shown" "[$action]"
            printf "      └─ %s\n" "$why"
        done < <(mutation_manifest)
    done

    echo ""
    echo -e "${PURPLE}────────────────────────────────────────────────────────────────────${NC}"
    echo "  Everything above is reversible with ./uninstall.sh."
    echo "  Nothing else on your machine is touched. Bare 'claude', 'copilot' and"
    echo "  'opencode' keep working exactly as they do now unless you opt in."
    echo -e "${PURPLE}════════════════════════════════════════════════════════════════════${NC}"
    echo ""
}

# Safety: Confirm before any system-level modification
# Usage: confirm_system_change "action description" "risk warning"
# Returns: 0 if approved, 1 if declined
confirm_system_change() {
    local action="$1"
    local risk="$2"

    # Skip if user already chose to skip all
    if [[ "$SKIP_ALL_SYSTEM_CHANGES" == "true" ]]; then
        return 1
    fi

    # Unattended paths: --yes approves, --ci/--non-interactive declines (safe).
    if [[ "$ASSUME_YES" == "true" ]]; then
        info "[--yes] auto-approving system change: $action"
        return 0
    fi
    if [[ "$NON_INTERACTIVE" == "true" ]]; then
        info "[non-interactive] declining optional system change: $action"
        return 1
    fi

    echo ""
    echo -e "${YELLOW}╔══════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${YELLOW}║               SYSTEM MODIFICATION REQUEST                            ║${NC}"
    echo -e "${YELLOW}╚══════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${CYAN}Action:${NC} $action"
    echo ""
    echo -e "${RED}Risk:${NC} $risk"
    echo ""
    echo -e "${BLUE}Options:${NC}"
    echo -e "  ${GREEN}y${NC} = Proceed with this action"
    echo -e "  ${YELLOW}n${NC} = Skip this action (installation continues)"
    echo -e "  ${PURPLE}skip-all${NC} = Skip ALL remaining system modifications"
    echo ""
    read -p "$(echo -e ${CYAN}Your choice [y/N/skip-all]: ${NC})" response

    case "$response" in
        [yY]|[yY][eE][sS])
            return 0
            ;;
        skip-all|SKIP-ALL|Skip-all)
            SKIP_ALL_SYSTEM_CHANGES=true
            info "Skipping all remaining system modifications"
            return 1
            ;;
        *)
            return 1
            ;;
    esac
}

# Repository URLs by network location
# Only memory-visualizer has a CN mirror, others always use public repos

# Memory Visualizer (HAS CN MIRROR)
MEMORY_VISUALIZER_CN_SSH="git@cc-github.bmwgroup.net:frankwoernle/memory-visualizer.git"
MEMORY_VISUALIZER_CN_HTTPS="https://cc-github.bmwgroup.net/frankwoernle/memory-visualizer.git"
MEMORY_VISUALIZER_PUBLIC_SSH="git@github.com:fwornle/memory-visualizer.git"
MEMORY_VISUALIZER_PUBLIC_HTTPS="https://github.com/fwornle/memory-visualizer.git"

# Semantic Analysis MCP Server (HAS CN MIRROR)
SEMANTIC_ANALYSIS_CN_SSH="git@cc-github.bmwgroup.net:frankwoernle/mcp-server-semantic-analysis.git"
SEMANTIC_ANALYSIS_CN_HTTPS="https://cc-github.bmwgroup.net/frankwoernle/mcp-server-semantic-analysis.git"
SEMANTIC_ANALYSIS_PUBLIC_SSH="git@github.com:fwornle/mcp-server-semantic-analysis.git"
SEMANTIC_ANALYSIS_PUBLIC_HTTPS="https://github.com/fwornle/mcp-server-semantic-analysis.git"

# Platform detection
PLATFORM=""
SHELL_RC=""
detect_platform() {
    case "$(uname -s)" in
        Darwin*)
            PLATFORM="macos"
            ;;
        Linux*)
            # WSL reports "Linux" from `uname -s` but is NOT a native Linux host:
            # there is no launchd, `systemctl --user` may be absent entirely
            # (WSL1 and older WSL2 without systemd), and Docker is Docker Desktop
            # running on the Windows side. Detecting it as its own platform lets
            # those branches be skipped with an explanation instead of failing.
            if [[ -n "${WSL_DISTRO_NAME:-}" ]] \
               || grep -qiE 'microsoft|wsl' /proc/version 2>/dev/null; then
                PLATFORM="wsl"
            else
                PLATFORM="linux"
            fi
            ;;
        MINGW*|CYGWIN*|MSYS*)
            PLATFORM="windows"
            ;;
        *)
            echo -e "${RED}Unsupported platform: $(uname -s)${NC}"
            exit 1
            ;;
    esac

    # Detect actual shell in use (prefer accuracy over platform defaults)
    if [[ -n "$SHELL" ]]; then
        case "$SHELL" in
            */zsh)
                SHELL_RC="$HOME/.zshrc"
                ;;
            */bash)
                # Check which bash config exists and is used
                if [[ -f "$HOME/.bash_profile" ]]; then
                    SHELL_RC="$HOME/.bash_profile"
                elif [[ -f "$HOME/.bashrc" ]]; then
                    SHELL_RC="$HOME/.bashrc"
                else
                    SHELL_RC="$HOME/.bash_profile"  # Create if needed
                fi
                ;;
            *)
                # Fallback to platform default
                if [[ "$PLATFORM" == "macos" ]]; then
                    SHELL_RC="$HOME/.zshrc"
                else
                    SHELL_RC="$HOME/.bashrc"
                fi
                ;;
        esac
    else
        # No $SHELL set, use platform default
        if [[ "$PLATFORM" == "macos" ]]; then
            SHELL_RC="$HOME/.zshrc"
        else
            SHELL_RC="$HOME/.bashrc"
        fi
    fi
}

# Detect if we should run in sandbox mode
detect_sandbox_mode() {
    # Check if ORIGINAL_CODING_REPO is already set and points to a valid coding installation
    if [[ -n "$ORIGINAL_CODING_REPO" ]] && [[ -d "$ORIGINAL_CODING_REPO" ]] && [[ -f "$ORIGINAL_CODING_REPO/bin/coding" ]]; then
        local current_install="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

        # If ORIGINAL_CODING_REPO points to a different installation, use sandbox mode
        if [[ "$ORIGINAL_CODING_REPO" != "$current_install" ]]; then
            SANDBOX_MODE=true

            echo ""
            echo -e "${YELLOW}╔══════════════════════════════════════════════════════════════════════╗${NC}"
            echo -e "${YELLOW}║                                                                      ║${NC}"
            echo -e "${YELLOW}║                      ${RED}SANDBOX MODE DETECTED${YELLOW}                          ║${NC}"
            echo -e "${YELLOW}║                                                                      ║${NC}"
            echo -e "${YELLOW}╚══════════════════════════════════════════════════════════════════════╝${NC}"
            echo ""
            echo -e "${CYAN}A coding installation is already configured at:${NC}"
            echo -e "  ${GREEN}$ORIGINAL_CODING_REPO${NC}"
            echo ""
            echo -e "${CYAN}You are attempting to install to:${NC}"
            echo -e "  ${BLUE}$current_install${NC}"
            echo ""
            echo -e "${YELLOW}Installing in SANDBOX MODE to prevent conflicts.${NC}"
            echo ""
            echo -e "${CYAN}Sandbox mode will:${NC}"
            echo -e "  ${GREEN}✓${NC} NOT modify global shell configs (.zshrc, .bash_profile)"
            echo -e "  ${GREEN}✓${NC} Create local .activate file for manual sourcing"
            echo -e "  ${GREEN}✓${NC} Allow testing install.sh without pollution"
            echo ""
            echo -e "${CYAN}To use this installation after install completes:${NC}"
            echo -e "  ${BLUE}source $current_install/.activate${NC}"
            echo ""

            # Unattended: proceed with the sandbox install (it is non-mutating
            # by design). Interactive behaviour is unchanged (empty = cancel).
            local response
            if [[ "$NON_INTERACTIVE" == "true" ]]; then
                response="y"
                info "[non-interactive] proceeding with sandbox installation"
            else
                read -p "$(echo -e ${YELLOW}Continue with sandbox installation? [y/N]: ${NC})" response || response="n"
            fi
            case "$response" in
                [yY][eE][sS]|[yY])
                    info "Proceeding with sandbox installation..."
                    echo ""
                    ;;
                *)
                    info "Installation cancelled by user"
                    exit 0
                    ;;
            esac
        fi
    fi
}

# Logging functions
#
# Never let logging abort the install. If $INSTALL_LOG is not writable — a
# root-owned checkout, a read-only mount, a directory owned by another user —
# every log() call would fail, and under `set -e` the very first one killed the
# script with a bare "Permission denied" before any of our own diagnostics could
# explain why. Fall back to a temp file once, tell the user where it went, and
# carry on.
log() {
    if [[ "${INSTALL_LOG_WRITABLE:-unknown}" == "unknown" ]]; then
        if ( : >> "$INSTALL_LOG" ) 2>/dev/null; then
            INSTALL_LOG_WRITABLE=yes
        else
            local fallback="${TMPDIR:-/tmp}/coding-install-$$.log"
            echo -e "${YELLOW}⚠️  Cannot write $INSTALL_LOG — logging to $fallback instead${NC}" >&2
            INSTALL_LOG="$fallback"
            if ( : >> "$INSTALL_LOG" ) 2>/dev/null; then
                INSTALL_LOG_WRITABLE=yes
            else
                INSTALL_LOG_WRITABLE=no
            fi
        fi
    fi
    [[ "$INSTALL_LOG_WRITABLE" == "yes" ]] || return 0
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$INSTALL_LOG" 2>/dev/null || true
}

error_exit() {
    echo -e "${RED}ERROR: $1${NC}" >&2
    log "ERROR: $1"
    exit 1
}

success() {
    echo -e "${GREEN}✅ $1${NC}"
    log "SUCCESS: $1"
}

info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
    log "INFO: $1"
}

warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
    log "WARNING: $1"
}

# Gate for anything that writes a config file SHARED with the user's own tools
# (~/.claude, ~/.claude.json, ~/.config/opencode, ~/.opencode, ~/.copilot).
#
# Requirement: installing this project MUST NOT change how bare `claude`,
# `copilot` or `opencode` behave. Those configs are global, so writing them
# changes every project on the machine — therefore they are opt-in only, and
# CODING_AGENT_SCOPE defaults to "wrapper".
#
# Usage, as the first line of any such function:
#     require_global_scope "what this would configure" || return 0
#
# In wrapper mode the equivalent capability is injected per-launch by bin/coding
# instead, so the feature is not lost for agents started through the wrapper.
require_global_scope() {
    local what="$1"
    if [[ "$CODING_AGENT_SCOPE" == "global" ]]; then
        return 0
    fi
    info "Skipping $what (wrapper-scoped install — your global agent config is untouched)"
    log "SKIP (wrapper scope): $what"
    return 1
}

# Set KEY=VALUE in the repo-local .env, replacing any existing line for KEY.
# Idempotent: re-running never appends a duplicate. Repo-local only — this
# never touches the user's shell environment or any file outside $CODING_REPO.
set_env_var() {
    local key="$1" value="$2"
    local env_file="$CODING_REPO/.env"

    [[ -f "$env_file" ]] || touch "$env_file"

    if grep -q "^${key}=" "$env_file" 2>/dev/null; then
        local tmp
        tmp="$(mktemp)"
        awk -v k="$key" -v v="$value" '
            $0 ~ "^" k "=" { print k "=" v; found=1; next }
            { print }
            END { if (!found) print k "=" v }
        ' "$env_file" > "$tmp" && mv "$tmp" "$env_file"
    else
        echo "${key}=${value}" >> "$env_file"
    fi
    log "Set ${key}=${value} in .env"
}

# ─────────────────────────────────────────────────────────────────────────────
# Proxy configuration for the install itself
#
# WHY THIS EXISTS: `npm install` resolves and downloads from the network, and
# native modules (fastembed -> onnxruntime-node) fetch prebuilt binaries from
# github.com in their lifecycle scripts. Behind a corporate proxy with no
# proxy env set, that fails with `getaddrinfo ENOTFOUND github.com` several
# minutes into the install. This must therefore run BEFORE any network step.
#
# INVARIANT: this function never unsets a proxy variable it did not set itself.
# scripts/detect-network.sh deliberately unsets HTTP_PROXY/HTTPS_PROXY when it
# cannot reach proxydetox — correct for a macOS launcher, actively harmful here,
# because on a corporate Linux box the user's own working proxy would be
# destroyed. We reuse its detection, never its mutation.
#
# Opt out entirely with CODING_INSTALL_PROXY=0.
# ─────────────────────────────────────────────────────────────────────────────

PROXY_SOURCE=""          # human-readable origin of the proxy we selected
NETWORK_DIRECT_OK=false  # true when github.com is reachable with no proxy
NETWORK_OK=true          # false once preflight proves the network is unusable;
                         # network-dependent steps then skip instead of failing

# Verify a proxy candidate by actually fetching through it. A listening port is
# not evidence; a 200/301 from github.com is.
_proxy_verifies() {
    local px="$1"
    [[ -n "$px" ]] || return 1
    curl -sS -o /dev/null --connect-timeout 6 --max-time 20 -x "$px" https://github.com/ >/dev/null 2>&1
}

_direct_verifies() {
    curl -sS -o /dev/null --connect-timeout 6 --max-time 20 --noproxy '*' https://github.com/ >/dev/null 2>&1
}

# Collect candidate proxies from the places corporate Linux/Windows boxes
# actually keep them. Order matters: the user's own environment wins.
_proxy_candidates() {
    local c

    # 1. Whatever the user already exported (captured before we touch anything).
    #    if/fi, not `[[ ]] && echo`: under `set -e` the failing AND-list would
    #    abort this function and silently truncate the candidate list.
    if [[ -n "${USER_PROXY:-}" ]]; then echo "$USER_PROXY"; fi

    # 2. An existing npm proxy config (honours a hand-written ~/.npmrc)
    if command -v npm >/dev/null 2>&1; then
        for c in $(npm config get https-proxy 2>/dev/null) $(npm config get proxy 2>/dev/null); do
            [[ "$c" == "null" || "$c" == "undefined" || -z "$c" ]] || echo "$c"
        done
    fi

    # 3. /etc/environment — the standard system-wide spot on Debian/Ubuntu
    if [[ -r /etc/environment ]]; then
        grep -hoiE '(https?_proxy)=["'"'"']?[^"'"'"'[:space:]]+' /etc/environment 2>/dev/null \
            | sed -E 's/^[^=]+=["'"'"']?//' || true
    fi

    # 4. APT's proxy — very common corporate footprint, and often the only one set
    if compgen -G "/etc/apt/apt.conf.d/*" >/dev/null 2>&1; then
        grep -hoiE 'Acquire::https?::Proxy[[:space:]]+"[^"]+"' /etc/apt/apt.conf.d/* 2>/dev/null \
            | sed -E 's/.*"([^"]+)".*/\1/' || true
    fi

    # 5. A local PAC-aware proxy (proxydetox / cntlm), the sanctioned Linux answer
    echo "http://127.0.0.1:3128"
}

configure_proxy_for_install() {
    if [[ "${CODING_INSTALL_PROXY:-1}" == "0" ]]; then
        info "Proxy auto-configuration disabled (CODING_INSTALL_PROXY=0) — using the environment as-is"
        return 0
    fi

    echo -e "\n${CYAN}🌐 Configuring network access for the installation...${NC}"

    # Capture the user's proxy BEFORE anything can modify the environment.
    USER_PROXY="${HTTPS_PROXY:-${https_proxy:-${HTTP_PROXY:-${http_proxy:-}}}}"

    # Reuse the launcher's detection library. It is written for `set -e` only,
    # so relax `set -u` across the source+call and restore it afterwards.
    local _had_u=0
    case "$-" in *u*) _had_u=1 ;; esac
    set +u
    : "${CODING_FORCE_CN:=}"
    if [[ -r "$CODING_REPO/scripts/detect-network.sh" ]]; then
        # shellcheck source=/dev/null
        source "$CODING_REPO/scripts/detect-network.sh" >/dev/null 2>&1 || true
        if declare -f detect_corporate_network >/dev/null 2>&1; then
            detect_corporate_network >/dev/null 2>&1 || true
        fi
    fi
    if [[ "$_had_u" == "1" ]]; then set -u; fi

    if [[ "${INSIDE_CN:-false}" == "true" ]]; then
        info "Corporate network detected"
    else
        info "Corporate network not detected (public or VPN-less)"
    fi

    # 1. Test the environment EXACTLY as npm will see it. If the user already
    #    has a working setup (proxy or not), change nothing at all.
    if curl -sS -o /dev/null --connect-timeout 8 --max-time 25 https://github.com/ >/dev/null 2>&1; then
        PROXY_WORKING=true
        if [[ -n "$USER_PROXY" ]]; then
            PROXY_SOURCE="$USER_PROXY"
            success "Your existing proxy works ($USER_PROXY) — leaving it untouched"
        else
            NETWORK_DIRECT_OK=true
            PROXY_SOURCE="direct"
            success "github.com reachable directly — no proxy needed"
        fi
        return 0
    fi

    # 2. The environment as-is does NOT work. If a proxy is configured, it is
    #    the likely culprit — check whether bypassing it succeeds. This is the
    #    one case where we override a user proxy, and only for this process:
    #    a verifiably broken proxy is not something to preserve.
    if [[ -n "$USER_PROXY" ]] && _direct_verifies; then
        warning "Configured proxy '$USER_PROXY' cannot reach github.com, but direct access works"
        info "  Bypassing it for this installation only (your shell config is not modified)"
        unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy
        NETWORK_DIRECT_OK=true
        PROXY_WORKING=true
        PROXY_SOURCE="direct (configured proxy bypassed)"
        return 0
    fi

    info "Neither direct access nor the current environment reaches github.com — searching for a proxy..."

    local cand seen=""
    while IFS= read -r cand; do
        [[ -n "$cand" ]] || continue
        # Normalise before dedup: bare host:port -> URL, and strip trailing
        # slashes so "…:3128/" and "…:3128" are not probed twice.
        [[ "$cand" == *://* ]] || cand="http://$cand"
        cand="${cand%%/}"
        case "$seen" in *"|$cand|"*) continue ;; esac
        seen="$seen|$cand|"

        info "  trying $cand ..."
        if _proxy_verifies "$cand"; then
            export HTTP_PROXY="$cand"  HTTPS_PROXY="$cand"
            export http_proxy="$cand"  https_proxy="$cand"
            # npm honours these and, unlike a config file, they propagate into
            # the child processes that native lifecycle scripts spawn.
            export npm_config_proxy="$cand" npm_config_https_proxy="$cand"

            # NO_PROXY is additive — never clobber what the user set.
            local base_no_proxy="localhost,127.0.0.1,::1,.bmwgroup.net"
            if [[ -n "${NO_PROXY:-${no_proxy:-}}" ]]; then
                export NO_PROXY="${NO_PROXY:-$no_proxy},$base_no_proxy"
            else
                export NO_PROXY="$base_no_proxy"
            fi
            export no_proxy="$NO_PROXY"

            PROXY_WORKING=true
            PROXY_SOURCE="$cand"
            success "Using proxy $cand for this installation"
            info "  (exported for this process only — your shell config is not modified)"
            return 0
        fi
    done < <(_proxy_candidates)

    # Nothing worked. Change NOTHING and let preflight fail with real guidance.
    PROXY_WORKING=false
    PROXY_SOURCE=""
    warning "No working proxy found — leaving your environment untouched"
    return 0
}

# Fail fast, before the expensive npm install, with an actionable message.
preflight_network() {
    echo -e "\n${CYAN}🔎 Verifying network reachability before installing dependencies...${NC}"

    local failed=()
    local host

    # With a proxy configured the client does not resolve the target itself —
    # the proxy does — so only DNS-check when we are going direct.
    if [[ -z "$PROXY_SOURCE" || "$PROXY_SOURCE" == "direct" ]]; then
        if ! python3 -c "import socket,sys; socket.gethostbyname('github.com')" >/dev/null 2>&1; then
            failed+=("DNS: cannot resolve github.com")
        fi
    fi

    for host in "https://github.com/" "https://registry.npmjs.org/"; do
        if ! curl -sS -o /dev/null --connect-timeout 8 --max-time 25 "$host" >/dev/null 2>&1; then
            failed+=("HTTP: cannot reach $host")
        fi
    done

    if [[ ${#failed[@]} -eq 0 ]]; then
        success "Network OK (via ${PROXY_SOURCE:-direct})"
        return 0
    fi

    echo ""
    echo -e "${RED}Network preflight failed:${NC}"
    local f; for f in "${failed[@]}"; do echo "  ✗ $f"; done
    echo ""
    echo -e "${YELLOW}This is the exact failure that kills 'npm install' several minutes in,${NC}"
    echo -e "${YELLOW}inside onnxruntime-node's postinstall (ENOTFOUND github.com).${NC}"
    echo ""
    echo -e "${CYAN}Detected:${NC}"
    echo "  corporate network : ${INSIDE_CN:-false}"
    echo "  proxy in use      : ${PROXY_SOURCE:-none}"
    echo ""
    echo -e "${CYAN}Fix one of these, then re-run ./install.sh:${NC}"
    echo "  • export https_proxy=http://<corp-proxy>:<port>   (check /etc/environment, or ask IT)"
    echo "  • run a local PAC-aware proxy (proxydetox, cntlm) on 127.0.0.1:3128"
    echo "  • connect to the VPN, or leave the corporate network entirely"
    echo ""

    if [[ "$CI_LITE" == "true" ]]; then
        # CI-lite exists to exercise the script's portability without a network.
        # Record the failure and let the run continue — but mark the network as
        # down so the steps that REQUIRE it skip cleanly instead of failing deep
        # inside npm with a misleading "Failed to install Node.js dependencies".
        warning "Network unreachable — continuing (CI-lite portability run)"
        info "  Network-dependent steps will be skipped, not attempted."
        NETWORK_OK=false
        INSTALLATION_FAILURES+=("Network preflight failed: ${failed[*]}")
        return 0
    fi

    error_exit "Network preflight failed — see the guidance above."
}

# Check for required dependencies
check_dependencies() {
    echo -e "${CYAN}🔍 Checking dependencies...${NC}"
    
    local missing_deps=()
    
    # Core dependencies
    if ! command -v git >/dev/null 2>&1; then
        missing_deps+=("git")
    fi
    
    if ! command -v node >/dev/null 2>&1; then
        missing_deps+=("node")
    else
        # Node.js exists - verify it actually works (catches library issues like simdjson mismatch)
        local node_health_output
        if ! node_health_output=$(node -e "console.log('ok')" 2>&1); then
            echo ""
            echo -e "${RED}╔══════════════════════════════════════════════════════════════════════╗${NC}"
            echo -e "${RED}║                                                                      ║${NC}"
            echo -e "${RED}║              ⚠️  NODE.JS IS BROKEN ⚠️                                  ║${NC}"
            echo -e "${RED}║                                                                      ║${NC}"
            echo -e "${RED}╚══════════════════════════════════════════════════════════════════════╝${NC}"
            echo ""
            echo -e "${YELLOW}Node.js is installed but fails to execute. This is commonly caused by${NC}"
            echo -e "${YELLOW}Homebrew library version mismatches (e.g., libsimdjson, libuv).${NC}"
            echo ""
            echo -e "${CYAN}Error:${NC}"
            echo "$node_health_output" | head -5
            echo ""
            echo -e "${CYAN}Common causes and fixes:${NC}"
            echo -e "  ${GREEN}1.${NC} Library mismatch after Homebrew update - try: brew upgrade"
            echo -e "  ${GREEN}2.${NC} Use nvm for isolated Node management: nvm install --lts && nvm use --lts"
            echo -e "  ${GREEN}3.${NC} Check if libsimdjson needs linking: brew link simdjson"
            echo ""
            echo -e "${RED}IMPORTANT:${NC} This installer will NOT attempt to fix your Node installation."
            echo -e "           Please resolve this issue manually before proceeding."
            echo ""
            error_exit "Node.js is broken. Please fix it before running this installer."
        fi
    fi

    if ! command -v npm >/dev/null 2>&1; then
        missing_deps+=("npm")
    fi
    
    if ! command -v python3 >/dev/null 2>&1; then
        missing_deps+=("python3")
    fi
    
    if ! command -v curl >/dev/null 2>&1; then
        missing_deps+=("curl")
    fi

    # ── Soft dependencies: report, never block ───────────────────────────────
    # None of these justify aborting the install:
    #
    #   jq       Every consumer has a non-jq fallback (setup_mcp_config, the
    #            Claude hook installer). Absence degrades, it does not break.
    #   plantuml install_plantuml() runs LATER in main() and offers both a
    #            "skip" option and a repo-local JAR fallback. Gating on it here
    #            aborted the install before its own installer could ever run —
    #            the gate and the installer for the same tool were inverted.
    #   tmux     Never used by install.sh at all. It is a launch-time need and
    #            is already enforced where it belongs, in config/agents/*.sh.
    #            On Windows the hint below even admits tmux is unavailable
    #            natively, yet the gate still killed the install.
    local soft_deps=()
    command -v jq       >/dev/null 2>&1 || soft_deps+=("jq")
    command -v plantuml >/dev/null 2>&1 || soft_deps+=("plantuml")
    command -v tmux     >/dev/null 2>&1 || soft_deps+=("tmux")

    # Platform-specific checks
    if [[ "$PLATFORM" == "macos" ]]; then
        if ! command -v brew >/dev/null 2>&1; then
            warning "Homebrew not found. Some installations may require manual setup."
        else
            # Check for GNU coreutils (provides timeout command needed by test scripts)
            if ! command -v timeout >/dev/null 2>&1; then
                if confirm_system_change \
                    "Install GNU coreutils via Homebrew (brew install coreutils)" \
                    "Provides the 'timeout' command needed for test scripts. Safe to install."; then
                    info "Installing GNU coreutils (for timeout command)..."
                    if brew install coreutils; then
                        # Add gnubin to PATH for this session
                        export PATH="/opt/homebrew/opt/coreutils/libexec/gnubin:$PATH"
                        success "GNU coreutils installed successfully"
                        info "Adding gnubin to PATH in shell config..."
                        # Add to shell config if not already there
                        if ! grep -q "coreutils/libexec/gnubin" "$SHELL_RC" 2>/dev/null; then
                            echo '' >> "$SHELL_RC"
                            echo '# GNU coreutils (provides timeout, etc.)' >> "$SHELL_RC"
                            echo 'export PATH="/opt/homebrew/opt/coreutils/libexec/gnubin:$PATH"' >> "$SHELL_RC"
                        fi
                    else
                        warning "Failed to install GNU coreutils. Some test scripts may not work."
                        SKIPPED_SYSTEM_DEPS+=("coreutils")
                    fi
                else
                    warning "Skipped coreutils installation. timeout command may not be available."
                    SKIPPED_SYSTEM_DEPS+=("coreutils")
                    info "To install manually: brew install coreutils"
                fi
            else
                success "GNU coreutils (timeout) is already available"
            fi
        fi
    fi
    
    if [[ ${#missing_deps[@]} -ne 0 ]]; then
        echo -e "${RED}Missing required dependencies: ${missing_deps[*]}${NC}"
        echo -e "${YELLOW}Please install the missing dependencies and run the installer again.${NC}"
        
        # Provide installation hints — these list ONLY the hard requirements.
        # Soft deps are reported separately below and never block.
        echo -e "\n${CYAN}Installation hints:${NC}"
        case "$PLATFORM" in
            macos)
                echo "  - Install Homebrew: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
                echo "  - Then run: brew install git node python3 curl"
                ;;
            linux|wsl)
                echo "  - Ubuntu/Debian: sudo apt-get update && sudo apt-get install -y git nodejs npm python3 python3-pip curl"
                echo "  - RHEL/CentOS:   sudo yum install -y git nodejs npm python3 python3-pip curl"
                echo "  - Arch:          sudo pacman -S git nodejs npm python python-pip curl"
                ;;
            windows)
                echo "  - Install Git Bash: https://git-scm.com/downloads"
                echo "  - Install Node.js:  https://nodejs.org/"
                echo "  - Install Python:   https://www.python.org/downloads/"
                ;;
        esac
        if [[ "$CI_LITE" == "true" ]]; then
            warning "Missing core dependencies (${missing_deps[*]}) — continuing (CI-lite portability run)"
            INSTALLATION_FAILURES+=("Core dependencies missing: ${missing_deps[*]}")
        else
            exit 1
        fi
    fi

    if [[ ${#missing_deps[@]} -eq 0 ]]; then
        success "All required dependencies are installed"
    fi

    # Soft dependencies: inform, then carry on. Each line says what is lost and
    # who fixes it, so the user never has to guess whether it matters.
    if [[ ${#soft_deps[@]} -ne 0 ]]; then
        echo ""
        info "Optional tools not found: ${soft_deps[*]} (installation continues)"
        local _sd
        for _sd in "${soft_deps[@]}"; do
            case "$_sd" in
                jq)       echo "    • jq       — JSON edits fall back to python3/node. Install for cleaner merges." ;;
                plantuml) echo "    • plantuml — this installer offers to install it later, or use a repo-local JAR." ;;
                tmux)     echo "    • tmux     — only needed when you launch an agent via 'coding'; install before first use." ;;
            esac
        done
        INSTALLATION_WARNINGS+=("Optional tools missing: ${soft_deps[*]}")
    fi
}

# Install memory-visualizer (git submodule)
install_memory_visualizer() {
    echo -e "\n${CYAN}📊 Installing memory-visualizer (git submodule)...${NC}"

    cd "$CODING_REPO"

    # Check for both .git directory and .git file (for submodules)
    if [[ -d "$MEMORY_VISUALIZER_DIR/.git" ]] || [[ -f "$MEMORY_VISUALIZER_DIR/.git" ]]; then
        info "Memory visualizer submodule already exists, updating..."
        cd "$MEMORY_VISUALIZER_DIR"
        if timeout 10s git pull origin main 2>/dev/null; then
            success "Memory visualizer updated"
        else
            info "Could not update memory-visualizer (may be on specific commit)"
        fi
    else
        info "Initializing memory-visualizer submodule..."
        git submodule update --init --recursive integrations/memory-visualizer || error_exit "Failed to initialize memory-visualizer submodule"
    fi

    cd "$MEMORY_VISUALIZER_DIR"

    # Install dependencies
    info "Installing memory-visualizer dependencies..."
    npm install || error_exit "Failed to install memory-visualizer dependencies"

    # Build the visualizer
    info "Building memory-visualizer..."
    npm run build || error_exit "Failed to build memory-visualizer"

    # Update browserslist database to suppress warnings
    info "Updating browserslist database..."
    npx update-browserslist-db@latest 2>/dev/null || warning "Could not update browserslist database"

    # Update vkb script to use local memory-visualizer
    if [[ "$PLATFORM" == "macos" ]]; then
        sed -i '' "s|VISUALIZER_DIR=.*|VISUALIZER_DIR=\"$MEMORY_VISUALIZER_DIR\"|" "$CODING_REPO/knowledge-management/vkb"
    else
        sed -i "s|VISUALIZER_DIR=.*|VISUALIZER_DIR=\"$MEMORY_VISUALIZER_DIR\"|" "$CODING_REPO/knowledge-management/vkb"
    fi

    success "Memory visualizer installed successfully"
}

# Install semantic analysis MCP server (git submodule)
install_semantic_analysis() {
    echo -e "\n${CYAN}🧠 Installing semantic analysis MCP server (git submodule)...${NC}"

    cd "$CODING_REPO"

    # Check for both .git directory and .git file (for submodules)
    if [[ -d "$SEMANTIC_ANALYSIS_DIR/.git" ]] || [[ -f "$SEMANTIC_ANALYSIS_DIR/.git" ]]; then
        info "mcp-server-semantic-analysis submodule already exists, updating..."
        cd "$SEMANTIC_ANALYSIS_DIR"
        if timeout 10s git pull origin main 2>/dev/null; then
            success "mcp-server-semantic-analysis updated"
        else
            info "Could not update mcp-server-semantic-analysis (may be on specific commit)"
        fi
    else
        info "Initializing mcp-server-semantic-analysis submodule..."
        git submodule update --init --recursive integrations/mcp-server-semantic-analysis || error_exit "Failed to initialize semantic-analysis submodule"
    fi

    # Only proceed with build if we have the repository
    if [[ -d "$SEMANTIC_ANALYSIS_DIR" && -f "$SEMANTIC_ANALYSIS_DIR/package.json" ]]; then
        info "Installing semantic analysis dependencies..."
        cd "$SEMANTIC_ANALYSIS_DIR"

        # Check for Node.js
        if ! command -v node &> /dev/null; then
            warning "Node.js not found. Please install Node.js 18+ to use semantic analysis."
            return 1
        fi

        # Install dependencies and build
        npm install || warning "Failed to install semantic analysis dependencies"
        npm run build || warning "Failed to build semantic analysis server"

        # Make built server executable
        if [[ -f "dist/index.js" ]]; then
            chmod +x dist/index.js
        fi

        success "Semantic analysis MCP server installed successfully"
    else
        warning "Semantic analysis repository not available - skipping build"
    fi

    cd "$CODING_REPO"
}

# Install MCP Constraint Monitor with Professional Dashboard (git submodule)
install_constraint_monitor() {
    echo -e "\n${CYAN}🚦 Installing MCP Constraint Monitor with Professional Dashboard (git submodule)...${NC}"

    cd "$CODING_REPO"

    local constraint_monitor_dir="$CODING_REPO/integrations/mcp-constraint-monitor"

    # Initialize or update submodule (check for both .git directory and .git file)
    if [[ -d "$constraint_monitor_dir/.git" ]] || [[ -f "$constraint_monitor_dir/.git" ]]; then
        info "mcp-constraint-monitor submodule already exists, updating..."
        cd "$constraint_monitor_dir"
        if timeout 10s git pull origin main 2>/dev/null; then
            success "mcp-constraint-monitor updated"
        else
            info "Could not update mcp-constraint-monitor (may be on specific commit)"
        fi
    else
        info "Initializing mcp-constraint-monitor submodule..."
        git submodule update --init --recursive integrations/mcp-constraint-monitor || {
            warning "Failed to initialize mcp-constraint-monitor submodule"
            info "You can manually clone: git clone https://github.com/fwornle/mcp-constraint-monitor.git integrations/mcp-constraint-monitor"
            INSTALLATION_WARNINGS+=("mcp-constraint-monitor: Failed to initialize submodule")
            return 1
        }
    fi

    # Install constraint monitor dependencies
    if [[ -d "$constraint_monitor_dir" && -f "$constraint_monitor_dir/package.json" ]]; then
        cd "$constraint_monitor_dir"

        # Run the constraint monitor's own install script (skip hooks - we handle those in main install)
        if [[ -f "install.sh" ]]; then
            info "Running constraint monitor installation (dependencies only)..."
            bash install.sh --skip-hooks || warning "Constraint monitor installation had issues"
        else
            # Fallback to manual installation if install.sh doesn't exist
            info "Installing constraint monitor dependencies..."
            npm install || warning "Failed to install constraint monitor dependencies"
        fi

        # Install professional dashboard dependencies
        if [[ -d "dashboard" ]]; then
            info "Installing professional dashboard dependencies..."
            cd dashboard

            # Prefer pnpm if available (Next.js works better with pnpm)
            if command -v pnpm >/dev/null 2>&1; then
                pnpm install || npm install || warning "Failed to install dashboard dependencies"
            else
                npm install || warning "Failed to install dashboard dependencies"
            fi

            cd ..
            success "Professional Dashboard dependencies installed"
            info "Dashboard runs on port 3030"
        else
            warning "Dashboard directory not found in constraint monitor"
        fi

        success "MCP Constraint Monitor with Professional Dashboard installed"
        info "Global monitoring supports multi-project constraint tracking"
        info "Hooks will be configured in the main installation process"
    else
        warning "Constraint monitor package.json not found"
        INSTALLATION_WARNINGS+=("mcp-constraint-monitor: Missing package.json")
    fi

    cd "$CODING_REPO"
}

# Install System Health Dashboard
install_system_health_dashboard() {
    echo -e "\n${CYAN}🏥 Installing System Health Dashboard...${NC}"

    if [[ ! -d "$CODING_REPO/integrations/system-health-dashboard" ]]; then
        warning "System Health Dashboard directory not found"
        return 1
    fi

    cd "$CODING_REPO/integrations/system-health-dashboard"

    if [[ ! -f "package.json" ]]; then
        warning "System Health Dashboard package.json not found"
        cd "$CODING_REPO"
        return 1
    fi

    info "Installing System Health Dashboard dependencies..."
    npm install || warning "Failed to install System Health Dashboard dependencies"

    success "System Health Dashboard dependencies installed"
    info "Dashboard will run on port 3032 (frontend) and 3033 (API)"
    info "Access at: http://localhost:3032"

    cd "$CODING_REPO"
}

# Host-side prerequisites for the CodeGraph backend.
#
# CodeGraph itself is installed in the coding-services image, NOT on the host — the
# binary, its Node runtime and its SQLite index all live in the container. What has to
# exist on the host is only what Docker and the agents cannot create themselves:
#
#   1. .codegraph/  — the bind MOUNTPOINT. CODEGRAPH_DIR takes a plain directory name
#      and rejects absolute paths, so the index cannot be redirected to .data by env
#      alone; compose binds .data/codegraph over this path instead. Docker cannot
#      mkdir a mountpoint under a read-only parent, so the directory must pre-exist or
#      the container fails to start.
#   2. .data/codegraph/ — the writable target of that bind.
#
# Non-fatal throughout, like install_graphify: a fresh clone without Docker should
# still complete an install.
_install_codegraph_support() {
    info "Preparing CodeGraph backend (container-side; host gets a mountpoint + shim)..."

    if ! mkdir -p "$CODING_REPO/.codegraph" "$CODING_REPO/.data/codegraph" 2>/dev/null; then
        warning "Could not create CodeGraph directories"
        INSTALLATION_WARNINGS+=("codegraph: could not create .codegraph / .data/codegraph")
        return 0
    fi
    touch "$CODING_REPO/.codegraph/.gitkeep" 2>/dev/null || true

    if [[ -f "$CODING_REPO/bin/codegraph" ]]; then
        chmod +x "$CODING_REPO/bin/codegraph" 2>/dev/null || true
        success "CodeGraph host shim ready (bin/codegraph → docker exec)"
    else
        warning "bin/codegraph shim missing"
        INSTALLATION_WARNINGS+=("codegraph: bin/codegraph shim missing")
    fi

    # A host-global install shadows the container one and can serve a different
    # version against a host-side index. Warn rather than uninstall — it may not be ours.
    # Identify by content, not path: any shim that delegates to `docker exec` is fine
    # wherever it lives, while a real binary on PATH is the problem regardless of name.
    local on_path
    on_path="$(command -v codegraph 2>/dev/null || true)"
    if [[ -n "$on_path" ]] && ! grep -q "docker exec" "$on_path" 2>/dev/null; then
        warning "A host-global 'codegraph' is on PATH at ${on_path}"
        warning "  It shadows the container backend and may be a different version."
        warning "  Remove with: npm -g uninstall @colbymchenry/codegraph"
        INSTALLATION_WARNINGS+=("codegraph: host-global install shadows the container backend")
    fi

    local active
    active="$(node "$CODING_REPO/scripts/code-graph-config.mjs" active 2>/dev/null || echo unknown)"
    info "  Active code-graph backend: ${active} (switch in config/code-graph.json)"
    info "  Build the index: docker exec coding-services codegraph-index.sh full"
}

# Install graphify (code knowledge graph; replaces the former code-graph-rag + Memgraph stack).
# Graphify builds a static graph.json and serves it over MCP from the coding-graphify
# container — no host Python/uv venv and no Memgraph database are required.
install_graphify() {
    echo -e "\n${CYAN}🔗 Installing graphify code knowledge graph...${NC}"

    cd "$CODING_REPO"

    # Ensure the graphify submodule is initialized (best-effort)
    info "Initializing graphify submodule..."
    if git submodule update --init integrations/graphify 2>/dev/null; then
        success "graphify submodule initialized"
    else
        warning "Could not initialize graphify submodule (integrations/graphify)"
        INSTALLATION_WARNINGS+=("graphify: submodule init failed")
    fi

    # Agent MCP registration is deliberately NOT done here. setup_mcp_config() runs
    # after this function and is the single registration path for every agent; a
    # second path here was silently overwritten by it, which is how OpenCode and
    # Copilot drifted onto a retired backend.

    success "graphify installed"
    _install_codegraph_support
    info "  - MCP server: http://localhost:3851/mcp (served by coding-graphify container)"

    cd "$CODING_REPO"
}

# Create universal command wrappers
create_command_wrappers() {
    echo -e "\n${CYAN}🔧 Creating command wrappers...${NC}"
    
    local bin_dir="$CODING_REPO/bin"
    mkdir -p "$bin_dir"
    
    # ukb command removed - use MCP server workflow instead

    # Create vkb wrapper
    cat > "$bin_dir/vkb" << 'EOF'
#!/bin/bash
# Universal vkb wrapper
CODING_REPO="$(cd "$(dirname "$(dirname "${BASH_SOURCE[0]}")")" && pwd)"
export CODING_REPO
exec "$CODING_REPO/knowledge-management/vkb" "$@"
EOF
    chmod +x "$bin_dir/vkb"
    
    
    # Note: Original scripts now use dynamic repo detection, no need to update paths
    
    success "Command wrappers created"
}

# Configure shell environment
configure_shell_environment() {
    echo -e "\n${CYAN}🐚 Configuring shell environment...${NC}"
    
    local claude_path_export="export PATH=\"$CODING_REPO/bin:\$PATH\""
    local claude_repo_export="export CODING_REPO=\"$CODING_REPO\""
    
    # ── REMOVED: the four-file "clean up old aliases" scrub ─────────────────
    #
    # This used to run SEVEN sequential `sed -i.bak` passes over ALL FOUR of
    # ~/.bashrc, ~/.bash_profile, ~/.zshrc and ~/.zprofile, on every single run,
    # with no confirmation and before the sandbox guard below (so even sandbox
    # mode mutated them). It was unsafe in three separate ways:
    #
    #   1. Not recoverable. Each pass overwrote the same `.bak`, so after pass 7
    #      the "backup" held the state after pass 6 — the user's original file
    #      was gone for good.
    #   2. Over-broad. `/CODING_REPO.*coding/d` deletes ANY line mentioning both,
    #      including a user's own unrelated exports, comments or aliases.
    #   3. Unnecessary. Everything this installer adds now lives inside one
    #      marker-delimited block in ONE file ($SHELL_RC), which is removed and
    #      re-appended below. That is inherently idempotent and needs no scrub.
    #
    # Legacy leftovers from the pre-2025 layout (vkb/claude-mcp aliases, a
    # CLAUDE_REPO export, ~/bin wrapper scripts hardcoding a path that no longer
    # exists on any machine) are NOT rewritten either — silently editing four of
    # the user's shell files to clean up after an old version is exactly the kind
    # of impact this installer must not have. uninstall.sh removes what we added;
    # anything older is the user's to keep or delete.

    # SANDBOX MODE: Only create local .activate file
    if [[ "$SANDBOX_MODE" == "true" ]]; then
        cat > "$CODING_REPO/.activate" << EOF
# Coding Tools - Sandbox Activation
# Source this file to activate this installation in your current shell:
#   source $CODING_REPO/.activate

export CODING_REPO="$CODING_REPO"
export PATH="$CODING_REPO/bin:\$PATH"
EOF
        chmod +x "$CODING_REPO/.activate"

        warning "SANDBOX MODE: Global shell configs NOT modified"
        info "To activate this installation:"
        info "  source $CODING_REPO/.activate"
        return
    fi

    # NORMAL MODE: Modify shell config (ONLY ONE FILE based on detected shell)
    if grep -q "CODING_REPO.*$CODING_REPO" "$SHELL_RC" 2>/dev/null && grep -q "PATH.*$CODING_REPO/bin" "$SHELL_RC" 2>/dev/null; then
        info "Shell already configured with correct paths in $SHELL_RC"
    else
        # Ask for confirmation before modifying shell config
        if ! confirm_system_change \
            "Modify shell configuration file: $SHELL_RC" \
            "This adds CODING_REPO and PATH exports. Changes can be reversed by uninstall.sh."; then
            warning "Skipped shell configuration modification"
            info "You can manually add these to your shell config:"
            info "  $claude_repo_export"
            info "  $claude_path_export"
            SKIPPED_SYSTEM_DEPS+=("shell-config")
        else
            # ONE-TIME pristine backup. The previous version wrote a new
            # ${SHELL_RC}.coding-backup.<timestamp> on EVERY run, so these
            # accumulated forever and were never pruned. Keep exactly one copy
            # of the file as it was before this installer first touched it.
            local backup_file="${SHELL_RC}.coding-orig"
            if [[ ! -f "$backup_file" ]]; then
                cp "$SHELL_RC" "$backup_file"
                info "Saved a one-time original: $backup_file"
            else
                info "Original already preserved at: $backup_file"
            fi

            # Remove OUR marker block if a previous run added one, then append a
            # fresh copy. Remove-then-append on a delimited block is what makes
            # this idempotent, with no .bak litter and no broad patterns that
            # could catch the user's own lines.
            local tmp_rc
            tmp_rc="$(mktemp)"
            awk '
                /^# === CODING TOOLS START/ { skip=1 }
                skip != 1 { print }
                /^# === CODING TOOLS END/   { skip=0 }
            ' "$SHELL_RC" > "$tmp_rc" && mv "$tmp_rc" "$SHELL_RC"

            # Add configuration to SINGLE shell config file with markers
            {
                echo ""
                echo "# === CODING TOOLS START (installed: $(date +%Y-%m-%d)) ==="
                echo "$claude_repo_export"
                echo "$claude_path_export"
                echo "# === CODING TOOLS END ==="
            } >> "$SHELL_RC"

            # Verify the modification didn't break the shell config
            if bash -n "$SHELL_RC" 2>/dev/null || zsh -n "$SHELL_RC" 2>/dev/null; then
                success "Configuration added to $SHELL_RC (one marker block)"
                info "Revert at any time with ./uninstall.sh, or delete the block between"
                info "  '# === CODING TOOLS START' and '# === CODING TOOLS END'"
            else
                warning "Shell config may have issues - restoring original"
                cp "$backup_file" "$SHELL_RC"
                INSTALLATION_WARNINGS+=("Shell config: Restored from original due to syntax issues")
            fi
        fi
    fi
    
    # Create a cleanup script for the current shell session
    mkdir -p "$CODING_REPO/scripts"
    cat > "$CODING_REPO/scripts/cleanup-aliases.sh" << 'EOF'
#!/bin/bash
# Cleanup aliases from current shell session
unalias vkb 2>/dev/null || true
unalias claude-mcp 2>/dev/null || true
unset -f vkb 2>/dev/null || true
unset -f claude-mcp 2>/dev/null || true
EOF
    chmod +x "$CODING_REPO/scripts/cleanup-aliases.sh"
    
    success "Shell environment configured and old aliases removed"
    info "If you still see old aliases, run: source $CODING_REPO/scripts/cleanup-aliases.sh"
}

# Setup MCP configuration
setup_mcp_config() {
    echo -e "\n${CYAN}⚙️  Setting up MCP configuration...${NC}"
    
    # Check if template file exists
    if [[ ! -f "$CODING_REPO/claude-code-mcp.json" ]]; then
        warning "claude-code-mcp.json template not found, skipping MCP configuration..."
        return
    fi
    
    # Check if .env file exists and source it
    if [[ -f "$CODING_REPO/.env" ]]; then
        info "Loading environment variables from .env file..."
        set -a
        source "$CODING_REPO/.env"
        set +a
    else
        warning ".env file not found. Using empty API keys - please configure them later."
    fi
    
    # Note: Original template is preserved as claude-code-mcp.json
    
    # Replace placeholders in the template
    local temp_file=$(mktemp)
    cp "$CODING_REPO/claude-code-mcp.json" "$temp_file"
    
    # Replace environment variables - use the actual CODING_REPO path
    sed -i.bak "s|{{CODING_TOOLS_PATH}}|$CODING_REPO|g" "$temp_file"
    sed -i.bak "s|{{PARENT_DIR}}|$(dirname "$CODING_REPO")|g" "$temp_file"
    sed -i.bak "s|{{LOCAL_CDP_URL}}|${LOCAL_CDP_URL:-ws://localhost:9222}|g" "$temp_file"
    sed -i.bak "s|{{ANTHROPIC_API_KEY}}|${ANTHROPIC_API_KEY:-}|g" "$temp_file"
    sed -i.bak "s|{{OPENAI_API_KEY}}|${OPENAI_API_KEY:-}|g" "$temp_file"
    sed -i.bak "s|{{XAI_API_KEY}}|${XAI_API_KEY:-}|g" "$temp_file"
    # Present in claude-code-mcp.json but previously unsubstituted, so every
    # generated agent config carried the literal placeholder text as its value.
    sed -i.bak "s|{{GROQ_API_KEY}}|${GROQ_API_KEY:-}|g" "$temp_file"
    sed -i.bak "s|{{GROK_API_KEY}}|${GROK_API_KEY:-${XAI_API_KEY:-}}|g" "$temp_file"
    sed -i.bak "s|{{OPENAI_BASE_URL}}|${OPENAI_BASE_URL:-}|g" "$temp_file"
    sed -i.bak "s|{{KNOWLEDGE_BASE_PATH}}|${KNOWLEDGE_BASE_PATH:-$CODING_REPO}|g" "$temp_file"
    sed -i.bak "s|{{CODING_DOCS_PATH}}|${CODING_DOCS_PATH:-$CODING_REPO/docs}|g" "$temp_file"
    
    # Replace the code-graph server entry with whatever config/code-graph.json says is
    # active. The template still carries a literal entry so the file stands alone and so
    # this step is a no-op when nothing has been switched; without the splice, changing
    # backends would update the Docker config but leave native mode on the old one.
    # Any non-active backend's serverName is dropped so two never register at once.
    if command -v node >/dev/null 2>&1 && [[ -f "$CODING_REPO/config/code-graph.json" ]]; then
        if node -e '
            const fs = require("fs");
            const { execFileSync } = require("child_process");
            const [file, repo] = process.argv.slice(1);
            const run = (args) => execFileSync("node", [repo + "/scripts/code-graph-config.mjs", ...args], { encoding: "utf8" }).trim();
            const entry = JSON.parse(run(["mcp-entry", "--agent", "claude", "--flavor", "claude", "--named"]));
            const reg = JSON.parse(fs.readFileSync(repo + "/config/code-graph.json", "utf8"));
            const allNames = Object.values(reg.backends).map((b) => b.mcp.serverName);
            const active = Object.keys(entry)[0];
            const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
            for (const n of allNames) if (n !== active) delete cfg.mcpServers[n];
            Object.assign(cfg.mcpServers, entry);
            fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
            process.stderr.write("code-graph backend: " + active + "\n");
        ' "$temp_file" "$CODING_REPO" 2>&1; then
            :
        else
            warning "Could not resolve code-graph backend from registry; using the template's literal entry"
        fi
    fi

    # Save the processed version locally
    cp "$temp_file" "$CODING_REPO/claude-code-mcp-processed.json"
    
    # Fix common JSON syntax errors (trailing commas)
    if command -v python3 >/dev/null 2>&1; then
        python3 -c "
import json
import sys
try:
    with open('$CODING_REPO/claude-code-mcp-processed.json', 'r') as f:
        data = json.load(f)
    with open('$CODING_REPO/claude-code-mcp-processed.json', 'w') as f:
        json.dump(data, f, indent=2)
    print('JSON syntax validated and fixed')
except Exception as e:
    print(f'JSON validation failed: {e}', file=sys.stderr)
" || warning "JSON validation failed, but continuing..."
    fi
    
    info "Processed configuration saved to: claude-code-mcp-processed.json"
    
    # Setup USER-LEVEL cross-project configuration
    setup_user_level_mcp_config "$temp_file"
    
    # Setup project-level configuration (legacy support)
    setup_project_level_mcp_config "$temp_file"
    
    # Setup non-Claude agent MCP configurations
    setup_opencode_mcp_config "$temp_file"
    setup_copilot_mcp_config "$temp_file"
    
    # Clean up
    rm -f "$temp_file"
    
    success "MCP configuration setup completed (Claude, OpenCode, Copilot)"
}

# Setup user-level MCP configuration for cross-project use
setup_user_level_mcp_config() {
    local temp_file="$1"

    # ~/.claude.json is read by EVERY claude invocation in every project. In
    # wrapper mode bin/coding passes --mcp-config per launch instead (the seam
    # already exists in scripts/claude-mcp-launcher.sh), so bare `claude` sees
    # exactly the MCP servers it saw before this project was installed.
    require_global_scope "user-level MCP configuration (~/.claude.json)" || return 0

    # SANDBOX MODE: Skip global config modifications
    if [[ "$SANDBOX_MODE" == "true" ]]; then
        warning "SANDBOX MODE: Skipping user-level MCP configuration (~/.claude.json)"
        info "To use MCP servers, manually source: $CODING_REPO/claude-code-mcp-processed.json"
        return 0
    fi

    echo -e "\n${CYAN}📋 Setting up user-level MCP configuration (cross-project)...${NC}"

    # Read existing user configuration if it exists
    local user_config="$HOME/.claude.json"
    local user_config_backup=""
    
    if [[ -f "$user_config" ]]; then
        # Create backup
        user_config_backup="$user_config.backup.$(date +%Y%m%d_%H%M%S)"
        cp "$user_config" "$user_config_backup"
        info "Backed up existing configuration to: $user_config_backup"
        
        # Merge with existing configuration
        local merged_config=$(mktemp)
        
        # Use jq to merge configurations, giving priority to new MCP servers
        if command -v jq >/dev/null 2>&1; then
            jq -s '.[0] * .[1]' "$user_config" "$temp_file" > "$merged_config"
            cp "$merged_config" "$user_config"
            rm -f "$merged_config"
            success "Merged MCP configuration with existing user config"
        else
            # Fallback: overwrite mcpServers section only
            warning "jq not found, using simple merge (may overwrite existing MCP servers)"
            cp "$temp_file" "$user_config"
        fi
    else
        # No existing config, just copy
        cp "$temp_file" "$user_config"
        success "Created new user-level configuration"
    fi
    
    info "User-level MCP configuration: $user_config"
    echo -e "${GREEN}✅ This configuration will work in ALL your projects${NC}"
}

# Setup project-level MCP configuration (legacy support)
setup_project_level_mcp_config() {
    local temp_file="$1"
    
    echo -e "\n${CYAN}📁 Setting up project-level MCP configuration...${NC}"
    
    # Copy to user's Claude configuration directory (legacy app-specific config)
    local claude_config_dir=""
    case "$PLATFORM" in
        macos)
            claude_config_dir="$HOME/Library/Application Support/Claude"
            ;;
        linux|wsl)
            claude_config_dir="$HOME/.config/Claude"
            ;;
        windows)
            claude_config_dir="$APPDATA/Claude"
            if [[ -z "$claude_config_dir" ]]; then
                claude_config_dir="$HOME/AppData/Roaming/Claude"
            fi
            ;;
    esac
    
    if [[ -n "$claude_config_dir" ]] && [[ -d "$claude_config_dir" ]]; then
        cp "$temp_file" "$claude_config_dir/claude-code-mcp.json"
        info "Also installed to Claude app directory: $claude_config_dir/claude-code-mcp.json"
    else
        info "Claude app directory not found (this is normal for CLI-only usage)"
    fi
}

# Setup OpenCode MCP configuration
# OpenCode format: { "mcp": { "name": { "type": "local", "command": ["cmd", ...args], "enabled": true, "environment": {...} } } }
# MCP server names this installer owns in the non-Claude agent configs.
#
# Both converters below MERGE rather than replace, so anything a user adds by hand
# survives. That merge needs a prune list: without one, a server we stop shipping
# (e.g. code-graph-rag, retired with the Memgraph stack) would linger forever in
# every agent config, pointing at a backend that no longer exists.
#
# Only names on this list are ever removed. Retired names stay listed so existing
# installs get cleaned up.
MANAGED_MCP_KEYS="semantic-analysis constraint-monitor graphify code-graph-rag"

setup_opencode_mcp_config() {
    local temp_file="$1"

    # Rewrites ~/.config/opencode/opencode.json. In wrapper mode the launcher
    # supplies MCP servers via OPENCODE_CONFIG_CONTENT instead.
    require_global_scope "OpenCode MCP configuration (~/.config/opencode/opencode.json)" || return 0

    echo -e "\n${CYAN}📋 Setting up OpenCode MCP configuration...${NC}"
    
    if [[ "$SANDBOX_MODE" == "true" ]]; then
        warning "SANDBOX MODE: Skipping OpenCode MCP configuration"
        return 0
    fi
    
    local opencode_config="$HOME/.config/opencode/opencode.json"
    
    if [[ ! -f "$opencode_config" ]]; then
        info "OpenCode config not found at $opencode_config, skipping..."
        return 0
    fi
    
    if ! command -v python3 >/dev/null 2>&1; then
        warning "python3 not found, skipping OpenCode MCP config..."
        return 0
    fi
    
    # Backup existing config
    cp "$opencode_config" "$opencode_config.backup.$(date +%Y%m%d_%H%M%S)"
    
    # Convert Claude MCP format to OpenCode MCP format and merge into existing config
    python3 -c "
import json, sys

# Read Claude MCP config (processed template)
with open('$temp_file', 'r') as f:
    claude_config = json.load(f)

# Read existing OpenCode config
with open('$opencode_config', 'r') as f:
    oc_config = json.load(f)

# Convert Claude mcpServers to OpenCode mcp format
mcp_servers = claude_config.get('mcpServers', {})
managed = set('$MANAGED_MCP_KEYS'.split())
oc_mcp = {}

for name, server in mcp_servers.items():
    env = server.get('env', {})

    # Transport-aware. An HTTP server has no command to run, so emitting the
    # local shape for it produces command:[''] — a silently broken entry.
    if server.get('type') in ('http', 'sse') or server.get('url'):
        oc_mcp[name] = {
            'type': 'remote',
            'url': server.get('url', ''),
            'enabled': True,
        }
    else:
        oc_mcp[name] = {
            'type': 'local',
            'command': [server.get('command', '')] + server.get('args', []),
            'enabled': True,
        }
    if env:
        oc_mcp[name]['environment'] = env

# Merge, do not replace: drop only the managed names we are no longer shipping,
# keep every hand-added server, then apply the current set.
existing = oc_config.get('mcp', {})
for name in list(existing):
    if name in managed and name not in oc_mcp:
        del existing[name]
existing.update(oc_mcp)
oc_config['mcp'] = existing

with open('$opencode_config', 'w') as f:
    json.dump(oc_config, f, indent=2)

print(f'Configured {len(oc_mcp)} MCP servers for OpenCode')
" || { warning "Failed to configure OpenCode MCP"; return 0; }
    
    success "OpenCode MCP configuration updated: $opencode_config"
}

# Setup Copilot MCP configuration (VS Code / GitHub Copilot)
# Copilot format: { "servers": { "name": { "type": "stdio", "command": "...", "args": [...], "env": {...} } } }
setup_copilot_mcp_config() {
    local temp_file="$1"
    
    echo -e "\n${CYAN}📋 Setting up Copilot MCP configuration...${NC}"
    
    if [[ "$SANDBOX_MODE" == "true" ]]; then
        warning "SANDBOX MODE: Skipping Copilot MCP configuration"
        return 0
    fi
    
    if ! command -v python3 >/dev/null 2>&1; then
        warning "python3 not found, skipping Copilot MCP config..."
        return 0
    fi
    
    # Create .vscode directory if it doesn't exist
    local vscode_dir="$CODING_REPO/.vscode"
    mkdir -p "$vscode_dir"
    
    local copilot_mcp="$vscode_dir/mcp.json"
    
    # Convert Claude MCP format to Copilot MCP format
    python3 -c "
import json, sys

# Read Claude MCP config (processed template)
with open('$temp_file', 'r') as f:
    claude_config = json.load(f)

# Convert Claude mcpServers to Copilot servers format
import os
mcp_servers = claude_config.get('mcpServers', {})
managed = set('$MANAGED_MCP_KEYS'.split())
copilot_servers = {}

for name, server in mcp_servers.items():
    # Transport-aware, same reasoning as the OpenCode converter above. Without
    # the http branch every HTTP server landed as stdio with an empty command,
    # which is why Copilot had no working code-graph server at all.
    if server.get('type') in ('http', 'sse') or server.get('url'):
        copilot_servers[name] = {
            'type': 'http',
            'url': server.get('url', ''),
        }
    else:
        copilot_servers[name] = {
            'type': 'stdio',
            'command': server.get('command', ''),
            'args': server.get('args', []),
        }
    env = server.get('env', {})
    if env:
        copilot_servers[name]['env'] = env

# Merge into any existing file rather than overwriting it wholesale.
copilot_config = {'servers': {}}
if os.path.exists('$copilot_mcp'):
    try:
        with open('$copilot_mcp', 'r') as f:
            copilot_config = json.load(f)
        copilot_config.setdefault('servers', {})
    except (ValueError, OSError):
        copilot_config = {'servers': {}}

existing = copilot_config['servers']
for name in list(existing):
    if name in managed and name not in copilot_servers:
        del existing[name]
existing.update(copilot_servers)

with open('$copilot_mcp', 'w') as f:
    json.dump(copilot_config, f, indent=2)

print(f'Configured {len(copilot_servers)} MCP servers for Copilot')
" || { warning "Failed to configure Copilot MCP"; return 0; }
    
    success "Copilot MCP configuration created: $copilot_mcp"
}

# Initialize knowledge management system
# Imports knowledge from git-tracked JSON exports into GraphDB (LevelDB)
# This is critical for fresh installs where LevelDB is empty but JSON exports exist
initialize_shared_memory() {
    echo -e "\n${CYAN}📝 Initializing knowledge management...${NC}"

    info "Knowledge management is handled by GraphDB (see .data/knowledge-graph/)"
    info "Team-specific exports available at .data/knowledge-export/*.json"

    # Check if JSON exports exist but LevelDB is empty (fresh install scenario)
    local json_exports_exist=false
    local leveldb_empty=true

    # Check for ANY JSON exports (coding.json, ui.json, resi.json, etc.)
    local json_count=0
    if [[ -d "$CODING_REPO/.data/knowledge-export" ]]; then
        json_count=$(find "$CODING_REPO/.data/knowledge-export" -name "*.json" -type f 2>/dev/null | wc -l | tr -d ' ')
        if [[ "$json_count" -gt 0 ]]; then
            json_exports_exist=true
            info "Found $json_count JSON export file(s) to import"
        fi
    fi

    # Check if LevelDB has data (look for .ldb files with content or non-empty .log files)
    if [[ -d "$CODING_REPO/.data/knowledge-graph" ]]; then
        local log_size=0
        for log_file in "$CODING_REPO/.data/knowledge-graph"/*.log; do
            if [[ -f "$log_file" ]]; then
                local size=$(stat -f%z "$log_file" 2>/dev/null || stat -c%s "$log_file" 2>/dev/null || echo "0")
                if [[ "$size" -gt 100 ]]; then
                    leveldb_empty=false
                    break
                fi
            fi
        done
    fi

    # Import from JSON if exports exist and LevelDB is empty
    if [[ "$json_exports_exist" == "true" && "$leveldb_empty" == "true" ]]; then
        info "Importing knowledge from JSON exports into GraphDB..."

        # Ensure bin directory is in PATH for graph-sync
        export PATH="$CODING_REPO/bin:$PATH"

        # Run graph-sync import (without file watchers using a simple timeout)
        if command -v node >/dev/null 2>&1; then
            cd "$CODING_REPO"
            # Run import and capture output
            if timeout 60 node bin/graph-sync import 2>&1 | grep -E "^✓|entities|relations" | head -10; then
                success "Knowledge imported from JSON exports to GraphDB"
            else
                warning "Knowledge import encountered issues (non-fatal)"
            fi
            cd - > /dev/null
        else
            warning "Node.js not available - skipping knowledge import"
        fi
    elif [[ "$json_exports_exist" == "true" ]]; then
        info "GraphDB already has data, skipping JSON import"
    else
        info "No JSON exports found - knowledge will be created as you work"
    fi

    success "Knowledge management system ready"
}

# Create example configuration files
create_example_configs() {
    echo -e "\n${CYAN}📄 Creating example configuration files...${NC}"
    
    # Create .env.example for MCP servers (only if it doesn't exist)
    if [[ ! -f "$CODING_REPO/.env.example" ]]; then
        info "Creating .env.example file..."
        cat > "$CODING_REPO/.env.example" << 'EOF'
# Claude Knowledge Management System - Environment Variables

# API Keys
ANTHROPIC_API_KEY=your-anthropic-api-key

# Primary coding tools path (set automatically by installer)
# This is the main path used throughout the system
CODING_TOOLS_PATH=/path/to/coding/repo

# For claude-logger MCP server
# No specific environment variables required

# For constraint-monitor system
XAI_API_KEY=your-xai-api-key
OPENAI_API_KEY=your-openai-api-key

# Admin API keys for real-time usage/billing data in status line
# These are DIFFERENT from regular API keys - they have org-level permissions
# Anthropic: Create at console.anthropic.com -> Settings -> Admin API Keys (format: sk-ant-admin-...)
ANTHROPIC_ADMIN_API_KEY=your-anthropic-admin-api-key
# OpenAI: Create at platform.openai.com/settings/organization/admin-keys
OPENAI_ADMIN_API_KEY=your-openai-admin-api-key

# Custom paths (optional)
# CODING_REPO=/path/to/coding/repo (legacy, now uses CODING_TOOLS_PATH)
# MEMORY_VISUALIZER_DIR=/path/to/memory-visualizer

# Knowledge Base path - where .data/knowledge-graph/ and .data/knowledge-export/ are located
# Default: same directory as the coding project
# Can be set to a different path for centralized knowledge management
CODING_KB_PATH=/path/to/coding/repo

# Default knowledge views to display in VKB viewer
# Comma-separated list of views (e.g., "coding,ui,resi")
KNOWLEDGE_VIEW=coding,ui
EOF
    else
        info ".env.example already exists, skipping creation"
    fi
    
    # Create actual .env file if it doesn't exist
    if [[ ! -f "$CODING_REPO/.env" ]]; then
        info "Creating .env file with default settings..."
        cat > "$CODING_REPO/.env" << EOF
# Claude Knowledge Management System - Environment Variables

# API Keys
ANTHROPIC_API_KEY=

# Project path - automatically set by installer
CLAUDE_PROJECT_PATH=$CODING_REPO

# Knowledge Base path - where .data/knowledge-graph/ and .data/knowledge-export/ are located
# Default: same directory as the coding project
CODING_KB_PATH=$CODING_REPO

# For constraint-monitor system
GROK_API_KEY=
OPENAI_API_KEY=

# Admin API keys for real-time usage/billing data in status line
# These are DIFFERENT from regular API keys - they have org-level permissions
# Anthropic: Create at console.anthropic.com -> Settings -> Admin API Keys (format: sk-ant-admin-...)
ANTHROPIC_ADMIN_API_KEY=
# OpenAI: Create at platform.openai.com/settings/organization/admin-keys
OPENAI_ADMIN_API_KEY=

# Default knowledge views to display in VKB viewer
KNOWLEDGE_VIEW=coding,ui
EOF
        success ".env file created with project paths"
    else
        # Update existing .env file to add CODING_KB_PATH if missing
        if ! grep -q "CODING_KB_PATH" "$CODING_REPO/.env"; then
            info "Adding CODING_KB_PATH to existing .env file..."
            echo "" >> "$CODING_REPO/.env"
            echo "# Knowledge Base path - where .data/knowledge-graph/ and .data/knowledge-export/ are located" >> "$CODING_REPO/.env"
            echo "# Default: same directory as the coding project" >> "$CODING_REPO/.env"
            echo "CODING_KB_PATH=$CODING_REPO" >> "$CODING_REPO/.env"
        fi
        
        # Update existing .env file to add KNOWLEDGE_VIEW if missing
        if ! grep -q "KNOWLEDGE_VIEW" "$CODING_REPO/.env"; then
            info "Adding KNOWLEDGE_VIEW to existing .env file..."
            echo "" >> "$CODING_REPO/.env"
            echo "# Default knowledge views to display in VKB viewer" >> "$CODING_REPO/.env"
            echo "KNOWLEDGE_VIEW=coding,ui" >> "$CODING_REPO/.env"
        fi

        # Update existing .env file to add Admin API keys if missing
        if ! grep -q "ANTHROPIC_ADMIN_API_KEY" "$CODING_REPO/.env"; then
            info "Adding Admin API keys to existing .env file..."
            echo "" >> "$CODING_REPO/.env"
            echo "# Admin API keys for real-time usage/billing data in status line" >> "$CODING_REPO/.env"
            echo "# These are DIFFERENT from regular API keys - they have org-level permissions" >> "$CODING_REPO/.env"
            echo "# Anthropic: Create at console.anthropic.com -> Settings -> Admin API Keys (format: sk-ant-admin-...)" >> "$CODING_REPO/.env"
            echo "ANTHROPIC_ADMIN_API_KEY=" >> "$CODING_REPO/.env"
            echo "# OpenAI: Create at platform.openai.com/settings/organization/admin-keys" >> "$CODING_REPO/.env"
            echo "OPENAI_ADMIN_API_KEY=" >> "$CODING_REPO/.env"
        fi
    fi
    
    success "Example configuration files created"
}

# Verify installation
verify_installation() {
    echo -e "\n${CYAN}🔍 Verifying installation...${NC}"
    
    local errors=0
    
    # Check vkb command (ukb removed - use MCP server workflow)
    if [[ -x "$CODING_REPO/bin/vkb" ]]; then
        success "vkb command is available"
    else
        error_exit "vkb command not found or not executable"
        ((errors++))
    fi
    
    # Check memory visualizer
    if [[ -d "$MEMORY_VISUALIZER_DIR/dist" ]]; then
        success "Memory visualizer is built"
    else
        warning "Memory visualizer dist directory not found"
        ((errors++))
    fi
    
    # Check Constraint Monitor with Professional Dashboard
    if [[ -d "$CODING_REPO/integrations/mcp-constraint-monitor" ]]; then
        success "MCP Constraint Monitor (standalone) configured"
        if [[ -d "$CODING_REPO/integrations/mcp-constraint-monitor/dashboard" ]]; then
            success "Professional Dashboard (port 3030) installed"
        else
            warning "Professional Dashboard not found"
        fi
    else
        warning "Constraint monitor system not installed"
    fi

    # Check System Health Dashboard
    if [[ -d "$CODING_REPO/integrations/system-health-dashboard" ]]; then
        if [[ -d "$CODING_REPO/integrations/system-health-dashboard/node_modules" ]]; then
            success "System Health Dashboard (ports 3032/3033) installed"
        else
            warning "System Health Dashboard dependencies not installed"
        fi
    else
        warning "System Health Dashboard not found"
    fi
    
    # Check Semantic Analysis MCP server
    if [[ -f "$CODING_REPO/integrations/mcp-server-semantic-analysis/dist/index.js" ]]; then
        success "Semantic Analysis MCP server is built"
    else
        warning "Semantic Analysis MCP server not built"
    fi

    
    
    if [[ $errors -eq 0 ]]; then
        success "Installation verification passed!"
    else
        warning "Installation completed with warnings. Some features may not work correctly."
    fi
}

# Detect available coding agents
detect_agents() {
    info "Detecting available coding agents..."
    
    local agents_found=()
    
    # Check for Claude Code
    if command -v claude >/dev/null 2>&1; then
        agents_found+=("claude")
        success "✓ Claude Code detected"
    else
        warning "Claude Code not found"
    fi
    
    # Check for GitHub CoPilot
    if command -v gh >/dev/null 2>&1; then
        if gh extension list 2>/dev/null | grep -q copilot; then
            agents_found+=("copilot")
            success "✓ GitHub CoPilot detected"
        else
            warning "GitHub CLI found but CoPilot extension not installed"
            info "  Install with: gh extension install github/gh-copilot"
        fi
    else
        warning "GitHub CLI not found"
        info "  Install from: https://cli.github.com/"
    fi
    
    if [ ${#agents_found[@]} -eq 0 ]; then
        if [[ "$CI_LITE" == "true" ]]; then
            warning "No coding agent CLI (Claude Code / GitHub Copilot) found — continuing (CI-lite portability run)"
            INSTALLATION_FAILURES+=("No coding agent CLI found")
            return 0
        fi
        error_exit "No supported coding agents found. Please install Claude Code or GitHub CoPilot."
        return 1
    fi
    
    info "Found agents: ${agents_found[*]}"
    return 0
}

# Configure team-based knowledge management
configure_team_setup() {
    echo ""
    echo -e "${PURPLE}🏢 Multi-Team Knowledge Base Configuration${NC}"
    echo -e "${PURPLE}=========================================${NC}"
    echo ""
    
    # Set default team configuration
    export CODING_TEAM="coding ui"
    
    info "Team configuration automatically set to: coding and ui"
    info ""
    info "ℹ️  To change the team configuration, modify the CODING_TEAM environment variable"
    info "   Available teams:"
    echo "     • coding - General coding patterns and knowledge"
    echo "     • ui     - UI/Frontend development (React, TypeScript, etc.)"
    echo "     • resi   - Reprocessing/Simulation development (C++, systems, performance)"
    echo "     • raas   - RaaS development (Java, DevOps, microservices)"
    echo "     • custom - Any custom team name"
    echo ""
    info "   Example: export CODING_TEAM=\"resi raas\" for multiple teams"
    info "   Example: export CODING_TEAM=\"myteam\" for a custom team"

    # Add to shell environment (only if not already configured and NOT in sandbox mode)
    if [[ "$SANDBOX_MODE" == "true" ]]; then
        warning "SANDBOX MODE: Skipping CODING_TEAM configuration in $SHELL_RC"
        info "To use CODING_TEAM, export it manually: export CODING_TEAM=\"coding ui\""
    elif grep -q "export CODING_TEAM=" "$SHELL_RC" 2>/dev/null; then
        info "CODING_TEAM already configured in $SHELL_RC"
    else
        echo "" >> "$SHELL_RC"
        echo "# Coding Tools - Team Configuration" >> "$SHELL_RC"
        echo "# Modify this variable to change team scope (e.g., \"resi raas\" for multiple teams)" >> "$SHELL_RC"
        echo "export CODING_TEAM=\"$CODING_TEAM\"" >> "$SHELL_RC"
        success "Team configuration added to $SHELL_RC"
    fi

    info "Your configuration will use these knowledge exports:"
    echo "  • .data/knowledge-export/coding.json (general coding patterns)"
    echo "  • .data/knowledge-export/ui.json (UI/frontend specific knowledge)"
    info "Knowledge is managed by GraphDB at .data/knowledge-graph/ (auto-persisted)"
}

# Build Docker infrastructure — the only supported deployment mode. Native
# mode (host processes for MCP servers, dashboards, semantic-analysis) was
# removed; Docker is mandatory because the supervisor/coordinator/dashboard
# stack assumes a single source of truth for service lifecycle.
configure_docker_mode() {
    echo -e "\n${CYAN}🐳 Docker Setup${NC}"
    echo ""
    echo "All coding services (MCP servers, dashboards, semantic-analysis,"
    echo "constraint-monitor, embedding listener) run in Docker. The only"
    echo "host-side processes are bin/coding itself, the LSL transcript"
    echo "monitor, the LLM proxy on :12435, and bin/init-history.sh."

    if ! command -v docker &>/dev/null; then
        if [[ "$CI_LITE" == "true" ]]; then
            warning "Docker not installed — skipping Docker setup (CI-lite portability run)"
            INSTALLATION_FAILURES+=("Docker not installed (image build skipped)")
            return 0
        fi
        error_exit "Docker is required but not installed. Install Docker Desktop first: https://www.docker.com/products/docker-desktop"
    fi

    if ! docker info &>/dev/null; then
        if [[ "$CI_LITE" == "true" ]]; then
            warning "Docker daemon not running — skipping Docker setup (CI-lite portability run)"
            INSTALLATION_FAILURES+=("Docker daemon not running (image build skipped)")
            return 0
        fi
        error_exit "Docker daemon is not running. Start Docker Desktop, then re-run install.sh."
    fi

    # The .docker-mode marker is kept for backwards compatibility — older
    # scripts still test for it. It's effectively always on now.
    touch "$CODING_REPO/.docker-mode"

    if [[ -f "$CODING_REPO/docker/docker-compose.yml" ]]; then
        info "Building Docker images (this may take a few minutes)..."
        if docker compose -f "$CODING_REPO/docker/docker-compose.yml" build; then
            success "Docker images built"
        else
            warning "Docker build had issues — you may need to rebuild manually"
            INSTALLATION_WARNINGS+=("Docker: Build had warnings")
        fi
    fi

    if [[ -x "$CODING_REPO/scripts/generate-docker-mcp-config.sh" ]]; then
        info "Generating Docker MCP configuration..."
        "$CODING_REPO/scripts/generate-docker-mcp-config.sh" || warning "Could not generate Docker MCP config"
    fi

    success "Docker setup complete"
    info "  Use 'coding --claude' or 'coding --copilot' to launch the agent against the dockerized stack"
}

# Install PlantUML for diagram generation
install_plantuml() {
    info "Installing PlantUML for diagram generation..."

    # Check if already installed
    if command -v plantuml >/dev/null 2>&1; then
        success "✓ PlantUML already installed"
        return 0
    fi

    # Offer choice: system package manager or self-contained JAR
    echo ""
    echo -e "${CYAN}PlantUML is not installed. Choose installation method:${NC}"
    echo -e "  ${GREEN}1${NC} = Self-contained JAR in coding repo ${YELLOW}(Recommended - no system changes)${NC}"
    echo -e "  ${GREEN}2${NC} = System package manager (brew/apt-get)"
    echo -e "  ${GREEN}3${NC} = Skip PlantUML (diagram generation won't work)"
    echo ""
    read_or_default plantuml_choice "" "$(echo -e ${CYAN}Your choice [1/2/3]: ${NC})"

    case "$plantuml_choice" in
        1)
            # Self-contained JAR - no system changes
            install_plantuml_jar
            ;;
        2)
            # System package manager - requires confirmation
            case "$PLATFORM" in
                macos)
                    if command -v brew >/dev/null 2>&1; then
                        if confirm_system_change \
                            "Install PlantUML via Homebrew (brew install plantuml)" \
                            "Homebrew may update other packages as dependencies. This can affect other tools."; then
                            info "Installing PlantUML via Homebrew..."
                            if brew install plantuml; then
                                success "✓ PlantUML installed via Homebrew"
                            else
                                warning "Failed to install PlantUML via Homebrew, trying JAR fallback..."
                                install_plantuml_jar
                            fi
                        else
                            info "Using JAR fallback instead..."
                            install_plantuml_jar
                        fi
                    else
                        warning "Homebrew not found, using JAR fallback..."
                        install_plantuml_jar
                    fi
                    ;;
                linux|wsl)
                    if command -v apt-get >/dev/null 2>&1; then
                        if confirm_system_change \
                            "Install PlantUML via apt-get (sudo apt-get install plantuml)" \
                            "Requires sudo privileges. May install additional dependencies."; then
                            info "Installing PlantUML via apt-get..."
                            if sudo apt-get update && sudo apt-get install -y plantuml; then
                                success "✓ PlantUML installed via apt-get"
                            else
                                warning "Failed to install PlantUML via apt-get, trying JAR fallback..."
                                install_plantuml_jar
                            fi
                        else
                            info "Using JAR fallback instead..."
                            install_plantuml_jar
                        fi
                    elif command -v yum >/dev/null 2>&1; then
                        if confirm_system_change \
                            "Install PlantUML via yum (sudo yum install plantuml)" \
                            "Requires sudo privileges. May install additional dependencies."; then
                            info "Installing PlantUML via yum..."
                            if sudo yum install -y plantuml; then
                                success "✓ PlantUML installed via yum"
                            else
                                warning "Failed to install PlantUML via yum, trying JAR fallback..."
                                install_plantuml_jar
                            fi
                        else
                            info "Using JAR fallback instead..."
                            install_plantuml_jar
                        fi
                    elif command -v pacman >/dev/null 2>&1; then
                        if confirm_system_change \
                            "Install PlantUML via pacman (sudo pacman -S plantuml)" \
                            "Requires sudo privileges. May install additional dependencies."; then
                            info "Installing PlantUML via pacman..."
                            if sudo pacman -S --noconfirm plantuml; then
                                success "✓ PlantUML installed via pacman"
                            else
                                warning "Failed to install PlantUML via pacman, trying JAR fallback..."
                                install_plantuml_jar
                            fi
                        else
                            info "Using JAR fallback instead..."
                            install_plantuml_jar
                        fi
                    else
                        warning "No supported package manager found, using JAR fallback..."
                        install_plantuml_jar
                    fi
                    ;;
                *)
                    warning "Unknown platform, using JAR fallback..."
                    install_plantuml_jar
                    ;;
            esac
            ;;
        3|*)
            warning "Skipping PlantUML installation. Diagram generation will not work."
            SKIPPED_SYSTEM_DEPS+=("plantuml")
            ;;
    esac
}

# Fallback installation using PlantUML JAR
install_plantuml_jar() {
    info "Installing PlantUML JAR fallback..."
    
    # Check if Java is available
    if ! command -v java >/dev/null 2>&1; then
        warning "Java not found. PlantUML JAR requires Java to run."
        INSTALLATION_WARNINGS+=("PlantUML: Java required but not found")
        return 1
    fi
    
    # Create local bin directory
    local bin_dir="$CODING_REPO/bin"
    mkdir -p "$bin_dir"
    
    # Download PlantUML JAR
    local plantuml_jar="$bin_dir/plantuml.jar"
    info "Downloading PlantUML JAR..."
    
    if curl -L -o "$plantuml_jar" "https://github.com/plantuml/plantuml/releases/download/v1.2023.12/plantuml-1.2023.12.jar"; then
        # Create wrapper script
        local plantuml_script="$bin_dir/plantuml"
        cat > "$plantuml_script" << 'EOF'
#!/bin/bash
java -jar "$(dirname "$0")/plantuml.jar" "$@"
EOF
        chmod +x "$plantuml_script"
        
        # Add to PATH in .activate if not already there
        if [ -f "$CODING_REPO/.activate" ] && ! grep -q "$bin_dir" "$CODING_REPO/.activate"; then
            echo "export PATH=\"$bin_dir:\$PATH\"" >> "$CODING_REPO/.activate"
        fi
        
        success "✓ PlantUML JAR installed to $bin_dir"
        info "Note: PlantUML added to PATH via .activate script"
    else
        warning "Failed to download PlantUML JAR"
        INSTALLATION_WARNINGS+=("PlantUML: Failed to download JAR")
        return 1
    fi
}

# Update DMR_HOST in .env.ports for cross-platform container access
# Windows containers need host.docker.internal to reach host services
update_dmr_host_config() {
    local dmr_host="$1"
    local env_ports_file="${CODING_REPO:-.}/.env.ports"

    if [[ ! -f "$env_ports_file" ]]; then
        warning ".env.ports not found - skipping DMR_HOST update"
        return 0
    fi

    # Check current DMR_HOST value
    local current_host=$(grep "^DMR_HOST=" "$env_ports_file" 2>/dev/null | cut -d'=' -f2)

    if [[ "$current_host" != "$dmr_host" ]]; then
        info "Updating DMR_HOST=$dmr_host in .env.ports"
        if grep -q "^DMR_HOST=" "$env_ports_file"; then
            # Update existing line
            sed -i.bak "s/^DMR_HOST=.*/DMR_HOST=$dmr_host/" "$env_ports_file"
            rm -f "${env_ports_file}.bak"
        else
            # Add after DMR_PORT line
            sed -i.bak "/^DMR_PORT=/a\\
DMR_HOST=$dmr_host" "$env_ports_file"
            rm -f "${env_ports_file}.bak"
        fi
        success "✓ DMR_HOST configured for $(uname -s)"
    fi
}

# Detect and report available GPU acceleration for local LLM inference
# This is informational - DMR/llama.cpp handles the actual backend selection
detect_gpu_acceleration() {
    local gpu_info=""

    case "$(uname -s)" in
        Darwin)
            # macOS - check for Apple Silicon (Metal) or Intel
            if [[ "$(uname -m)" == "arm64" ]]; then
                gpu_info="Apple Silicon (Metal acceleration)"
            else
                gpu_info="Intel Mac (CPU only)"
            fi
            ;;
        Linux)
            # Check for NVIDIA GPU
            if command -v nvidia-smi >/dev/null 2>&1; then
                local nvidia_gpu=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1)
                if [[ -n "$nvidia_gpu" ]]; then
                    gpu_info="NVIDIA: $nvidia_gpu (CUDA)"
                fi
            fi
            # Check for AMD GPU
            if [[ -z "$gpu_info" ]] && command -v rocm-smi >/dev/null 2>&1; then
                gpu_info="AMD GPU (ROCm)"
            fi
            # Fallback to CPU
            if [[ -z "$gpu_info" ]]; then
                gpu_info="CPU (AVX2/AVX512 if available)"
            fi
            ;;
        MINGW*|MSYS*|CYGWIN*)
            # Windows - check for NVIDIA
            if command -v nvidia-smi >/dev/null 2>&1; then
                local nvidia_gpu=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1)
                if [[ -n "$nvidia_gpu" ]]; then
                    gpu_info="NVIDIA: $nvidia_gpu (CUDA)"
                fi
            fi
            if [[ -z "$gpu_info" ]]; then
                gpu_info="CPU (DirectML fallback available)"
            fi
            ;;
        *)
            gpu_info="Unknown platform"
            ;;
    esac

    info "Hardware acceleration: $gpu_info"
}

# Setup local LLM inference via Docker Model Runner (DMR)
# DMR uses llama.cpp backend via Docker Desktop's Model Runner feature
# Port configured in .env.ports as DMR_PORT (default: 12434)
#
# GPU/Hardware Support (automatic via llama.cpp):
# - Apple Silicon: Metal acceleration (built-in, no setup needed)
# - NVIDIA GPU: CUDA acceleration (requires CUDA toolkit)
# - AMD GPU: Vulkan/ROCm acceleration
# - CPU: Always available fallback (AVX2/AVX512 optimized)
setup_local_llm() {
    local dmr_port="${DMR_PORT:-12434}"
    local dmr_host="localhost"

    info "Setting up local LLM inference (optional)..."

    # Detect platform for DMR_HOST configuration
    # Windows containers need host.docker.internal to reach host services
    case "$(uname -s)" in
        MINGW*|MSYS*|CYGWIN*)
            dmr_host="host.docker.internal"
            info "Windows detected - using DMR_HOST=host.docker.internal"
            ;;
        *)
            dmr_host="localhost"
            ;;
    esac

    # Check if Docker is available
    if ! command -v docker >/dev/null 2>&1; then
        warning "Docker not installed - skipping local LLM setup"
        info "Install Docker Desktop to enable local LLM inference"
        SKIPPED_SYSTEM_DEPS+=("local-llm")
        return 0
    fi

    # Check if Docker Desktop Model Runner is available
    if docker model --help >/dev/null 2>&1; then
        info "Docker Model Runner (DMR) is available"

        # Report detected hardware acceleration
        detect_gpu_acceleration

        # Check if DMR is enabled on the correct port
        if curl -s "http://localhost:${dmr_port}/engines/v1/models" >/dev/null 2>&1; then
            success "✓ DMR already running on port ${dmr_port}"
            update_dmr_host_config "$dmr_host"
            ensure_dmr_model
            return 0
        fi

        # DMR is available but not enabled - ask user
        echo ""
        echo -e "${CYAN}Docker Model Runner (DMR) is available but not enabled.${NC}"
        echo -e "  DMR provides local LLM inference via llama.cpp"
        echo -e "  ${GREEN}y${NC} = Enable DMR on port ${dmr_port}"
        echo -e "  ${GREEN}n${NC} = Skip (coding tools will use cloud APIs only)"
        echo ""
        read_or_default enable_dmr_choice "n" "$(echo -e ${CYAN}Enable Docker Model Runner? [y/N]: ${NC})"

        case "$enable_dmr_choice" in
            [yY]|[yY][eE][sS])
                info "Enabling Docker Model Runner on port ${dmr_port}..."
                if docker desktop enable model-runner --tcp "${dmr_port}" 2>/dev/null; then
                    success "✓ DMR enabled on port ${dmr_port}"
                    sleep 2  # Give it time to start
                    update_dmr_host_config "$dmr_host"
                    ensure_dmr_model
                else
                    warning "Failed to enable DMR (may require Docker Desktop restart)"
                    INSTALLATION_WARNINGS+=("DMR: Failed to enable - try: docker desktop enable model-runner --tcp ${dmr_port}")
                    return 1
                fi
                ;;
            *)
                info "Skipping DMR setup (optional component)"
                SKIPPED_SYSTEM_DEPS+=("dmr")
                return 0
                ;;
        esac
    else
        info "Docker Model Runner not available (requires Docker Desktop 4.40+)"
        info "To enable DMR, upgrade Docker Desktop and run: docker desktop enable model-runner --tcp ${dmr_port}"
        SKIPPED_SYSTEM_DEPS+=("dmr")
        return 0
    fi
}

# Ensure DMR has the required model downloaded
ensure_dmr_model() {
    local model="ai/llama3.2"
    local dmr_port="${DMR_PORT:-12434}"
    info "Ensuring DMR model '$model' is available..."

    # Check if DMR is accessible
    if ! curl -s "http://localhost:${dmr_port}/engines/v1/models" >/dev/null 2>&1; then
        warning "DMR not accessible on port ${dmr_port}"
        return 1
    fi

    # Check if model exists
    if curl -s "http://localhost:${dmr_port}/engines/v1/models" | grep -q "llama3.2"; then
        success "✓ Model '$model' already available"
        return 0
    fi

    # Pull the model
    info "Pulling model '$model' (this may take a few minutes)..."
    if docker model pull "$model" 2>/dev/null; then
        success "✓ Model '$model' downloaded"
    else
        warning "Failed to pull model '$model'"
        info "Try manually: docker model pull $model"
        INSTALLATION_WARNINGS+=("DMR: Failed to pull model $model")
        return 1
    fi
}

# Setup LLM CLI Proxy - HTTP bridge to host CLI tools (claude, copilot-cli)
# for Docker containers. Port 12435, adjacent to DMR's port 12434.
setup_llm_cli_proxy() {
    local proxy_port="${LLM_CLI_PROXY_PORT:-12435}"
    local proxy_dir="$CODING_REPO/integrations/llm-cli-proxy"
    local has_cli=false

    info "Setting up LLM CLI Proxy (optional)..."

    # Check if claude CLI is available
    if command -v claude >/dev/null 2>&1; then
        local claude_version
        claude_version=$(claude --version 2>/dev/null | head -1)
        success "  claude CLI found: $claude_version"
        has_cli=true
    else
        info "  claude CLI not found"
        echo ""
        echo -e "  ${CYAN}The 'claude' CLI enables routing LLM requests through your Claude Max subscription.${NC}"
        echo -e "  Install: ${GREEN}npm install -g @anthropic-ai/claude-code${NC}"
        if confirm_system_change \
            "Install claude CLI globally via npm" \
            "Runs: npm install -g @anthropic-ai/claude-code"; then
            if npm install -g @anthropic-ai/claude-code 2>/dev/null; then
                success "  claude CLI installed"
                has_cli=true
            else
                warning "  Failed to install claude CLI"
            fi
        fi
    fi

    # Check if copilot-cli is available
    if command -v copilot-cli >/dev/null 2>&1; then
        local copilot_version
        copilot_version=$(copilot-cli --version 2>/dev/null | head -1)
        success "  copilot-cli found: $copilot_version"
        has_cli=true
    else
        info "  copilot-cli not found (optional)"
    fi

    # If no CLI tools available, skip proxy setup
    if [[ "$has_cli" != "true" ]]; then
        info "No CLI tools available - skipping LLM CLI Proxy setup"
        SKIPPED_SYSTEM_DEPS+=("llm-cli-proxy")
        return 0
    fi

    # Build the proxy
    if [[ -d "$proxy_dir" ]]; then
        info "Building LLM CLI Proxy..."
        (cd "$proxy_dir" && npm install && npm run build) 2>&1 | tail -3
        if [[ -f "$proxy_dir/dist/server.js" ]]; then
            success "  LLM CLI Proxy built successfully"
        else
            warning "  LLM CLI Proxy build failed"
            INSTALLATION_WARNINGS+=("LLM CLI Proxy: Build failed")
            return 1
        fi
    else
        warning "  LLM CLI Proxy directory not found at $proxy_dir"
        return 1
    fi

    # Check if already running
    if lsof -i :"$proxy_port" -sTCP:LISTEN >/dev/null 2>&1; then
        success "  LLM CLI Proxy already running on port $proxy_port"
        return 0
    fi

    # A login-persistent background service is a bigger commitment than any
    # config edit: it keeps running after the install, after logout, and after
    # the user has forgotten about it. `--yes` used to auto-approve it via
    # confirm_system_change, which is the wrong default for "unattended".
    # Require explicit consent, exactly like the global agent configs.
    if [[ "${CODING_INSTALL_SYSTEM_SERVICES:-0}" != "1" ]]; then
        info "Not installing an autostart service for the LLM proxy"
        info "  It runs on demand when you use 'coding'. For a login-persistent"
        info "  service, re-run with CODING_INSTALL_SYSTEM_SERVICES=1."
        log "SKIP: LLM proxy autostart service (not opted in)"
        return 0
    fi

    # Offer to install as persistent service.
    # Dispatch on $PLATFORM, not `uname -s`: WSL reports "Linux" but frequently
    # has no user systemd instance (WSL1, and WSL2 without systemd enabled), so
    # the Linux branch would install a unit that can never start.
    case "$PLATFORM" in
        macos)
            create_llm_proxy_launchd "$proxy_dir" "$proxy_port"
            ;;
        linux)
            create_llm_proxy_systemd "$proxy_dir" "$proxy_port"
            ;;
        wsl)
            # Only offer systemd when a user instance actually exists.
            if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
                create_llm_proxy_systemd "$proxy_dir" "$proxy_port"
            else
                info "  WSL without a user systemd instance — no autostart service installed."
                info "  Start manually when needed: cd $proxy_dir && npm start"
                INSTALLATION_WARNINGS+=("LLM proxy: no autostart on this WSL (systemd --user unavailable); start manually")
            fi
            ;;
        *)
            info "  Start manually: cd $proxy_dir && npm start"
            ;;
    esac
}

# Create macOS LaunchAgent for LLM CLI Proxy
create_llm_proxy_launchd() {
    local proxy_dir="$1"
    local proxy_port="$2"
    local plist_path="$HOME/Library/LaunchAgents/com.coding.llm-cli-proxy.plist"
    local node_path
    node_path=$(which node)

    if confirm_system_change \
        "Install LLM CLI Proxy as a LaunchAgent (starts at login)" \
        "Creates $plist_path"; then

        mkdir -p "$HOME/Library/LaunchAgents"
        cat > "$plist_path" << PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.coding.llm-cli-proxy</string>
    <key>ProgramArguments</key>
    <array>
        <string>${node_path}</string>
        <string>${proxy_dir}/dist/server.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${proxy_dir}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>LLM_CLI_PROXY_PORT</key>
        <string>${proxy_port}</string>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:${HOME}/.nvm/versions/node/$(node -v)/bin</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${proxy_dir}/logs/stdout.log</string>
    <key>StandardErrorPath</key>
    <string>${proxy_dir}/logs/stderr.log</string>
</dict>
</plist>
PLIST_EOF

        mkdir -p "$proxy_dir/logs"
        launchctl load "$plist_path" 2>/dev/null
        sleep 2

        if lsof -i :"$proxy_port" -sTCP:LISTEN >/dev/null 2>&1; then
            success "  LLM CLI Proxy running as LaunchAgent on port $proxy_port"
        else
            warning "  LaunchAgent installed but proxy may not have started yet"
            info "  Check: launchctl list | grep llm-cli-proxy"
        fi
    else
        info "  Start manually: cd $proxy_dir && npm start"
    fi
}

# Create Linux systemd user service for LLM CLI Proxy
create_llm_proxy_systemd() {
    local proxy_dir="$1"
    local proxy_port="$2"
    local service_path="$HOME/.config/systemd/user/llm-cli-proxy.service"
    local node_path
    node_path=$(which node)

    if confirm_system_change \
        "Install LLM CLI Proxy as a systemd user service" \
        "Creates $service_path"; then

        mkdir -p "$HOME/.config/systemd/user"
        cat > "$service_path" << SYSTEMD_EOF
[Unit]
Description=LLM CLI Proxy - HTTP bridge to host CLI tools
After=network.target

[Service]
Type=simple
WorkingDirectory=${proxy_dir}
ExecStart=${node_path} ${proxy_dir}/dist/server.js
Environment=LLM_CLI_PROXY_PORT=${proxy_port}
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
SYSTEMD_EOF

        mkdir -p "$proxy_dir/logs"
        systemctl --user daemon-reload
        systemctl --user enable llm-cli-proxy.service
        systemctl --user start llm-cli-proxy.service
        sleep 2

        if systemctl --user is-active llm-cli-proxy.service >/dev/null 2>&1; then
            success "  LLM CLI Proxy running as systemd service on port $proxy_port"
        else
            warning "  systemd service installed but may not have started"
            info "  Check: systemctl --user status llm-cli-proxy"
        fi
    else
        info "  Start manually: cd $proxy_dir && npm start"
    fi
}

# Install Node.js dependencies for agent-agnostic functionality
install_node_dependencies() {
    info "Installing Node.js dependencies for agent-agnostic functionality..."

    if [ ! -f "$CODING_REPO/package.json" ]; then
        error_exit "package.json not found. This is required for agent-agnostic functionality."
        return 1
    fi

    # Preflight already proved the network is unusable. Attempting npm here would
    # fail several minutes later with a misleading error; skip explicitly instead.
    # (Only reachable under --ci, which downgrades preflight to a warning.)
    if [[ "$NETWORK_OK" != "true" ]]; then
        warning "Skipping Node.js dependencies — no usable network (see preflight above)"
        INSTALLATION_FAILURES+=("Node.js dependencies skipped: no network")
        return 0
    fi

    cd "$CODING_REPO"

    # Never let any sub-install download a browser. gsd-browser is the mandated
    # browser tool (see CLAUDE.md) and ships its own Chrome for Testing.
    export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

    # --ignore-scripts is the fix for the corporate-network install failure.
    # Without it, fastembed -> onnxruntime-node runs a postinstall that downloads
    # a ~200MB prebuilt binary from github.com, which dies with
    # `getaddrinfo ENOTFOUND github.com` behind a proxy and takes the whole
    # install with it (this step used to be fatal).
    #
    # This mirrors what the container build has done all along —
    # docker/Dockerfile.coding-services: `npm ci --ignore-scripts || npm install --ignore-scripts`
    # followed by an explicit arch-specific native install. The host path simply
    # never got the same treatment.
    #
    # NOT --omit=optional: the onnxruntime and tokenizer binaries ARE
    # optionalDependencies, so omitting them is precisely what breaks fastembed.
    if npm ci --ignore-scripts || npm install --ignore-scripts; then
        success "✓ Node.js dependencies installed"
    else
        error_exit "Failed to install Node.js dependencies"
        return 1
    fi

    # Because scripts were skipped, native modules must be built explicitly.
    # Each is rebuilt individually so one failure does not mask the others.
    #
    # These packages ship as `prebuild-install || node-gyp rebuild`: they try to
    # download a prebuilt binary for the exact node/OS/arch, and fall back to
    # compiling from source. When no prebuilt matches AND no toolchain is
    # present, the fallback fails — so the actionable remedy is almost always
    # "install build tools". (Note this is not caused by --ignore-scripts: a
    # plain `npm install` runs the same script with the same outcome.)
    local native_mod rebuild_log native_failed=0
    for native_mod in better-sqlite3 classic-level; do
        # One log per module, kept only on failure so the path we print is real.
        rebuild_log="${TMPDIR:-/tmp}/coding-rebuild-${native_mod}.log"
        info "Building native bindings for $native_mod..."
        if npm rebuild "$native_mod" >"$rebuild_log" 2>&1; then
            success "✓ $native_mod native bindings built"
            rm -f "$rebuild_log" 2>/dev/null || true
        else
            native_failed=1
            warning "$native_mod native build failed"
            # Surface the actual cause instead of swallowing it.
            local reason
            reason="$(grep -m1 -iE "gyp ERR! stack Error|not ok|command not found|No such file" "$rebuild_log" 2>/dev/null | head -c 200 || true)"
            # NOTE: if/fi, not `[[ ]] && info`. Under `set -e` a bare AND-list
            # whose test fails returns non-zero and aborts the installer.
            if [[ -n "$reason" ]]; then info "  cause: $reason"; fi
            if ! command -v cc >/dev/null 2>&1 && ! command -v gcc >/dev/null 2>&1; then
                info "  No C compiler found — that is the likely cause. Install build tools:"
                case "$PLATFORM" in
                    macos)        info "    xcode-select --install" ;;
                    linux|wsl)    info "    sudo apt-get install -y build-essential   (or: dnf groupinstall 'Development Tools')" ;;
                    windows)      info "    npm install --global windows-build-tools   (or install Visual Studio Build Tools)" ;;
                esac
            fi
            info "  Impact: $([[ "$native_mod" == "better-sqlite3" ]] && echo "local knowledge databases" || echo "LevelDB-backed graph storage") will not work until this is fixed."
            info "  Full log: $rebuild_log"
            INSTALLATION_WARNINGS+=("Native build failed: $native_mod (see $rebuild_log)")
        fi
    done
    [[ "$native_failed" == "0" ]] || log "One or more native builds failed; logs retained under ${TMPDIR:-/tmp}"

    ensure_km_core_link
    install_fastembed_native
    install_vkb_server_deps
}

# ─────────────────────────────────────────────────────────────────────────────
# @fwornle/km-core: submodule + node_modules link
#
# km-core is consumed as `@fwornle/km-core` but is NOT a package.json dependency
# — it is the lib/km-core git submodule, reached through a symlink at
# node_modules/@fwornle/km-core. Two things therefore have to be true, and
# neither happened automatically before:
#
#   1. The submodule must be checked out. install.sh initialised every OTHER
#      submodule but never this one, so on a fresh clone lib/km-core was empty.
#   2. The symlink must exist. `npm ci` wipes node_modules, and because the
#      package is not declared, npm prunes it as extraneous — so switching to
#      `npm ci` actively deletes it.
#
# When it is missing, every ETM spawn dies instantly with
#   ERR_MODULE_NOT_FOUND: Cannot find package '@fwornle/km-core'
#     imported from src/live-logging/ObservationWriter.js
# which surfaces as a red LSL badge while the health API still reports green.
#
# It is deliberately NOT added to package.json as a `file:` dependency: that
# would make a failed submodule fetch (no network, no SSH key, CN restrictions)
# abort the ENTIRE install, instead of degrading to "session logging disabled".
# ─────────────────────────────────────────────────────────────────────────────
ensure_km_core_link() {
    local km_src="$CODING_REPO/lib/km-core"
    local scope_dir="$CODING_REPO/node_modules/@fwornle"
    local link="$scope_dir/km-core"

    # 1. Check out the submodule if it is missing or empty.
    if [[ ! -f "$km_src/package.json" ]]; then
        info "Initializing lib/km-core submodule..."
        if ! (cd "$CODING_REPO" && git submodule update --init lib/km-core >/dev/null 2>&1); then
            warning "Could not initialize the lib/km-core submodule"
            info "  → live session logging (LSL) and observations will be unavailable."
            info "  → fix later with: git submodule update --init lib/km-core && ./install.sh"
            INSTALLATION_WARNINGS+=("km-core submodule unavailable — LSL/observations disabled")
            return 0
        fi
    fi

    # 2. km-core has its own dependencies (graphology, classic-level, fastembed…).
    #    Stripping them breaks semantic-analysis and the vkb-server experiment API.
    if [[ ! -d "$km_src/node_modules" ]]; then
        info "Installing km-core dependencies..."
        (cd "$km_src" && { npm ci --ignore-scripts >/dev/null 2>&1 || npm install --ignore-scripts >/dev/null 2>&1; }) \
            || warning "km-core dependency install had problems"
    fi

    # 3. (Re)create the symlink. Relative target so the repo stays movable.
    mkdir -p "$scope_dir"
    if [[ -L "$link" || -e "$link" ]]; then
        rm -rf "$link"
    fi
    ln -s "../../lib/km-core" "$link"

    # 4. Verify by resolution, not by file existence.
    if (cd "$CODING_REPO" && node -e "import('@fwornle/km-core').then(()=>process.exit(0),()=>process.exit(1))" >/dev/null 2>&1); then
        success "✓ @fwornle/km-core linked and resolvable"
    else
        warning "@fwornle/km-core is linked but does not import cleanly"
        info "  → check that lib/km-core/dist exists (it may need building)"
        INSTALLATION_WARNINGS+=("km-core present but not importable")
    fi
}

# fastembed's tokenizer ships as per-platform prebuilt packages. --ignore-scripts
# skips the platform selection, so install the right one explicitly. This is a
# host-side port of docker/Dockerfile.coding-services' arch-conditional step.
#
# fastembed is genuinely needed on the HOST (obs-api owns retrieval — see
# src/retrieval/retrieval-service.js) as well as in the container (the
# embedding-listener in docker/supervisord.conf), so this is not optional work.
install_fastembed_native() {
    local os arch pkg
    os="$(uname -s)"
    arch="$(uname -m)"

    case "$os:$arch" in
        Darwin:*)                 pkg="@anush008/tokenizers-darwin-universal" ;;
        Linux:x86_64|Linux:amd64) pkg="@anush008/tokenizers-linux-x64-gnu" ;;
        Linux:aarch64|Linux:arm64) pkg="@anush008/tokenizers-linux-arm64-gnu" ;;
        MINGW*:*|MSYS*:*|CYGWIN*:*) pkg="@anush008/tokenizers-win32-x64-msvc" ;;
        *)                        pkg="" ;;
    esac

    if [[ -n "$pkg" ]]; then
        info "Installing platform tokenizer for fastembed ($os/$arch)..."
        npm install "$pkg" --no-save --ignore-scripts >/dev/null 2>&1 || true
    else
        warning "No known fastembed tokenizer build for $os/$arch"
    fi

    # Verify rather than assume. onnxruntime-node is prebuilt-only — there is no
    # source-build fallback — so on an unsupported platform (musl, exotic arch)
    # host-side embeddings simply cannot work. Degrade explicitly instead of
    # letting obs-api crash at runtime: retrieval then defers to the container's
    # embedding listener, which is a supported Debian/glibc target.
    if node -e "require('fastembed')" >/dev/null 2>&1; then
        success "✓ fastembed loads on this host"
    else
        warning "fastembed cannot load on this platform ($os/$arch)"
        info "  → host-side semantic retrieval will be disabled; the container's"
        info "    embedding listener is unaffected, so knowledge features still work."
        INSTALLATION_WARNINGS+=("fastembed unavailable on host ($os/$arch) — host retrieval disabled")
        set_env_var CODING_EMBEDDINGS_HOST off
    fi
}

install_vkb_server_deps() {
    info "Installing vkb-server dependencies..."
    if [ -d "$CODING_REPO/lib/vkb-server" ]; then
        cd "$CODING_REPO/lib/vkb-server"
        if npm ci --ignore-scripts >/dev/null 2>&1 || npm install --ignore-scripts >/dev/null 2>&1; then
            success "✓ vkb-server dependencies installed"
        else
            warning "Failed to install vkb-server dependencies"
            INSTALLATION_WARNINGS+=("vkb-server dependencies failed")
        fi
        cd "$CODING_REPO"
    fi
}

# Initialize knowledge management databases (Qdrant + SQLite)
initialize_knowledge_databases() {
    echo -e "\n${CYAN}📊 Initializing Continuous Learning Knowledge Databases...${NC}"

    cd "$CODING_REPO"

    # Create .data directory for knowledge databases
    local data_dir="$CODING_REPO/.data"
    if [[ ! -d "$data_dir" ]]; then
        info "Creating .data directory for knowledge databases..."
        mkdir -p "$data_dir"
        success ".data directory created"
    else
        info ".data directory already exists"
    fi

    # Check if Qdrant is available (optional)
    local qdrant_available=false
    info "Checking Qdrant availability (optional for vector search)..."
    if timeout 3s curl -s http://localhost:6333/health >/dev/null 2>&1; then
        qdrant_available=true
        success "✓ Qdrant is running on localhost:6333"
    else
        info "Qdrant not running (optional - vector search features will be disabled)"
        info "To enable Qdrant: docker run -d -p 6333:6333 qdrant/qdrant"
    fi

    # Check if VKB server is running (which locks LevelDB)
    local vkb_running=false
    if pgrep -f "vkb-server" >/dev/null 2>&1 || lsof -i :8080 2>/dev/null | grep -q node; then
        vkb_running=true
        info "VKB server detected - Graph database will be skipped (this is OK)"
        info "LevelDB is locked by VKB server, SQLite/Qdrant initialization will proceed"
    fi

    # Initialize knowledge management system (databases + config)
    info "Initializing knowledge management system..."
    if node scripts/initialize-knowledge-system.js --project-path "$CODING_REPO"; then
        success "✓ Knowledge management system initialized"
        info "  • Configuration: .specstory/config/knowledge-system.json"
        if [[ "$qdrant_available" == true ]]; then
            info "  • Qdrant collections: knowledge_patterns, trajectory_analysis, session_memory"
        fi
        info "  • SQLite database: $data_dir/knowledge.db"
        info "  • Knowledge extraction: enabled"
    else
        warning "Knowledge system initialization had issues"
        INSTALLATION_WARNINGS+=("Knowledge system: Initialization had warnings")
    fi

    # Add environment variables for database paths if not already in .env
    if [[ -f "$CODING_REPO/.env" ]]; then
        if ! grep -q "QDRANT_URL" "$CODING_REPO/.env"; then
            echo "" >> "$CODING_REPO/.env"
            echo "# Continuous Learning Knowledge System - Database Configuration" >> "$CODING_REPO/.env"
            echo "QDRANT_URL=http://localhost:6333" >> "$CODING_REPO/.env"
            echo "SQLITE_PATH=$data_dir/knowledge.db" >> "$CODING_REPO/.env"
        fi
    fi

    success "Knowledge databases ready for use"
}


# Create unified launcher
setup_unified_launcher() {
    info "Setting up unified launcher..."

    # SANDBOX MODE: Skip global launcher installation
    if [[ "$SANDBOX_MODE" == "true" ]]; then
        warning "SANDBOX MODE: Skipping unified launcher installation (~/.bin)"
        info "To use 'coding' command, add to PATH: export PATH=\"$CODING_REPO/bin:\$PATH\""
        return 0
    fi

    local bin_dir="$HOME/bin"
    mkdir -p "$bin_dir"

    # Create symlink to coding
    if [ -f "$CODING_REPO/bin/coding" ]; then
        ln -sf "$CODING_REPO/bin/coding" "$bin_dir/coding"
        success "✓ coding launcher created in $bin_dir"

        # Add to PATH if not already there
        if [[ ":$PATH:" != *":$bin_dir:"* ]]; then
            info "Adding $bin_dir to PATH in $SHELL_RC"
            echo "export PATH=\"$bin_dir:\$PATH\"" >> "$SHELL_RC"
        fi
    else
        error_exit "coding script not found"
        return 1
    fi
}

# [DEPRECATED] VSCode extension removed in favor of native agent integration
# The vscode-km-copilot extension has been removed as part of the agent-agnostic
# architecture update. Integration is now handled through the unified agent API.
# See: lib/agent-api/ for the new adapter-based architecture
# Optional: Set up admin/management API keys for real-time spend tracking
setup_api_admin_keys() {
    info "API Admin Key Setup (for real-time spend tracking in status bar)"
    info "This step is optional - press Enter to skip each provider."

    if [[ ! -f "$CODING_REPO/scripts/setup-api-keys.js" ]]; then
        warning "setup-api-keys.js not found, skipping admin key setup"
        return 0
    fi

    if confirm_system_change \
        "Run interactive API admin key setup" \
        "This will prompt for optional admin API keys (Anthropic, OpenAI, xAI) and write them to .env"; then
        node "$CODING_REPO/scripts/setup-api-keys.js" || {
            warning "API key setup encountered errors (non-fatal)"
        }
    else
        info "Skipping API admin key setup (can run later: node scripts/setup-api-keys.js)"
    fi
}

# Main installation flow
# Configure the private session-history side-repo.
#
# The .specstory/history/ tree contains verbatim Claude session transcripts
# (organized as YYYY/MM/<file>.md, with classification + operational logs
# tracked under .specstory/history/logs/)
# (full prompts, full responses, file paths, occasionally secrets that
# slipped past redaction). They are .gitignore'd in this public repo and
# live in a SEPARATE PRIVATE repo so conversation content can't leak via
# a public clone.
#
# This step asks the user for the URL of that private repo, stores it in
# .env as CODING_HISTORY_REPO, then delegates to bin/init-history.sh
# which clones into .specstory/history/ (or just creates the empty dirs
# if the user skipped or has no access).
setup_history_repo() {
    info "Configuring private session-history repository"

    local env_file="$CODING_REPO/.env"
    local hist_dir="$CODING_REPO/.specstory/history"
    local existing=""

    if [[ -f "$env_file" ]] && grep -q '^CODING_HISTORY_REPO=' "$env_file"; then
        existing="$(grep '^CODING_HISTORY_REPO=' "$env_file" | head -1 | cut -d= -f2-)"
    fi

    cat <<'EOF'

  ──────────────────────────────────────────────────────────────────
  PRIVATE SESSION-HISTORY REPO

  This repo writes verbatim Claude session transcripts into
    .specstory/history/YYYY/MM/<file>.md      (LSL transcripts)
    .specstory/history/logs/                  (classification + operational)

  This tree is .gitignore'd here — it lives in a SEPARATE PRIVATE
  repo so conversation content (including occasional unredacted
  secrets, internal paths, stakeholder names) can't leak via a public
  clone.

  Suggested name: coding-history (any host where your team has access
  works — github.com, GitHub Enterprise, GitLab, Gitea…)

  If you don't have a repo yet:
    1. Open your git host's web UI
    2. Create a NEW PRIVATE repository named "coding-history"
    3. Do NOT add a README/license/.gitignore (it must be empty)
    4. Copy its clone URL and paste it below
  ──────────────────────────────────────────────────────────────────

EOF

    local repo_url=""
    if [[ -n "$existing" ]]; then
        echo "  Currently configured: $existing"
        read_or_default keep "Y" "  Keep this URL? [Y/n]: "
        if [[ -z "${keep:-}" || "${keep}" =~ ^[Yy]$ ]]; then
            repo_url="$existing"
        else
            read_or_default repo_url "" "  New private history repo URL [blank to skip]: "
        fi
    else
        read_or_default repo_url "" "  Private history repo URL [blank to skip]: "
    fi

    if [[ -z "$repo_url" ]]; then
        warning "No private history repo configured — using local-only dirs."
        INSTALLATION_WARNINGS+=("History: no private repo configured (local-only)")
    else
        # Persist into .env (create if missing, replace if existing)
        [[ -f "$env_file" ]] || touch "$env_file"
        if grep -q '^CODING_HISTORY_REPO=' "$env_file"; then
            local tmp
            tmp="$(mktemp)"
            awk -v url="$repo_url" '
                /^CODING_HISTORY_REPO=/ { print "CODING_HISTORY_REPO=" url; next }
                { print }
            ' "$env_file" > "$tmp" && mv "$tmp" "$env_file"
        else
            echo "CODING_HISTORY_REPO=$repo_url" >> "$env_file"
        fi
        success "Saved CODING_HISTORY_REPO to .env"
    fi

    # Always ensure the dirs exist so LSL services don't crash. init-history.sh
    # also handles cloning the private repo when it's configured AND the
    # local dir is empty.
    if [[ -x "$CODING_REPO/bin/init-history.sh" ]]; then
        "$CODING_REPO/bin/init-history.sh" || warning "init-history.sh exited non-zero"
    else
        # First-run before init-history.sh has been chmod'd or in a partial
        # checkout — make sure the dirs exist so we don't break later steps.
        mkdir -p "$hist_dir" "$hist_dir/logs/classification"
    fi

    # Detect the "I have local content but no git checkout" case and surface
    # the seed recipe — destructive enough that the user should run it
    # themselves rather than us doing it implicitly.
    if [[ -n "$repo_url" ]] \
        && [[ -d "$hist_dir" ]] \
        && [[ -n "$(ls -A "$hist_dir" 2>/dev/null || true)" ]] \
        && [[ ! -d "$hist_dir/.git" ]]; then
        cat <<EOF

  ${YELLOW}NOTE${NC}: $hist_dir/ already has content but isn't a git
  checkout. To seed your private repo with the existing snapshot:

    cd $hist_dir
    git init -b main
    git add .
    git commit -m "initial snapshot"
    git remote add origin $repo_url
    git push -u origin main

  After that, $hist_dir/ tracks the private repo and any future commits
  there go ONLY to that private repo (this 'coding' repo ignores the
  folder via .gitignore).

EOF
    fi
}

show_usage() {
    cat <<EOF
Agent-Agnostic Coding Tools — Universal Installer

USAGE:
  ./install.sh [OPTIONS]

OPTIONS:
  -y, --yes                 Unattended: auto-approve system changes, never prompt.
      --ci, --non-interactive
                            Unattended: never prompt (take safe defaults, DECLINE
                            optional system changes) AND downgrade missing-infra
                            gates (Docker / agent CLI / core deps) from fatal to
                            warnings, so a portability run completes with a summary.
  -h, --help                Show this help and exit.

ENVIRONMENT:
  CI=true                   Same as --ci (auto-detected on CI runners).
  CODING_INSTALL_YES=1      Same as --yes.
  CODING_INSTALL_CI=1       Same as --ci.

Default (no flags) is the interactive install: prompts work as before and
missing Docker / agent CLI / core dependencies abort with guidance.
EOF
}

# parse_args — populate the unattended-mode globals from flags + environment.
# Unknown flags are warned-and-ignored (preserves the historically lenient
# behaviour; e.g. a stray --skip-hooks must never abort the root installer).
parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -y|--yes)                    ASSUME_YES=true; NON_INTERACTIVE=true ;;
            --ci|--non-interactive)      NON_INTERACTIVE=true; CI_LITE=true ;;
            # --dry-run must be truly side-effect free, including the install
            # log: writing $CODING_REPO/install.log would contradict "nothing
            # was changed". Redirect it to a temp file for the duration.
            --dry-run)                   DRY_RUN=true; NON_INTERACTIVE=true
                                         INSTALL_LOG="${TMPDIR:-/tmp}/coding-install-dryrun.log" ;;
            --global-agents)             CODING_INSTALL_GLOBAL_AGENTS=1 ;;
            -h|--help)                   show_usage; exit 0 ;;
            --skip-hooks)                : ;;  # accepted, no-op at root level
            *)                           warning "Unknown option: $1 (ignored)" ;;
        esac
        shift
    done

    # Environment overrides (CI systems set CI=true).
    [[ "${CI:-}" == "true" ]] && { NON_INTERACTIVE=true; CI_LITE=true; }
    [[ -n "${CODING_INSTALL_YES:-}" ]] && { ASSUME_YES=true; NON_INTERACTIVE=true; }
    [[ -n "${CODING_INSTALL_CI:-}" ]] && { NON_INTERACTIVE=true; CI_LITE=true; }

    # No controlling TTY on stdin → force non-interactive so `read` under
    # `set -e` can never abort on EOF (the failure mode of piped/CI runs).
    [[ -t 0 ]] || NON_INTERACTIVE=true

    if [[ "$NON_INTERACTIVE" == "true" ]]; then
        info "Running non-interactively (assume_yes=$ASSUME_YES, ci_lite=$CI_LITE)"
    fi
}

# read_or_default VAR DEFAULT PROMPT...
# Interactive behaviour is byte-identical to a bare `read -r -p` (the user's
# input, including empty, is preserved). Only NON_INTERACTIVE or an EOF on stdin
# substitutes DEFAULT — so no prompt can abort an unattended run under `set -e`.
read_or_default() {
    local __var="$1" __def="$2"; shift 2
    if [[ "$NON_INTERACTIVE" == "true" ]]; then
        printf -v "$__var" '%s' "$__def"
        return 0
    fi
    local __reply
    read -r -p "$*" __reply || __reply="$__def"
    printf -v "$__var" '%s' "$__reply"
}

# ─────────────────────────────────────────────────────────────────────────────
# The one question that decides host impact.
#
# DEFAULT IS "wrapper" (no). Note this deliberately INVERTS the semantics of
# confirm_system_change(), where --yes auto-approves: an unattended run must
# never silently reconfigure the user's global agent setup. Choosing global
# non-interactively requires the explicit CODING_INSTALL_GLOBAL_AGENTS=1 or
# --global-agents.
# ─────────────────────────────────────────────────────────────────────────────
ask_agent_scope() {
    # Explicit opt-in wins, interactive or not.
    if [[ "${CODING_INSTALL_GLOBAL_AGENTS:-0}" == "1" ]]; then
        CODING_AGENT_SCOPE="global"
        info "Agent scope: GLOBAL (explicitly requested)"
        set_env_var CODING_AGENT_SCOPE global
        return 0
    fi

    if [[ "$NON_INTERACTIVE" == "true" ]]; then
        CODING_AGENT_SCOPE="wrapper"
        info "Agent scope: WRAPPER-SCOPED (default for unattended runs)"
        info "  Global agent configs are NOT modified. Re-run with --global-agents to opt in."
        set_env_var CODING_AGENT_SCOPE wrapper
        return 0
    fi

    echo ""
    echo -e "${CYAN}Observe agents launched WITHOUT the 'coding' wrapper?${NC}"
    echo ""
    echo "  Session logging and knowledge injection always work for agents you"
    echo "  start via 'coding'. Extending that to bare 'claude' / 'copilot' /"
    echo "  'opencode' requires editing their GLOBAL config files, which changes"
    echo "  their behaviour in every project on this machine."
    echo ""
    echo -e "  ${GREEN}n${NC} (default) — wrapper-scoped. Nothing outside this repo is configured."
    echo "                 Bare agents behave exactly as they do today."
    echo -e "  ${YELLOW}y${NC}           — also write hooks/MCP into ~/.claude, ~/.config/opencode."
    echo "                 Reversible with ./uninstall.sh."
    echo ""
    local reply
    read_or_default reply "n" "$(echo -e "${CYAN}Observe bare agent sessions too? [y/N]: ${NC}")"
    case "$reply" in
        [Yy]*)
            CODING_AGENT_SCOPE="global"
            info "Agent scope: GLOBAL — bare agent sessions will be observed"
            ;;
        *)
            CODING_AGENT_SCOPE="wrapper"
            success "Agent scope: WRAPPER-SCOPED — your global agent configs stay untouched"
            ;;
    esac
    set_env_var CODING_AGENT_SCOPE "$CODING_AGENT_SCOPE"
}

# ─────────────────────────────────────────────────────────────────────────────
# Migration: global → wrapper.
#
# Choosing wrapper scope stops us WRITING global config, but it does not undo
# what an earlier global-mode install already wrote. Those artifacts are still
# live, so bare agents would remain affected and the user's choice would be
# quietly untrue. Detect the leftovers and offer to remove them.
#
# Everything here is surgical: only entries naming THIS repo or our own known
# filenames are touched. The user's own hooks, plugins and commands are left
# exactly as they are.
# ─────────────────────────────────────────────────────────────────────────────
cleanup_stale_global_artifacts() {
    [[ "$CODING_AGENT_SCOPE" == "wrapper" ]] || return 0

    local found=()

    # 1. Slash commands previously copied into the global dir.
    local cmd_leftovers=()
    if [[ -d "$HOME/.claude/commands" && -d "$CODING_REPO/.claude/commands" ]]; then
        local f base
        for f in "$CODING_REPO/.claude/commands"/*.md; do
            [[ -f "$f" ]] || continue
            base="$(basename "$f")"
            [[ -f "$HOME/.claude/commands/$base" ]] && cmd_leftovers+=("$base")
        done
        [[ ${#cmd_leftovers[@]} -gt 0 ]] && found+=("~/.claude/commands: ${#cmd_leftovers[@]} command(s) from this repo")
    fi

    # 2. Our hooks inside the user's global Claude settings.
    local hooks_present=false
    if [[ -f "$HOME/.claude/settings.json" ]] && grep -q "$CODING_REPO" "$HOME/.claude/settings.json" 2>/dev/null; then
        hooks_present=true
        found+=("~/.claude/settings.json: hooks pointing at this repo")
    fi

    # 3. OpenCode plugins copied under $HOME.
    local oc_leftovers=()
    local p
    for p in compaction-guard knowledge-injection; do
        [[ -f "$HOME/.opencode/plugins/$p.js" ]] && oc_leftovers+=("$p.js")
    done
    [[ ${#oc_leftovers[@]} -gt 0 ]] && found+=("~/.opencode/plugins: ${#oc_leftovers[@]} plugin(s)")

    if [[ ${#found[@]} -eq 0 ]]; then
        return 0
    fi

    echo ""
    warning "This machine still carries GLOBAL agent configuration from an earlier install:"
    local item
    for item in "${found[@]}"; do echo "    • $item"; done
    echo ""
    info "You chose wrapper-scoped, so these are the reason bare agents would still"
    info "be affected. Removing them completes the switch. Your own hooks, plugins"
    info "and commands are not touched."
    echo ""

    local reply
    read_or_default reply "y" "$(echo -e "${CYAN}Remove this project's global leftovers? [Y/n]: ${NC}")"
    case "$reply" in
        [Nn]*)
            warning "Left in place — bare agents will still load this project's config"
            INSTALLATION_WARNINGS+=("Stale global agent config left in place (wrapper scope chosen)")
            return 0
            ;;
    esac

    # Remove only the command files that came from this repo.
    local base
    for base in "${cmd_leftovers[@]:-}"; do
        [[ -n "$base" ]] || continue
        rm -f "$HOME/.claude/commands/$base" && info "  removed ~/.claude/commands/$base"
    done
    rmdir "$HOME/.claude/commands" 2>/dev/null || true

    # Strip only hook entries whose command names this repo.
    if [[ "$hooks_present" == "true" ]]; then
        local settings="$HOME/.claude/settings.json"
        if [[ ! -f "$settings.coding-orig" ]]; then
            cp "$settings" "$settings.coding-orig"
            info "  saved a one-time original: $settings.coding-orig"
        fi
        if node -e '
            const fs = require("fs");
            const [file, repo] = process.argv.slice(1);
            const s = JSON.parse(fs.readFileSync(file, "utf8"));
            let removed = 0;
            for (const ev of Object.keys(s.hooks || {})) {
                const before = s.hooks[ev].length;
                s.hooks[ev] = s.hooks[ev].filter(
                    (e) => !(e.hooks || []).some((h) => (h.command || "").includes(repo)),
                );
                removed += before - s.hooks[ev].length;
                if (s.hooks[ev].length === 0) delete s.hooks[ev];
            }
            if (s.hooks && Object.keys(s.hooks).length === 0) delete s.hooks;
            fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
            process.stderr.write(`removed ${removed} hook entr${removed === 1 ? "y" : "ies"}\n`);
        ' "$settings" "$CODING_REPO" 2>&1 | while read -r l; do info "  $l"; done; then
            :
        else
            warning "  could not edit $settings — remove the hooks naming $CODING_REPO by hand"
        fi
    fi

    # OpenCode plugins: delete the files and drop their entries from the config.
    for p in "${oc_leftovers[@]:-}"; do
        [[ -n "$p" ]] || continue
        rm -f "$HOME/.opencode/plugins/$p" && info "  removed ~/.opencode/plugins/$p"
    done
    rmdir "$HOME/.opencode/plugins" 2>/dev/null || true
    local oc_json="$HOME/.config/opencode/opencode.json"
    if [[ -f "$oc_json" ]] && grep -q "$CODING_REPO\|compaction-guard\|knowledge-injection" "$oc_json" 2>/dev/null; then
        node -e '
            const fs = require("fs");
            const [file, repo] = process.argv.slice(1);
            const c = JSON.parse(fs.readFileSync(file, "utf8"));
            if (Array.isArray(c.plugin)) {
                const before = c.plugin.length;
                c.plugin = c.plugin.filter(
                    (p) => !String(p).includes(repo)
                        && !String(p).includes("compaction-guard")
                        && !String(p).includes("knowledge-injection"),
                );
                if (c.plugin.length === 0) delete c.plugin;
                if (before !== (c.plugin || []).length) {
                    fs.writeFileSync(file, JSON.stringify(c, null, 2) + "\n");
                    process.stderr.write("dropped plugin entries from opencode.json\n");
                }
            }
        ' "$oc_json" "$CODING_REPO" 2>&1 | while read -r l; do info "  $l"; done || true
    fi

    success "Global leftovers removed — bare agents now behave as they did before this project"
}

main() {
    parse_args "$@"
    echo -e "${PURPLE}🚀 Agent-Agnostic Coding Tools - Universal Installer${NC}"
    echo -e "${PURPLE}=====================================================${NC}"
    echo ""

    # Initialize log
    # `|| true`: this is the FIRST write to the log, and on a root-owned or
    # read-only checkout it failed under `set -e` and killed the install with a
    # bare "Permission denied". log() below handles the fallback properly.
    echo "Installation started at $(date)" > "$INSTALL_LOG" 2>/dev/null || true
    log "Platform: $(uname -s)"
    log "Coding repo: $CODING_REPO"

    # Detect platform
    detect_platform
    info "Detected platform: $PLATFORM"
    info "Shell config file: $SHELL_RC"

    # Detect if sandbox mode should be used
    detect_sandbox_mode
    if [[ "$SANDBOX_MODE" == "true" ]]; then
        log "Running in SANDBOX MODE"
    fi

    # Disclose everything BEFORE the first mutation. --dry-run stops here, so
    # the manifest is also a way to inspect the installer without running it.
    print_impact_manifest
    if [[ "$DRY_RUN" == "true" ]]; then
        success "Dry run — nothing was changed."
        info "Re-run without --dry-run to install."
        exit 0
    fi

    # The single question that decides host impact (default: wrapper-scoped).
    ask_agent_scope

    # Choosing wrapper does not undo what an earlier global install wrote, so
    # offer to remove those leftovers — otherwise the choice is quietly untrue.
    cleanup_stale_global_artifacts

    # Network FIRST. Everything below this line may hit the network, and the
    # heaviest step (install_node_dependencies -> native postinstalls fetching
    # from github.com) is the one that fails hardest without a proxy. Detecting
    # the network after that step — as this script used to — is useless.
    configure_proxy_for_install
    preflight_network

    # Run installation steps
    check_dependencies
    detect_agents
    configure_team_setup
    setup_history_repo
    install_node_dependencies
    initialize_knowledge_databases
    install_plantuml
    setup_local_llm  # DMR preferred, Ollama as fallback
    setup_llm_cli_proxy  # HTTP bridge for claude/copilot CLI in Docker
    install_memory_visualizer
    install_semantic_analysis
    install_constraint_monitor
    install_system_health_dashboard
    install_graphify
    configure_docker_mode
    create_command_wrappers
    setup_unified_launcher
    configure_shell_environment
    initialize_shared_memory
    create_example_configs
    setup_mcp_config
    install_enhanced_lsl
    install_mastra_opencode
    install_compaction_guard
    install_knowledge_injection
    install_copilot_file_hooks
    install_skills
    create_project_local_settings
    install_okb_snapshot_guard
    install_constraint_monitor_hooks
    verify_installation
    setup_api_admin_keys

    # Create activation script for immediate use
    cat > "$CODING_REPO/.activate" << EOF
#!/bin/bash
# Activate Agent-Agnostic Coding Tools environment
export CODING_REPO="$CODING_REPO"
export PATH="$CODING_REPO/bin:\$PATH"
echo "✅ Agent-Agnostic Coding Tools environment activated!"
echo "Commands 'vkb' and 'coding' are now available."
echo ""
echo "Usage:"
echo "  coding           # Use best available agent"
echo "  coding --copilot # Force CoPilot"
echo "  coding --claude  # Force Claude Code"
EOF
    chmod +x "$CODING_REPO/.activate"
    
    # Installation status report
    show_installation_status
    
    log "Installation completed"
}

# Show comprehensive installation status
show_installation_status() {
    echo ""
    echo -e "${PURPLE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    if [[ ${#INSTALLATION_FAILURES[@]} -eq 0 && ${#INSTALLATION_WARNINGS[@]} -eq 0 ]]; then
        echo -e "${GREEN}🎉 Installation completed successfully!${NC}"
    elif [[ ${#INSTALLATION_FAILURES[@]} -eq 0 ]]; then
        echo -e "${YELLOW}⚠️  Installation completed with warnings${NC}"
    else
        echo -e "${RED}❌ Installation completed with some failures${NC}"
    fi

    echo -e "${PURPLE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    # Show skipped system changes (important safety info)
    if [[ ${#SKIPPED_SYSTEM_DEPS[@]} -gt 0 ]]; then
        echo -e "\n${BLUE}ℹ️  Skipped system changes (at your request):${NC}"
        for skipped in "${SKIPPED_SYSTEM_DEPS[@]}"; do
            echo -e "  ${BLUE}•${NC} $skipped"
        done
        echo -e "  ${CYAN}These can be installed manually later if needed.${NC}"
    fi

    # Show warnings
    if [[ ${#INSTALLATION_WARNINGS[@]} -gt 0 ]]; then
        echo -e "\n${YELLOW}⚠️  Warnings:${NC}"
        for warning in "${INSTALLATION_WARNINGS[@]}"; do
            echo -e "  ${YELLOW}•${NC} $warning"
        done
    fi

    # Show failures
    if [[ ${#INSTALLATION_FAILURES[@]} -gt 0 ]]; then
        echo -e "\n${RED}❌ Failures:${NC}"
        for failure in "${INSTALLATION_FAILURES[@]}"; do
            echo -e "  ${RED}•${NC} $failure"
        done
        echo ""
        echo -e "${RED}⚠️  IMPORTANT: Some components failed to install!${NC}"
        echo -e "${RED}   The system may not work fully until these issues are resolved.${NC}"
        if [[ "$INSIDE_CN" == true && "$PROXY_WORKING" == false ]]; then
            echo -e "${YELLOW}   Hint: External repository access is blocked. Try:${NC}"
            echo -e "${YELLOW}   1. Configure your proxy settings${NC}"
            echo -e "${YELLOW}   2. Run installer from outside corporate network${NC}"
        fi
    fi

    echo ""
    echo -e "${CYAN}📋 Next steps:${NC}"
    echo -e "   ${CYAN}⚡ To start using commands immediately:${NC} source .activate"
    echo -e "   ${CYAN}📖 Commands available:${NC} vkb (View Knowledge Base)"

    if [[ ${#INSTALLATION_FAILURES[@]} -eq 0 ]]; then
        echo ""
        echo -e "${GREEN}Happy knowledge capturing! 🧠${NC}"
    fi
}

# Install Enhanced Live Session Logging system
install_enhanced_lsl() {
    echo -e "\n${CYAN}📝 Installing Enhanced LSL system...${NC}"

    # Run LSL deployment script
    if [[ -x "$CODING_REPO/scripts/deploy-enhanced-lsl.sh" ]]; then
        info "Running Enhanced LSL deployment..."
        "$CODING_REPO/scripts/deploy-enhanced-lsl.sh" --skip-tests || warning "Enhanced LSL installation had warnings"
        success "Enhanced LSL system installed"
    else
        warning "Enhanced LSL deployment script not found or not executable"
    fi
}

# Install Mastra OpenCode plugin for observational memory
install_mastra_opencode() {
    echo -e "\n${CYAN}🧠 Installing Mastra OpenCode plugin...${NC}"

    cd "$CODING_REPO"

    # Check Node.js >= 22.13.0 (required by @mastra/opencode)
    if ! command -v node &> /dev/null; then
        warning "Node.js not found. Mastra OpenCode requires Node.js 22+"
        INSTALLATION_WARNINGS+=("Mastra OpenCode: Node.js not found")
        return 1
    fi

    local node_major
    node_major=$(node -v | sed 's/^v//' | cut -d. -f1)
    if [[ "$node_major" -lt 22 ]]; then
        warning "Node.js $node_major found, but Mastra OpenCode requires Node.js >= 22.13.0"
        INSTALLATION_WARNINGS+=("Mastra OpenCode: Node.js version too old ($node_major, need 22+)")
        return 1
    fi
    info "Node.js v$(node -v | sed 's/^v//') detected (>= 22 required)"

    # Install @mastra/opencode via npm
    info "Installing @mastra/opencode..."
    if npm install @mastra/opencode@latest 2>>"$INSTALL_LOG"; then
        success "@mastra/opencode installed"
    else
        warning "npm install @mastra/opencode failed. If package is unavailable, a monorepo build fallback may be needed."
        INSTALLATION_WARNINGS+=("Mastra OpenCode: npm install failed -- check npm registry availability")
        return 1
    fi

    # Create .observations/ directory for LibSQL storage
    info "Setting up observation storage directory..."
    mkdir -p "$CODING_REPO/.observations"
    success "Created .observations/ directory"

    # Create .observations/config.json with default token budget config
    if [[ ! -f "$CODING_REPO/.observations/config.json" ]]; then
        info "Creating default observation config..."
        cat > "$CODING_REPO/.observations/config.json" << 'OBSCONFIG'
{
  "version": 1,
  "model": "google/gemini-2.5-flash",
  "observation": {
    "messageTokens": 20000
  },
  "reflection": {
    "observationTokens": 90000
  },
  "budgets": {
    "opencode": {
      "dailyTokens": 500000
    },
    "mastra": {
      "dailyTokens": 500000
    },
    "claude": {
      "dailyTokens": 1000000
    }
  }
}
OBSCONFIG
        success "Created .observations/config.json with default budgets"
    else
        info ".observations/config.json already exists -- skipping"
    fi

    # Create .opencode/ directory and mastra.json plugin config
    mkdir -p "$CODING_REPO/.opencode"
    if [[ ! -f "$CODING_REPO/.opencode/mastra.json" ]]; then
        info "Creating Mastra plugin config..."
        cat > "$CODING_REPO/.opencode/mastra.json" << 'MASTRACONFIG'
{
  "model": "google/gemini-2.5-flash",
  "storagePath": ".observations/observations.db",
  "observation": {
    "messageTokenThreshold": 500
  },
  "reflection": {
    "observationTokenThreshold": 5000
  }
}
MASTRACONFIG
        success "Created .opencode/mastra.json with storage path override"
    else
        info ".opencode/mastra.json already exists -- skipping"
    fi

    cd "$CODING_REPO"
    success "Mastra OpenCode plugin installation complete"
}

# Install compaction-guard plugin to prevent "Bad Request" during OpenCode compaction.
# When sessions grow too large (many tool calls, base64 images, large outputs),
# the compaction request itself can exceed API proxy limits. This plugin truncates
# old tool outputs and enriches compaction prompts to keep payloads manageable.
# Also configures compaction.reserved=40000 in opencode.json to trigger compaction earlier.
install_compaction_guard() {
    # Writes ~/.opencode/plugins/ and ~/.config/opencode/opencode.json, so it
    # would load in EVERY opencode session. In wrapper mode bin/coding supplies
    # the plugin through OPENCODE_CONFIG_CONTENT instead (config/agents/opencode.sh).
    require_global_scope "OpenCode compaction-guard plugin (global ~/.opencode)" || return 0

    echo -e "\n${CYAN}🛡️  Installing OpenCode compaction-guard plugin...${NC}"

    local OPENCODE_HOME="$HOME/.opencode"
    local OPENCODE_CONFIG="$HOME/.config/opencode"
    local PLUGIN_SRC="$CODING_REPO/plugins/opencode/compaction-guard.js"
    local PLUGIN_DST="$OPENCODE_HOME/plugins/compaction-guard.js"

    # --- 1. Install the plugin file ---
    if [[ ! -f "$PLUGIN_SRC" ]]; then
        warning "compaction-guard.js not found at $PLUGIN_SRC -- skipping plugin install"
        INSTALLATION_WARNINGS+=("Compaction guard: plugin source not found")
        return 1
    fi

    mkdir -p "$OPENCODE_HOME/plugins"
    cp "$PLUGIN_SRC" "$PLUGIN_DST"
    success "Installed compaction-guard plugin → $PLUGIN_DST"

    # --- 2. Ensure @opencode-ai/plugin SDK is available (needed for type hints) ---
    if [[ -d "$OPENCODE_HOME/node_modules/@opencode-ai/plugin" ]]; then
        info "@opencode-ai/plugin SDK already present"
    else
        info "Installing @opencode-ai/plugin SDK in $OPENCODE_HOME..."
        (cd "$OPENCODE_HOME" && npm install @opencode-ai/plugin@latest 2>>"$INSTALL_LOG") \
            && success "@opencode-ai/plugin SDK installed" \
            || warning "@opencode-ai/plugin SDK install failed (plugin may still work)"
    fi

    # --- 3. Update opencode.json with compaction settings and plugin registration ---
    local OPENCODE_JSON="$OPENCODE_CONFIG/opencode.json"
    if [[ -f "$OPENCODE_JSON" ]]; then
        if command -v jq &> /dev/null; then
            local TMP_JSON
            local needs_update=false

            # 3a. Add compaction settings if missing
            if jq -e '.compaction' "$OPENCODE_JSON" > /dev/null 2>&1; then
                info "compaction settings already present in opencode.json -- skipping"
            else
                info "Adding compaction settings to opencode.json..."
                TMP_JSON=$(mktemp)
                jq '. + {"compaction": {"auto": true, "prune": true, "reserved": 40000}}' "$OPENCODE_JSON" > "$TMP_JSON" \
                    && mv "$TMP_JSON" "$OPENCODE_JSON" \
                    && success "Added compaction.reserved=40000 to opencode.json" \
                    || { warning "Failed to update opencode.json"; rm -f "$TMP_JSON"; }
            fi

            # 3b. Register plugin in opencode.json so OpenCode actually loads it
            local PLUGIN_PATH="$PLUGIN_DST"
            if jq -e '.plugin' "$OPENCODE_JSON" > /dev/null 2>&1; then
                # plugin key exists -- check if our path is already in the array
                if jq -e --arg p "$PLUGIN_PATH" '.plugin | map(select(. == $p)) | length > 0' "$OPENCODE_JSON" > /dev/null 2>&1; then
                    info "compaction-guard already registered in opencode.json plugin array"
                else
                    info "Adding compaction-guard to existing plugin array..."
                    TMP_JSON=$(mktemp)
                    jq --arg p "$PLUGIN_PATH" '.plugin += [$p]' "$OPENCODE_JSON" > "$TMP_JSON" \
                        && mv "$TMP_JSON" "$OPENCODE_JSON" \
                        && success "Added compaction-guard to plugin array in opencode.json" \
                        || { warning "Failed to update opencode.json plugin array"; rm -f "$TMP_JSON"; }
                fi
            else
                info "Adding plugin array with compaction-guard to opencode.json..."
                TMP_JSON=$(mktemp)
                jq --arg p "$PLUGIN_PATH" '. + {"plugin": [$p]}' "$OPENCODE_JSON" > "$TMP_JSON" \
                    && mv "$TMP_JSON" "$OPENCODE_JSON" \
                    && success "Registered compaction-guard plugin in opencode.json" \
                    || { warning "Failed to add plugin array to opencode.json"; rm -f "$TMP_JSON"; }
            fi
        else
            warning "jq not available -- cannot update opencode.json automatically"
            info "Manually add to $OPENCODE_JSON:"
            info '  "compaction": {"auto": true, "prune": true, "reserved": 40000}'
            info "  \"plugin\": [\"$PLUGIN_DST\"]"
        fi
    else
        info "opencode.json not found at $OPENCODE_JSON -- skipping compaction config"
        info "(OpenCode will use defaults; create the file to customize compaction)"
    fi

    success "Compaction-guard installation complete"
}

# Install the knowledge-injection plugin — per-prompt KB injection for OpenCode,
# mirroring the Claude Code UserPromptSubmit hook. Makes OpenCode runs carry the
# ~1000-token retrieved-knowledge block (Working Memory + semantic Insights/Digests/
# Entities/Observations), so the model uses it AND the Performance-tab "Retrieved
# Knowledge" modal populates for OpenCode runs (previously always empty for them).
install_knowledge_injection() {
    # Same reasoning as install_compaction_guard: global ~/.opencode write,
    # replaced per-launch by OPENCODE_CONFIG_CONTENT in wrapper mode.
    require_global_scope "OpenCode knowledge-injection plugin (global ~/.opencode)" || return 0

    echo -e "\n${CYAN}🧠 Installing OpenCode knowledge-injection plugin...${NC}"

    local OPENCODE_HOME="$HOME/.opencode"
    local OPENCODE_JSON="$HOME/.config/opencode/opencode.json"
    local PLUGIN_SRC="$CODING_REPO/plugins/opencode/knowledge-injection.js"
    local PLUGIN_DST="$OPENCODE_HOME/plugins/knowledge-injection.js"

    if [[ ! -f "$PLUGIN_SRC" ]]; then
        warning "knowledge-injection.js not found at $PLUGIN_SRC -- skipping plugin install"
        INSTALLATION_WARNINGS+=("Knowledge injection: plugin source not found")
        return 1
    fi

    mkdir -p "$OPENCODE_HOME/plugins"
    cp "$PLUGIN_SRC" "$PLUGIN_DST"
    success "Installed knowledge-injection plugin → $PLUGIN_DST"

    # Register in the opencode.json plugin array (append — must not clobber the
    # compaction-guard entry install_compaction_guard added just before us).
    # OpenCode also auto-loads ~/.opencode/plugins/*.js, so this is belt-and-suspenders.
    if [[ -f "$OPENCODE_JSON" ]] && command -v jq &> /dev/null; then
        local TMP_JSON
        if jq -e '.plugin' "$OPENCODE_JSON" > /dev/null 2>&1; then
            if jq -e --arg p "$PLUGIN_DST" '.plugin | map(select(. == $p)) | length > 0' "$OPENCODE_JSON" > /dev/null 2>&1; then
                info "knowledge-injection already registered in opencode.json plugin array"
            else
                TMP_JSON=$(mktemp)
                jq --arg p "$PLUGIN_DST" '.plugin += [$p]' "$OPENCODE_JSON" > "$TMP_JSON" \
                    && mv "$TMP_JSON" "$OPENCODE_JSON" \
                    && success "Added knowledge-injection to plugin array in opencode.json" \
                    || { warning "Failed to update opencode.json plugin array"; rm -f "$TMP_JSON"; }
            fi
        else
            TMP_JSON=$(mktemp)
            jq --arg p "$PLUGIN_DST" '. + {"plugin": [$p]}' "$OPENCODE_JSON" > "$TMP_JSON" \
                && mv "$TMP_JSON" "$OPENCODE_JSON" \
                && success "Registered knowledge-injection plugin in opencode.json" \
                || { warning "Failed to add plugin array to opencode.json"; rm -f "$TMP_JSON"; }
        fi
    fi

    success "Knowledge-injection installation complete"
}

# Enable Copilot CLI filesystem hooks so the repo's .github/hooks/hooks.json bridge
# actually fires. Copilot gates these behind TWO settings that are OFF by default —
# without both, the entire copilot integration (KB injection via postToolUse
# additionalContext, constraint monitoring, observation capture) stays dormant and
# no live test would catch it (the contract test only checks hooks.json schema):
#   1. enableFileHooks: true   (user settings — ~/.copilot/settings.json)
#   2. the repo folder in trustedFolders (~/.copilot/config.json)
# Both edits are idempotent and fail-open (node — copilot ships node; jq can't parse
# the JSONC config.json). Per-avenue KB injection still honors CODING_KNOWLEDGE_INJECTION=0.
install_copilot_file_hooks() {
    # THIS ONE IS A SEPARATE OPT-IN, off even in global scope.
    #
    # `copilot` has no per-launch equivalent for enableFileHooks: there is no
    # flag and no config-dir env var (only --additional-mcp-config is
    # session-scoped). So unlike claude and opencode, this capability CANNOT be
    # made wrapper-scoped — it is inherently global, and switching it on lets a
    # repo's own .github/hooks/hooks.json fire in ANY of the user's repositories.
    #
    # It therefore needs its own explicit consent, not merely "global scope".
    # With it off, copilot under `coding` still gets MCP and transcript capture;
    # only the postToolUse knowledge-injection path is dormant.
    if [[ "${CODING_INSTALL_COPILOT_HOOKS:-0}" != "1" ]]; then
        info "Skipping Copilot filesystem hooks (opt in with CODING_INSTALL_COPILOT_HOOKS=1)"
        info "  Why separate: copilot has no per-launch hook switch, so this is"
        info "  unavoidably global — it would let repo hooks fire in all your repos."
        log "SKIP: copilot file hooks (not opted in)"
        return 0
    fi

    echo -e "\n${CYAN}🪝  Enabling Copilot CLI filesystem hooks...${NC}"
    local SETTINGS="$HOME/.copilot/settings.json"
    local CONFIG="$HOME/.copilot/config.json"

    if ! command -v node &> /dev/null; then
        warning "node not found — cannot enable copilot file hooks automatically"
        info "Manually: set \"enableFileHooks\": true in $SETTINGS and add \"$CODING_REPO\" to trustedFolders in $CONFIG"
        return 1
    fi

    # 1. enableFileHooks in the clean-JSON user settings file.
    CODING_SETTINGS="$SETTINGS" node -e '
      const fs=require("fs"); const p=process.env.CODING_SETTINGS; let d={};
      try { d=JSON.parse(fs.readFileSync(p,"utf8")); } catch {}
      d.enableFileHooks=true;
      fs.mkdirSync(require("path").dirname(p),{recursive:true});
      fs.writeFileSync(p, JSON.stringify(d,null,2));
    ' 2>>"$INSTALL_LOG" && success "Set enableFileHooks: true in ~/.copilot/settings.json" \
      || warning "Failed to update ~/.copilot/settings.json"

    # 2. Trust the repo folder in the JSONC-format config.json (strip // comments to parse).
    if [[ -f "$CONFIG" ]]; then
        CODING_CONFIG="$CONFIG" CODING_TRUST="$CODING_REPO" node -e '
          const fs=require("fs"); const p=process.env.CODING_CONFIG;
          let raw=""; try { raw=fs.readFileSync(p,"utf8"); } catch {}
          const nc=raw.split("\n").filter(l=>!l.trim().startsWith("//")).join("\n");
          let d={}; try { d=JSON.parse(nc); } catch {}
          d.trustedFolders=Array.isArray(d.trustedFolders)?d.trustedFolders:[];
          if(!d.trustedFolders.includes(process.env.CODING_TRUST)) d.trustedFolders.push(process.env.CODING_TRUST);
          fs.writeFileSync(p, JSON.stringify(d,null,2));
        ' 2>>"$INSTALL_LOG" && success "Trusted $CODING_REPO in ~/.copilot/config.json" \
          || warning "Failed to update ~/.copilot/config.json trustedFolders"
    else
        info "~/.copilot/config.json not found — copilot will create it + prompt for folder trust on first run"
    fi

    success "Copilot filesystem hooks enabled (KB injection via postToolUse is live)"
}

# Install skills to all supported agents (Claude global, Copilot, OpenCode)
# Adding a skill: drop .md into .claude/commands/ → this function handles the rest.
install_skills() {
    echo -e "\n${CYAN}📝 Installing skills to all agents...${NC}"

    if [[ -x "$CODING_REPO/scripts/generate-agent-instructions.sh" ]]; then
        "$CODING_REPO/scripts/generate-agent-instructions.sh" "$CODING_REPO" "$CODING_REPO"
        success "Skills synced to Claude (global), Copilot, and OpenCode"
    else
        warning "scripts/generate-agent-instructions.sh not found or not executable"
    fi
}

# Create project-local settings for the coding repo itself
create_project_local_settings() {
    echo -e "\n${CYAN}📝 Creating Project-Local Settings...${NC}"

    local project_settings_dir="$CODING_REPO/.claude"
    local project_settings_file="$project_settings_dir/settings.local.json"

    # Create .claude directory if needed
    mkdir -p "$project_settings_dir"

    # Create settings.local.json with platform-specific paths
    cat > "$project_settings_file" << 'EOF'
{
  "permissions": {
    "allow": [
      "Bash(npm run api:*)",
      "Bash(TRANSCRIPT_DEBUG=true node scripts/enhanced-transcript-monitor.js --test)",
      "Bash(node:*)",
      "Bash(plantuml:*)",
      "Bash(bin/coding:*)",
      "Bash(cp:*)",
      "Bash(cat:*)",
      "Bash(timeout:*)",
      "Bash(watch:*)",
      "Bash(find:*)",
      "Bash(CODING_REPO=CODING_REPO_PLACEHOLDER node CODING_REPO_PLACEHOLDER/scripts/combined-status-line.js)",
      "Bash(kill:*)",
      "Bash(pkill:*)",
      "Bash(grep:*)",
      "Bash(lsof:*)",
      "Bash(curl:*)",
      "Bash(PORT=3030 npm run dev)",
      "mcp__constraint-monitor__check_constraints",
      "Bash(npm start)",
      "Bash(git rm:*)",
      "Bash(npm run:*)",
      "Bash(chmod:*)",
      "Bash(./test-individual-constraints.sh:*)",
      "Bash(docker stop:*)",
      "Bash(docker rm:*)",
      "Bash(docker-compose up:*)",
      "Bash(docker logs:*)",
      "Bash(docker restart:*)",
      "Bash(PORT=3031 npm run api)",
      "Bash(git checkout:*)",
      "Bash(xargs kill:*)",
      "mcp__mcp-git-ingest__git_directory_structure",
      "mcp__mcp-git-ingest__git_read_important_files",
      "WebSearch",
      "Bash(git remote get-url:*)",
      "Bash(basename:*)",
      "Bash(PORT=3030 npm run dashboard)",
      "Bash(sort:*)",
      "Bash(awk:*)",
      "Bash(PORT=3031 node src/dashboard-server.js)",
      "Bash(jq:*)",
      "Bash(npm install:*)",
      "Read(//USER_HOME_PLACEHOLDER/.claude/**)",
      "WebFetch(domain:console.groq.com)",
      "Read(//private/tmp/**)",
      "Bash(./collect-test-results.js)",
      "WebFetch(domain:github.com)",
      "Bash(sqlite3 .data/knowledge.db \"SELECT source, COUNT(*) as count FROM knowledge_extractions GROUP BY source\")",
      "Bash(sqlite3 .data/knowledge.db \"PRAGMA table_info(knowledge_extractions)\")",
      "Bash(vkb restart:*)",
      "Bash(bin/vkb restart:*)",
      "Bash(ps:*)",
      "Bash(git submodule:*)",
      "Bash(git config:*)",
      "Bash(git restore:*)",
      "Bash(git diff:*)",
      "Bash(xargs -I {} git restore --source=HEAD {})",
      "WebFetch(domain:claude.ai)",
      "mcp__constraint-monitor__get_constraint_status",
      "Bash(for coll in ontology-coding ontology-raas ontology-resi ontology-agentic ontology-ui)",
      "Bash(do echo -n \"$coll: \")",
      "Bash(done)",
      "Bash(npm test:*)",
      "Bash(docker info:*)",
      "Bash(bin/vkb:*)",
      "Bash(SYSTEM_HEALTH_API_PORT=3033 pnpm api:*)",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(rm:*)",
      "Bash(npm view:*)",
      "Bash(while read name)",
      "Bash(do [ ! -f \"docs/presentation/images/$name.png\" ])",
      "Bash(echo:*)",
      "Bash(git fetch:*)"
    ],
    "deny": [],
    "ask": []
  },
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node CODING_REPO_PLACEHOLDER/integrations/mcp-constraint-monitor/src/hooks/pre-prompt-hook-wrapper.js"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node CODING_REPO_PLACEHOLDER/integrations/mcp-constraint-monitor/src/hooks/pre-tool-hook-wrapper.js"
          }
        ]
      }
    ]
  }
}
EOF
    # NOTE: statusLine is NOT set here — tmux provides the status bar for all
    # coding sessions. See tmux-session-wrapper.sh and status-line-fast.cjs.

    # Replace placeholders with actual paths
    sed -i.bak "s|CODING_REPO_PLACEHOLDER|$CODING_REPO|g" "$project_settings_file"
    sed -i.bak "s|USER_HOME_PLACEHOLDER|$HOME|g" "$project_settings_file"
    rm -f "$project_settings_file.bak"

    success "Created .claude/settings.local.json with platform-specific paths"
}

# Install OKB snapshot guard pre-commit hooks
# Prevents .data/ files from being accidentally committed with unrelated changes.
# Only allows .data/ commits when OKB_SNAPSHOT=1 is explicitly set.
install_okb_snapshot_guard() {
    echo -e "\n${CYAN}Installing OKB snapshot guard hooks...${NC}"

    local hook_template="$CODING_REPO/scripts/hooks/pre-commit-okb-guard.sh"
    if [[ ! -f "$hook_template" ]]; then
        warning "OKB pre-commit hook template not found at $hook_template"
        return 1
    fi

    # Install in coding repo itself
    local coding_hook="$CODING_REPO/.git/hooks/pre-commit"
    if [[ -d "$CODING_REPO/.git/hooks" ]]; then
        cp "$hook_template" "$coding_hook"
        chmod +x "$coding_hook"
        success "OKB snapshot guard installed in coding repo"
    fi

    # Install in consumer repos that have OKB as a submodule
    local consumer_repos=(
        "$HOME/Agentic/_work/rapid-automations"
    )
    for repo in "${consumer_repos[@]}"; do
        local submodule_hooks_dir="$repo/.git/modules/integrations/operational-knowledge-management/hooks"
        if [[ -d "$submodule_hooks_dir" ]]; then
            cp "$hook_template" "$submodule_hooks_dir/pre-commit"
            chmod +x "$submodule_hooks_dir/pre-commit"
            success "OKB snapshot guard installed in $(basename "$repo") OKB submodule"
        fi
    done
}

# Install constraint monitor hooks and LSL logging hooks
install_constraint_monitor_hooks() {
    # ~/.claude/settings.json hooks fire for EVERY claude session in every
    # project — this is the single biggest "did installing this change my setup?"
    # surface. In wrapper mode bin/coding derives a settings file containing
    # these hooks and passes it with --settings per launch, so the user's own
    # ~/.claude/settings.json is never read-modify-written.
    require_global_scope "global Claude hooks (~/.claude/settings.json)" || return 0

    echo -e "\n${CYAN}🔗 Installing Hooks (Constraints + LSL)...${NC}"

    # SANDBOX MODE: Skip global hooks installation
    if [[ "$SANDBOX_MODE" == "true" ]]; then
        warning "SANDBOX MODE: Skipping global hooks installation (~/.claude/settings.json)"
        info "Hooks will NOT be active in sandbox mode"
        info "To use hooks, install from the primary coding installation"
        return 0
    fi

    # NODE.JS HEALTH CHECK: Verify Node.js works before installing hooks
    # This prevents broken hooks from crashing Claude if Node.js has library issues
    # (e.g., Homebrew simdjson/libuv version mismatch)
    info "Verifying Node.js health before hook installation..."
    local node_test_output
    if ! node_test_output=$(node -e "console.log('ok')" 2>&1); then
        echo ""
        echo -e "${RED}╔══════════════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${RED}║                                                                      ║${NC}"
        echo -e "${RED}║              ⚠️  NODE.JS HEALTH CHECK FAILED ⚠️                       ║${NC}"
        echo -e "${RED}║                                                                      ║${NC}"
        echo -e "${RED}╚══════════════════════════════════════════════════════════════════════╝${NC}"
        echo ""
        echo -e "${YELLOW}Node.js failed to execute. This is often caused by Homebrew library${NC}"
        echo -e "${YELLOW}version mismatches (e.g., simdjson, libuv).${NC}"
        echo ""
        echo -e "${CYAN}Error output:${NC}"
        echo "$node_test_output" | head -5
        echo ""
        echo -e "${CYAN}Common causes and fixes:${NC}"
        echo -e "  ${GREEN}1.${NC} Library mismatch after Homebrew update - try: brew upgrade"
        echo -e "  ${GREEN}2.${NC} Use nvm for isolated Node management: nvm install --lts && nvm use --lts"
        echo -e "  ${GREEN}3.${NC} Check if libsimdjson needs linking: brew link simdjson"
        echo ""
        echo -e "${RED}IMPORTANT:${NC} This installer will NOT attempt to fix your Node installation."
        echo ""
        warning "SKIPPING hook installation to prevent Claude from crashing"
        warning "Please fix Node.js manually, then re-run: ./install.sh"
        INSTALLATION_WARNINGS+=("Hooks: Skipped - Node.js health check failed")
        return 1
    fi
    success "Node.js health check passed"

    local settings_file="$HOME/.claude/settings.json"
    local pre_hook_cmd="node $CODING_REPO/integrations/mcp-constraint-monitor/src/hooks/pre-tool-hook-wrapper.js"
    local post_hook_cmd="node $CODING_REPO/scripts/tool-interaction-hook-wrapper.js"
    local prompt_hook_cmd="node $CODING_REPO/scripts/health-prompt-hook.js"
    local status_line_cmd="node $CODING_REPO/scripts/combined-status-line-wrapper.js"

    # Create .claude directory if it doesn't exist
    mkdir -p "$HOME/.claude"

    # Check if jq is available for JSON manipulation
    if ! command -v jq >/dev/null 2>&1; then
        warning "jq not found - attempting manual JSON configuration"

        # Create settings file if it doesn't exist
        if [[ ! -f "$settings_file" ]]; then
            cat > "$settings_file" << EOF
{
  "\$schema": "https://json.schemastore.org/claude-code-settings.json",
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "$pre_hook_cmd"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "$post_hook_cmd"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$prompt_hook_cmd",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
EOF
            success "Created new settings file with hooks and status line"
            return 0
        else
            warning "Cannot merge hooks without jq - please install jq and run installer again"
            INSTALLATION_WARNINGS+=("Hooks: Not installed - jq required for merge")
            return 1
        fi
    fi

    # Backup existing settings
    if [[ -f "$settings_file" ]]; then
        local backup_file="${settings_file}.backup.$(date +%Y%m%d_%H%M%S)"
        cp "$settings_file" "$backup_file"
        info "Backed up existing settings to: $backup_file"
    else
        # Create new settings file
        echo '{"$schema": "https://json.schemastore.org/claude-code-settings.json"}' > "$settings_file"
    fi

    # Use jq to add or update hooks
    local temp_file=$(mktemp)

    # Check if EXACT hooks already exist with correct paths
    local pre_exists=$(jq -e --arg cmd "$pre_hook_cmd" '.hooks.PreToolUse[]? | select(.hooks[]?.command == $cmd)' "$settings_file" 2>/dev/null && echo "yes" || echo "no")
    local post_exists=$(jq -e --arg cmd "$post_hook_cmd" '.hooks.PostToolUse[]? | select(.hooks[]?.command == $cmd)' "$settings_file" 2>/dev/null && echo "yes" || echo "no")

    if [[ "$pre_exists" == "yes" ]] && [[ "$post_exists" == "yes" ]]; then
        info "Both PreToolUse and PostToolUse hooks already installed with correct paths"
        return 0
    fi

    # IMPORTANT: Remove any old hook entries (duplicates or wrong paths) before adding new ones
    # This ensures clean state and prevents accumulation of stale hooks
    jq --arg pre_cmd "$pre_hook_cmd" --arg post_cmd "$post_hook_cmd" --arg prompt_cmd "$prompt_hook_cmd" --arg status_line_cmd "$status_line_cmd" '
        # Remove ALL existing PreToolUse hooks that match the wrapper script (regardless of path)
        .hooks.PreToolUse = (
            if .hooks.PreToolUse then
                [.hooks.PreToolUse[] | select(.hooks[]?.command | contains("pre-tool-hook-wrapper.js") | not)]
            else
                []
            end
        ) |
        # Remove ALL existing PostToolUse hooks that match the wrapper script (regardless of path)
        .hooks.PostToolUse = (
            if .hooks.PostToolUse then
                [.hooks.PostToolUse[] | select(.hooks[]?.command | contains("tool-interaction-hook-wrapper.js") | not)]
            else
                []
            end
        ) |
        # Remove ALL existing UserPromptSubmit hooks that match health-prompt-hook (regardless of path)
        .hooks.UserPromptSubmit = (
            if .hooks.UserPromptSubmit then
                [.hooks.UserPromptSubmit[] | select(.hooks[]?.command | contains("health-prompt-hook.js") | not)]
            else
                []
            end
        ) |
        # Add the new hooks with correct paths (only ONE instance of each)
        .hooks.PreToolUse += [{
            "matcher": "*",
            "hooks": [{
                "type": "command",
                "command": $pre_cmd
            }]
        }] |
        .hooks.PostToolUse += [{
            "matcher": "*",
            "hooks": [{
                "type": "command",
                "command": $post_cmd
            }]
        }] |
        .hooks.UserPromptSubmit += [{
            "hooks": [{
                "type": "command",
                "command": $prompt_cmd,
                "timeout": 5
            }]
        }]
    ' "$settings_file" > "$temp_file"

    # Validate JSON
    if jq empty "$temp_file" 2>/dev/null; then
        mv "$temp_file" "$settings_file"
        success "Hooks installed to ~/.claude/settings.json"
        info "  - PreToolUse: Constraint monitoring (blocks violations)"
        info "  - PostToolUse: LSL logging (captures interactions)"
        info "  - UserPromptSubmit: System health verification"
        info "  - StatusLine: provided by tmux (see tmux-session-wrapper.sh)"
    else
        rm -f "$temp_file"
        warning "Failed to update settings file - JSON validation failed"
        INSTALLATION_WARNINGS+=("Hooks: Installation failed - JSON error")
        return 1
    fi
}

# Run main function — only when executed directly, so the script can be sourced
# (e.g. by tests / CI) to exercise individual functions without installing.
if [[ "$SCRIPT_EXECUTED" == "true" ]]; then
    main "$@"
fi
