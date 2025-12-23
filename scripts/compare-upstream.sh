#!/bin/bash

# Compare current repo with upstream template
# Usage: ./scripts/compare-upstream.sh [--stat] [--files-only] [file-pattern]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
UPSTREAM_REMOTE="${UPSTREAM_REMOTE:-template}"
UPSTREAM_BRANCH="main"

# Parse arguments
SHOW_STAT=false
FILES_ONLY=false
FILE_PATTERN=""

for arg in "$@"; do
  case $arg in
    --stat)
      SHOW_STAT=true
      shift
      ;;
    --files-only)
      FILES_ONLY=true
      shift
      ;;
    *)
      if [ -z "$FILE_PATTERN" ]; then
        FILE_PATTERN="$arg"
      fi
      shift
      ;;
  esac
done

echo -e "${BLUE}🔍 Comparing with upstream: $UPSTREAM_REMOTE/$UPSTREAM_BRANCH${NC}\n"

# Fetch latest from upstream
echo -e "${BLUE}📥 Fetching latest from $UPSTREAM_REMOTE/$UPSTREAM_BRANCH...${NC}"
git fetch "$UPSTREAM_REMOTE" "$UPSTREAM_BRANCH" --quiet 2>&1 || {
  echo -e "${RED}❌ Error: Could not fetch from $UPSTREAM_REMOTE/$UPSTREAM_BRANCH${NC}"
  echo "Available remotes:"
  git remote -v
  exit 1
}

echo ""

# Build git diff command
if [ -n "$FILE_PATTERN" ]; then
  DIFF_CMD="git diff $UPSTREAM_REMOTE/$UPSTREAM_BRANCH -- '$FILE_PATTERN'"
else
  DIFF_CMD="git diff $UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
fi

# Show file list
if [ "$FILES_ONLY" = true ]; then
  echo -e "${BLUE}📄 Files with differences:${NC}\n"
  eval "$DIFF_CMD --name-only" 2>/dev/null | while read file; do
    if [ -n "$file" ]; then
      # Check if file exists in both branches
      if git cat-file -e "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH:$file" 2>/dev/null; then
        if [ -f "$file" ]; then
          echo -e "  ${YELLOW}~${NC} $file"
        else
          echo -e "  ${RED}-${NC} $file (deleted locally)"
        fi
      else
        if [ -f "$file" ]; then
          echo -e "  ${GREEN}+${NC} $file (new file)"
        fi
      fi
    fi
  done
  echo ""
  exit 0
fi

# Show summary stats
if [ "$SHOW_STAT" = true ]; then
  echo -e "${BLUE}📊 Summary of changes:${NC}\n"
  eval "$DIFF_CMD --stat"
  echo ""
  exit 0
fi

# Show full diff
echo -e "${BLUE}📋 Full diff:${NC}\n"
eval "$DIFF_CMD"

# Show summary at the end
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Summary:${NC}"
CHANGED_FILES=$(eval "$DIFF_CMD --name-only" | wc -l | tr -d ' ')
echo -e "  ${CYAN}Files changed:${NC} $CHANGED_FILES"
echo ""
echo -e "${YELLOW}Tip: Use --stat for a summary, --files-only for just file names${NC}"
echo -e "${YELLOW}Example: ./scripts/compare-upstream.sh --stat${NC}"
echo -e "${YELLOW}Example: ./scripts/compare-upstream.sh --files-only 'server/utils/*'${NC}"
