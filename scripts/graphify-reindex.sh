#!/bin/bash
# Rebuild the graphify code graph, write progress + metadata, then reload the MCP
# server. Runs INSIDE coding-services (spawned by the dashboard "Re-index" button),
# so it calls the in-image graphify venv directly — no cross-container hop.
#
# Usage: graphify-reindex.sh [REPO_PATH] [MODE]
#   REPO_PATH  default /workspace/coding
#   MODE       "update" (incremental AST, default, fast) | "full" (code+docs via proxy)
set -uo pipefail

REPO="${1:-/workspace/coding}"
MODE="${2:-update}"
OUT="${GRAPHIFY_OUT:-/coding/.data/graphify/graphify-out}"
DIR="$(dirname "$OUT")"                 # .data/graphify
PROGRESS="$DIR/progress.json"
META="$DIR/metadata.json"
LOG="$DIR/reindex.log"
GRAPHIFY_BIN=/coding/integrations/graphify/.venv/bin/graphify
PYBIN=/coding/integrations/graphify/.venv/bin/python

mkdir -p "$OUT"

write_progress() {
    # $1=status $2=phase
    printf '{"status":"%s","phase":"%s","updatedAt":"%s"}\n' \
        "$1" "$2" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$PROGRESS"
}

write_progress running "Extracting code graph (${MODE})"
{
    echo "=== graphify-reindex $(date -u +%FT%TZ) mode=$MODE repo=$REPO ==="
    cd "$REPO" || exit 1
    if [ "$MODE" = "full" ]; then
        "$GRAPHIFY_BIN" extract "$REPO"
    else
        # Fast incremental — re-extract ONLY the files changed since the graph was
        # built (git diff against graph.json's built_at_commit + working tree),
        # preserving unchanged nodes. This is the same `_rebuild_code(changed_paths=…)`
        # path the graphify git-hook uses. It sidesteps the full-corpus re-parse:
        # JS/TS/Vue/Svelte bypass the per-file AST cache BY DESIGN (cross-file symbol
        # resolution over the live workspace), so a plain `graphify update` re-parses
        # ALL ~1300+ of them every run regardless of how little changed. Scoping to the
        # changed set makes it seconds instead of ~90s. Falls back to a full `update`
        # when there is no usable git baseline or the change set is large (>500).
        # Viz is skipped either way (GRAPHIFY_VIZ_NODE_LIMIT=0); clustering/communities
        # are kept intact.
        # Baseline = the last commit we successfully indexed to, recorded in OUR
        # own metadata sidecar (re-stamped to HEAD after every run below). We do
        # NOT use graph.json's built_at_commit as the baseline: graphify freezes
        # it on the "no topology change -> outputs left untouched" path, so it
        # would pin every incremental diff to an ever-older commit and re-extract
        # the same files on every run forever (never reaching the 0-change no-op).
        # The sidecar advances each run, so a clean tree at HEAD => 0 changed =>
        # near-instant. Fall back to graph.json only when the sidecar is absent
        # (e.g. immediately after a fresh full build). Retry the read: right after
        # a container (re)start the bind-mount read can transiently fail.
        BUILT=""
        for _try in 1 2 3; do
            BUILT=$("$PYBIN" -c "import json,os;p='$META';print((json.load(open(p)).get('commit_hash') or '') if os.path.exists(p) else '')" 2>>"$LOG" || true)
            [ -n "$BUILT" ] && break
            sleep 1
        done
        if [ -z "$BUILT" ]; then
            BUILT=$("$PYBIN" -c "import json;print(json.load(open('$OUT/graph.json')).get('built_at_commit') or '')" 2>>"$LOG" || true)
        fi
        CHANGED=""
        BUILT_OK=0
        if [ -n "$BUILT" ] && git cat-file -e "${BUILT}^{commit}" 2>/dev/null; then
            BUILT_OK=1
            CHANGED=$( { git diff --name-only "$BUILT" HEAD; git diff --name-only HEAD; git ls-files --others --exclude-standard; } 2>/dev/null | sort -u | sed '/^$/d' )
        fi
        # Drop paths graphify never graphs (.graphifyignore/.gitignore: .data/,
        # dist/, logs/, .specstory/, node_modules/, …). `git diff` lists them, but
        # counting them would force a full whole-graph rebuild for pure noise —
        # e.g. this repo's .data/ export churn keeps NCHANGED>0 forever, so the
        # 0-change no-op path could never engage and every re-index paid ~30s+.
        # Uses the SAME matcher graphify's detect() uses. Fail-safe: on any error
        # the python exits non-zero and we keep the unfiltered set (worst case a
        # needless rebuild, never a skipped one).
        if [ -n "$CHANGED" ]; then
            FILTERED=$(GRAPHIFY_CHANGED_RAW="$CHANGED" "$PYBIN" - <<'PY' 2>>"$LOG"
import os
from pathlib import Path
from graphify.detect import _load_graphifyignore, _is_ignored, CODE_EXTENSIONS
root = Path('.').resolve()
raw = [l.strip() for l in os.environ.get('GRAPHIFY_CHANGED_RAW', '').splitlines() if l.strip()]
pats = _load_graphifyignore(root)   # raises on failure -> non-zero exit -> keep raw
cache = {}
kept = []
for f in raw:
    try:
        p = root / f
        # update mode builds the CODE graph only: a changed doc/image/config
        # can't alter code topology, so it must not trigger a whole-graph rebuild.
        if p.suffix not in CODE_EXTENSIONS:
            continue
        if not _is_ignored(p, root, pats, _cache=cache):
            kept.append(f)
    except Exception:
        kept.append(f)              # keep on per-file uncertainty
print('\n'.join(kept))
PY
) && CHANGED="$FILTERED"
        fi
        NCHANGED=$(printf '%s' "$CHANGED" | grep -c . || true)
        if [ "$BUILT_OK" = 1 ] && [ "${NCHANGED:-0}" -eq 0 ]; then
            # Already current: nothing changed since the graph's baseline. Do NOT
            # fall through to a full re-extract (~90s for zero benefit) — the graph
            # already reflects this tree; the metadata step below re-stamps the
            # freshness marker to HEAD so the dashboard clears "N commits behind".
            echo "Up to date: 0 file(s) changed since ${BUILT} — skipping extraction."
        elif [ "$BUILT_OK" = 1 ] && [ "${NCHANGED:-0}" -gt 0 ] && [ "${NCHANGED:-0}" -le 500 ]; then
            echo "Incremental (changed-files): ${NCHANGED} file(s) changed since ${BUILT} — re-extracting only those."
            GRAPHIFY_VIZ_NODE_LIMIT=0 GRAPHIFY_OUT="$OUT" GRAPHIFY_CHANGED="$CHANGED" "$PYBIN" - <<'PY'
import os
from pathlib import Path
from graphify.watch import _rebuild_code
changed = [Path(f.strip()) for f in os.environ.get('GRAPHIFY_CHANGED', '').splitlines() if f.strip()]
if not changed:
    raise SystemExit(0)
root = Path('.')
saved = Path(os.environ.get('GRAPHIFY_OUT', 'graphify-out')) / '.graphify_root'
if saved.exists():
    t = saved.read_text(encoding='utf-8').strip()
    if t:
        root = Path(t)
ok = _rebuild_code(root, changed_paths=changed, block_on_lock=True)
raise SystemExit(0 if ok else 1)
PY
        else
            echo "Incremental fallback -> full update (baseline='${BUILT}' changed=${NCHANGED:-0})."
            GRAPHIFY_VIZ_NODE_LIMIT=0 "$GRAPHIFY_BIN" update "$REPO"
        fi
    fi
} >> "$LOG" 2>&1
rc=$?
if [ "$rc" -ne 0 ]; then
    write_progress failed "graphify ${MODE} exited ${rc} (see reindex.log)"
    exit "$rc"
