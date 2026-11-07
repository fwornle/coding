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
# Tools that look the user up (git, ssh, npm) need a passwd/group entry.
if ! getent group "$gid" >/dev/null; then echo "agent:x:$gid:" >> /etc/group; fi
if ! getent passwd "$uid" >/dev/null; then echo "agent:x:$uid:$gid:agent:$home:/bin/bash" >> /etc/passwd; fi

export HOME="$home"
exec setpriv --reuid="$uid" --regid="$gid" --clear-groups --no-new-privs -- "$@"
