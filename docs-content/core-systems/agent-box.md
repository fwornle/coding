# Agent Box & Overrides

`coding` runs Claude inside a container, the **agent box**. The agent can edit
your project, but it cannot touch the guard that checks its tool calls, and it
cannot approve its own rule bypasses. Approving takes your fingerprint, face,
phone, security key or password, in a host browser page.

![Agent box architecture](../images/agent-box-architecture.png)

## Why a box

Without it the agent runs as you. Everything the guard is made of (hook script,
rules, `~/.claude/settings.json`, the override mechanism) is a file you own, so
the agent can edit, disable or re-point it. The box puts a privilege boundary
in between:

- The agent runs as your user id with `no_new_privs`. There is no `sudo` and no
  Docker socket.
- The constraint hook and its rules are baked into the image under
  `/opt/coding-guard`, owned by root. Claude's managed policy
  (`/etc/claude-code/managed-settings.json`) pins the hook, and `disableAllHooks`
  in user or project settings cannot switch it off.
- Only the workspace is mounted read-write. The rest of `$HOME` is not
  mounted, apart from Claude's transcript folder.
- It works the same on macOS, Linux, WSL and Windows, because inside the box it
  is always Linux.

## Launching

| Command | Where the agent runs |
|---------|---------------------|
| `coding` / `coding --claude` | in the box: the default when the `constraints` feature is on |
| `coding --no-box` | on the host; this is **recorded in the guard audit log** |
| `coding --copilot --box` (also `--opencode`, `--pi`) | in the box, opt-in for now |
| `CODING_BOX=false coding` | on the host (same as `--no-box`, also recorded) |

Only the final command changes: tmux, the status line and all host services
stay as they are. With the `constraints` feature off (the Docker-free `harness`
tier) the default is the host.

**First run.** Build the image once, then log the agent in once inside the box.
Linux cannot read the macOS Keychain; the login is kept in the `coding-box-home`
volume.

```bash
coding box build      # bakes in the COMMITTED guard and rules
coding box status     # current / stale / missing
```

The image contains only what is committed. If an agent edits the guard inside
the mounted repo, nothing reaches the box. When the image is older than the
committed guard, the launcher warns, but it never rebuilds on its own.

## The host guard

`coding-guard` is a small daemon on `localhost:3035`, started by launchd
(macOS) or systemd (Linux, WSL), and owned by the `constraints` feature. It
lives **outside** the box and holds what the agent must never have, in
`~/.coding/guard/` (mode 0700, mounted into no container):

| File | What |
|------|------|
| `signing-key.pem` | Ed25519 key that signs override grants |
| `approver.token` | setup token for the enrolment page |
| `factors.json` | your enrolled factors: authenticator **public** keys, argon2id hashes |
| `audit.jsonl` | hash-chained log of every request, decision and bypass |
| `public/guard-public.pem` | the only part the box sees (read-only at `/etc/coding-guard`) |

The box refuses to start if any folder it would mount contains this directory,
for example a workspace of `$HOME`.

## Override factors

You choose these at install (`install.sh` asks), and can change them any time:

```bash
coding guard enroll    # opens the factor page in your browser
coding guard factors   # what is enrolled
```

| Factor | How you use it |
|--------|----------------|
| **This computer** | Touch ID (macOS), Windows Hello |
| **Phone** | the browser shows a QR code; scan it, then use your phone's face or fingerprint (passkey, "hybrid") |
| **Security key** | YubiKey or any FIDO2 key, touch + PIN |
| **Password** | at least 12 characters, typed in the browser page, never in an agent's terminal; argon2id |
| **Recovery codes** | ten one-time codes, shown once when your first factor is enrolled |

Enrol more than one so that losing a device doesn't lock you out. The first
factor needs only the setup token. After that, adding, removing or changing a
factor also requires proving one you already have, so a stolen token alone
cannot add a factor. Five wrong passwords or recovery codes lock both for 15
minutes; authenticators are not guessable and keep working.

## Approving an override

![Override flow](../images/agent-box-override-flow.png)

