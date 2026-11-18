#!/bin/sh
# Commit helper for Bantay-3D-Demo.
# Every commit made through this script is authored AND committed by
# Kiev Gonzales (kvzl0), regardless of the machine's global git config.
# It sets the identity per command via environment variables and never
# edits any git config file.
#
# Usage:
#   npm run commit -- "feat: describe your change"
#   sh scripts/commit.sh "feat: describe your change"     (commits staged files)
#   sh scripts/commit.sh -a "fix: describe your change"   (stages all tracked changes first)
set -eu

AUTHOR_NAME="Kiev Gonzales"
AUTHOR_EMAIL="kvzl0@users.noreply.github.com"

if [ "${1:-}" = "-a" ]; then
  git add -u
  shift
fi

if [ -z "${1:-}" ]; then
  echo "Usage: sh scripts/commit.sh [-a] \"commit message\"" >&2
  exit 1
fi

GIT_AUTHOR_NAME="$AUTHOR_NAME" \
GIT_AUTHOR_EMAIL="$AUTHOR_EMAIL" \
GIT_COMMITTER_NAME="$AUTHOR_NAME" \
GIT_COMMITTER_EMAIL="$AUTHOR_EMAIL" \
  git commit -m "$1"

git log -1 --format='Committed %h as %an <%ae> (committer: %cn)'
