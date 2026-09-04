# Constraint Testing

Constraints are checked before a tool call runs, not after. This is how they fire, how to
test one, and how to override a false positive honestly.

=== "⚡ Quick (~3 min)"

    ## What a constraint does

    A PreToolUse hook sees each tool call **before execution**. A CRITICAL or ERROR match blocks
    the call; WARNING and INFO let it through with feedback. Eighteen ship configured, covering
    security, architecture, code quality and documentation.

    | Severity | Score impact | Tool call |
    |----------|--------------|-----------|
    | CRITICAL | −3.0 | blocked |
    | ERROR | −2.0 | blocked |
    | WARNING | −1.0 | proceeds |
    | INFO | −0.5 | proceeds |

    Compliance starts at 10.0 and each violation subtracts.

    ## When one blocks you

    Read what it says — the message names the rule and usually the fix. Then **fix the code**.

    Do not reword the command to slip past the pattern. Swapping an API purely to dodge a regex
    leaves the real problem in place and removes the only signal that it was there.

    ## When it is genuinely wrong

    Say so explicitly, in the request:

    ```
    OVERRIDE_CONSTRAINT: <constraint-id>
    ```

    with a sentence of rationale. That keeps the escape hatch auditable — an override is a
    recorded decision, a reworded command is a silent one.

    ## Where to look

    The dashboard at [localhost:3030](http://localhost:3030) shows the live violation feed,
    compliance trend and each rule's configuration.

=== "📖 Standard (~15 min)"

    ## How enforcement is wired

    ![Constraint Testing Architecture](../images/constraint-testing-architecture.png)

    The hook runs *between* the agent deciding to call a tool and the tool executing. That timing
    is the entire design: a check that runs afterwards can only describe damage. Because it sits
    on the tool-call path, a blocked call never happened at all — there is nothing to undo.

    Severity decides what happens on a match, and also what it costs:

    | Severity | Compliance impact | Action | Exit code |
    |----------|-------------------|--------|-----------|
    | CRITICAL | −3.0 | Block | 1 |
    | ERROR | −2.0 | Block | 1 |
    | WARNING | −1.0 | Allow, with a warning | 0 |
    | INFO | −0.5 | Allow, with a note | 0 |

    The compliance score starts at 10.0, subtracts per violation and is clamped to 0–10, so it is
    a rolling indicator rather than a running total.

    ## The rules

    Eighteen constraints across four groups — security (hardcoded secrets, dynamic evaluation),
    architecture, code quality and documentation placement. The security pair matches at 100%
    detection in testing, which is the bar you want for a rule whose failure mode is a leaked
    credential.

    Rules are declarative: an id, a regex, a severity and the message shown when they fire, so
    adding one is a config change rather than code.

    ## Overrides are part of the design

    A pattern-based rule will sometimes be wrong. The supported answer is an explicit override
    naming the constraint plus a rationale, which is recorded. The unsupported answer — quietly
    rephrasing until the regex stops matching — is worse than either fixing or overriding,
    because the rule was the only thing that knew there was a question.

    One known false-positive class worth recognising: a file-scoped rule can fire on the *text of
    a command* rather than on the file it targets, so a script that merely mentions a forbidden
    pattern in a string can trip a rule aimed at source files. That is an override case, not a
    rewrite case.

    ## Testing a constraint you have written

    Two ways, and they answer different questions. The automated harness feeds known-violating
    and known-clean inputs and asserts the verdicts — that tells you the rule matches what you
    meant. Interactive testing runs it against a real tool call — that tells you the rule fires
    where you expected in the actual hook path.

    Write the negative case as well as the positive one. A pattern that matches nothing passes
    every test that only checks clean input, and looks identical to one that works.

    ## Monitoring

    The dashboard at [localhost:3030](http://localhost:3030) carries the live violation feed,
    compliance trend over time, and per-rule configuration. The `constraints` CLI answers the same
    questions from a terminal and works even when the container is down, because it evaluates
    in-process.

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/guides/constraint-testing.deep.md"
