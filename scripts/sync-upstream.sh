#!/bin/bash

# Sync script for merging updates from nuxt-better-auth-saas template
# Usage: ./scripts/sync-upstream.sh [--dry-run] [--no-confirm] [--no-backup]

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
# Use 'template' remote (points to nuxt-better-auth-saas)
# If you want to use a different remote, set UPSTREAM_REMOTE env var
UPSTREAM_REMOTE="${UPSTREAM_REMOTE:-template}"
UPSTREAM_BRANCH="main"
CURRENT_BRANCH=$(git branch --show-current)

# Parse arguments
DRY_RUN=false
NO_CONFIRM=false
NO_BACKUP=false

for arg in "$@"; do
  case $arg in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --no-confirm)
      NO_CONFIRM=true
      shift
      ;;
    --no-backup)
      NO_BACKUP=true
      shift
      ;;
    *)
      ;;
  esac
done

echo -e "${BLUE}🔄 Syncing updates from nuxt-better-auth-saas${NC}\n"

# Check if we're on a safe branch
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo -e "${YELLOW}⚠️  Warning: You're on branch '$CURRENT_BRANCH', not 'main'${NC}"
  if [ -t 0 ]; then
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "Aborted."
      exit 1
    fi
  else
    echo -e "${RED}Error: Cannot run interactively outside main branch without TTY. Use --no-confirm flag.${NC}"
    exit 1
  fi
fi

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
  echo -e "${RED}❌ Error: You have uncommitted changes${NC}"
  echo "Please commit or stash your changes before syncing."
  exit 1
fi

# Check if upstream remote exists
if ! git remote get-url "$UPSTREAM_REMOTE" > /dev/null 2>&1; then
  echo -e "${RED}❌ Error: Remote '$UPSTREAM_REMOTE' not found${NC}"
  echo "Available remotes:"
  git remote -v
  exit 1
fi

# Fetch latest from upstream
echo -e "${BLUE}📥 Fetching latest from $UPSTREAM_REMOTE/$UPSTREAM_BRANCH...${NC}"
git fetch "$UPSTREAM_REMOTE" "$UPSTREAM_BRANCH"

# Get the merge base and check if there are any new commits
MERGE_BASE=$(git merge-base HEAD "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH")
NEW_COMMITS=$(git rev-list --count "$MERGE_BASE".."$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" 2>/dev/null || echo "0")

if [ "$NEW_COMMITS" -eq "0" ]; then
  echo -e "${GREEN}✅ You're already up to date!${NC}"
  exit 0
fi

echo -e "${GREEN}📊 Found $NEW_COMMITS new commit(s)${NC}\n"

# Show commit log
echo -e "${BLUE}Recent commits from upstream:${NC}"
git log "$MERGE_BASE".."$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" --oneline --decorate -10
echo ""

# Show file changes summary
echo -e "${BLUE}Files changed:${NC}"
git diff --stat "$MERGE_BASE".."$UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
echo ""

# CRITICAL: Check for potential conflicts
echo -e "${CYAN}🔍 Analyzing potential conflicts...${NC}"
CONFLICT_FILES=$(git diff --name-only "$MERGE_BASE"..HEAD | while read file; do
  if git diff --name-only "$MERGE_BASE".."$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" | grep -q "^$file$"; then
    echo "$file"
  fi
done)

if [ -n "$CONFLICT_FILES" ]; then
  CONFLICT_COUNT=$(echo "$CONFLICT_FILES" | wc -l | tr -d ' ')
  echo -e "${YELLOW}⚠️  WARNING: Found $CONFLICT_COUNT file(s) that may have conflicts:${NC}"
  echo "$CONFLICT_FILES" | while read file; do
    echo -e "  ${YELLOW}•${NC} $file"
  done
  echo ""
  echo -e "${CYAN}These files were modified both locally and upstream.${NC}"
  echo -e "${CYAN}You'll need to manually resolve conflicts in these files.${NC}"
  echo ""
else
  echo -e "${GREEN}✅ No obvious conflicts detected (files modified in both branches)${NC}"
  echo -e "${YELLOW}Note: This doesn't guarantee no conflicts - Git will detect actual conflicts during merge.${NC}"
  echo ""
fi

# Show modified files list
MODIFIED_FILES=$(git diff --name-only "$MERGE_BASE".."$UPSTREAM_REMOTE/$UPSTREAM_BRANCH")
echo -e "${BLUE}All files modified upstream:${NC}"
echo "$MODIFIED_FILES" | head -20
if [ $(echo "$MODIFIED_FILES" | wc -l) -gt 20 ]; then
  echo "... and $(($(echo "$MODIFIED_FILES" | wc -l) - 20)) more files"
fi
echo ""

