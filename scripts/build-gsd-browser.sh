#!/usr/bin/env bash
# Build gsd-browser from its tagged source with the chromiumoxide fix applied,
# and install it where bin/gsd-browser looks for it.
#
# Why a local build: the prebuilt gsd-browser 0.2.1 is built on chromiumoxide
# 0.9.1, which never dispatches Page.frameStoppedLoading. A same-document
# navigation (page.html#1 -> page.html#2) therefore never gets "load" back,
# `navigate` hangs for 30 s and fails with "timeout reading response from
# daemon", and every later command queues behind it. The one-line fix is
# integrations/gsd-browser/chromiumoxide-frame-stopped-loading.patch; it is
# applied to the exact chromiumoxide release gsd-browser's Cargo.lock pins.
#
# The result reports its version as <pin>+frame-stopped-loading, which is how
# install.sh tells it apart from the stock binary. A side effect worth having:
# gsd-browser restarts a daemon whose version differs from the CLI's, so
# swapping binaries never leaves the old daemon serving.
#
# Usage: scripts/build-gsd-browser.sh [version-pin]   (default 0.2.1)
# Needs cargo (rustup) and git; uses the network for the clone and crates.
set -euo pipefail

PIN="${1:-${GSD_BROWSER_VERSION_PIN:-0.2.1}}"
MARK="frame-stopped-loading"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PATCH="${REPO_DIR}/integrations/gsd-browser/chromiumoxide-frame-stopped-loading.patch"
SRC="${HOME}/.gsd-browser/src"
GSD_SRC="${SRC}/gsd-browser"
DEST="${GSD_BROWSER_BIN:-${HOME}/.gsd-browser/bin/gsd-browser}"

die() { echo "build-gsd-browser: $*" >&2; exit 1; }

# rustup from Homebrew is keg-only and not on PATH; ~/.cargo/bin is where
# rustup-init puts it. Either counts.
for d in /opt/homebrew/opt/rustup/bin /usr/local/opt/rustup/bin "${HOME}/.cargo/bin"; do
    [[ -x "${d}/cargo" ]] && PATH="${d}:${PATH}"
done
command -v cargo >/dev/null || die "cargo not found (install rustup: brew install rustup && rustup default stable)"
command -v git >/dev/null || die "git not found"
[[ -f "$PATCH" ]] || die "patch missing: $PATCH"

mkdir -p "$SRC"

# Source at the pinned tag. An existing checkout at that tag is reset rather
# than re-cloned, which keeps target/ so the other dependencies are not
# recompiled (a rebuild is ~2 min instead of ~4).
if [[ -d "${GSD_SRC}/.git" ]] && [[ "$(git -C "$GSD_SRC" describe --tags --exact-match 2>/dev/null)" == "v${PIN}" ]]; then
    git -C "$GSD_SRC" checkout -q -- .
else
    rm -rf "$GSD_SRC"
    git clone -q --depth 1 --branch "v${PIN}" https://github.com/open-gsd/gsd-browser.git "$GSD_SRC"
fi

# The chromiumoxide release the lockfile pins, verified against the lockfile's
# checksum, so the patch lands on exactly the code upstream ships.
CO_VER="$(awk '/^name = "chromiumoxide"$/{getline; gsub(/version = |"/,""); print; exit}' "${GSD_SRC}/Cargo.lock")"
CO_SUM="$(awk '/^name = "chromiumoxide"$/{f=1} f&&/^checksum/{gsub(/checksum = |"/,""); print; exit}' "${GSD_SRC}/Cargo.lock")"
[[ -n "$CO_VER" && -n "$CO_SUM" ]] || die "chromiumoxide not found in ${GSD_SRC}/Cargo.lock"
CO_DIR="${SRC}/chromiumoxide-${CO_VER}"
CRATE="${SRC}/chromiumoxide-${CO_VER}.crate"
curl -fsSL -o "$CRATE" "https://static.crates.io/crates/chromiumoxide/chromiumoxide-${CO_VER}.crate"
GOT="$(shasum -a 256 "$CRATE" | awk '{print $1}')"
[[ "$GOT" == "$CO_SUM" ]] || die "chromiumoxide ${CO_VER} checksum mismatch: got ${GOT}, Cargo.lock says ${CO_SUM}"
rm -rf "$CO_DIR"
tar -xzf "$CRATE" -C "$SRC"
rm -f "$CRATE"
patch -s -p1 -d "$CO_DIR" < "$PATCH" || die "patch does not apply to chromiumoxide ${CO_VER}; check whether upstream already has the fix"

# Point the workspace at the patched crate and mark the version.
printf '\n[patch.crates-io]\n# Dispatch Page.frameStoppedLoading (see coding/%s).\nchromiumoxide = { path = "../chromiumoxide-%s" }\n' \
    "integrations/gsd-browser/$(basename "$PATCH")" "$CO_VER" >> "${GSD_SRC}/Cargo.toml"
sed -i.orig "s/^version = \"${PIN}\"$/version = \"${PIN}+${MARK}\"/" "${GSD_SRC}/cli/Cargo.toml"
rm -f "${GSD_SRC}/cli/Cargo.toml.orig"
grep -q "^version = \"${PIN}+${MARK}\"$" "${GSD_SRC}/cli/Cargo.toml" || die "could not set the version in cli/Cargo.toml"

echo "Building gsd-browser ${PIN}+${MARK} (a few minutes on first build)..."
cargo build --release -p gsd-browser --manifest-path "${GSD_SRC}/Cargo.toml"
BUILT="${GSD_SRC}/target/release/gsd-browser"
"$BUILT" --version | grep -q -- "+${MARK}" || die "built binary does not report +${MARK}"

# Stop the running daemon so the old binary is not left serving.
[[ -x "$DEST" ]] && "$DEST" daemon stop >/dev/null 2>&1 || true
mkdir -p "$(dirname "$DEST")"
install -m 755 "$BUILT" "$DEST"
echo "Installed $("$DEST" --version) to ${DEST}"
