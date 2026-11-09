#!/bin/sh
# coding agent box entrypoint — runs as root only long enough to give the
# agent user a home, then drops to the HOST user's uid/gid for good.
#
# The host uid matters on native Linux: files the agent writes on the bind-
# mounted workspace must belong to the user, not to root or to uid 1000. On
# Docker Desktop (macOS, Windows, WSL) ownership is mapped anyway.
#
# no_new_privs: nothing the agent runs can regain privileges (no setuid path
# back to root), so the root-owned guard under /opt/coding-guard and the policy
# in /etc/claude-code stay out of reach for the whole session.
set -eu

uid="${CODING_BOX_UID:-1000}"
gid="${CODING_BOX_GID:-1000}"
case "$uid:$gid" in
  0:*|*:0)
    echo "coding-box: refusing to run the agent as root (CODING_BOX_UID/GID=$uid:$gid)" >&2
    exit 64
    ;;
esac

home=/home/agent
mkdir -p "$home"
chown "$uid:$gid" "$home"
# Docker creates the missing parents of a nested mount as root: ~/.claude when
# it mounts the host's ~/.claude/projects into the home volume, ~/.copilot for
# ~/.copilot/session-state, ~/.pi for the staged ~/.pi/agent. Left that way,
# the agent cannot write its own config there: /login fails for claude, and
# copilot exits at once (it writes ~/.copilot/config.json on start). Only the
# directory itself — never the mount below it.
for dir in "$home/.claude" "$home/.copilot" "$home/.pi"; do
  if [ -d "$dir" ] && ! mountpoint -q "$dir"; then chown "$uid:$gid" "$dir"; fi
done
# Tools that look the user up (git, ssh, npm) need a passwd/group entry.
if ! getent group "$gid" >/dev/null; then echo "agent:x:$gid:" >> /etc/group; fi
if ! getent passwd "$uid" >/dev/null; then echo "agent:x:$uid:$gid:agent:$home:/bin/bash" >> /etc/passwd; fi

export HOME="$home"
# Cmd+V image paste (clipboard/paste-bridge.py): the agents' Linux builds ignore
# the empty bracketed paste a Mac terminal sends for an image-only clipboard;
# the bridge turns it into their Ctrl+V. copilot also gets a private X display,
# because it reads images over X11 rather than through xclip.
# CODING_BOX_PASTE=off runs the agent bare.
bridge=""
if [ "${CODING_BOX_PASTE:-on}" != off ] && [ $# -gt 0 ]; then
  case "$(basename "$1")" in
    claude|pi) bridge="/opt/coding-box/paste-bridge --" ;;
    copilot) bridge="/opt/coding-box/paste-bridge --x11 --" ;;
  esac
fi
# shellcheck disable=SC2086 # $bridge is deliberately word-split (empty or a fixed argv prefix)
exec setpriv --reuid="$uid" --regid="$gid" --clear-groups --no-new-privs -- $bridge "$@"
