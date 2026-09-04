# Continuous Integration

Four GitHub Actions workflows guard this repository — what each proves, and what a red run
actually means.

=== "⚡ Quick (~3 min)"

    ## The four workflows

    | Workflow | Runs on | Proves |
    |----------|---------|--------|
    | **tests** | push to `main`, every PR | The whole suite passes — lint, jest and `node:test` |
    | **Egress Lint** | push to `main`, every PR | No new code dials a provider cloud directly |
    | **Deploy Documentation** | push to `main` | The published site matches `main` |
    | **Cross-platform** | every PR | The installer works on Linux, macOS and Windows |

    Only Cross-platform skips pushes to `main` — it is PR-and-dispatch only.

    ## What CI cannot see

    No runner has Docker, the agent CLIs, the private submodules, or a corporate proxy. A green
    run therefore proves the suite passes **without** those, which is a real guarantee but a
    narrower one than "everything works".

    ## Two runners, split by content

    A test file belongs to jest or to `node:test` depending on whether it imports `node:test` —
    by content, not by filename. That is why a file cannot be claimed by both or dropped by both.

    ## When something goes red

    Read which workflow failed first: they mean entirely different things. A red **tests** is a
    code problem; a red **Egress Lint** is a policy problem; a red **Deploy Documentation** means
    the site no longer matches `main`.

=== "📖 Standard (~15 min)"

    ## Why four, and why independent

    Each workflow has its own triggers and its own failure meaning, and between them they cover
    the test suite, the egress policy, the published documentation and the installer's
    portability. Keeping them separate is what makes a red run informative — one combined
    workflow would tell you something broke without telling you what kind of thing.

    ![The four workflows, their triggers, and what each proves](../images/ci-workflows.png)

    ## What a green run does and does not prove

    Every runner is a stock GitHub-hosted machine. None has Docker, the agent CLIs, the private
    `integrations/*` submodules, or a corporate proxy. So green means: the suite passes on a
    clean machine with none of this project's runtime around it.

    That is worth knowing in both directions. It is a genuine portability guarantee — a
    contributor with none of the local setup can still be told whether their change is sound. And
    it is a real gap: anything that only manifests with the containers running is not covered
    here, and is covered by the local suite instead.

    ## The test split

    The repository has two test systems, and classification is **by content**: a file that
    imports `node:test` belongs to `node:test`, everything else matching the jest globs belongs
    to jest. Both runners read the same inventory, so a file cannot be claimed by both or
    silently dropped by both.

    That mattered because the failure it prevents is invisible. Jest collects `.test.js` files
    but cannot see a `node:test` registration, so it used to report "your test suite must contain
    at least one test" for suites that were in fact fine — while other suites ran under no runner
    at all.

    ## The documentation workflow is unusual

    It carries a **freshness guard** as well as a build. The gate decides whether a push touched
    anything the site renders, and skipping is the normal case. What is not normal is the gate
    skipping while the site is genuinely stale — a failure that reports success, because a
    skipped build makes the whole run green.

    That has happened: several files under `docs-content/` are symlinks into `docs/`, so editing
    one changes the symlink's *target* and not the symlink, and a `docs-content`-only path
    pattern did not match. Five consecutive green runs published nothing.

    So the guard checks the invariant directly rather than trusting the pattern: the content hash
    of everything the site renders, symlinks resolved, must equal the hash the live site is
    serving. It fails only on positive evidence of staleness — if it cannot fetch the live
    manifest it warns and passes, because a guard that goes red on its own infrastructure gets
    disabled and then protects nothing.

    ## What a red workflow tells you

    | Red workflow | Means |
    |--------------|-------|
    | **tests** | A genuine code failure, or a test that depends on local setup |
    | **Egress Lint** | New code reaches a provider cloud directly, bypassing the proxy |
    | **Deploy Documentation** | The build failed, or the site no longer matches `main` |
    | **Cross-platform** | The installer is not portable — usually a shell or path assumption |

    Cross-platform failures are the ones most likely to be real and least likely to reproduce
    locally, because they are usually about a shell or a path that only behaves differently on
    another operating system.

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/ci/README.deep.md:3"
