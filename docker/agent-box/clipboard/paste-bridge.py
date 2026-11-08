#!/usr/bin/env python3
"""
Paste bridge for the agent box: makes Cmd+V paste an image, for every agent.

On a Mac, Cmd+V is handled by the TERMINAL, not the agent: with only an image
on the clipboard it sends an EMPTY bracketed paste (ESC[200~ ESC[201~). The
macOS builds of the agents take that as "look for an image"; the Linux builds
in the box do not (Claude Code gates it on macos/wsl, pi and copilot never
look), so Cmd+V did nothing and only Ctrl+V reached the clipboard shim.

This sits between the terminal and the agent on a pseudo-terminal, passes every
byte through unchanged, and rewrites exactly one sequence: an empty bracketed
paste becomes Ctrl+V (0x16), the agents' own "paste an image" key. A paste with
any content in it is never touched.

copilot (`--x11`): its image read is a native module talking the X11 protocol
directly, not xclip, so the clipboard shim cannot serve it. Here the bridge
starts a private Xvfb and, when Ctrl+V (typed, or rewritten from Cmd+V) is on
its way to the agent, first fetches the host image from the guard and makes it
the X selection with the real xclip — then forwards the key. The host clipboard
is read at paste time only, never polled; every read is audited by the guard.

Also PID 1 duties: forwards SIGTERM/SIGHUP/SIGINT to the agent and reaps
orphaned children (the agent's subprocesses re-parent here).

Usage: paste-bridge [--x11] -- <command> [args…]
Without a terminal on stdin it simply execs the command.
"""
import base64
import errno
import fcntl
import json
import os
import pty
import select
import signal
import struct
import subprocess
import sys
import termios
import time
import tty
import urllib.request

PASTE_START = b'\x1b[200~'
PASTE_END = b'\x1b[201~'
EMPTY_PASTE = PASTE_START + PASTE_END
CTRL_V = b'\x16'
# How long a partial ESC[200~… may wait for the rest before it is passed on.
HOLD_SECONDS = 0.05
REAL_XCLIP = '/usr/bin/xclip'
DISPLAY = ':99'


class PasteFilter:
    """Byte-stream rewriter: EMPTY_PASTE → Ctrl+V; everything else verbatim.

    feed() returns (bytes_to_forward, saw_paste_key). A trailing proper prefix
    of EMPTY_PASTE is held back until the next feed() or flush() — terminals
    send a paste in one write, but a read can still split it.
    """

    def __init__(self):
        self.pending = b''

    def feed(self, data):
        buf = self.pending + data
        self.pending = b''
        out = bytearray()
        key = False
        i = 0
        while i < len(buf):
            if buf.startswith(EMPTY_PASTE, i):
                out += CTRL_V
                key = True
                i += len(EMPTY_PASTE)
                continue
            rest = buf[i:]
            if EMPTY_PASTE.startswith(rest):
                self.pending = rest
                break
            if buf[i] == CTRL_V[0]:
                key = True
            out.append(buf[i])
            i += 1
        return bytes(out), key

    def flush(self):
        out, self.pending = self.pending, b''
        return out


def copy_winsize(src_fd, dst_fd):
    try:
        size = fcntl.ioctl(src_fd, termios.TIOCGWINSZ, b'\0' * 8)
        fcntl.ioctl(dst_fd, termios.TIOCSWINSZ, size)
    except OSError:
        pass


def write_all(fd, data):
    while data:
        try:
            n = os.write(fd, data)
        except InterruptedError:
            continue
        data = data[n:]


