#!/usr/bin/env bash
# coding — install from a release (published as the `coding-install.sh` asset).
#
#   curl -fsSL https://github.com/fwornle/coding/releases/latest/download/coding-install.sh | bash
#   curl -fsSL …/coding-install.sh | bash -s -- --features=learning     # installer options pass through
#
# What it does, and nothing else:
#   1. checks the prerequisites it needs itself (bash, curl, tar, a sha256 tool,
#      Node.js >= 22 — the installer checks the rest)
#   2. finds the latest release (the releases/latest REDIRECT, not the GitHub API:
#      the API allows 60 anonymous calls an hour per IP, which a shared corporate
#      egress uses up) — or CODING_VERSION=x.y.z pins one
#   3. downloads coding-<ver>.tar.gz + .sha256, verifies, unpacks into
#      ~/.coding/releases/<ver>/ and points ~/.coding/releases/current at it
#      (scripts/releases.mjs, lib/install/layout.cjs)
#   4. runs THAT release's install.sh through `current` — the tier menu, the
#      prerequisites, the service registration all live there, and everything it
#      stores names `current`, so `coding update` can replace the release later.
#
# A development checkout (git clone + ./install.sh) does not use this.
#
# Environment: CODING_VERSION (pin), CODING_RELEASE_URL (another release server;
# file:// works — the tests use it), CODING_HOME (instead of $HOME).
set -euo pipefail

BASE="${CODING_RELEASE_URL:-https://github.com/fwornle/coding/releases}"
BASE="${BASE%/}"
HOME_DIR="${CODING_HOME:-$HOME}"
export CODING_HOME="$HOME_DIR"   # scripts/releases.mjs reads it
REL="$HOME_DIR/.coding/releases"

say() { printf '%s\n' "coding-install: $*"; }
die() { printf '%s\n' "coding-install: $*" >&2; exit 1; }

# ── 1. prerequisites ─────────────────────────────────────────────────────────
for t in curl tar; do command -v "$t" >/dev/null 2>&1 || die "$t is required"; done
if command -v sha256sum >/dev/null 2>&1; then SHA=(sha256sum)
elif command -v shasum >/dev/null 2>&1; then SHA=(shasum -a 256)
else die "sha256sum or shasum is required to verify the download"; fi
command -v node >/dev/null 2>&1 || die "Node.js >= 22 is required (https://nodejs.org)"
node_major="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$node_major" -ge 22 ]] || die "Node.js >= 22 is required (found $(node --version))"

# ── 2. which release ─────────────────────────────────────────────────────────
version="${CODING_VERSION:-}"
if [[ -z "$version" ]]; then
    # -w appends "\n<redirect target>"; github answers with a redirect to
    # …/tag/v<x.y.z>, a file:// server with a body holding the tag.
    out="$(curl -fsS --retry 4 --retry-delay 2 -w '\n%{redirect_url}' "$BASE/latest")" \
        || die "could not reach $BASE/latest"
    target="${out##*$'\n'}"
    body="${out%$'\n'*}"
    if [[ "$target" =~ /tag/v([^/?#]+)$ ]]; then version="${BASH_REMATCH[1]}"
    else version="$(printf '%s' "$body" | tr -d '[:space:]')"; version="${version#v}"; fi
fi
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || die "no usable release version (got '${version}')"
say "release $version"

# ── 3. download, verify, unpack, activate ────────────────────────────────────
if [[ -f "$REL/$version/release.json" ]]; then
    say "release $version is already unpacked"
    node "$REL/$version/scripts/releases.mjs" use "$version" >/dev/null
else
    tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
    name="coding-$version.tar.gz"
    for f in "$name" "$name.sha256"; do
        curl -fsSL --retry 3 -o "$tmp/$f" "$BASE/download/v$version/$f" || die "download failed: $BASE/download/v$version/$f"
    done
    want="$(cut -d' ' -f1 < "$tmp/$name.sha256")"
    got="$("${SHA[@]}" "$tmp/$name" | cut -d' ' -f1)"
    [[ -n "$want" && "$want" == "$got" ]] || die "checksum mismatch for $name (expected $want, got $got)"
    say "downloaded $name, checksum ok"
    mkdir -p "$tmp/u"
    tar -xzf "$tmp/$name" -C "$tmp/u"
    tree="$tmp/u/coding-$version"
    [[ -f "$tree/release.json" ]] || die "$name is not a release (no release.json)"
    node "$tree/scripts/releases.mjs" adopt "$tree" >/dev/null
    node "$REL/$version/scripts/releases.mjs" use "$version" >/dev/null
fi
CUR="$REL/current"
say "installed in $REL/$version (current -> $version)"

# ── 4. the release's own installer, through current ──────────────────────────
# Through `current`: install.sh keeps its logical location, so the shell rc,
# ~/bin/coding, agent settings and daemons all name `current`. CODING_REPO is set
# to the same path, or install.sh would treat an inherited one as another
# install and switch to sandbox mode. Piped from curl, stdin is this script —
# give the installer the terminal when there is one, so the tier menu can ask.
cd "$CUR"
export CODING_REPO="$CUR"
if [[ ! -t 0 && -r /dev/tty ]] && (exec </dev/tty) 2>/dev/null; then
    exec bash ./install.sh "$@" </dev/tty
fi
exec bash ./install.sh "$@"
