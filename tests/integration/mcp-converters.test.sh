#!/usr/bin/env bash
#
# Contract test for install.sh's non-Claude MCP config converters.
#
# Covers three defects that reached live agent configs:
#   1. Both converters replaced their target map wholesale, so a server we stopped
#      shipping (code-graph-rag, retired with Memgraph) survived forever while a
#      correctly-registered one (graphify) could be silently overwritten.
#   2. Neither handled HTTP transport, so an HTTP server landed as stdio with an
#      empty command — which is why Copilot had no working code-graph server.
#   3. {{GROQ_API_KEY}} / {{GROK_API_KEY}} were never substituted, leaking literal
#      placeholder text as the env value.
#
# NOTE: install.sh sets CODING_REPO unconditionally at source time (install.sh:29),
# so this test MUST re-export its fixture paths AFTER sourcing. Getting that wrong
# makes the converters write to the real repo.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

mkdir -p "$T/home/.config/opencode" "$T/repo/.vscode"

cat > "$T/home/.config/opencode/opencode.json" <<'JSON'
{
  "theme": "dark",
  "mcp": {
    "semantic-analysis": {"type": "local", "command": ["node", "old.js"], "enabled": true},
    "code-graph-rag":    {"type": "local", "command": ["python", "cgr.py"], "enabled": true},
    "my-own-server":     {"type": "local", "command": ["node", "mine.js"], "enabled": true}
  }
}
JSON

cat > "$T/repo/.vscode/mcp.json" <<'JSON'
{
  "servers": {
    "code-graph-rag": {"type": "stdio", "command": "python", "args": ["cgr.py"]},
    "hand-added":     {"type": "stdio", "command": "node", "args": ["x.js"]}
  }
}
JSON

cat > "$T/claude-mcp.json" <<'JSON'
{
  "mcpServers": {
    "semantic-analysis": {"command": "node", "args": ["dist/index.js"], "env": {"K": "v"}},
    "graphify":          {"type": "http", "url": "http://localhost:3851/mcp"}
  }
}
JSON

SANDBOX_MODE=false
# shellcheck disable=SC1090,SC1091
source "$REPO_ROOT/install.sh" >/dev/null 2>&1 || true

# Must come after the source — see NOTE above.
export HOME="$T/home"
export CODING_REPO="$T/repo"

setup_opencode_mcp_config "$T/claude-mcp.json" >/dev/null 2>&1
setup_copilot_mcp_config  "$T/claude-mcp.json" >/dev/null 2>&1

python3 - "$T/home/.config/opencode/opencode.json" "$T/repo/.vscode/mcp.json" "$REPO_ROOT" <<'PY'
import json, re, sys

oc = json.load(open(sys.argv[1]))
cp = json.load(open(sys.argv[2]))
mcp, srv = oc.get("mcp", {}), cp.get("servers", {})
fails = []

def check(cond, msg):
    print(("  PASS  " if cond else "  FAIL  ") + msg)
    if not cond:
        fails.append(msg)

print("OpenCode converter:")
check(mcp.get("graphify", {}).get("type") == "remote", "HTTP server emitted as type=remote")
check(mcp.get("graphify", {}).get("url") == "http://localhost:3851/mcp", "url preserved")
check("code-graph-rag" not in mcp, "retired managed server pruned")
check("my-own-server" in mcp, "hand-added server survives the merge")
check(oc.get("theme") == "dark", "unrelated top-level settings preserved")
check(mcp.get("semantic-analysis", {}).get("command") == ["node", "dist/index.js"],
      "stdio server converts to command array")
check(mcp.get("semantic-analysis", {}).get("environment") == {"K": "v"}, "env mapped to environment")

print("Copilot converter:")
check(srv.get("graphify", {}).get("type") == "http", "HTTP server emitted as type=http")
check(srv.get("graphify", {}).get("url") == "http://localhost:3851/mcp", "url preserved")
check("code-graph-rag" not in srv, "retired managed server pruned")
check("hand-added" in srv, "hand-added server survives the merge")
check(srv.get("semantic-analysis", {}).get("command") == "node", "stdio server shape unchanged")

print("Template substitution coverage:")
tpl = open(f"{sys.argv[3]}/claude-code-mcp.json").read()
inst = open(f"{sys.argv[3]}/install.sh").read()
placeholders = set(re.findall(r"\{\{([A-Z_]+)\}\}", tpl))
substituted = set(re.findall(r'sed -i\.bak "s\|\{\{([A-Z_]+)\}\}\|', inst))
missing = sorted(placeholders - substituted)
check(not missing, f"every template placeholder has a substitution (unsubstituted: {missing})")

print()
print(f"{len(fails)} failure(s)")
sys.exit(1 if fails else 0)
PY
