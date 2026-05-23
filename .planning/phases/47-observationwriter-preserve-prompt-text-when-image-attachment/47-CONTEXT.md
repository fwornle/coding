# Phase 47 — Context

**Title:** ObservationWriter: preserve prompt text when image attachments are present
**Filed:** 2026-05-21
**Severity:** Medium (data-loss bug, recovery requires manual hand-writes)
**Status:** Filed (not yet planned)

---

## Bug

When a user prompt contains image attachments, the `messages` column on the
resulting observation row stores only the image placeholders — the actual
text portion of the prompt is dropped.

### Stored shape (broken)

```json
{
  "id": "...",
  "role": "user",
  "content": "[Image: source: /Users/.../image-cache/<uuid>/1.png]\n[Image: source: /Users/.../image-cache/<uuid>/2.png]",
  "metadata": { "agent": "claude", "format": "live" }
}
```

### Expected shape

The prompt text plus image references should both be present, e.g.:

```json
{
  "role": "user",
  "content": "online learning in cooling, despite the ongoing implementation in C(oding)? (tmux statusline) [Image #1] & observations (gap) [Image #2]\n\n[Image: source: .../1.png]\n[Image: source: .../2.png]"
}
```

---

## Symptoms

1. **Observations dashboard** (`localhost:3032/observations`) shows summaries that
   miss what was actually asked — only image references are visible to the
   summarizer, so the intent line is generic or template-shaped.

2. **Backfill is unrecoverable from the DB alone.**
   `scripts/backfill-raw-observations.mjs` reads `messages` from the row and
   asks the LLM proxy to summarize. With only image placeholders present, the
   proxy returns template placeholder text (`Intent: [what the developer
   actually asked or requested — ...]`) and the row is correctly skipped.
   The only fix today is manual hand-writing from session context.

---

## Confirmed instance

- Row id: `9a3e700c-1bbd-4e47-8734-7df4c73bd228`
- Created: 2026-05-21T18:46:29.612Z
- Project: km-core (cross-classified in coding DB)
- Original prompt: badge investigation + two screenshots (tmux statusline + /observations panel)
- Manually backfilled in this session — `metadata.manualBackfill: true`, with `manualReason` documenting why the proxy couldn't help.

---

## Suspected root cause

`src/live-logging/ObservationWriter.js` — the user-message serialization
path. The transcript jsonl line for the prompt is read, then content is
flattened to a string. When the content is a *block array* (text + image
blocks), the flattening logic appears to drop text and keep only image
references — or the upstream reader in
`scripts/enhanced-transcript-monitor.js` (ETM) hands the writer a stripped
view.

Both files need inspection. Look at how `content` is built when the source
record has `content: [{type:'text', text:'...'}, {type:'image', ...}]`.

---

## Scope

### Must

1. Fix capture: when a prompt has image attachments, retain **both** the text
   and the image references in `messages[*].content`.
2. Regression test: mixed text + image prompt → stored row must contain both.
3. Re-verify on a fresh prompt: send a text+image message, inspect the
   observation row, confirm both are stored.

### Should

4. Widen `scripts/backfill-raw-observations.mjs`: when a `[Raw]`/low-quality
   row has placeholder-only `messages`, attempt to recover the full prompt
   text from the source transcript jsonl (`source_file` column points at it).
   This makes existing broken history backfillable without manual work.

### Could

*(historical-row audit + bulk recovery moved to Phase 50 — see Related)*

---

## Acceptance criteria

- [ ] A prompt sent with mixed text + images stores both in `messages[*].content`.
- [ ] Regression test added under `tests/live-logging/` covers the mixed-content path.

---

## Related

- **Phase 50 — LSL-grounded async observation resolver.** The bulk-recovery
  pathway for already-broken historical rows (including row `9a3e700c-…`
  which currently carries a manual backfill) is handled there via the
  shared `getLSLWindow` primitive. This phase intentionally narrows to
  the writer-path fix so the bug stops happening; Phase 50 handles
  everything before the fix lands.
- Commit `a607618a3` (2026-05-21): unrelated `[📚]` badge promotion fix from the same session — preserved here only because that session is what surfaced this bug.
- See also: working memory entry "Tmux Status Bar and Status Line Fast Path" (separate concern).
