#!/usr/bin/env python3
"""A terminal, for testing tmux mouse bindings.

tmux only interprets mouse input arriving on a CLIENT's terminal, so the only
way to exercise a mouse binding without a hand on a mouse is to BE the
terminal: attach a real tmux client on a pty and write SGR mouse sequences
into it.

The one behaviour that matters here is that a real terminal tracks mouse
modes as STATE. When tmux writes `\033[?1003l` mid-gesture, xterm.js (VS
Code's terminal) stops reporting motion for that gesture and re-enabling a
mode a few bytes later does not resurrect it — the mousedown that owned the
drag is over. A driver that keeps firing motion regardless cannot see that
failure, and reports a broken binding as working.

Usage: drag-client.py <socket> <steps>
  steps: comma list of down:COL:ROW / move:COL:ROW / up:COL:ROW
"""
import os, pty, sys, time, select, re

SOCK, STEPS = sys.argv[1], sys.argv[2]
state = {'tracking': False, 'listener': False, 'dropped': 0}

def sgr(btn, col, row, press):
    return f"\033[<{btn};{col};{row}{'M' if press else 'm'}".encode()

pid, fd = pty.fork()
if pid == 0:
    os.environ['TERM'] = 'xterm-256color'
    os.execvp('tmux', ['tmux', '-L', SOCK, 'attach-session', '-t', 't'])

def _absorb(data):
    for m in re.finditer(rb'\x1b\[\?(1002|1003)([hl])', data):
        on = m.group(2) == b'h'
        state['tracking'] = on
        if not on:
            state['listener'] = False   # the gesture's motion listener is gone


def drain(t=0.3):
    end = time.time() + t
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.05)
        if not r:
            continue
        try:
            data = os.read(fd, 65536)
        except OSError:
            return
        _absorb(data)


def settle(floor=0.15, quiet=0.2, cap=3.0):
    """Drain until tmux has been silent for `quiet` seconds.

    A fixed sleep between gesture steps is a guess about machine speed, and the
    guess (0.25s) was wrong under load: running inside the full suite the `up`
    could be handled before the motion event just before it, moving the
    selection end one cell and copying "…dddd e" instead of "…dddd ". Waiting
    for the pty to go QUIET ties the pacing to what tmux has actually finished
    drawing rather than to how fast the machine happens to be.

    `floor` still applies, because tmux is briefly silent before it starts
    responding at all, and `cap` bounds the wait so a wedged server fails the
    test rather than hanging it.
    """
    drain(floor)
    end = time.time() + cap
    last = time.time()
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.05)
        if r:
            try:
                data = os.read(fd, 65536)
            except OSError:
                return
            if data:
                last = time.time()
                _absorb(data)
                continue
        if time.time() - last >= quiet:
            return

settle(floor=1.0, quiet=0.3, cap=6.0)
for step in STEPS.split(','):
    kind, col, row = step.split(':')
    col, row = int(col), int(row)
    if kind == 'down':
        os.write(fd, sgr(0, col, row, True))
        state['listener'] = state['tracking']
    elif kind == 'move':
        if state['listener']:
            os.write(fd, sgr(32, col, row, True))
        else:
            state['dropped'] += 1
    elif kind == 'up':
        os.write(fd, sgr(0, col, row, False))
        state['listener'] = False
    settle()
settle(floor=0.3, quiet=0.3, cap=4.0)
print(f"dropped={state['dropped']}")
os.write(fd, b'\x02d')
drain(0.5)
os.close(fd)
os.waitpid(pid, 0)
