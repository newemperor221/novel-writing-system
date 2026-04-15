#!/usr/bin/env bash
# audit.sh — Audit a specific chapter

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
Usage: $(basename "$0") <book-id> <chapter> [OPTIONS]

Audit a specific chapter for continuity and AI taste.

Arguments:
  book-id              Book ID
  chapter              Chapter number

Options:
  --fix                 Auto-fix issues found
  --verbose             Show detailed audit report

Examples:
  $(basename "$0") my-book 5
  $(basename "$0") my-book 5 --fix
  $(basename "$0") my-book 5 --verbose

EOF
  exit 1
}

BOOK_ID=""
CHAPTER=""
DO_FIX=false
VERBOSE=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --fix) DO_FIX=true; shift ;;
    --verbose) VERBOSE=true; shift ;;
    --help|-h) usage ;;
    -*) echo -e "${RED}Unknown: $1${NC}"; usage ;;
    *) BOOK_ID="$1"; CHAPTER="$2"; shift 2 ;;
  esac
done

[[ -z "$BOOK_ID" ]] && { echo -e "${RED}Error: book-id required${NC}"; usage; }
[[ -z "$CHAPTER" ]] && { echo -e "${RED}Error: chapter required${NC}"; usage; }

STATE_DIR="$WORKFLOW_DIR/state/$BOOK_ID"
RUNTIME_DIR="$WORKFLOW_DIR/runtime/$BOOK_ID"
BOOKS_DIR="$WORKFLOW_DIR/books/$BOOK_ID"
CHAPTER_DIR="$RUNTIME_DIR/chapter-$(printf '%03d' "$CHAPTER")"

echo -e "${BLUE}Auditing chapter $CHAPTER of $BOOK_ID${NC}"

# Check files exist
CHAPTER_FILE="$BOOKS_DIR/chapters/ch-$(printf '%03d' "$CHAPTER").md"
if [[ ! -f "$CHAPTER_FILE" ]]; then
  echo -e "${RED}Error: Chapter file not found: $CHAPTER_FILE${NC}"
  exit 1
fi

# Read draft content
DRAFT_CONTENT=$(cat "$CHAPTER_FILE")

# ============================================================
# Run AUDITOR
# ============================================================
echo -e "\n${YELLOW}Running AUDITOR...${NC}"

AUDITOR_CONTEXT="
Book: $BOOK_ID
Chapter: $CHAPTER
Draft:
$DRAFT_CONTENT

Truth files:
- current_state: $(cat "$STATE_DIR/current_state.json")
- pending_hooks: $(cat "$STATE_DIR/pending_hooks.json")
- character_matrix: $(cat "$STATE_DIR/character_matrix.json")
- emotional_arcs: $(cat "$STATE_DIR/emotional_arcs.json")
- particle_ledger: $(cat "$STATE_DIR/particle_ledger.json")

Anti-AI-Taste Checks:
- 词汇: 因此、然而、但是、于是、总之、此时、此刻、缓缓、渐渐、猛然
- 句式: AI causal chains, 只见 overuse, 3+ consecutive 他开头

Audit in detail. List ALL issues found.
"

AUDITOR_OUTPUT="$("$SCRIPT_DIR/_call_llm.sh" \
  --system "$WORKFLOW_DIR/agents/AUDITOR.md" \
  --prompt "$AUDITOR_CONTEXT" \
  --model "${CLAUDE_MODEL:-claude-sonnet-4-20250514}" \
  --max_tokens 4096 2>/dev/null)" || AUDITOR_OUTPUT=""

if [[ -n "$AUDITOR_OUTPUT" ]]; then
  echo "$AUDITOR_OUTPUT" > "$CHAPTER_DIR/07-audit.json"

  # Parse result
  OVERALL=$(echo "$AUDITOR_OUTPUT" | jq -r '.overall_result // "UNKNOWN"' 2>/dev/null || echo "UNKNOWN")
  ISSUES=$(echo "$AUDITOR_OUTPUT" | jq '.issues | length' 2>/dev/null || echo "0")
  AI_FLAGS=$(echo "$AUDITOR_OUTPUT" | jq '.ai_taste_flags | length' 2>/dev/null || echo "0")

  echo -e "\n${BLUE}Audit Result${NC}"
  echo "  Overall: $OVERALL"
  echo "  Issues: $ISSUES"
  echo "  AI Taste Flags: $AI_FLAGS"

  if [[ "$VERBOSE" == "true" ]]; then
    echo ""
    echo "$AUDITOR_OUTPUT" | jq '.' 2>/dev/null || echo "$AUDITOR_OUTPUT"
  fi

  if [[ "$OVERALL" == "PASS" ]]; then
    echo -e "\n${GREEN}✓ Chapter $CHAPTER passed audit${NC}"
  else
    echo -e "\n${YELLOW}⚠ Chapter $CHAPTER has issues${NC}"

    # Show issues
    echo -e "\n${YELLOW}Issues:${NC}"
    echo "$AUDITOR_OUTPUT" | jq -r '.issues[] | "  [\( .severity )] \( .dimension ): \( .description )"' 2>/dev/null || true

    if [[ "$DO_FIX" == "true" ]]; then
      echo -e "\n${YELLOW}Running REVISER to fix issues...${NC}"

      REVISER_OUTPUT="$("$SCRIPT_DIR/_call_llm.sh" \
        --system "$WORKFLOW_DIR/agents/REVISER.md" \
        --prompt "$(cat <<<"Book: $BOOK_ID
Chapter: $CHAPTER
Original draft:
$DRAFT_CONTENT

Audit report:
$AUDITOR_OUTPUT

Fix all issues. Preserve must-keep scenes.")" \
        --model "${CLAUDE_MODEL:-claude-sonnet-4-20250514}" \
        --max_tokens 8192 2>/dev/null)" || REVISER_OUTPUT=""

      if [[ -n "$REVISER_OUTPUT" ]]; then
        echo "$REVISER_OUTPUT" > "$CHAPTER_DIR/08-revised.md"
        cp "$REVISER_OUTPUT" "$CHAPTER_FILE"
        echo -e "${GREEN}✓ Fixed and saved${NC}"
      fi
    fi
  fi
else
  echo -e "${RED}✗ Audit failed${NC}"
  exit 1
fi
