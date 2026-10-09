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
the status line shows `N:proxy` or `N:direct`.

## pi's GitHub Copilot login fails with 429

pi's `/login` → GitHub Copilot asks for your GitHub Enterprise domain (`bmw.ghe.com`). A
`429 Too Many Requests` after approving the device code comes from a Copilot rate limit
on your account; wait 10–15 minutes and log in again.

## Start from scratch

```sh
glass stop
glass uninstall --yes      # deletes ~/.glass, including all measurements
```
