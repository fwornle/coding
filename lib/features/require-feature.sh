#!/usr/bin/env bash
# Guard a CLI on its feature.
#
# Sourced by the bin/ shims that front a feature-owned service. Without it, a
# CLI for a switched-off feature fails with whatever its backend happens to say
# — "connection refused", "no such container", a 30-second timeout — and none of
# those tell the user the one thing they need to know, which is that they turned
# it off and how to turn it back on.
#
# Usage, immediately after the shebang and CODING_REPO resolution:
#
#   source "$CODING_REPO/lib/features/require-feature.sh"
#   require_feature knowledge
#
# Exit status 2 (not 1) so a caller can distinguish "this feature is off" from
# the wrapped command's own failures.
#
# See docs/architecture/features.md.

require_feature() {
  local feature="$1"
  local repo="${CODING_REPO:-}"

  # No repo, no resolver: say nothing and carry on. A guard that blocks the
  # command because it could not find its own helper is worse than no guard.
  [ -n "$repo" ] || return 0
  [ -x "$repo/bin/coding-features" ] || return 0
  command -v node >/dev/null 2>&1 || return 0

  if node "$repo/bin/coding-features" enabled "$feature" >/dev/null 2>&1; then
    return 0
  fi

  # `enabled` exits 1 for "off" and prints nothing. It also resolves closed on a
  # malformed config — which is the right answer here, because the user is about
  # to reach a service that the launcher would equally have refused to start.
  local reason
  reason="$(node "$repo/bin/coding-features" explain "$feature" 2>/dev/null | tail -n +2 | head -1 | sed 's/^ *//')"

  {
    echo "This command needs the '${feature}' feature, which is switched off."
    [ -n "$reason" ] && echo "  ${reason}"
    echo
    echo "  Turn it on:  coding-features set ${feature} on"
    echo "  See what is on:  coding-features status"
  } >&2
  exit 2
}
