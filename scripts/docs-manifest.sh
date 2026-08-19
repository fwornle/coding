#!/usr/bin/env bash
# Content hash of everything mkdocs renders, with SYMLINKS RESOLVED.
#
# The point of `find -L` is the whole point of this script. Several files under
# docs-content/ are symlinks into docs/ (e.g. benchmarks/coding-v1/RESULTS.md), so a hash
# of the symlinks themselves is constant while the pages they render change. `-L` follows
# them and hashes the CONTENT that will actually be published.
#
# Used in two places that must agree exactly:
#   - deploy-docs.yml build job, which publishes the result as .docs-manifest in the site
#   - deploy-docs.yml freshness job, which compares the live .docs-manifest against this
#
# One implementation rather than two inline pipelines, because the guard is only as good as
# the two hashes being computed identically — a drift between them makes it either
# permanently red or permanently useless.
set -euo pipefail
cd "$(dirname "$0")/.."

{
  # `git ls-files`, NOT `find`. The digest must be a function of the REPOSITORY, not of the
  # working directory it happens to be computed in — otherwise the two sides disagree for
  # reasons that have nothing to do with the site.
  #
  # Found the hard way: `find -L docs-content -type f` counted 366 files on a macOS checkout
  # against 361 in CI. The five extras were gitignored .DS_Store files, so the guard's first
  # live comparison reported a mismatch that meant nothing — a false alarm, which is the one
  # thing a guard must not produce if it is to stay enabled.
  #
  # sha256sum FOLLOWS symlinks when handed a path, so listing the tracked symlink still
  # hashes the bytes it resolves to — which is what preserved the property this whole guard
  # exists for (docs-content/**/RESULTS.md -> docs/**/RESULTS.md).
  #
  # Paths are in the digest too, so a rename or deletion moves the hash even when the
  # surviving bytes do not.
  git ls-files -z docs-content | LC_ALL=C sort -z | xargs -0 sha256sum
  sha256sum mkdocs.yml
} | sha256sum | cut -d' ' -f1