fi

write_progress running "Writing metadata"
"$PYBIN" - "$OUT/graph.json" "$META" "$REPO" >> "$LOG" 2>&1 <<'PY'
import json, sys, subprocess, datetime
graph, meta, repo = sys.argv[1], sys.argv[2], sys.argv[3]
d = json.load(open(graph))
# Freshness marker = the commit the graph now reflects. A successful reindex
# always brings the graph up to the current working tree (incremental re-extracts
# diff(baseline..HEAD) + worktree + untracked; full rebuilds from scratch), so
# HEAD is authoritative. graph.json's own built_at_commit is NOT trustworthy here:
# graphify's watch.py leaves it stale on the "no topology change -> outputs left
# untouched" path, which otherwise pins the dashboard at "N commits behind" forever.
try:
    commit = subprocess.check_output(["git", "-C", repo, "rev-parse", "HEAD"], text=True).strip()
except Exception:
    commit = d.get("built_at_commit")
nodes = len(d.get("nodes", []))
edges = len(d.get("links", d.get("edges", [])))
json.dump({
    "commit_hash": commit,
    "indexed_at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    "nodes": nodes,
    "edges": edges,
}, open(meta, "w"))
PY

# No MCP server restart needed: graphify's serve.py hot-reloads graph.json when
# its (mtime_ns, size) changes (serve.py:141,281), so the freshly-written graph
# is picked up on the next query with zero downtime. Restarting here was pure
# overhead (and the visible "graphify: stopped/started" churn).
write_progress completed "Code graph up to date"
