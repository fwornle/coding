#!/usr/bin/env python3
"""
Test driver for docker/agent-box/clipboard/paste-bridge.py.

Plays the TERMINAL: runs the bridge on a pseudo-terminal around a stand-in
agent that records, in hex, every byte it receives, then writes the given
chunks (with an optional pause between them) and reports what reached the
agent plus the exit code as JSON.

usage: paste-bridge-drive.py <bridge> <exit-code> <pause-seconds> <hex-chunk>…
"""
import json
import os
import pty
import select
import sys
import tempfile
import time

AGENT = r'''
import os, sys, tty, select, time
tty.setraw(0)
out = open(sys.argv[1], "w")
end = time.monotonic() + float(sys.argv[2])
while time.monotonic() < end:
    r, _, _ = select.select([0], [], [], 0.05)
    if r:
        out.write(os.read(0, 4096).hex()); out.flush()
sys.exit(int(sys.argv[3]))
'''


def main():
    bridge, code, pause, *chunks = sys.argv[1:]
    pause = float(pause)
    rec = tempfile.NamedTemporaryFile(delete=False).name
    listen = 0.6 + pause * len(chunks)
    pid, fd = pty.fork()
    if pid == 0:
        os.execvp(sys.executable, [sys.executable, bridge, '--', sys.executable, '-c', AGENT, rec, str(listen), code])
    time.sleep(0.3)  # let the agent reach raw mode
    for c in chunks:
        os.write(fd, bytes.fromhex(c))
        time.sleep(pause)
    deadline = time.monotonic() + listen + 5
    while time.monotonic() < deadline:
        r, _, _ = select.select([fd], [], [], 0.1)
        if r:
            try:
                if not os.read(fd, 4096):
                    break
            except OSError:
                break
    _, status = os.waitpid(pid, 0)
    with open(rec) as f:
        received = f.read()
    os.unlink(rec)
    print(json.dumps({'received': received, 'exit': os.waitstatus_to_exitcode(status)}))


if __name__ == '__main__':
    main()