class X11Clipboard:
    """A private X display whose CLIPBOARD selection the bridge fills on demand."""

    def __init__(self, log):
        self.log = log
        self.server = None
        self.owner = None
        self.env = None

    def start(self):
        if not os.path.exists(REAL_XCLIP):
            self.log(f'{REAL_XCLIP} missing — copilot image paste disabled')
            return None
        try:
            self.server = subprocess.Popen(
                ['Xvfb', DISPLAY, '-nolisten', 'tcp', '-screen', '0', '64x64x24'],
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except OSError as err:
            self.log(f'Xvfb did not start ({err}) — copilot image paste disabled')
            return None
        self.env = dict(os.environ, DISPLAY=DISPLAY)
        sock = f'/tmp/.X11-unix/X{DISPLAY[1:]}'
        deadline = time.monotonic() + 5
        while not os.path.exists(sock) and time.monotonic() < deadline:
            if self.server.poll() is not None:
                self.log('Xvfb exited at start — copilot image paste disabled')
                return None
            time.sleep(0.05)
        return DISPLAY

    def fetch_host_image(self):
        base = os.environ.get('CODING_GUARD_URL')
        token = os.environ.get('CODING_GUARD_BOX_TOKEN')
        if not base or not token:
            return None
        req = urllib.request.Request(f'{base}/clipboard', headers={'x-coding-box-token': token})
        try:
            with urllib.request.urlopen(req, timeout=15) as res:
                body = json.load(res)
        except Exception as err:  # refused, off, unreachable: no image
            self.log(f'host clipboard unavailable: {err}')
            return None
        if body.get('image') != 'image/png' or not body.get('data'):
            return None
        return base64.b64decode(body['data'])

    def _replace_owner(self, target, data):
        if self.owner and self.owner.poll() is None:
            self.owner.terminate()
            try:
                self.owner.wait(timeout=1)
            except subprocess.TimeoutExpired:
                self.owner.kill()
        # -quiet keeps xclip in the foreground serving the selection (INCR for
        # large images included) until another client takes it over.
        self.owner = subprocess.Popen(
            [REAL_XCLIP, '-quiet', '-selection', 'clipboard', '-t', target, '-i'],
            stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=self.env)
        self.owner.stdin.write(data)
        self.owner.stdin.close()

    def _owns(self, target):
        try:
            res = subprocess.run([REAL_XCLIP, '-selection', 'clipboard', '-t', 'TARGETS', '-o'],
                                 capture_output=True, timeout=1, env=self.env)
        except (OSError, subprocess.TimeoutExpired):
            return False
        return target.encode() in res.stdout

    def load(self):
        """Make the host's image (or nothing) the selection; True when an image is there."""
        if not self.env:
            return False
        png = self.fetch_host_image()
        if png is None:
            # Clear it: no stale image from an earlier paste, and no text the
            # agent copied itself pretending to be the host clipboard.
            self._replace_owner('text/plain', b'')
            return False
        self._replace_owner('image/png', png)
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            if self._owns('image/png'):
                return True
            time.sleep(0.03)
        self.log('xclip did not take the selection in time')
        return False

    def stop(self):
        for proc in (self.owner, self.server):
            if proc and proc.poll() is None:
                proc.terminate()


def main(argv):
    x11 = False
    if argv and argv[0] == '--x11':
        x11, argv = True, argv[1:]
    if argv and argv[0] == '--':
        argv = argv[1:]
    if not argv:
        sys.stderr.write('usage: paste-bridge [--x11] -- <command> [args…]\n')
        return 64
    if not os.isatty(0):
        os.execvp(argv[0], argv)

    debug = os.environ.get('CODING_BOX_PASTE_DEBUG') == '1'
    log_file = os.path.join(os.environ.get('HOME', '/tmp'), '.paste-bridge.log') if debug else None

    def log(msg):
        if log_file:
            with open(log_file, 'a') as f:
                f.write(f'{time.strftime("%H:%M:%S")} {msg}\n')

    clip = X11Clipboard(log) if x11 else None
    if clip and clip.start():
        os.environ['DISPLAY'] = DISPLAY

    pid, master = pty.fork()
    if pid == 0:
        try:
            os.execvp(argv[0], argv)
        except OSError as err:
            sys.stderr.write(f'paste-bridge: cannot run {argv[0]}: {err}\n')
            os._exit(127)

    stdin = 0
    copy_winsize(stdin, master)
    saved = termios.tcgetattr(stdin)
    tty.setraw(stdin)

    status = {'code': None}

    def reap(*_):
        while True:
            try:
                got, st = os.waitpid(-1, os.WNOHANG)
            except ChildProcessError:
                return
            if got == 0:
                return
            if got == pid:
                status['code'] = os.waitstatus_to_exitcode(st)

    def forward(sig, _frame):
        try:
            os.kill(pid, sig)
        except ProcessLookupError:
            pass

    signal.signal(signal.SIGCHLD, reap)
    signal.signal(signal.SIGWINCH, lambda *_: copy_winsize(stdin, master))
    for sig in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT, signal.SIGQUIT):
        signal.signal(sig, forward)

    filt = PasteFilter()
    try:
        while True:
            timeout = HOLD_SECONDS if filt.pending else None
            try:
                ready, _, _ = select.select([stdin, master], [], [], timeout)
            except InterruptedError:
                continue
            if not ready and filt.pending:
                write_all(master, filt.flush())
                continue
            if master in ready:
                try:
                    data = os.read(master, 65536)
                except OSError as err:
                    if err.errno != errno.EIO:
                        raise
                    data = b''
                if not data:
                    break
                write_all(1, data)
            if stdin in ready:
                data = os.read(stdin, 65536)
                if not data:
                    break
                out, key = filt.feed(data)
                if key:
                    log(f'paste key ({"rewritten" if CTRL_V not in data else "typed"})')
                    if clip:
                        log(f'x11 selection: {"image" if clip.load() else "empty"}')
                if out:
                    write_all(master, out)
    finally:
        termios.tcsetattr(stdin, termios.TCSAFLUSH, saved)
        if clip:
            clip.stop()

    deadline = time.monotonic() + 5
    while status['code'] is None and time.monotonic() < deadline:
        reap()
        if status['code'] is None:
            time.sleep(0.05)
    return status['code'] if status['code'] is not None else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
