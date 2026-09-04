# LLM Routing

Every LLM call made anywhere in coding goes through the proxy on `:12435`, and two YAML files
decide where it lands.

=== "⚡ Quick (~3 min)"

    ## Two files decide everything

    Your conversation with a coding agent, and every background cognitive service, reaches the
    llm-proxy on `:12435`. The proxy routes from **two version-controlled YAMLs** in the
    `rapid-llm-proxy` repo. Nothing else routes — no hardcoded chains, no policy hidden in
    startup scripts.

    | File | Answers |
    |------|---------|
    | `config/llm-routing.yaml` | Which **provider** and **model** serves a given piece of work |
    | `config/llm-fallback.yaml` | What happens when that provider **can't** |

    Both hot-reload on save. No restart.

    ## Always write provider/model

    A provider id names the **account that gets billed**, not the company that owns the model.
    `claude-code-max` (flat-rate Max subscription) and `anthropic-api` (metered key) both serve
    Claude models and are emphatically different money. So never write a bare model name:

    ```
    claude-code-max/claude-opus-5     personal Max subscription
    gh-copilot/claude-sonnet-5        corporate Copilot contract
    groq/openai/gpt-oss-120b          Groq API key
    ```

    The same form is used in the proxy logs, in `token_usage.provider`, and on the dashboard.

    ## Why did this call go there?

    Ask the proxy. It replays the decision the request path makes:

    ```bash
    curl -s 'localhost:12435/api/llm/routing/resolve?job=bg-observation-writer' | jq -r .summary
    # bg-observation-writer (step 2) -> gh-copilot/claude-haiku-4.5 > claude-code-max/claude-haiku-4.5 > …
    ```

    Add `&tools=true` to apply the capability gate, or `&network=corporate` to evaluate the
    other network without moving the laptop.

    ## Change it safely

    **Token Usage → Settings** on the [dashboard](http://localhost:3032/token-usage), or edit
    the YAML by hand. Saves are validated before they are written, and a config that will not
    parse aborts proxy startup rather than being half-applied.

    ## Where to go next

    **Standard** explains how a route and a model are actually chosen, when work is offloaded
    to a local model, and what happens when a provider fails. **Deep Dive** is the full
    reference, including the measurements behind each default.

=== "📖 Standard (~15 min)"

    ## How a request finds its provider

    ![LLM routing architecture](../images/llm-routing-architecture.png)

    Lookup is **three steps, in order** — no wildcards, no scoring, no tie-breaks:

    1. `routes["<job>/<agent>"]` — foreground, where the agent matters
    2. `routes["<job>"]` — background, where it doesn't
    3. `defaults[<class>]` — `fg-chat` for `fg-*` jobs, `background` otherwise

    `job` is `fg-chat` for a coding-agent conversation, or `bg-<service>` for a background
    service — the `process` field the caller sends to `/api/complete`.

    ## Bands pick the model, routes pick the provider

    The route names a **provider**. The **complexity band** then picks the model from *that
    provider's own table*:

    ```yaml
    routes:
      fg-chat/claude:        { provider: claude-code-max, complexity: high }
      bg-observation-writer: { provider: gh-copilot,      complexity: small }

    providers:
      gh-copilot:
        models: { small: claude-haiku-4.5, medium: claude-sonnet-4.6, high: claude-sonnet-5 }
      claude-code-max:
        models: { small: claude-haiku-4.5, medium: claude-sonnet-5,   high: claude-opus-5 }
    ```

    Deriving the model this way — rather than pinning provider *and* model on each row — is
    what makes fallback safe: when `bg-observation-writer` falls from `gh-copilot` to
    `claude-code-max` it lands on *that* provider's `small` model, instead of carrying a
    Claude model id to Groq.

    Each provider also declares `available_models`, the full set that account can serve.
    `models` is a **choice out of** that catalogue, and a band naming a model outside it
    **fails validation at boot** — so a stale id is caught when a vendor retires it, not as a
    `400` on the next call.

    ## When the caller declares its own band

    `complexity: from-caller` lets the caller supply the band; the **provider is still ours to
    decide**. Two routes use it: `fg-chat/opencode` and `fg-chat/pi`. This is the only caller
    input to routing — `body.provider` and `body.subscription` are deliberately ignored,
    because a caller that can re-route itself can quietly move spend onto another account.

    A caller can spell the band three ways, strongest first: `complexity` on the body, an
    `x-complexity` header, or OpenAI's `reasoning_effort`. The third is how **pi** does it, and
    it is why lowering pi's thinking level to `low`/`minimal`/`off` is what makes a turn
    eligible for the local offload. OpenCode has the same seam under `--variant`
    (`cheap` → `small`, `standard` → `medium`, `deep` → `high`).

    None of this reads prompt content. Every input is a field the caller set on purpose, and
    `GET /api/llm/routing/resolve?…&complexity=<band>` reproduces the decision exactly.

    There is also a prompt classifier, but it **ships disabled** and may only ever *lower* a
    band, never raise one.

    ## Offloading cheap work to a local model

    `semantic_routing` moves a call whose band is in `offload_bands` to a **local, unmetered**
    endpoint, inserting the route's own provider as the first fallback. There are two possible
    targets, because no single machine is always reachable:

    | Target | What it is | Network | Serves |
    |---|---|---|---|
    | `qwen-local` | on-prem V100 cluster | corporate only | foreground and background |
    | `qwen-laptop` | llama.cpp on this laptop, `127.0.0.1:8081` | public only | foreground only, **off by default** |

    Three switches gate every offload, and each defaults safe:

    - **`offload_bands`** — how *hard* a call may be to qualify. A target may narrow this list,
      never widen it.
    - **`scope`** — who may be *waiting* on it (`fg`, `bg`, or both). A laptop generating at a
      few tokens per second is fine for a turn you are watching and wrong for a high-volume
      background service.
    - **`enabled`** — declaring a target says where an offload *could* go; enabling it says
      work should actually be sent there.

    Both targets **fail closed**: each is re-probed every 60s and dropped from every chain
    while unreachable, so a stopped `llama-server` or an off-VPN cluster costs nothing beyond
    falling back to the provider the route named. A target is never probed on a network it does
    not serve.

    When an offload does not happen, `offloadSkipped` says which of the reasons applied — no
    target for this network, the target is switched off, or the target does not serve this kind
    of work. They have different fixes.

    ## When a provider can't serve

    `llm-fallback.yaml` gives each provider an ordered list of what to try next:

    ```yaml
    chains:
      gh-copilot:
        - provider: claude-code-max
          when: { network: [public] }   # claude-code is firewall-blocked inside corporate
        - provider: groq
        - provider: openai
    ```

    - A candidate whose **guard** doesn't hold is skipped — not an error; the chain continues.
    - Chains are **flat, not recursive**. Falling back from A to B does not then consult B's
      own chain, so one route means one visible list of attempts rather than a graph to trace.
    - Only the failure classes in `retry_on` advance the chain. A 400, a 401 or a content
      refusal surfaces verbatim — retrying a caller's bug across three providers just burns
      three quotas and hides the bug.

    A request carrying `tools[]` may only land on a provider whose `capabilities.tools` is
    true; with `enforce_capabilities: true` a tools-bearing request with no capable provider
    **fails loudly** rather than landing somewhere that silently drops the tools and returns
    prose.

    ## Foreground Claude is a passthrough

    `fg-chat/claude` is special. Claude Code speaks the **Anthropic wire protocol**, and the
    proxy forwards those requests verbatim to `/v1/messages` rather than selecting a provider —
    so only a provider marked `fg_transport: anthropic-passthrough` can serve it, which today
    means `claude-code-max` alone. Routing it anywhere else is refused with a `501
    ROUTE_NOT_IMPLEMENTED` rather than silently ignored.

    A practical consequence: foreground Claude can **never** be offloaded to a local model, on
    any network.

    ## Changing the configuration

    **Token Usage → Settings** at [localhost:3032](http://localhost:3032/token-usage) edits both
    files. Saves are sent as a patch of only what changed and applied through the YAML document
    API, so the extensive comments in both files survive editing; the proxy validates before
    writing, and a rejected save leaves both files byte-identical.

    The **Flow** tab draws the same data as a graph, with edge thickness from real traffic. That
    combination answers a question neither table can: a thick edge to a provider that no route
    names means work is arriving there **by fallback**.

    Editing the YAML by hand works too — the proxy reloads on mtime change.

    ## Diagnosing a routing surprise

    1. **`/api/llm/routing/resolve`** — did the route resolve where you expected? `matchedKey`
       and `step` say which of the three lookup steps fired; `step: 3` means nothing matched and
       you got a class default.
    2. **Read `skipped[]`** before assuming a bug — a guard or the capability gate may have
       removed the provider you expected, and it says which.
    3. **Reproduce with `tools[]`.** A curl reproduction of an *agent* call that omits them
       takes a different chain and can succeed where the agent fails.
    4. **Read the log line.** `fallbackFrom` and the `[<failure_class>]` tag say exactly why the
       chain advanced.

    For what routing *did* rather than what it *would* do, every `token_usage` row carries
    `route_key`, `route_band`, `route_step`, `offloaded_from`, `chain_position` and an
    `attempt_trail`. The dashboard renders it at **Token Usage → Routing**.

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/architecture/llm-routing.deep.md"
