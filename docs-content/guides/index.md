# Guides

Task-oriented walkthroughs. Each one assumes the system is installed and running.

=== "⚡ Quick (~3 min)"

    ## Pick by what you are doing

    | You want to… | Guide |
    |--------------|-------|
    | Run only part of `coding` — or none of the Docker parts | [Composing What Runs](features.md) |
    | Add a new coding agent | [Agent Integration](agent-integration.md) |
    | Work behind a corporate proxy or VPN | [Network Configuration](network-configuration.md) |
    | Decode the tmux status bar | [Status Line](status-line.md) |
    | Investigate a health problem | [Health Dashboard](health-dashboard.md) |
    | Add, switch or debug an LLM provider | [LLM Providers](llm-providers.md) |
    | Write or debug a constraint | [Constraint Testing](constraint-testing.md) |
    | Explore the knowledge graph | [VKB Visualization](vkb-visualization.md) |
    | Understand how knowledge is captured | [Knowledge Workflows](knowledge-workflows.md) |
    | Work out why CI went red | [Continuous Integration](../ci/README.md) |
    | Write or use a skill | [Skills System](skills-system.md) |

    ## If you are new

    Read [Getting Started](../getting-started/index.md) first, then
    [Core Systems](../core-systems/index.md). The guides here go deeper than either and assume
    you already have something running.

=== "📖 Standard (~15 min)"

    ## What these guides are for

    The [Core Systems](../core-systems/index.md) pages explain what each system *is*. These
    guides are about *doing* something with them — adding an agent, chasing a failure, changing a
    provider — and so carry complete configurations and worked examples rather than overviews.

    ## Choosing one

    | Guide | Reach for it when |
    |-------|-------------------|
    | **[Composing What Runs](features.md)** | Deciding which of the nine features to run — presets, dependencies, and what a pared-down install costs you |
    | **[Agent Integration](agent-integration.md)** | Adding a coding assistant to the system — the config contract, hooks and API |
    | **[Network Configuration](network-configuration.md)** | Behind a corporate proxy or VPN, or an agent's traffic is being routed unexpectedly |
    | **[Status Line](status-line.md)** | Decoding the tmux bar — every indicator, and how to configure it |
    | **[Health Dashboard](health-dashboard.md)** | A service is unhealthy, or you want to understand the supervision architecture |
    | **[LLM Providers](llm-providers.md)** | Adding, switching or troubleshooting a cloud or local provider |
    | **[Constraint Testing](constraint-testing.md)** | Writing a constraint, or one is firing when it should not |
    | **[VKB Visualization](vkb-visualization.md)** | Exploring the knowledge graph, or driving the viewer programmatically |
    | **[Knowledge Workflows](knowledge-workflows.md)** | Understanding how knowledge is captured, processed and stored |
    | **[Continuous Integration](../ci/README.md)** | A CI run went red, or you want to know what a green one actually proves |
    | **[Skills System](skills-system.md)** | Writing a skill, or working out why one did not trigger |

    ## Two that pay off early

    **Status Line.** It is on screen the entire time you work, and it reports health, cost and
    logging state continuously. Learning to read it turns most "is something broken?" questions
    into a glance.

    **Health Dashboard.** When something *is* broken, this is where the answer is. It also
    explains the layered supervision model, which is what makes an unresponsive-but-alive process
    detectable at all.

    ## Related

    - [Getting Started](../getting-started/index.md) — installation and first session
    - [Core Systems](../core-systems/index.md) — what each system does
    - [Architecture](../architecture/index.md) — why it is built this way
    - [Troubleshooting](../reference/troubleshooting.md) — symptom-first index

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/guides/index.deep.md"
