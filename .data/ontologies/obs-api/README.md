# obs-api curated ontology dir (Gap A, 2026-06-19)

obs-api's GraphKMStore loads ONE `ontologyDir`. The bundled km-core dir carries
only the LearningArtifact axis (LearningArtifact + Observation/Digest/Insight),
so the coding L1 (Component/SubComponent/Detail) and Phase-57 L2 classes never
reached `/api/v1/ontology/classes` and the viewer's OntologyFilter could not
render the L1→L2 hierarchy.

This dir is a strict SUPERSET of the bundled writer ontology:
- `upper.json`              — host upper (14) + LearningArtifact (merged, real file)
- `learning-artifacts.json` — Observation/Digest/Insight (copied from lib/km-core/ontology)
- `coding-ontology.json`    — symlink → ../coding-ontology.json  (L1 + coding lower classes)
- `coding.lower.json`       — symlink → ../coding.lower.json     (Phase-57 L2)
- `coding.display.json`     — symlink → ../coding.display.json   (display overlay, loader-skipped)

The symlinks keep the actively-maintained coding ontologies canonical (edit the
files in ../, no re-copy needed). Only `upper.json` must be regenerated if the
host upper.json or bundled LearningArtifact change:

    # merge host upper + bundled LearningArtifact into upper.json
    (see the build snippet in the Gap A commit message / observations-api-server.mjs KG_ONTOLOGY_DIR)

Writer safety: because this is a superset, the writer keeps every class it had.
Verified via OntologyRegistry pre-flight (49 classes, parent chains resolve) +
a live writer smoke-test (POST /api/observations/messages → observations:1).
