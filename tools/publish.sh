#!/usr/bin/env bash
# publish.sh — the repeatable publish path for the reference kit.
#
# Why this exists (2026-09-12). This directory has never had a git remote.
# Publishing was a manual copy, which produced exactly the failures @0rkz caught
# and some he did not:
#   - four successive "frozen" implementation pins that were local-only commits,
#     fetchable by nobody, while being cited as frozen bilateral terms;
#   - a published verify-live.js hardcoding the RETIRED signing key while
#     printing that it verified against the live one;
#   - a local READINESS_REPORT still claiming F1 FAIL / bond $0 weeks after funding;
#   - a whole conformance suite published to GitHub that never existed locally.
#
# Drift in both directions at once is what "no source of truth" looks like.
# After this, publishing is one auditable command and drift is detectable with
# tools/check-published-sync.cjs.
#
# Usage:
#   ./tools/publish.sh                 # DRY RUN — shows exactly what would change
#   ./tools/publish.sh --commit "msg"  # stage + commit in the clone, still no push
#   ./tools/publish.sh --push   "msg"  # commit AND push to origin/main
#
# The push is externally visible, so it is never the default.
set -euo pipefail

REPO="git@github.com:stillmarcus24/notary-x402-reference-kit.git"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

MODE="dry"; MSG=""
case "${1:-}" in
  --commit) MODE="commit"; MSG="${2:?commit message required}" ;;
  --push)   MODE="push";   MSG="${2:?commit message required}" ;;
  "")       MODE="dry" ;;
  *) echo "unknown arg: $1" >&2; exit 2 ;;
esac

echo "==> gate: every check must pass before anything is published"
# Each check MUST abort the publish on failure. The previous form was
#   ( cmd >/dev/null ) && echo "    name ok"
# which does not abort under `set -e`: bash exempts a failing left-hand side of an
# && list from errexit, so a failing check merely skipped its own "ok" line and
# publishing continued. Found 2026-09-12 the hard way — check-consistency.cjs was
# failing on a stale manifest checksum and this gate published anyway, printing 3
# "ok" lines instead of 4. A gate whose failure mode is a MISSING line is not a
# gate. Explicit if/else + exit, and the check's own output is shown on failure
# instead of being swallowed by >/dev/null.
run_gate() {
  local name="$1"; shift
  local dir="$1"; shift
  local out status
  out="$( cd "$dir" && "$@" 2>&1 )" && status=0 || status=$?
  if [ "$status" -ne 0 ]; then
    echo "    $name FAILED (exit $status) — nothing published"
    echo "$out" | sed 's/^/      /'
    exit "$status"
  fi
  echo "    $name ok"
}
run_gate "digests    " "$SRC"            node tools/verify-digests.cjs
run_gate "consistency" "$SRC"            node tools/check-consistency.cjs
run_gate "obligations" "$SRC"            node tools/test-slash-obligations.cjs
run_gate "conformance" "$SRC/conformance" node run-all.js

echo "==> cloning $REPO"
git clone -q "$REPO" "$WORK/kit"

echo "==> syncing publishable files"
rsync -a --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'GITHUB-REPLY-*' \
  --exclude 'TSC-BRIEF-*' \
  --exclude '*-HOLD-FOR-APPROVAL.md' \
  --exclude 'docs/BOND_FUNDING_PROPOSAL.md' \
  "$SRC/" "$WORK/kit/"

cd "$WORK/kit"
echo "==> changes vs published main:"
git add -A
git --no-pager diff --cached --stat | sed 's/^/    /'

if [ "$MODE" = "dry" ]; then
  echo "==> DRY RUN — nothing committed, nothing pushed."
  echo "    re-run with --commit \"msg\" or --push \"msg\""
  exit 0
fi

if git diff --cached --quiet; then echo "==> nothing to publish"; exit 0; fi
git commit -q -m "$MSG"
echo "==> committed $(git rev-parse --short HEAD) in the clone"

if [ "$MODE" = "push" ]; then
  git push -q origin main
  echo "==> PUSHED to origin/main -> $(git rev-parse HEAD)"
else
  echo "==> not pushed (--commit only). Clone is discarded on exit; use --push to publish."
fi
