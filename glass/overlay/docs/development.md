# Development & Releases

The glass repository is generated. Changes go into its source repositories, then a new
extraction.

=== "⚡ Quick (~3 min)"

    ## How a change ships

    1. Change the code in `coding` (or `rapid-llm-proxy`), including these docs
       (`glass/overlay/docs/` in coding).
    2. `node scripts/glass/extract.mjs --target bmw --publish <glass checkout>` opens a pull request in
       AIMAAD/glass.
    3. CI runs: tests, install check, provenance, docs build, Wiz scans.
    4. Merge → a new `package.json` version publishes a release; changed docs publish
       this site.

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/development.deep.md"
