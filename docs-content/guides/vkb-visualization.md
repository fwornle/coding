# VKB Visualization

The knowledge graph in a browser — how to open the viewer, what it shows, and what to check
when it shows nothing.

=== "⚡ Quick (~3 min)"

    ## Open it

    ```bash
    vkb
    ```

    That opens [127.0.0.1:3032/viewer/coding](http://127.0.0.1:3032/viewer/coding), served by
    the coding-services container — nothing to build or start on your machine.

    ```bash
    vkb okb          # the operational knowledge base (VOKB) instead
    vkb --no-open    # just print the URL
    ```

    `vkb` needs the `knowledge` feature (the `learning` tiers), which runs the container
    anyway. The page reads its graph from obs-api (`:12436`) on your machine.

    ## What you see

    ![Knowledge Graph Viewer](../images/viewer.png)

    Entities as a graph — projects, components, insights, details — filterable by team, type,
    learning source and detail level. Click a node for its details and relations; where an
    entity has a full insight document, a button opens it rendered, with diagrams.

    ## Teams

    The **Teams / Views** rail on the left starts from the selection in **Dashboard → Teams**
    and changes it both ways. See [Teams & Shared Learning](teams.md).

=== "📖 Standard (~15 min)"

    ## How it is served

    The viewer is a static single-page app (`integrations/unified-viewer`). The
    coding-services image builds it, and the dashboard frontend in the container (`:3032`)
    serves the build under `/viewer/`, every viewer route falling back to the app's shell. The
    app reads its data from obs-api (`:12436`) on the host. `vkb`:

    1. checks the `knowledge` feature is on (`coding-features status`);
    2. checks the container serves the viewer on `:3032` — and says to rebuild the image when
       the container is older than the viewer;
    3. warns if obs-api does not answer on `:12436` (the page would open empty);
    4. opens `http://127.0.0.1:3032/viewer/<system>` (macOS `open`, Linux `xdg-open`, WSL
       `wslview`; otherwise it prints the URL).

    ## Exploring the graph

    ![Node Details Panel](../images/viewer-details.png)

    | Panel | Does |
    |---|---|
    | Filters (left) | search, detail level (Full · Overview · Summary), legend, teams / projects / views, ontology class, source |
    | Canvas | the graph; drag to pan, scroll to zoom, click a node to select it |
    | Entity / History (right) | the selected node's details, or the newest insights |
    | Timeline (bottom) | when knowledge was learned; click a bar to jump to it |

    [Reading the Graph](viewer-detail-levels.md) explains the detail levels.

    ## When it shows nothing

    | Symptom | Check |
    |---|---|
    | "This command needs the 'knowledge' feature" | `coding-features set knowledge on` (or a learning tier) |
    | `nothing answers on :3032` | `docker ps` — is coding-services up? Is `health` on? |
    | `has no viewer build — its image predates it` | rebuild the image: `docker compose -f docker/docker-compose.yml build coding-services`, then `up -d coding-services` |
    | `obs-api is not answering on :12436` | `curl -s localhost:12436/health`; Dashboard → Health |
    | "Showing 0 of 0 nodes" for a long time | `curl -s 'localhost:12436/api/v1/entities?limit=1'` — is the store hydrated? |
    | Old UI after an update | the image builds the viewer — rebuild it (as above) |

    ## Developing the viewer

    ```bash
    cd integrations/unified-viewer
    npm run dev            # http://127.0.0.1:5173/viewer/coding, hot reload
    npm test               # vitest
    ```

    The dev server reads the same obs-api. What everyone else sees is the image's build, so a
    change to the viewer reaches `vkb` with the next image build.

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/guides/vkb-visualization.deep.md"
