---
description: Load session logs (LSL) from current and coding projects for continuity
argument-hint: Optional number of files to load (default auto-detects based on length)
---

# Session Logs (/sl) - Session Continuity Command

Load and summarize recent Live Session Logs (LSL) to provide continuity from previous work sessions.

## Instructions

**Goal**: Load recent LSL files and produce a summary to establish context continuity.

### Tooling Rules (read first — these keep /sl prompt-free)

**Use exactly the two `ls` forms below for discovery, and `Read` for content. Nothing else.**

> Do NOT use `Glob`. Claude Code no longer exposes a `Glob` tool to the main agent — search is
> done through `Bash`. An earlier version of this skill mandated `Glob` and banned `Bash`
> outright, which made every `/sl` run open with an apology about the preferred tool being
> unavailable before falling back to an ad-hoc `find`. The two commands below are the
> replacement; they are pre-allowed, so they do not prompt.

The two allowed discovery commands (`<ROOT>` is `.specstory/history` for the current project,
or the absolute coding path for Step 3):

```
ls -d <ROOT>/[0-9][0-9][0-9][0-9]/[0-9][0-9]      # list YYYY/MM tranche dirs, oldest→newest
ls -1r <ROOT>/<YYYY>/<MM>                          # list one month's files, NEWEST FIRST
```

Both are matched by user-level allow rules (see [Permissions](#permissions)), so they run
prompt-free in **any** project.

Two things the numeric `[0-9]` pattern buys you — do not "simplify" it away:

- `.specstory/history` also contains non-LSL subtrees (`logs/`, `docs/`). A recursive
  `**/*.md` sweep over the coding project returns **~23,000 files**, almost all noise. The
  numeric year/month pattern selects only real LSL tranches.
- Listing one month at a time keeps the result at tens of files, not thousands.

**Never** reach for these — each one triggers a prompt even where a matching `Bash(...)` allow
rule exists, because the permission matcher cannot statically resolve the command it runs:

- `find … -exec <cmd>` (the `-exec` payload is opaque to the matcher)
- `xargs <cmd>` / `` `cmd` `` / `$(cmd)` (nested command)
- pipelines (`ls … | head`, `find … | sort`) — every stage needs its own allow rule, and the
  project-scoped ones only exist in `coding`

If you catch yourself writing a shell one-liner to size or filter these files: stop, use the
two `ls` forms plus `Read`.

### Step 1: Determine Current Project

1. Get the current working directory
2. Identify the project name (the directory name containing `.specstory/history`)
3. Note if this IS the `coding` project or a DIFFERENT project

### Step 2: Load LSL Files from Current Project

1. `ls -d .specstory/history/[0-9][0-9][0-9][0-9]/[0-9][0-9]` — take the **last** line as the
   newest tranche. Files are nested by year/month (`.specstory/history/YYYY/MM/`); a flat
   `.specstory/history/*.md` finds nothing.
2. `ls -1r .specstory/history/<YYYY>/<MM>` for that tranche — newest first.
   **This orders by filename, NOT by modification time**, which is what you want: filenames
   are date-encoded (`YYYY-MM-DD_HHMM-HHMM-<hash>.md`) and are the only reliable ordering. A
   `git checkout`, clone, or submodule update rewrites mtimes wholesale and would surface
   months-old files as "most recent".
   Suffixed siblings (`…-1_<hash>.md`, `…-2_<hash>.md`) are continuations of the same time
   tranche — treat them as one session, newest suffix last.
   If the newest tranche has too few files, repeat for the preceding month.
3. **Read** the most recent file.
4. Judge length from what `Read` returned:
   - **Short** (a few hundred lines, or the content is one aborted/trivial exchange) → also
     Read the next 1-2 files back
   - Skip files that only record a prior `/sl` invocation — they carry no work context
5. Note the **timestamp range** from the oldest loaded file's filename

### Step 3: Load Coding Project LSL Files (Cross-Project Context)

**Only if current project is NOT `coding`:**

1. `ls -d /Users/Q284340/Agentic/coding/.specstory/history/[0-9][0-9][0-9][0-9]/[0-9][0-9]`,
   then `ls -1r /Users/Q284340/Agentic/coding/.specstory/history/<YYYY>/<MM>` for the
   tranche(s) covering the Step 2 range
2. Find files that fall within or overlap the timestamp range from Step 2
3. **Read** the most recent coding LSL file from that time range
4. If that file is short, also Read 1-2 previous files from coding

**If current project IS `coding`:** Skip this step (already handled in Step 2)

### Step 4: Produce Summary

Create a concise summary covering:

1. **Time Range**: When these sessions occurred
2. **Projects Involved**: Which projects had activity
3. **Key Topics/Tasks**: Main things worked on in each session
4. **Current State**: What was left in progress or recently completed
5. **Suggested Next Steps**: Any obvious continuity items

Format the summary as:

```
## Session Continuity Summary

**Time Range**: [oldest file date] to [newest file date]
**Projects**: [list of projects with activity]

### Recent Work:
- [Project A]: [Brief description of main tasks]
- [Project B]: [Brief description of main tasks]

### Current State:
[What was in progress or just completed]

### Suggested Continuity:
[Any obvious next steps or items to pick up]
```

## File Selection Logic

- **Primary criterion**: Recency **by filename date**, not mtime (see Step 2)
- **Secondary criterion**: Length (short files trigger loading more files)
- **Tertiary criterion**: Cross-project relevance (coding project files during same timeframe)

## Size Thresholds

Judged from the `Read` result — do not shell out to `wc`/`ls -l` to measure a file.

- **Short**: a few hundred lines, or a single aborted/trivial exchange → load additional files
- **Sufficient**: a full session of prompts and tool calls → enough context alone
- **Very large**: `Read` truncates at 2000 lines → focus on the most recent sections, and
  `Read` neighbouring files rather than re-reading the same one with offsets

## Path Constants

- Current project LSL: `.specstory/history/YYYY/MM/*.md`
- Coding project LSL: `/Users/Q284340/Agentic/coding/.specstory/history/YYYY/MM/*.md`

## Permissions

`/sl` is designed to run with **zero permission prompts** in any project. That relies on six
user-level rules in `~/.claude/settings.json`:

```json
"Read(//Users/Q284340/**/.specstory/history/**)",
"Read(//Users/Q284340/Agentic/coding/.specstory/history/**)",
"Bash(ls -d .specstory/history/:*)",
"Bash(ls -1r .specstory/history/:*)",
"Bash(ls -d /Users/Q284340/Agentic/coding/.specstory/history/:*)",
"Bash(ls -1r /Users/Q284340/Agentic/coding/.specstory/history/:*)"
```

The relative pair covers whatever project is current; the absolute pair covers the
cross-project access in Step 3 (needed because that path is outside the workspace whenever the
current project is not `coding`). They are user-level, so they apply everywhere — project
`.claude/settings.local.json` allow rules do NOT, which is why an ad-hoc `find` or `ls` in a
different shape prompts outside `coding`.

If a prompt ever appears, the cause is almost always a command that deviates from the two
exact `ls` forms — a different flag order, a pipe, or a `find`. Re-read the Tooling Rules
rather than adding a rule.

## User Arguments

If user provides `$ARGUMENTS`:
- Number (e.g., "3"): Load exactly that many recent files per project
- "all": Load all files from today
- Empty/default: Use automatic length-based detection

---

**Begin by identifying the current project and loading the most recent LSL file.**
