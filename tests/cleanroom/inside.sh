#!/usr/bin/env bash
# tests/cleanroom/inside.sh — the clean-room isolation test, container side.
#
# Started by tests/cleanroom/run.sh in a throwaway container as a non-root user
# whose HOME has never seen `coding`. Answers one question with a measurement
# rather than an argument:
#
#   Can someone clone these tools, install them under their own scope, use
#   them, and leave no trace on any other tenant's data?
#
# Phases:
#   1. plant a SENTINEL tenant (`coding`) in the same HOME and checksum it — the
#      strongest available stand-in for "the developer's data": every code path
#      that still addresses the `coding` tenant by literal lands on it
#   2. ./install.sh --ci --scope=team-a --features=km-perf, from a fresh clone
#   3. drive the writers with no agent and no LLM: the launch-time history
#      init, session logs for an outside project AND for the tools repo itself,
#      and an entity written through obs-api
#   4. assert where every byte went
#
# Prints one PASS/FAIL line per assertion and exits non-zero on any FAIL.
set -uo pipefail

SCOPE=team-a
TOOLS="$HOME/coding"
PROJECT="$HOME/work/project-x"
DATA="$HOME/.coding/data"
SENTINEL="$DATA/coding"
OUT="${CLEANROOM_OUT:-/tmp/cleanroom}"
mkdir -p "$OUT"

fails=0
pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; fails=$((fails + 1)); }
step() { printf '\n── %s\n' "$*"; }

# Every file under a tree with its checksum, sorted — a byte-level fingerprint.
fingerprint() {
  (cd "$1" && find . -type f -print0 | sort -z | xargs -0 -r sha256sum)
}

# Every file under HOME except the tools checkout, the outside project and
# package-manager caches, which are the installer's documented business.
home_files() {
  (cd "$HOME" && find . \( -path ./coding -o -path ./work -o -path ./.npm -o -path ./.cache \
      -o -path ./.node-gyp -o -path ./.local/share/pnpm \) -prune -o \( -type f -o -type l \) -print | sort)
}

# ── 1. the sentinel tenant ──────────────────────────────────────────────────
step "1. sentinel tenant '$SENTINEL'"
mkdir -p "$SENTINEL/history/2026/10" "$SENTINEL/kb/exports" "$SENTINEL/var/knowledge-graph"
echo "the developer's session"            > "$SENTINEL/history/2026/10/2026-10-01_0900-1000_dev.md"
echo '{"entities":[{"name":"DevOnly"}]}' > "$SENTINEL/kb/exports/coding.json"
echo "leveldb stand-in"                   > "$SENTINEL/var/knowledge-graph/CURRENT"
fingerprint "$SENTINEL" > "$OUT/sentinel.before"
home_files > "$OUT/home.before"

# ── 2. the install ──────────────────────────────────────────────────────────
step "2. ./install.sh --ci --scope=$SCOPE --features=km-perf"
cd "$TOOLS"
git status --porcelain --ignored > "$OUT/tools.before"
./install.sh --ci --scope="$SCOPE" --features=km-perf > "$OUT/install.log" 2>&1
echo "installer exit=$? (--ci downgrades missing Docker/agents to warnings)"
tail -25 "$OUT/install.log"

[ "$(sed -n '/^[^#]/{p;q}' "$HOME/.coding/scope" 2>/dev/null)" = "$SCOPE" ] \
  && pass "~/.coding/scope names $SCOPE" || fail "~/.coding/scope does not name $SCOPE"

# The installer's PATH additions are in the rc file, not this shell.
export CODING_REPO="$TOOLS"
export PATH="$TOOLS/bin:$PATH"
DH="$("$TOOLS/bin/coding-data-home")"
[ "$DH" = "$DATA/$SCOPE" ] && pass "data home resolves to $DATA/$SCOPE" \
  || fail "data home resolves to '$DH', not $DATA/$SCOPE"

# ── 3. drive the writers ────────────────────────────────────────────────────
step "3a. launch-time history init (what bin/coding runs on every start)"
"$TOOLS/bin/init-history.sh"

