# shellcheck shell=bash
#
# The PIDs listening on a local TCP port, one per line — on macOS, Linux and WSL.
#
# lsof is the only tool macOS has for this, and it is NOT installed on a minimal
# Debian/Ubuntu image (or a fresh WSL distribution), where `lsof ... || true` used to
# make every "is the port free / who holds it" check silently report "free". `ss`
# (iproute2) is on every systemd distribution; `fuser` (psmisc) is the last resort.
#
#   source "$CODING_REPO/scripts/lib/port-pids.sh"
#   pid="$(listening_pids 12435 | head -1)"
listening_pids() {
    local port="$1"
    if command -v lsof >/dev/null 2>&1; then
        lsof -ti "tcp:${port}" -sTCP:LISTEN 2>/dev/null
    elif command -v ss >/dev/null 2>&1; then
        ss -Hltnp "sport = :${port}" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u
    elif command -v fuser >/dev/null 2>&1; then
        fuser -n tcp "${port}" 2>/dev/null | tr -s ' ' '\n' | grep -E '^[0-9]+$'
    fi
    return 0
}
