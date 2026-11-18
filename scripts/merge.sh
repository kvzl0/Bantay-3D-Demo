#!/bin/sh
# Merge a feature branch into main with Kiev Gonzales (kvzl0) as BOTH author and
# committer of the merge commit. Use this instead of GitHub's merge button, which
# records "GitHub" as the committer. Sets the identity per command via environment
# variables and never edits any git config file.
#
# Usage:
#   npm run merge -- feat/my-branch
#   sh scripts/merge.sh feat/my-branch
#
# Pushing the merged main to GitHub marks the branch's open pull request as merged.
set -eu

AUTHOR_NAME="Kiev Gonzales"
AUTHOR_EMAIL="kvzl0@users.noreply.github.com"
BRANCH="${1:-}"

if [ -z "$BRANCH" ]; then
  echo "Usage: sh scripts/merge.sh <branch>" >&2
  exit 1
fi

git fetch origin
git checkout main
git merge --ff-only origin/main

GIT_AUTHOR_NAME="$AUTHOR_NAME" \
GIT_AUTHOR_EMAIL="$AUTHOR_EMAIL" \
GIT_COMMITTER_NAME="$AUTHOR_NAME" \
GIT_COMMITTER_EMAIL="$AUTHOR_EMAIL" \
  git merge --no-ff "origin/$BRANCH" -m "Merge branch '$BRANCH'"

git log -1 --format='Merged as %h by %an <%ae> (committer: %cn <%ce>)'
echo "Review, then publish with: git push origin main"