When an agent is blocked and asks for an exception, the guard opens a request
and answers with a link:

```bash
coding guard pending        # what is waiting
coding guard approve <id>   # opens http://localhost:3035/approve/<id>
coding guard deny <id>
```

The page shows the rule, the file, the agent's reason and an excerpt. All of it
was written by the agent, so read it as a claim, not a fact. You pick a scope,
then confirm with a factor:

| Scope | Lasts |
|-------|-------|
| this one call | one use, within 10 minutes |
| the next N minutes | 1–240 minutes |
| this whole session | the box session, at most 12 hours |

The guard then signs a **grant** bound to the rule, the box session and (if
named) the file. The box can verify a grant with the public key but can never
create one. The challenge is fixed to that request and scope when it is issued,
so a proof given for "this one call" cannot be turned into "this whole session".

### What the agent sees

Inside the box, a blocked tool call files the request itself and tells the
agent where to send you:

```text
🔐 Only the user can override this, on the host. Override requested:
   no-incremental-documentation: http://localhost:3035/approve/3f9c0a1b2d4e
Tell the user which rule blocked you, why you need the exception, and give them the link.
```

The agent relays the link and the reason. After you approve, it repeats the
same call; the hook fetches the grant, checks the signature with the public key
and lets the call through. Retrying before you decide doesn't pile up requests:
the same rule, session and file share one pending request.

In the box, **only a signed grant overrides a rule**:

- `OVERRIDE_CONSTRAINT: <id>` in a prompt does nothing there. The agent can
  write to its own transcript and can type into its own terminal, so a prompt
  is no proof that you wrote it.
- The hook takes the guard's address and public key from the read-only
  `/etc/coding-guard`, and the session from the container's hostname, not from
  environment variables the agent could set.
- If the guard is unreachable or the keys are missing, the call stays blocked.
- If the constraint guard itself breaks, write tools are blocked and the hook
  asks for a `guard-error` grant; approving it lets calls through for the scope
  you pick.

On the host (`coding --no-box`) the typed `OVERRIDE_CONSTRAINT` still works,
because there is no boundary for a grant to protect.

## Docker access from the box: `coding svc`

The box has no Docker socket; unrestricted Docker would mean "guard off". The
guard runs a fixed set of Docker commands for it instead. It builds every
command itself and accepts no mounts, images or shell:

| Verb | Does |
|------|------|
| `coding svc status` | containers and supervisor programs |
| `coding svc logs <container\|program> [n]` | last `n` lines |
| `coding svc restart <program>` | `supervisorctl restart`, program must exist |
| `coding svc graphify query\|path\|explain\|update\|diagnose\|cluster-only …` | the graphify CLI (`bin/graphify` uses this automatically in the box) |
| `coding svc up`, `coding svc rebuild` | **need your approval**: they act on the compose file and Dockerfile, which the agent can edit |

## Audit log

```bash
coding guard audit --limit 30
```

Every override request, approval, denial, failed or locked factor attempt,
`coding svc` call and `--no-box` launch is recorded. Each line carries the hash
of the one before it, so editing, deleting or reordering a line breaks the
chain, and `audit` names the first broken line.

## What is not in the box yet

- No MCP servers, and no knowledge-injection or session-logging hooks inside the
  box. Claude's session logs still work, because its transcripts are written to
  your normal folder.
- Copilot, opencode and pi run in the box only with `--box`, and without their
  own constraint check.
- Network traffic from the box is not yet forced through the proxy.

## Key files

| File | Role |
|------|------|
| `docker/agent-box/` | image, entrypoint, Claude managed policy |
| `scripts/agent-box.mjs` | `coding box build\|status`, the `docker run` arguments |
| `scripts/coding-guard-daemon.mjs` | the host guard on :3035 |
| `scripts/coding-guard.mjs` | `coding guard …`, `coding svc …` |
| `lib/guard/` | keys, grants, factors, WebAuthn ceremonies, audit chain, svc vocabulary, pages |
| `launchd/com.coding.guard.plist`, `systemd/guard.service` | service units |
