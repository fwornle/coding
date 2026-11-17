#!/bin/bash
# Stands in for a coding agent: alternate screen + ANY-EVENT mouse tracking
# (DECSET 1003), which is what Claude Code, opencode and Copilot CLI ask for and
# what makes tmux downgrade the terminal's mouse protocol the moment copy-mode
# opens.
# $1 = "grab" to request the mouse, anything else to leave it alone.
# $2 = optional file every byte the app reads is appended to.
printf '\033[?1049h'
[ "$1" = grab ] && printf '\033[?1000h\033[?1003h\033[?1006h'
clear
for i in $(seq 1 20); do printf 'line %02d  aaaa bbbb cccc dddd eeee ffff gggg\n' "$i"; done
if [ -n "$2" ]; then
  stty raw -echo
  exec cat >> "$2"
fi
while true; do read -r -n 1 -t 3600 _ || true; done
