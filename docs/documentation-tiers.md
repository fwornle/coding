# Tiering a documentation page

The published site (`docs-content/`, rendered by `mkdocs.yml`) presents long pages as three
content tabs. This is the recipe for converting one, and the reasoning behind the rules that
are enforced by `tests/integration/docs-tiers.test.js`.

Not every page is tiered. Pages under ~250 lines already read in a few minutes and are left
alone; tabs on a short page are overhead, not navigation.

## The three tiers

| Tier | Budget | Contains | Excludes |
|------|--------|----------|----------|
| `⚡ Quick (~3 min)` | ≤ 60 lines | What this is, in 2–3 sentences; the commands or facts you actually need; at most one table or diagram; a pointer to the next tier | Caveats, history, alternatives, rationale |
| `📖 Standard (~15 min)` | ≤ 200 lines | Everything needed for general-purpose use: the concepts, the main workflows, the configuration most people touch, the common failure modes | Internal mechanism, edge cases, historical rationale, benchmark data, exhaustive option tables |
| `📚 Deep Dive (full)` | unchanged | The page as it was before tiering | — |

Each tier must read **standalone**. A reader on Quick should never have to switch tabs to
make sense of what they are reading — the tiers are three depths of the same story, not three
consecutive parts of one.

## Converting a page

The Deep Dive tier is a snippet include, so the existing body is never re-indented under a
tab and stays an ordinary markdown file to edit and diff:

```bash
mkdir -p docs-content/_tiers/<section>
git mv docs-content/<section>/<page>.md docs-content/_tiers/<section>/<page>.deep.md
```

Then strip the leading `# H1` from the partial — it moves to the shell page, and two `<h1>`
elements on one page is invalid — and write the shell back at the original path:

```markdown
# Page Title

One sentence of shared context, outside the tabs.

=== "⚡ Quick (~3 min)"

    ## A heading unique to this page
    ...

=== "📖 Standard (~15 min)"

    ## Another unique heading
    ...

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/<section>/<page>.deep.md"
```

Because the shell sits exactly where the old page sat, every relative link and image in the
moved body keeps resolving — snippets are a text-level include, so paths resolve from the
**including** page.

## Rules the lint enforces, and why

**Tier labels are exact, and in that order.** `content.tabs.link` is enabled, which syncs the
tab across pages by label text and persists the choice. A page that spells a tier differently
silently opts out, so a reader who chose Quick lands on whatever that page's first tab is.

**No heading text may be reused across tiers of one page.** Markdown does not know about
tabs: the `toc` extension sees all three tiers as one document, so the second use of a heading
is renamed `#foo` → `#foo_1`. The Deep Dive tier renders last and carries every anchor the
site already links to, so a careless heading in Quick silently moves a Deep Dive anchor and
breaks inbound links with no warning. Give each tier its own framing — which is the right
outcome anyway, since a tier that reuses the headings of another is usually a truncated copy
rather than a genuine summary.

**Every `--8<--` target must exist.** `check_paths` is on in `mkdocs.yml`, so a mistyped path
fails the build instead of publishing an empty tab.

**No orphaned partials.** A file under `_tiers/` that no page includes is unreachable, yet is
still hashed into the docs freshness manifest, so it can trigger rebuilds of content nobody
can read.

## Checking your work

```bash
python3 -m mkdocs build --strict          # anchors are validated; a bad include fails here
NODE_OPTIONS='--experimental-vm-modules --no-warnings' npx jest tests/integration/docs-tiers.test.js
python3 -m mkdocs serve -a 127.0.0.1:8765 # then look at the page
```

The build and the lint between them catch structure. They cannot tell you whether the Quick
tier is genuinely readable in three minutes — read it.

One thing worth checking in the browser rather than the diff: switch tabs and confirm the
right-hand table of contents follows. That is `docs-content/javascripts/tabbed-toc.js` hiding
the entries whose anchors live in an inactive tab, and it is the part of the design that has
no representation in the markdown at all.
