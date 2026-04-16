#!/usr/bin/env bash
# write-next.sh — Thin wrapper delegating to TypeScript orchestrator
#
# Usage: ./write-next.sh <book-id> [OPTIONS]
#
# Options:
#   --chapter <n>     Chapter number (default: next chapter)
#   --context <text>  Writing context/instruction
#   --platform <plat> Override platform (tangfan/qidian)
#   --no-audit        Skip audit/revision (FAST mode)
#   --force           Force overwrite if chapter exists
#   --json            Output JSON status
#   --verbose         Show detailed progress
#   --cost            Show cost summary
#   --cost --book <id> Show book-specific cost

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKFLOW_DIR="$(dirname "$SCRIPT_DIR")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

usage() {
  cat <<EOF
Usage: $(basename "$0") <book-id> [OPTIONS]

Delegate to TypeScript orchestrator (src/orchestrator.ts).

Arguments:
  book-id              Book ID (required)

Options:
  --chapter <n>        Chapter number (default: next chapter)
  --context <text>     Writing context/instruction
  --platform <plat>    Override platform (tangfan/qidian)
  --no-audit           Skip audit/revision (write draft only)
  --force              Force rewrite even if chapter exists
  --json               Output JSON status
  --verbose            Show detailed progress
  --cost               Show total cost summary
  --cost --book <id>   Show cost for specific book

Examples:
  $(basename "$0") my-book
  $(basename "$0") my-book --chapter 5 --context "本章聚焦师徒矛盾"
  $(basename "$0") --cost --book my-book

EOF
  exit 1
}

# Cost query shortcut
if [[ "${1:-}" == "--cost" ]]; then
  cd "$WORKFLOW_DIR"
  npx tsx src/orchestrator.ts --cost "${2:-}" "${3:-}" "${4:-}" 2>/dev/null
  exit 0
fi

# Parse arguments
BOOK_ID=""
CHAPTER_NUM=""
CONTEXT=""
PLATFORM_OVERRIDE=""
SKIP_AUDIT=false
FORCE=false
JSON_OUTPUT=false
VERBOSE=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --chapter) CHAPTER_NUM="$2"; shift 2 ;;
    --context) CONTEXT="$2"; shift 2 ;;
    --platform) PLATFORM_OVERRIDE="$2"; shift 2 ;;
    --no-audit) SKIP_AUDIT=true; shift ;;
    --force) FORCE=true; shift ;;
    --json) JSON_OUTPUT=true; shift ;;
    --verbose) VERBOSE=true; shift ;;
    --help|-h) usage ;;
    -*) echo -e "${RED}Unknown option: $1${NC}" >&2; usage ;;
    *) BOOK_ID="$1"; shift ;;
  esac
done

if [[ -z "$BOOK_ID" ]]; then
  echo -e "${RED}Error: book-id is required${NC}" >&2
  usage
fi

STATE_DIR="$WORKFLOW_DIR/state/$BOOK_ID"
if [[ ! -d "$STATE_DIR" ]]; then
  echo -e "${RED}Error: Book '$BOOK_ID' not found. Run init-book.sh first.${NC}" >&2
  exit 1
fi

if [[ -z "$CHAPTER_NUM" ]]; then
  CHAPTER_NUM="$(jq -r '.chapter' "$STATE_DIR/current_state.json" 2>/dev/null || echo 0)"
  CHAPTER_NUM=$((CHAPTER_NUM + 1))
fi

BOOKS_DIR="$WORKFLOW_DIR/books/$BOOK_ID"
CHAPTER_FILE="$BOOKS_DIR/chapters/ch-$(printf '%03d' "$CHAPTER_NUM").md"
if [[ -f "$CHAPTER_FILE" ]] && [[ "$FORCE" == "false" ]]; then
  echo -e "${RED}Error: Chapter $CHAPTER_NUM already exists. Use --force to overwrite.${NC}" >&2
  exit 1
fi

echo -e "${BLUE}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║         Event-Driven Multi-Agent Pipeline            ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════╝${NC}\n"
echo -e "Book:     ${GREEN}$BOOK_ID${NC}"
echo -e "Chapter:  ${GREEN}$CHAPTER_NUM${NC}"
[[ -n "$PLATFORM_OVERRIDE" ]] && echo -e "Platform: ${GREEN}$PLATFORM_OVERRIDE${NC}"
[[ "$SKIP_AUDIT" == "true" ]] && echo -e "Mode:     ${YELLOW}FAST (skip audit)${NC}\n"

CMD="npx tsx src/orchestrator.ts '$BOOK_ID'"
[[ -n "$CHAPTER_NUM" ]] && CMD="$CMD --chapter '$CHAPTER_NUM'"
[[ -n "$CONTEXT" ]] && CMD="$CMD --context '$CONTEXT'"
[[ -n "$PLATFORM_OVERRIDE" ]] && CMD="$CMD --platform '$PLATFORM_OVERRIDE'"
[[ "$SKIP_AUDIT" == "true" ]] && CMD="$CMD --skip-audit"
[[ "$FORCE" == "true" ]] && CMD="$CMD --force"

cd "$WORKFLOW_DIR"

if [[ "$VERBOSE" == "true" ]]; then
  echo -e "${CYAN}Running via TypeScript orchestrator...${NC}\n"
fi

eval "$CMD"
