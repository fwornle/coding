# Vendored: js-yaml 4.1.0 (MIT)

`js-yaml.cjs` is `node_modules/js-yaml/dist/js-yaml.js` from js-yaml 4.1.0,
unmodified apart from the extension; `js-yaml.LICENSE` is its licence.

**Why it is vendored.** `lib/features` runs BEFORE `npm install`: install.sh
previews the selected profile for the `--dry-run` manifest, validates
`--features=…`, and resolves which install steps to skip, all ahead of the
dependency step. Resolved from `node_modules`, js-yaml did not exist yet on a
fresh clone, so every profile failed validation and the installer silently fell
back to installing everything — and every `skip_unless_feature` gate saw the
all-on fallback list. Found by the clean-room install test (tests/cleanroom).

`.cjs` because the root package is `"type": "module"` and this is a UMD build.
To update: copy the new `dist/js-yaml.js` here and bump the version above.
