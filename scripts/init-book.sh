#!/usr/bin/env bash
# init-book.sh — Initialize a new book with 7 truth files

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKFLOW_DIR="$(dirname "$SCRIPT_DIR")"
STATE_DIR="$WORKFLOW_DIR/state"
BOOKS_DIR="$WORKFLOW_DIR/books"
RUNTIME_DIR="$WORKFLOW_DIR/runtime"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

usage() {
  cat <<EOF
Usage: $(basename "$0") <book-title> [OPTIONS]

Initialize a new book with 7 truth files.

Arguments:
  book-title           Book title (will be slugified to book-id)

Options:
  --genre <genre>      Genre: xuanhuan, urban, xianxia, litrpg, etc. (default: xuanhuan)
  --platform <platform> Target platform: tangfan, qidian (default: tangfan)
  --author <name>       Author name (default: unknown)
  --target-chapters <n> Target total chapters (default: 100)
  --chapter-words <n>   Target words per chapter (default: 2800)
  --world <world-id>    World/series ID for multi-book management

Examples:
  $(basename "$0") "我的小说" --genre xuanhuan --platform tangfan
  $(basename "$0") "都市异能" --genre urban --world shared-world

EOF
  exit 1
}

# Parse arguments
BOOK_TITLE=""
GENRE="xuanhuan"
PLATFORM="tangfan"
AUTHOR="unknown"
TARGET_CHAPTERS=100
CHAPTER_WORDS=2800
WORLD_ID=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --genre) GENRE="$2"; shift 2 ;;
    --platform) PLATFORM="$2"; shift 2 ;;
    --author) AUTHOR="$2"; shift 2 ;;
    --target-chapters) TARGET_CHAPTERS="$2"; shift 2 ;;
    --chapter-words) CHAPTER_WORDS="$2"; shift 2 ;;
    --world) WORLD_ID="$2"; shift 2 ;;
    --help|-h) usage ;;
    -*) echo -e "${RED}Unknown option: $1${NC}"; usage ;;
    *) BOOK_TITLE="$1"; shift ;;
  esac
done

if [[ -z "$BOOK_TITLE" ]]; then
  echo -e "${RED}Error: book-title is required${NC}"
  usage
fi

# Generate book-id (slugify)
BOOK_ID="$(echo "$BOOK_TITLE" | sed 's/[^a-zA-Z0-9\u4e00-\u9fa5]/_/g' | tr '[:upper:]' '[:lower:]')"
BOOK_ID="$(echo "$BOOK_ID" | sed 's/__*/_/g; s/^_//; s/_$//')"

# Also handle Chinese characters for slug
if command -v python3 &> /dev/null; then
  BOOK_ID="$(python3 -c "
import sys
import unicodedata
s = '$BOOK_TITLE'
s = unicodedata.normalize('NFKC', s)
s = ''.join(c if not unicodedata.is_combining_char(c) else '_' for c in s)
s = s.lower()
import re
s = re.sub(r'[^a-z0-9]+', '_', s)
s = re.sub(r'^_|_$', '', s)
print(s)
")"
fi

echo -e "${GREEN}Initializing book: ${BOOK_TITLE} (${BOOK_ID})${NC}"
echo "  Genre: $GENRE"
echo "  Platform: $PLATFORM"
echo "  Target chapters: $TARGET_CHAPTERS"
echo "  Words per chapter: $CHAPTER_WORDS"
[[ -n "$WORLD_ID" ]] && echo "  World: $WORLD_ID"

# Check if book already exists
if [[ -d "$STATE_DIR/$BOOK_ID" ]]; then
  echo -e "${RED}Error: Book '$BOOK_ID' already exists${NC}"
  exit 1
fi

# Create directories
echo -e "\n${YELLOW}Creating directories...${NC}"
mkdir -p "$STATE_DIR/$BOOK_ID"
mkdir -p "$BOOKS_DIR/$BOOK_ID/chapters"
mkdir -p "$RUNTIME_DIR/$BOOK_ID"

echo "  ✓ $STATE_DIR/$BOOK_ID"
echo "  ✓ $BOOKS_DIR/$BOOK_ID/chapters"
echo "  ✓ $RUNTIME_DIR/$BOOK_ID"

# Generate UUIDs
generate_uuid() {
  if command -v uuidgen &> /dev/null; then
    uuidgen | tr '[:upper:]' '[:lower:]'
  elif command -v python3 &> /dev/null; then
    python3 -c "import uuid; print(uuid.uuid4())"
  else
    # Fallback: simple random hex
    od -An -tx1 -N16 /dev/urandom | tr -d ' \n' | head -c 36
  fi
}

NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
BOOK_ID_FINAL="$BOOK_ID"

# ============================================================
# 1. author_intent.json
# ============================================================
echo -e "\n${YELLOW}Creating truth files...${NC}"
AUTHOR_INTENT_FILE="$STATE_DIR/$BOOK_ID/author_intent.json"
cat > "$AUTHOR_INTENT_FILE" <<EOF
{
  "bookId": "$BOOK_ID",
  "title": "$BOOK_TITLE",
  "genre": "$GENRE",
  "targetPlatform": "$PLATFORM",
  "targetAudience": "",
  "coreTheme": "",
  "tone": "mixed",
  "targetWordCountPerChapter": {
    "ideal": $CHAPTER_WORDS,
    "min": $((CHAPTER_WORDS * 9 / 10)),
    "max": $((CHAPTER_WORDS * 11 / 10))
  },
  "updateFrequency": "daily",
  "mustKeepElements": [],
  "mustAvoidElements": [],
  "plannedArcs": [],
  "createdAt": "$NOW",
  "lastUpdated": "$NOW"
}
EOF
echo "  ✓ author_intent.json"

