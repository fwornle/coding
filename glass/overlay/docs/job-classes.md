# Job Classes

What kind of job each prompt you give an agent is — fix, build, ship, status, explain, … —
labelled in the background with your own Copilot account. Opt-in, off by default.

!!! tip "First time?"
    [Tutorial: Job Classes](tutorial-job-classes.md) walks through it step by step, with a
    screenshot of each step: switch it on, measure, read the tree, join your team.
    The [overview deck](job-classes-overview.md) shows the whole idea on six slides, and
    how glass and coding share the work.

=== "⚡ Quick (~3 min)"

    ## What it is for

    Some of what you ask an agent is hard (finding why something broke); much of it is
    routine (commit and push, is it finished, rerun the tests). Today one strong, expensive
    model answers all of it. Job classes sort your prompts into kinds of job, so you can see
    what your work consists of and, later, which kinds a cheaper model does just as well.

    A cheap **student** model labels every turn; a strong **teacher** model re-checks a share
    of them. A class's labels are trusted once the teacher agrees with at least 90 % of them,
    over at least 20 checked turns (the **gate**).

    ## Switch it on

    1. `glass ui` → **Token Usage → Classes**, or in a terminal: `glass job-classes on`.
    2. **Try the account** sends one made-up prompt and shows the label it got.
    3. Tick **Label my turns**. It applies to the next turn; no restart.

    ![The labelling settings on the Classes tab](images/ui-job-classes-settings.png)

    Each prompt is redacted first and sent to **your own GitHub Copilot account** — the one
    your `gh` login reaches — never anywhere else. It uses a little of your Copilot quota per
    turn, and never touches the turn itself: the agent's call goes out before the label is
    asked for.

    ## See what your work consists of

    `glass job-classes measure` labels your recent prompts — read from the agents' own
    transcripts, redacted — with the teacher twice and the student once. It prints how well
    the student agrees with the teacher and writes the reference set the tab's tree and map
    read:

    ![The taxonomy tree after a first small measurement](images/ui-job-classes-tree.png)

    ## Your team's classes

    A team can share its own classes from a member's learning repo (folder `job-classes/`).
    Join it with the repo's git URL — in the tab, or `glass job-classes join <url>`;
    `glass job-classes pull` updates it. The repo itself is set up by someone who runs
    coding (see below).

    ## glass and coding

    Most people only install glass, and it labels, measures and shows on its own. Building
    a team's classes, trials and routing by class run in coding:

    | | glass alone | needs coding |
    |---|---|---|
    | Label your turns (student + teacher, your Copilot account) | ✅ | |
    | Measure your past prompts; tree, map, gate | ✅ | |
    | Join and update a team's classes | ✅ | |
    | Create a team's classes, propose and fold new ones | | ✅ `coding job-classes init` / `propose` / `fold` |
    | Trials: can a cheaper model take over a background job? | read-only, on a machine that also runs coding | ✅ started and accepted in coding's dashboard |
    | Replay a class's past turns on a cheaper model; record the evidence | | ✅ `coding job-classes replay …` |
    | Route a proven class to a cheaper model (the class floor) | ✗ glass shows the label, the agent keeps its model | ✅ for pi, opencode and Copilot CLI |
    | Offload easy calls to your own endpoint | ✅ [Offload](offload.md) | |

    Labels and gate counts stay on the machine that made them, in glass and in coding alike.
    What a team shares is its classes and, from coding, the evidence of replays.

    **Next:** what is sent, the commands, how the gate is counted, and what a team's
    maintainer sets up — open the deep dive.

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/job-classes.deep.md"
