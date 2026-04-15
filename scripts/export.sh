#!/usr/bin/env bash
# export.sh — Export book chapters for platform upload

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKFLOW_DIR="$(dirname "$SCRIPT_DIR")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

usage() {
  cat <<EOF
Usage: $(basename "$0") <book-id> [OPTIONS]

Export book chapters in platform-specific format.

Arguments:
  book-id              Book ID

Options:
  --platform <plat>    Platform: tangfan, qidian (default: from book config)
  --format <fmt>       Format: txt, md, epub (default: txt)
  --output <path>      Output path (default: books/{book-id}/export/)
  --from <n>           Start chapter (default: 1)
  --to <m>             End chapter (default: last)
  --approved-only      Only export approved chapters

Examples:
  $(basename "$0") my-book --platform tangfan --format txt
  $(basename "$0") my-book --from 10 --to 20
  $(basename "$0") my-book --format epub --output ~/desktop/

EOF
  exit 1
}

# Parse
BOOK_ID=""
PLATFORM=""
FORMAT="txt"
OUTPUT_DIR=""
FROM_CHAPTER=1
TO_CHAPTER=""
APPROVED_ONLY=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --platform) PLATFORM="$2"; shift 2 ;;
    --format) FORMAT="$2"; shift 2 ;;
    --output) OUTPUT_DIR="$2"; shift 2 ;;
    --from) FROM_CHAPTER="$2"; shift 2 ;;
    --to) TO_CHAPTER="$2"; shift 2 ;;
    --approved-only) APPROVED_ONLY=true; shift ;;
    --help|-h) usage ;;
    -*) echo -e "${RED}Unknown: $1${NC}"; usage ;;
    *) BOOK_ID="$1"; shift ;;
  esac
done

[[ -z "$BOOK_ID" ]] && { echo -e "${RED}Error: book-id required${NC}"; usage; }

# Paths
STATE_DIR="$WORKFLOW_DIR/state/$BOOK_ID"
BOOKS_DIR="$WORKFLOW_DIR/books/$BOOK_ID"
CHAPTERS_DIR="$BOOKS_DIR/chapters"

if [[ ! -d "$STATE_DIR" ]]; then
  echo -e "${RED}Error: Book '$BOOK_ID' not found${NC}"
  exit 1
fi

# Get platform from config if not specified
if [[ -z "$PLATFORM" ]]; then
  PLATFORM=$(jq -r '.targetPlatform' "$STATE_DIR/author_intent.json" 2>/dev/null || echo "tangfan")
fi

# Get book title
BOOK_TITLE=$(jq -r '.title' "$STATE_DIR/author_intent.json" 2>/dev/null || echo "$BOOK_ID")

# Output directory
[[ -z "$OUTPUT_DIR" ]] && OUTPUT_DIR="$BOOKS_DIR/export"
mkdir -p "$OUTPUT_DIR"

# Get last chapter
if [[ -z "$TO_CHAPTER" ]]; then
  LAST_CHAPTER=$(jq '.chapter' "$STATE_DIR/current_state.json" 2>/dev/null || echo 0)
else
  LAST_CHAPTER="$TO_CHAPTER"
fi

echo -e "${BLUE}Exporting: ${BOOK_TITLE}${NC}"
echo "  Platform: $PLATFORM"
echo "  Format: $FORMAT"
echo "  Chapters: $FROM_CHAPTER - $LAST_CHAPTER"
echo "  Output: $OUTPUT_DIR"

# Platform-specific settings
case "$PLATFORM" in
  tangfan)
    CHAPTER_HOOK="     "
    ;;
  qidian)
    CHAPTER_HOOK="——————"
    ;;
  *)
    CHAPTER_HOOK=""
    ;;
esac

# Export functions
export_txt() {
  local output_file="$OUTPUT_DIR/${BOOK_ID}.txt"

  > "$output_file"

  for ch in $(seq -f '%03g' "$FROM_CHAPTER" "$LAST_CHAPTER"); do
    chapter_file="$CHAPTERS_DIR/ch-$ch.md"
    if [[ -f "$chapter_file" ]]; then
      echo "" >> "$output_file"
      echo "" >> "$output_file"
      cat "$chapter_file" >> "$output_file"
      echo -e "${GREEN}✓${NC} Chapter $ch"
    else
      echo -e "${YELLOW}⚠${NC} Chapter $ch not found, skipped"
    fi
  done

  echo ""
  echo -e "${GREEN}✓${NC} Exported to: $output_file"
}

export_md() {
  local output_dir="$OUTPUT_DIR/md/$BOOK_ID"
  mkdir -p "$output_dir"

  for ch in $(seq -f '%03g' "$FROM_CHAPTER" "$LAST_CHAPTER"); do
    chapter_file="$CHAPTERS_DIR/ch-$ch.md"
    if [[ -f "$chapter_file" ]]; then
      cp "$chapter_file" "$output_dir/ch-$ch.md"
      echo -e "${GREEN}✓${NC} Chapter $ch"
    else
      echo -e "${YELLOW}⚠${NC} Chapter $ch not found, skipped"
    fi
  done

  echo ""
  echo -e "${GREEN}✓${NC} Exported to: $output_dir/"
}

export_epub() {
  local output_file="$OUTPUT_DIR/${BOOK_ID}.epub"

  # Check for epub-gen
  if ! command -v epub-gen &> /dev/null; then
    echo -e "${RED}Error: epub-gen not installed${NC}"
    echo "Install with: npm install -g epub-gen-memory"
    exit 1
  fi

  # Build content array
  local content=""
  for ch in $(seq "$FROM_CHAPTER" "$LAST_CHAPTER"); do
    chapter_file="$CHAPTERS_DIR/ch-$(printf '%03d' "$ch").md"
    if [[ -f "$chapter_file" ]]; then
      content="$content \"$chapter_file\""
    fi
  done

  # Generate EPUB
  node -e "
    const epub = require('epub-gen-memory');
    const path = require('path');

    const chapters = [];
    $(for ch in $(seq -f '%03g' "$FROM_CHAPTER" "$LAST_CHAPTER"); do
      f="$CHAPTERS_DIR/ch-$ch.md"
      [[ -f "$f" ]] && echo "chapters.push({title: 'Chapter $ch', data: require('fs').readFileSync('$f', 'utf8')});"
    done)

    const book = new epub({
      title: '$BOOK_TITLE',
      author: 'Generated',
      publisher: 'Novel Writing Workflow',
    });

    chapters.forEach((ch, i) => book.addChapter('Chapter ' + (i+1), ch.data));
    book.writeFile('$output_file').then(() => console.log('Done'));
  " 2>/dev/null || {
    echo -e "${RED}EPUB generation failed${NC}"
    exit 1
  }

  echo ""
  echo -e "${GREEN}✓${NC} Exported to: $output_file"
}

# Run export
echo ""
case "$FORMAT" in
  txt) export_txt ;;
  md) export_md ;;
  epub) export_epub ;;
  *) echo -e "${RED}Unknown format: $FORMAT${NC}"; exit 1 ;;
esac

# Summary
CHAPTER_COUNT=$((LAST_CHAPTER - FROM_CHAPTER + 1))
echo ""
echo "Export complete!"
echo "  Total chapters: $CHAPTER_COUNT"
echo "  Platform: $PLATFORM"
echo "  Format: $FORMAT"
