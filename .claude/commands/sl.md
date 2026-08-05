---
description: Load session logs (LSL) from current and coding projects for continuity
argument-hint: Optional number of files to load (default auto-detects based on length)
---

# Session Logs (/sl) - Session Continuity Command

Load and summarize recent Live Session Logs (LSL) to provide continuity from previous work sessions.

## Instructions

**Goal**: Load recent LSL files and produce a summary to establish context continuity.

### Tooling Rules (read first — these keep /sl prompt-free)

**Use ONLY `Glob` and `Read` for every step below. Never use Bash.**

`Glob` is ungated, and `Read` on `.specstory/history/**` is pre-allowed in
`~/.claude/settings.json` for every project (see [Permissions](#permissions)). Together they
make `/sl` run without a single permission prompt, in any project.

**Never** reach for these — each one triggers a prompt even when a matching `Bash(...)` allow
rule exists, because the permission matcher cannot statically resolve the command it runs:

- `find … -exec <cmd>` (the `-exec` payload is opaque to the matcher)
- `xargs <cmd>` / `` `cmd` `` / `$(cmd)` (nested command)
- `ls`/`find`/`head`/`wc` pipelines — allow rules are per-project, so they prompt in every
  project except `coding`

If you catch yourself writing a shell one-liner to list or size these files: stop, use `Glob`.

### Step 1: Determine Current Project

1. Get the current working directory
2. Identify the project name (the directory name containing `.specstory/history`)
3. Note if this IS the `coding` project or a DIFFERENT project

### Step 2: Load LSL Files from Current Project

1. Discover files with **Glob**, pattern `.specstory/history/**/*.md`.
   Files are nested by year/month (`.specstory/history/YYYY/MM/`), so the `**` matters — a
   flat `.specstory/history/*.md` finds nothing.
2. **Sort by filename, NOT by modification time.** Filenames are date-encoded
   (`YYYY-MM-DD_HHMM-HHMM-<hash>.md`) and are the only reliable ordering: a `git checkout`,
   clone, or submodule update rewrites mtimes wholesale and will surface months-old files as
   "most recent". Take the lexicographically greatest filename as newest.
3. **Read** the most recent file.
4. Judge length from what `Read` returned:
   - **Short** (a few hundred lines, or the content is one aborted/trivial exchange) → also
     Read the next 1-2 files back
   - Skip files that only record a prior `/sl` invocation — they carry no work context
5. Note the **timestamp range** from the oldest loaded file's filename

### Step 3: Load Coding Project LSL Files (Cross-Project Context)

**Only if current project is NOT `coding`:**

1. **Glob** `/Users/Q284340/Agentic/coding/.specstory/history/**/*.md`
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
- **Very large**: `Read` truncates at 2000 lines → focus on the most recent sections, and use
  `Glob`/`Read` on neighbouring files rather than re-reading the same one

## Path Constants

- Current project LSL: `.specstory/history/YYYY/MM/*.md`
- Coding project LSL: `/Users/Q284340/Agentic/coding/.specstory/history/YYYY/MM/*.md`

## Permissions

`/sl` is designed to run with **zero permission prompts** in any project. That relies on two
user-level rules in `~/.claude/settings.json`:

```json
"Read(//Users/Q284340/**/.specstory/history/**)",
"Read(//Users/Q284340/Agentic/coding/.specstory/history/**)"
```

The first covers the history folder of whatever project is current; the second explicitly
covers the cross-project read in Step 3 (needed because that path is outside the workspace
whenever the current project is not `coding`). They are user-level, so they apply everywhere —
project `.claude/settings.local.json` allow rules do NOT, which is why Bash listing commands
prompt outside `coding`.

If a prompt ever appears, the cause is almost always a Bash call that crept back into Steps
1-3 — not a missing rule. Re-read the Tooling Rules.

## User Arguments

If user provides `$ARGUMENTS`:
- Number (e.g., "3"): Load exactly that many recent files per project
- "all": Load all files from today
- Empty/default: Use automatic length-based detection

---

**Begin by identifying the current project and loading the most recent LSL file.**