# Dry run mode
if [ "$DRY_RUN" = true ]; then
  echo -e "${YELLOW}🔍 DRY RUN MODE - No changes will be made${NC}"
  echo "Would merge: $UPSTREAM_REMOTE/$UPSTREAM_BRANCH into $CURRENT_BRANCH"
  if [ -n "$CONFLICT_FILES" ]; then
    echo -e "${YELLOW}⚠️  Conflicts expected in the files listed above${NC}"
  fi
  exit 0
fi

# Create backup branch
if [ "$NO_BACKUP" = false ]; then
  BACKUP_BRANCH="backup-before-sync-$(date +%Y%m%d-%H%M%S)"
  echo -e "${BLUE}💾 Creating backup branch: $BACKUP_BRANCH${NC}"
  if git branch "$BACKUP_BRANCH" 2>/dev/null; then
    echo -e "${GREEN}✅ Backup created. To restore: git reset --hard $BACKUP_BRANCH${NC}"
  else
    echo -e "${YELLOW}⚠️  Backup branch already exists, using existing branch${NC}"
    # Try with a more unique name
    BACKUP_BRANCH="backup-before-sync-$(date +%Y%m%d-%H%M%S)-$$"
    if git branch "$BACKUP_BRANCH" 2>/dev/null; then
      echo -e "${GREEN}✅ Backup created with unique name: $BACKUP_BRANCH${NC}"
    else
      echo -e "${RED}❌ Error: Could not create backup branch${NC}"
      exit 1
    fi
  fi
  echo ""
fi

# Ask for confirmation
if [ "$NO_CONFIRM" = false ]; then
  echo -e "${YELLOW}⚠️  This will merge $UPSTREAM_REMOTE/$UPSTREAM_BRANCH into $CURRENT_BRANCH${NC}"
  if [ -n "$CONFLICT_FILES" ]; then
    echo -e "${YELLOW}⚠️  Conflicts are likely in the files listed above${NC}"
  fi
  if [ -t 0 ]; then
    read -p "Continue? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "Aborted."
      exit 1
    fi
  else
    echo -e "${RED}Error: Cannot run interactively without TTY. Use --no-confirm flag.${NC}"
    exit 1
  fi
fi

# Perform the merge
echo -e "${BLUE}🔀 Merging updates...${NC}"
MERGE_DATE=$(date +"%Y-%m-%d")
MERGE_MESSAGE="Merge updates from nuxt-better-auth-saas ($MERGE_DATE)

Synced $NEW_COMMITS commit(s) from $UPSTREAM_REMOTE/$UPSTREAM_BRANCH

Review changes and resolve any conflicts before pushing."

if git merge "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" --no-ff -m "$MERGE_MESSAGE"; then
  echo -e "\n${GREEN}✅ Successfully merged updates!${NC}"
  echo ""
  echo "Next steps:"
  echo "  1. Review the changes: git log --oneline -10"
  echo "  2. Run tests: pnpm test"
  echo "  3. Test your application manually"
  echo "  4. Check for any issues: git diff HEAD~1"
  echo "  5. Push when ready: git push origin $CURRENT_BRANCH"
  if [ "$NO_BACKUP" = false ]; then
    echo "  6. If something went wrong, restore from: git reset --hard $BACKUP_BRANCH"
  fi
else
  echo -e "\n${YELLOW}⚠️  Merge completed with conflicts${NC}"
  echo ""
  echo -e "${RED}Conflicts detected!${NC} Here's how to resolve them:"
  echo ""
  echo "1. See which files have conflicts:"
  echo "   ${CYAN}git status${NC}"
  echo ""
  echo "2. Open each conflicted file and look for conflict markers:"
  echo "   ${CYAN}<<<<<<< HEAD${NC} (your changes)"
  echo "   ${CYAN}=======${NC}"
  echo "   ${CYAN}>>>>>>> $UPSTREAM_REMOTE/$UPSTREAM_BRANCH${NC} (upstream changes)"
  echo ""
  echo "3. Edit each file to resolve conflicts, then stage it:"
  echo "   ${CYAN}git add <resolved-file>${NC}"
  echo ""
  echo "4. Once all conflicts are resolved, complete the merge:"
  echo "   ${CYAN}git commit${NC}"
  echo ""
  echo "5. Or abort the merge if needed:"
  echo "   ${CYAN}git merge --abort${NC}"
  echo ""
  echo -e "${YELLOW}Tip: Use a merge tool for easier conflict resolution:${NC}"
  echo "   ${CYAN}git mergetool${NC}"
  echo ""
  if [ "$NO_BACKUP" = false ]; then
    echo -e "${YELLOW}To restore from backup:${NC}"
    echo "   ${CYAN}git merge --abort${NC}"
    echo "   ${CYAN}git reset --hard $BACKUP_BRANCH${NC}"
  fi
  exit 1
fi