# ============================================================
# 2. current_state.json
# ============================================================
CURRENT_STATE_FILE="$STATE_DIR/$BOOK_ID/current_state.json"
cat > "$CURRENT_STATE_FILE" <<EOF
{
  "bookId": "$BOOK_ID",
  "chapter": 0,
  "location": "",
  "timeDescription": "",
  "presentCharacters": [],
  "protagonist": {
    "name": "",
    "level": "",
    "coreStats": {},
    "status": "active",
    "location": "",
    "health": {
      "physical": 100,
      "spiritual": 100,
      "mental": 100
    }
  },
  "activeEnemies": [],
  "knownTruths": [],
  "recentEvents": [],
  "worldFlags": {},
  "lastUpdated": "$NOW"
}
EOF
echo "  ✓ current_state.json"

# ============================================================
# 3. particle_ledger.json
# ============================================================
PARTICLE_FILE="$STATE_DIR/$BOOK_ID/particle_ledger.json"
cat > "$PARTICLE_FILE" <<EOF
{
  "particles": {
    "spiritual_energy": {
      "hardCap": null,
      "currentTotal": 0,
      "entries": []
    },
    "money": {
      "hardCap": null,
      "currentTotal": 0,
      "entries": []
    },
    "reputation": {
      "hardCap": null,
      "currentTotal": 0,
      "entries": []
    }
  },
  "lastUpdated": "$NOW"
}
EOF
echo "  ✓ particle_ledger.json"

# ============================================================
# 4. pending_hooks.json
# ============================================================
HOOKS_FILE="$STATE_DIR/$BOOK_ID/pending_hooks.json"
cat > "$HOOKS_FILE" <<EOF
{
  "hooks": [],
  "lastUpdated": "$NOW"
}
EOF
echo "  ✓ pending_hooks.json"

# ============================================================
# 5. chapter_summaries.json
# ============================================================
SUMMARIES_FILE="$STATE_DIR/$BOOK_ID/chapter_summaries.json"
cat > "$SUMMARIES_FILE" <<EOF
{
  "chapters": [],
  "lastUpdated": "$NOW"
}
EOF
echo "  ✓ chapter_summaries.json"

# ============================================================
# 6. subplot_board.json
# ============================================================
SUBPLOT_FILE="$STATE_DIR/$BOOK_ID/subplot_board.json"
cat > "$SUBPLOT_FILE" <<EOF
{
  "subplots": [],
  "lastUpdated": "$NOW"
}
EOF
echo "  ✓ subplot_board.json"

# ============================================================
# 7. emotional_arcs.json
# ============================================================
EMOTIONS_FILE="$STATE_DIR/$BOOK_ID/emotional_arcs.json"
cat > "$EMOTIONS_FILE" <<EOF
{
  "characters": [],
  "lastUpdated": "$NOW"
}
EOF
echo "  ✓ emotional_arcs.json"

# ============================================================
# 8. character_matrix.json
# ============================================================
MATRIX_FILE="$STATE_DIR/$BOOK_ID/character_matrix.json"
cat > "$MATRIX_FILE" <<EOF
{
  "characters": [],
  "relationships": [],
  "lastUpdated": "$NOW"
}
EOF
echo "  ✓ character_matrix.json"

# ============================================================
# 9. Create book_rules.md and story_bible.md
# ============================================================
BOOK_RULES_FILE="$BOOKS_DIR/$BOOK_ID/book_rules.md"
cat > "$BOOK_RULES_FILE" <<EOF
# $BOOK_TITLE — Book Rules

Author: $AUTHOR
Genre: $GENRE
Platform: $PLATFORM
Target Chapters: $TARGET_CHAPTERS

## Protagonist

- Name:
- Background:
- Core stats:

## Key Characters

## World Rules

## Forbidden Elements

## Custom Rules

EOF
echo "  ✓ books/$BOOK_ID/book_rules.md"

STORY_BIBLE_FILE="$BOOKS_DIR/$BOOK_ID/story_bible.md"
cat > "$STORY_BIBLE_FILE" <<EOF
# $BOOK_TITLE — Story Bible

## World Overview

## Geography

## Cultivation/Magic System

## Social Structure

## Key Locations

## Timeline

EOF
echo "  ✓ books/$BOOK_ID/story_bible.md"

# ============================================================
# Summary
# ============================================================
echo -e "\n${GREEN}✓ Book initialized successfully!${NC}"
echo ""
echo "Book ID: $BOOK_ID"
echo "Truth files: $STATE_DIR/$BOOK_ID/"
echo "Books directory: $BOOKS_DIR/$BOOK_ID/"
echo ""
echo "Next steps:"
echo "  1. Edit $BOOKS_DIR/$BOOK_ID/book_rules.md with protagonist details"
echo "  2. Edit $BOOKS_DIR/$BOOK_ID/story_bible.md with world details"
echo "  3. Run ./scripts/write-next.sh $BOOK_ID to write the first chapter"
