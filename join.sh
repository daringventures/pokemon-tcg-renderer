#!/usr/bin/env bash
# Join the Pokemon TCG game from any repo.
# Run once per repo. Idempotent — safe to re-run.

set -e

GAME_REPO="daringventures/pokemon-tcg-renderer"
WORKFLOW_URL="https://raw.githubusercontent.com/${GAME_REPO}/main/.github/workflows/participant.yml"
WORKFLOW_DIR=".github/workflows"
WORKFLOW_FILE="${WORKFLOW_DIR}/participant.yml"

# Check we're in a git repo
if ! git rev-parse --git-dir > /dev/null 2>&1; then
  echo "Not a git repo. Run this from the root of a repository."
  exit 1
fi

# Drop the workflow file
mkdir -p "$WORKFLOW_DIR"
curl -sf "$WORKFLOW_URL" -o "$WORKFLOW_FILE"
echo "✓ ${WORKFLOW_FILE}"

# Check for the dispatch token
if gh secret list 2>/dev/null | grep -q TCG_DISPATCH_TOKEN; then
  echo "✓ TCG_DISPATCH_TOKEN already set"
else
  echo ""
  echo "One more step: add your GitHub PAT as a repo secret."
  echo "Create a PAT at https://github.com/settings/tokens with 'repo' scope, then run:"
  echo ""
  echo "  gh secret set TCG_DISPATCH_TOKEN"
  echo ""
fi

echo ""
echo "Done. Merge a PR to earn cards. 🎴"
