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

    - **Summary** — nodes up, gateways healthy, GPUs busy, active jobs, status services; the
      trace top right is the share of nodes up at each poll (the cluster's heartbeat).
    - **A node tile** — its name and gateway endpoint (`host:port`), a status dot (green:
      gateway healthy, amber: up but no live backend, red: not reachable), GPU utilisation and
      memory bars, the host's CPU load and RAM bars, a sparkline (GPU utilisation, or CPU load
      on a node without a GPU driver), the models its gateway serves, the job on it, and when it
      was last seen.
    - **Routing panel** — the calls the offload router handled. Hover a row and the node that
      answered it lights up; click a tile to show only that node's calls.

    ## Set it up

    Whoever has the cluster's credentials writes up to three files into `~/.glass` (a
    devcontainer does it from its `.env`):

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
