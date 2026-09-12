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
( cd "$SRC" && node tools/verify-digests.cjs        >/dev/null ) && echo "    digests        ok"
( cd "$SRC" && node tools/check-consistency.cjs     >/dev/null ) && echo "    consistency    ok"
( cd "$SRC" && node tools/test-slash-obligations.cjs >/dev/null ) && echo "    obligations    ok"
( cd "$SRC/conformance" && node run-all.js          >/dev/null ) && echo "    conformance    ok"

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
