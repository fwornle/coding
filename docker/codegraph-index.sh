#!/bin/sh
# Build or refresh the CodeGraph index inside coding-services.
#
#   codegraph-index.sh [full|update]
#
# Counterpart to graphify-reindex.sh. Deliberately NOT a supervisord program:
# codegraph serves over stdio (spawned per agent session via `docker exec`), so
# there is no long-lived server to keep alive — only an index to keep fresh.
#
# Freshness is driven from here rather than by codegraph's own watcher or git hooks
# (CODEGRAPH_NO_WATCH / CODEGRAPH_NO_DAEMON are set in the image), so indexing is
# deterministic and observable instead of firing on filesystem events.
set -e

MODE="${1:-update}"
TARGET="${CODEGRAPH_TARGET:-/workspace/coding}"
DATA_DIR="${CODEGRAPH_DATA_DIR:-/coding/.data/codegraph}"
DB="${DATA_DIR}/codegraph.db"
META="${DATA_DIR}/metadata.json"
PROGRESS="${DATA_DIR}/progress.json"

mkdir -p "${DATA_DIR}"

write_progress() {
    printf '{"status":"%s","phase":"%s","mode":"%s","updatedAt":"%s"}\n' \
        "$1" "$2" "${MODE}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "${PROGRESS}"
}

trap 'write_progress failed "interrupted"' INT TERM

write_progress running "indexing"

# `codegraph init` ends with an interactive "how should I keep the index fresh?"
# prompt. Stdin is closed on every invocation below — with a TTY attached it would
# block forever and take the whole exec with it.
if [ "${MODE}" = "full" ] || [ ! -f "${DB}" ]; then
    echo "[codegraph] full index of ${TARGET}"
    if [ ! -f "${DB}" ]; then
        codegraph init "${TARGET}" < /dev/null || {
            write_progress failed "init"
            echo "[codegraph] init failed" >&2
            exit 1
        }
    else
        codegraph index "${TARGET}" < /dev/null || {
            write_progress failed "index"
            echo "[codegraph] index failed" >&2
            exit 1
        }
    fi
else
    echo "[codegraph] incremental sync of ${TARGET}"
    codegraph sync "${TARGET}" < /dev/null || {
        write_progress failed "sync"
        echo "[codegraph] sync failed" >&2
        exit 1
    }
fi

# Sidecar in the SAME shape graphify writes, so dashboard freshness tiles can read
# any backend without knowing which one produced it.
COMMIT="$(git -C "${TARGET}" rev-parse HEAD 2>/dev/null || echo unknown)"
SIZE="$(wc -c < "${DB}" 2>/dev/null | tr -d ' ' || echo 0)"
printf '{"commit_hash":"%s","indexed_at":"%s","artifact_bytes":%s,"backend":"codegraph"}\n' \
    "${COMMIT}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${SIZE}" > "${META}"

write_progress completed "done"
echo "[codegraph] index ready: ${DB} ($((SIZE / 1024 / 1024)) MB, commit ${COMMIT})"