step "3b. session logs from a synthetic transcript"
# One complete exchange, in the shape Claude Code writes. Synthetic on purpose:
# a real transcript would be personal data in a test fixture.
mk_transcript() {  # <cwd> <session-id> <file>
  # The session id is repeated in the prompt text on purpose: LSL output keeps
  # the conversation, not the transcript's ids, so the prompt is the probe.
  local cwd="$1" sid="$2" f="$3" t0 t1
  t0="$(date -u -d '-2 min' +%Y-%m-%dT%H:%M:%S.000Z)"
  t1="$(date -u -d '-1 min' +%Y-%m-%dT%H:%M:%S.000Z)"
  cat > "$f" <<EOF
{"type":"user","uuid":"u-$sid","parentUuid":null,"sessionId":"$sid","cwd":"$cwd","timestamp":"$t0","message":{"role":"user","content":"cleanroom probe $sid: list the files in this directory"}}
{"type":"assistant","uuid":"a-$sid","parentUuid":"u-$sid","sessionId":"$sid","cwd":"$cwd","timestamp":"$t1","message":{"role":"assistant","model":"claude-test","content":[{"type":"text","text":"cleanroom probe answer: there are no files here."}]}}
EOF
}
mkdir -p "$PROJECT" && git -C "$PROJECT" init -q 2>/dev/null
mkdir -p "$OUT/transcripts"
mk_transcript "$PROJECT" "cleanroom-outside" "$OUT/transcripts/outside.jsonl"
mk_transcript "$TOOLS"   "cleanroom-tools"   "$OUT/transcripts/tools.jsonl"
(cd "$PROJECT" && PROJECT_PATH="$PROJECT" node "$TOOLS/scripts/batch-lsl-processor.js" recover "$OUT/transcripts/outside.jsonl") \
  > "$OUT/lsl-outside.log" 2>&1 || true
(cd "$TOOLS" && PROJECT_PATH="$TOOLS" node "$TOOLS/scripts/batch-lsl-processor.js" recover "$OUT/transcripts/tools.jsonl") \
  > "$OUT/lsl-tools.log" 2>&1 || true

step "3c. an entity written through obs-api"
OBS_PORT=12436
(cd "$TOOLS" && node scripts/observations-api-server.mjs > "$OUT/obs-api.log" 2>&1) &
OBS_PID=$!
for _ in $(seq 1 90); do curl -sf "localhost:$OBS_PORT/health" >/dev/null && break; sleep 2; done
if curl -sf "localhost:$OBS_PORT/health" >/dev/null; then
  curl -s -X POST -H 'content-type: application/json' "localhost:$OBS_PORT/api/v1/entities" \
    -d '{"name":"CleanroomProbeEntity","entityType":"KnowledgeEntity","observations":["written by the clean-room test"]}' \
    > "$OUT/entity-post.json"
  echo "POST → $(head -c 300 "$OUT/entity-post.json")"
  sleep 8   # past the store's 5s export debounce
else
  echo "obs-api never answered /health — see $OUT/obs-api.log"
fi
kill "$OBS_PID" 2>/dev/null; wait "$OBS_PID" 2>/dev/null

# ── 4. where did it all go ──────────────────────────────────────────────────
step "4. assertions"

fingerprint "$SENTINEL" > "$OUT/sentinel.after"
diff -q "$OUT/sentinel.before" "$OUT/sentinel.after" >/dev/null \
  && pass "the sentinel tenant is byte-identical" \
  || { fail "the sentinel tenant changed:"; diff "$OUT/sentinel.before" "$OUT/sentinel.after" | head -20; }

[ ! -e "$DATA/default" ] && pass "nothing was filed under the placeholder scope" \
  || fail "a data home exists for the placeholder: $DATA/default"

# History: the tools repo's own slot is a symlink into this scope's data home.
link="$TOOLS/.specstory/history"
if [ -L "$link" ] && [ "$(readlink "$link")" = "$DH/history" ]; then
  pass ".specstory/history → $DH/history"
