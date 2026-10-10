## The daemon does not start

glass prints one line and runs the agent unmeasured:

```text
glass: daemon not reachable on 127.0.0.1:12445 — running claude unmeasured (log: ~/.glass/logs/daemon.log)
```

- Read the log it names.
- Another program on port 12445 → pick another: `GLASS_PORT=12460 glass claude`.
- Node older than 22.13 → `glass doctor` shows ✗; update Node.

## copilot runs but nothing is recorded

- `glass doctor` must show copilot ≥ 1.0.93. VS Code ships its own older copilot, which
  calls the public Copilot host; `which copilot` (`where copilot` on Windows) shows which
  one runs. Put the npm `@github/copilot` CLI first on `PATH`, or set
  `GLASS_COPILOT_BIN`.
- copilot must be logged in (`copilot`, then `/login`).

## An agent reports a certificate error

- Run the same command with `--no-intercept`. If that works, the interception is the
  cause: send `~/.glass/logs/daemon.log` and the agent's error to the maintainers.
- If you set `NODE_EXTRA_CA_CERTS` yourself, glass combines your CA file with its own for
  the run — make sure your file exists and is readable.

## Corporate proxy

The daemon reaches the model hosts through `HTTPS_PROXY` / `NO_PROXY` from the
environment `glass` was started in. `glass doctor` shows the egress proxy it will use, and
the network report (click the status line's `N:… P:…` field, or `glass report net`) shows
it next to the network location and the local proxy's state. `N:CN` or `N:VPN` with
`P:OFF` means you are on the corporate network without a working local proxy: external
model hosts are unreachable.

## pi's GitHub Copilot login fails with 429

pi's `/login` → GitHub Copilot asks for your GitHub Enterprise domain (`<tenant>.ghe.com`). A
`429 Too Many Requests` after approving the device code comes from a Copilot rate limit
on your account; wait 10–15 minutes and log in again.

## glass next to another local LLM proxy

Some tools (coding, for example) run their own LLM proxy on your machine and point the
agents at it. glass works next to them, but in three places the two overlap. `glass
doctor` warns about each one under *warnings*; the warnings do not stop glass, and the
exit code stays 0.

**claude started from the other tool's terminal.** Its launcher sets
`ANTHROPIC_BASE_URL` to its proxy (coding: `http://127.0.0.1:12435`). glass treats an
existing base URL as the upstream, so each call goes claude → glass → the other proxy →
Anthropic and both tools record it. Each count is right, but the two cannot be added up,
and the other tool files the call under glass's session id. Start glass from a terminal
the other tool's launcher did not set up.

**opencode or pi default to the other proxy.** coding, for example, sets `rapid-proxy/…`
in `~/.config/opencode/opencode.json` and `rapid-proxy-pi` in `~/.pi/agent/settings.json`,
both plain HTTP on `localhost:12435`. Plain-HTTP traffic never passes `HTTPS_PROXY`, so
glass treats the two agents differently:

- **opencode is measured anyway.** For the run, `glass opencode` points every provider
  with a plain-HTTP base URL at the daemon (through `OPENCODE_CONFIG_CONTENT`, your
  config file is not changed). The daemon forwards each call to the original URL and
  records it. If that URL is another tool's proxy, it records the call too: both counts
  are right, but do not add them up.
- **pi is not measured** while its default provider is plain HTTP. Pick one of pi's own
  providers for the run:

```sh
glass pi --model github-copilot/claude-haiku-4.5
```

On a machine without such a proxy, the agents' defaults are their own providers and
`glass opencode` / `glass pi` measure them without any option.

**tmux.** Started inside an existing tmux session, glass shows its status bar on that
session for the run and restores yours when the agent exits. `--no-tmux`, or a separate
terminal, leaves your bar alone.

The simplest setup: the other tool's sessions as usual, glass in a separate terminal
window that its launcher did not start.

## Start from scratch

```sh
glass stop
glass uninstall --yes      # deletes ~/.glass, including all measurements
```
