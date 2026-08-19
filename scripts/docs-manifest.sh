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
  # Paths are included in the digest, so a rename or deletion changes the hash even when
  # the surviving bytes do not.
  find -L docs-content -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum
  sha256sum mkdocs.yml
} | sha256sum | cut -d' ' -f1
