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
files in ../, no re-copy needed).

`upper.json` used to be a real file here that had to be REGENERATED whenever
the host upper or the bundled LearningArtifact changed. It is a symlink now
(2026-09-20). The regeneration step was a standing trap: the host
`../upper.json` carried 14 classes and this copy carried those 14 plus
LearningArtifact, so the two drifted silently and a process reading the host
file got a registry with no Observation/Digest/Insight class in it. The merge
was applied to `../upper.json` itself, so there is one file, one content, and
nothing to regenerate.

Writer safety: because this is a superset, the writer keeps every class it had.
Verified via OntologyRegistry pre-flight (49 classes, parent chains resolve) +
a live writer smoke-test (POST /api/observations/messages → observations:1).