else
  fail ".specstory/history is not a symlink into $DH/history ($(ls -ld "$link" 2>&1))"
fi

# Session logs: each landed with its own project, and only there.
has_probe() { grep -rlF "$1" "$2" 2>/dev/null | grep -v '/logs/' | head -1; }
f="$(has_probe 'cleanroom-outside' "$PROJECT/.specstory/history")"
[ -n "$f" ] && pass "the outside project's session landed in the outside project ($f)" \
  || fail "the outside project's session is not in $PROJECT/.specstory/history (see lsl-outside.log)"
[ -z "$(has_probe 'cleanroom-outside' "$DH/history")" ] \
  && pass "the outside project's session was NOT redirected into the tools history" \
  || fail "the outside project's session was redirected into $DH/history"
f="$(has_probe 'cleanroom-tools' "$DH/history")"
[ -n "$f" ] && pass "the tools repo's session landed in this scope's data home ($f)" \
  || fail "the tools repo's session is not in $DH/history (see lsl-tools.log)"

# Knowledge: the entity is in this scope's data home and nowhere else.
f="$(grep -rlF 'CleanroomProbeEntity' "$DH" 2>/dev/null | head -1)"
[ -n "$f" ] && pass "the entity was persisted under this scope's data home ($f)" \
  || fail "the entity is not anywhere under $DH (see obs-api.log)"
# tests/cleanroom/ itself names the probe, so it cannot count as a leak.
f="$(grep -rlF 'CleanroomProbeEntity' "$TOOLS" "$SENTINEL" 2>/dev/null | grep -v -e '/node_modules/' -e '/tests/cleanroom/' | head -3)"
[ -z "$f" ] && pass "the entity is nowhere in the tools checkout or the sentinel" \
  || fail "the entity leaked to: $f"

# No entity this install wrote claims the developer's tenant.
f="$(grep -rlE '"team" *: *"coding"' "$DH" 2>/dev/null | head -3)"
[ -z "$f" ] && pass "no file in this scope's data home carries team \"coding\"" \
  || fail "team \"coding\" appears in: $f"

# HOME: every new file is one the mutation manifest declares.
home_files > "$OUT/home.after"
comm -13 "$OUT/home.before" "$OUT/home.after" > "$OUT/home.new"
grep -vE "^\./(\.coding/scope|\.coding/features\.yaml|\.coding/data/$SCOPE/|bin/coding$|\.bashrc$|\.profile$|\.bash_profile$|\.zshrc$|\.gsd-browser/)" \
  "$OUT/home.new" > "$OUT/home.undeclared" || true
[ ! -s "$OUT/home.undeclared" ] \
  && pass "every new file under HOME is declared in the mutation manifest ($(wc -l < "$OUT/home.new") new)" \
  || { fail "files under HOME the manifest does not declare:"; head -30 "$OUT/home.undeclared"; }

# The tools checkout: no tracked file changed, and no user data accumulated in it.
cd "$TOOLS"
modified="$(git status --porcelain | grep -E '^( M|M |MM| D|D )' || true)"
[ -z "$modified" ] && pass "no tracked file in the tools checkout was modified" \
  || { fail "tracked files modified by install/use:"; echo "$modified" | head -20; }
user_trees="$(for d in .data/knowledge-graph .data/knowledge-export .data/exports .data/observation-export \
                        .data/measurements .data/run-snapshots .data/token-usage.db; do
                [ -e "$d" ] && echo "$d"; done)"
[ -z "$user_trees" ] && pass "no user-data tree was created inside the tools checkout" \
  || { fail "user data written into the tools checkout:"; echo "$user_trees"; }
git status --porcelain --ignored > "$OUT/tools.after"

printf '\n%s\n' "────────────────────────────────────────"
if [ "$fails" -eq 0 ]; then echo "CLEAN ROOM: all assertions passed"; else echo "CLEAN ROOM: $fails assertion(s) FAILED"; fi
exit "$fails"
