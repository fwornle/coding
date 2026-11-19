# Cluster & Routing

See a GPU cluster's nodes at a glance — gateway health, served models, GPUs, CPU and RAM, and jobs — and
follow every call the offload router sent there, kept back, or let fall back.

=== "⚡ Quick (~3 min)"

    ## Two tabs, shown only where they apply

    | Tab | Appears when | Shows |
    |---|---|---|
    | **Cluster** | `~/.glass/cluster.json` exists | one tile per node, a summary, and the routing history beside it |
    | **Routing** | an offload endpoint is set (or a cluster is configured) | the routing history, full width |

    Without either, glass looks exactly as before: no tab, no request to any node.

    ## The Cluster page

    <!-- screenshot: images/ui-cluster.png — the Cluster page with its node grid and the Routing panel -->
    !!! note "Screenshot to come"
        `images/ui-cluster.png` — the node grid, the summary row and the Routing panel.

    - **Summary** — nodes up, gateways healthy (out of the nodes that run a gateway), GPUs
      busy, active jobs, status services; the trace top right is the share of nodes up at each
      poll (the cluster's heartbeat).
    - **Outside the cluster's network** — a cluster on a private network answers only from
      inside it, or over VPN. When no node answers and none refuses a connection, the page says
      *the cluster is not reachable from this machine* and when it was last reached, instead
      of showing tiles of stale facts.
    - **A node tile** — its name and gateway endpoint (`host:port`), a status dot (green:
      gateway healthy, amber: up but no live backend, blue: no gateway — the node answers
      through its status service only, red: not reachable), GPU utilisation and
      memory bars, the host's CPU load and RAM bars, a sparkline (GPU utilisation, or CPU load
      on a node without a GPU driver), the models its gateway serves, the job on it, and when it
      was last seen.
    - **A clicked node** — opens over the grid: GPU utilisation, GPU memory, CPU and RAM (and
      the gateway's latency) as charts with time and value axes, over the last hour the page
      was open; its hardware, gateway backends, models (an adapter framed dashed) and jobs.
      **all nodes** goes back.
    - **History panel** — the calls the offload router handled and the jobs the nodes
      reported, newest first. A card's faint background says what it is on the cluster:
      blues for LLM work — *offload* (the router sent the call), *agent model* (an agent
      configured with a cluster model), *LLM job* — and green for a *non-LLM job*; a call an
      adapter served keeps its colour with a dashed frame. A call no node served has no tint.
      Hover a card and its node lights up; click a tile to show only that node's cards.

    ## Set it up

    The Cluster page rests entirely on files in `~/.glass` on your own machine: glass ships
    no node list and no keys. Whoever has the cluster's credentials writes up to three files
    there (a devcontainer does it from its `.env`):

    ```json title="~/.glass/cluster.json"
    { "nodes": [{ "name": "node1", "host": "192.0.2.10" }, { "name": "node2", "host": "192.0.2.11" }],
      "gatewayPort": 8000, "statusPort": 8099 }
    ```

    Two keys, two secrets — each optional, each owner-only:

    ```bash
    # the gateways' key: lets glass list the models each gateway serves
    printf '%s\n' "$CLUSTER_API_KEY" > ~/.glass/cluster.key && chmod 600 ~/.glass/cluster.key
    # the status services' key: lets glass read GPUs, CPU and RAM, jobs and endpoints
    printf '%s\n' "$CLUSTER_STATUS_KEY" > ~/.glass/cluster-status.key && chmod 600 ~/.glass/cluster-status.key
    ```

    With neither, the page still shows each gateway's health. Open `glass ui` → **Cluster**.
    No restart: the files are re-read when they change.

    ## The Routing tab

    <!-- screenshot: images/ui-routing.png — the Routing tab with offloaded, fell-back and kept calls -->
    !!! note "Screenshot to come"
        `images/ui-routing.png` — the Routing tab over 24 h.

    One row per call: when, which agent, the decision (**offloaded**, **fell back**, **kept**),
    the band and who chose it, the model and host that answered, why, latency and tokens.
    Pick a window (1 h to 30 days) and filter to offloaded calls or the rest.

    **Next:** what each node is asked, the key, and how a row becomes a decision — open the deep dive.

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/cluster.deep.md"
