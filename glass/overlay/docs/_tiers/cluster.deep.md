## What glass asks each node

Read-only, over HTTP only (glass spawns no shell), each request with a 3 s timeout, all
nodes in parallel:

| Request | Key | Gives |
|---|---|---|
| `GET http://<host>:<gatewayPort>/health` | none | `{ status, backends: { url: bool } }` — 200 healthy, 503 no live backend |
| `GET http://<host>:<gatewayPort>/v1/models` | `cluster.key` | the model ids the gateway serves |
| `GET http://<host>:<statusPort>/status` | `cluster-status.key` | GPUs (utilisation, memory, temperature), the host's CPU and RAM, jobs, listening endpoints |
| `GET http://<host>:<port>/v1/models` | none | for each port 8000–8999 the status service lists as listening (not the gateway or status port, at most 4): a model server running outside the gateway — a llama-server for an experiment — shown with its port and marked *not a gateway*. One that wants a key reads *needs a key*; it never gets one |

Each key goes to its own service only: the gateway key never reaches a status service or a
model server outside the gateway, and the status key never reaches a gateway. A request whose key is absent is not made — the tile
says *no gateway key* or *no status key* — so either secret can be handed out alone.

A node is **up** when any of the three answers. The status service is optional per node: a
node without it shows *no status service*, and its tile keeps gateway health and models.
A refused key reads as *refused the key*, not as an outage.

The status service answers in this shape (fields beyond it are dropped):

```json
{ "node": "node1", "ts": "2026-11-15T10:00:00Z",
  "gpus": [{ "index": 0, "name": "…", "util_pct": 64, "mem_used_mib": 12000, "mem_total_mib": 16000, "temp_c": 61 }],
  "host": { "cpu_count": 32, "cpu_pct": 41.5, "load": [3.5, 2.1, 1.8], "mem_total_mib": 128799, "mem_used_mib": 32543, "mem_available_mib": 96256 },
  "jobs": [{ "id": "…", "name": "train", "image": "…", "status": "running", "started": "…", "gpu": "0" }],
  "endpoints": [{ "port": 8000, "process": "gateway" }],
  "gateway": { "port": 8000, "healthy": true, "backends": {} } }
```

## When glass polls

Only while someone looks. The page's first read starts the poller; it polls every 15 s
and stops by itself two minutes after the last read. A closed page means no traffic to the
cluster. The tab's own check (`/api/cluster?peek=1`) reads `cluster.json` and nothing else.

## Whether the cluster can be reached at all

Each poll ends with a verdict, `reach` in `/api/cluster`, and the time of the last
`reachable` poll, `lastReachedAt`:

| `reach` | When | The page |
|---|---|---|
| `reachable` | at least one node answered | the tiles |
| `nodes-down` | none answered, but a host refused a connection: the network path exists | the tiles, under a banner that no node answers |
| `unreachable` | none answered and none refused: every request timed out or found no route | one notice — *not reachable from this machine*, last reached — and no tiles |

`unreachable` is what a cluster on a private network looks like from outside it (off VPN).
The page polls on, and fills in with the first poll that reaches a node.

## What a history card is

| Card | When | Colour |
|---|---|---|
| offload | a routing row with `offloaded` whose host is a node | faint sky blue |
| agent model | any other routing row whose host is a node | faint indigo |
| … with adapter | the row's model is one a node's gateway lists with a `parent` (its base model) | the same colour, dashed frame |
| LLM job | a job a status service reports with `kind: "llm"` | faint blue |
| non-LLM job | a job with `kind: "other"`, or no kind | faint green |

A routing row counts as `offloaded` only when a provider other than the agent's own
answered; a row whose offload target failed and whose own provider answered is `fell back`.

Jobs come from the job log (`jobLog` in `/api/cluster`): every job a status service
reported while the page was open, with when it was first and last seen — at most 200,
in memory only.

**Gateways healthy** counts out of the nodes whose gateway has answered at least once
since the daemon started (`summary.gateways`), so a node without a gateway does not count,
and losing the network does not shrink the count.

`host` is optional: a status service from before it was added sends none, and the tile then
shows the GPUs only. RAM used is total minus available, so page cache the kernel can drop
counts as free.

The daemon keeps the last 240 samples per node (an hour at 15 s) in memory for the
sparklines and a clicked node's charts — nothing about the cluster is written to disk.

## The files

| File | Holds | Rules |
|---|---|---|
| `~/.glass/cluster.json` | `nodes` (`name`, `host`), `gatewayPort` (default 8000), `statusPort` (default 8099) | invalid nodes are skipped and named on the page; at most 256 nodes |
| `~/.glass/cluster.key` | the gateways' API key, alone | sent only to `/v1/models` — and by [offload](offload.md), when its endpoint is one of these gateways |
| `~/.glass/cluster-status.key` | the status services' key, alone — a separate secret | sent only to `/status` |

Both key files are optional and owner-only: one other users can read is **refused**
(`chmod 600`) and the page names it, while the other key keeps working. Neither is ever
logged or returned by any route; the view only says whether each is set
(`keySet`, `statusKeySet`). With neither, only `/health` is asked. Private addresses are
reached directly, never through a corporate proxy (as the offload endpoint is).

## How a call becomes a routing row

Every call the offload router looks at is a row in the token database with its decision
(see [Offload Easy Calls](offload.md)):

| Decision | Recorded as | Shown |
|---|---|---|
| **offloaded** | `offloaded_from` = the agent's own provider; `upstream` = the endpoint | the model and host that answered, the provider it replaced |
| **fell back** | `attempt_trail.attempts` — the endpoint, its error class, how long it took | the failure, and the provider that answered instead |
| **kept** | `attempt_trail.offloadSkipped` — the gate that kept it | the reason (band not ticked, too large, busy, tool results…) |
| **routed** | another routing row (coding's proxy, where its figures are included) | the skipped candidates |

The band column says which band applied and who decided it (`caller`, `classifier`,
`turn`, `session`). Click a row for its tokens, route key, the classifier's note and the
full trail.

On the Cluster page a row lights the node whose **host** it was sent to. A node's gateway
may hand the call to a backend on another node; glass sees the gateway it addressed, not
the backend behind it.

## Routes

| Route | Answers |
|---|---|
| `GET /api/cluster` | `{ configured: false }`, or every node with `up`, `gateway`, `models`, `status`, `lastSeen`, `history`, plus `summary` |
| `GET /api/cluster?peek=1` | `{ configured }` |
| `GET /api/routing?hours=N&limit=M` | `{ available, counts, truncated, rows }` — decisions of the last N hours (0 = all), newest first |

Both are read-only; there is nothing to write from the UI.
