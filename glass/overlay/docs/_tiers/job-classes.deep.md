## What is sent, and where

Nothing, until you switch labelling on. With it on, for each human turn of an agent glass
measures (claude, copilot, opencode, pi):

- the turn's prompt — the person's message, not the agent's tool calls — **redacted** with
  glass's own patterns (keys, tokens, e-mail addresses); a prompt whose redaction fails is
  not sent;
- inside the classification request: the taxonomy's classes, their tests and examples;
- to `https://api.githubcopilot.com` (github.com) or `https://copilot-api.<tenant>.ghe.com`
  (a GHE.com tenant), the Copilot API of the host your `gh` login reaches — the same host
  glass reads GitHub's quota figure from;
- with the token of that `gh` login, read from `gh` when needed and never stored.

The label, the model that gave it and the first 120 characters of the redacted prompt are
stored in glass's token DB (table `turn_job_class`), beside the turn's token rows.

Not labelled: tool-loop calls (only the first call of a turn is), sub-agent calls, the
agents' own utility calls (titles, summaries) and headless `claude -p` runs.

## Student, teacher and the gate

| | Model | When |
|---|---|---|
| **student** | `claude-haiku-5.5` | every turn |
| **teacher** | `claude-sonnet-5` | a share of turns (25 % by default; 0 switches it off) |

The **gate** is per class: of the turns the student put in a class, the share the teacher
put there too (its precision). A class passes at 90 % over at least 20 teacher-checked
turns, counted over every label of one taxonomy version. The Classes tab's **Gate** panel
shows where each class stands. Nothing acts on a label yet: they are counted and shown.

A free Copilot plan may not offer these models; **Try the account** then says so.

## The measurement

`glass job-classes measure [--days 28] [--max 200]` reads the human prompts of the last
days from the agents' own transcripts:

| Agent | Where |
|---|---|
| Claude Code | `~/.claude/projects/` — interactive sessions only |
| Copilot CLI | `~/.copilot/session-state/` — interactive sessions only |
| VS Code Copilot Chat | VS Code's `chatSessions` |

It drops harness text (slash commands, notifications) and prompts under 25 characters,
redacts the rest, and labels the newest `--max` with the teacher twice and the student once
(3 calls each). It prints the teacher's agreement with itself, the student's agreement with
the teacher, and the largest class, and writes the **reference set** — prompts where the
teacher's two passes agree — that the tab's tree and map read. A rerun resumes where the
last one stopped.

## Commands

| Command | |
|---|---|
| `glass job-classes` | on or off, the Copilot account, the taxonomy, what was labelled |
| `glass job-classes on` / `off` | switch labelling |
| `glass job-classes measure [--days N] [--max N]` | label your recent prompts; the reference set |
| `glass job-classes join <git URL>` | use a team's taxonomy (its learning repo's `job-classes/`) |
| `glass job-classes pull` / `leave` | update the team's taxonomy / go back to the shipped default |

## Files

| Path | Content |
|---|---|
| `~/.glass/job-classes.json` | The settings (owner-only) |
| `~/.glass/job-classes/team/` | The team's taxonomy, when joined (a sparse clone of `job-classes/`) |
| `~/.glass/data/job-classes/glass/` | The measurement: labels per pass, the report, the reference set |
