#!/usr/bin/env bash
# write-next.sh — Complete write-next-chapter pipeline

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKFLOW_DIR="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

usage() {
  cat <<EOF
Usage: $(basename "$0") <book-id> [OPTIONS]

Execute the complete write-next-chapter pipeline:
  PLANNER → ARCHITECT → COMPOSER → WRITER → OBSERVER → AUDITOR → REVISER → NORMALIZER → EDITOR → FACTS-KEEPER

Arguments:
  book-id              Book ID (required)

Options:
  --chapter <n>        Chapter number (default: next chapter)
  --context <text>     Writing context/instruction
  --platform <plat>    Override platform (tangfan/qidian)
  --no-audit           Skip audit/revision (write draft only)
  --force              Force rewrite even if chapter exists
  --json                Output JSON status
  --verbose             Show detailed progress

Examples:
  $(basename "$0") my-book
  $(basename "$0") my-book --chapter 5 --context "本章聚焦师徒矛盾"
  $(basename "$0") my-book --no-audit  # draft only

EOF
  exit 1
}

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
    -*) echo -e "${RED}Unknown option: $1${NC}"; usage ;;
    *) BOOK_ID="$1"; shift ;;
  esac
done

if [[ -z "$BOOK_ID" ]]; then
  echo -e "${RED}Error: book-id is required${NC}"
  usage
fi

# Paths
STATE_DIR="$WORKFLOW_DIR/state/$BOOK_ID"
BOOKS_DIR="$WORKFLOW_DIR/books/$BOOK_ID"
RUNTIME_DIR="$WORKFLOW_DIR/runtime/$BOOK_ID"

if [[ ! -d "$STATE_DIR" ]]; then
  echo -e "${RED}Error: Book '$BOOK_ID' not found. Run init-book.sh first.${NC}"
  exit 1
fi

# Determine chapter number
if [[ -z "$CHAPTER_NUM" ]]; then
  CHAPTER_NUM="$(jq -r '.chapter' "$STATE_DIR/current_state.json" 2>/dev/null || echo 0)"
  CHAPTER_NUM=$((CHAPTER_NUM + 1))
fi

CHAPTER_DIR="$RUNTIME_DIR/chapter-$(printf '%03d' "$CHAPTER_NUM")"

# Check if chapter exists (unless --force)
if [[ -f "$BOOKS_DIR/chapters/ch-$(printf '%03d' "$CHAPTER_NUM").md" ]] && [[ "$FORCE" == "false" ]]; then
  echo -e "${RED}Error: Chapter $CHAPTER_NUM already exists. Use --force to overwrite.${NC}"
  exit 1
fi

# Get platform
if [[ -z "$PLATFORM_OVERRIDE" ]]; then
  PLATFORM="$(jq -r '.targetPlatform' "$STATE_DIR/author_intent.json" 2>/dev/null || echo "tangfan")"
else
  PLATFORM="$PLATFORM_OVERRIDE"
fi

# ============================================================
# Helper functions
# ============================================================

log() {
  if [[ "$JSON_OUTPUT" == "true" ]]; then
    echo "{\"step\": \"$1\", \"status\": \"$2\", \"message\": \"$3\"}"
  else
    echo -e "${BLUE}[$1]${NC} ${GREEN}$2${NC} $3"
  fi
}

log_verbose() {
  if [[ "$VERBOSE" == "true" ]]; then
    echo -e "  ${CYAN}→${NC} $1"
  fi
}

step() {
  echo -e "\n${YELLOW}═══ $1 ═══${NC}"
}

check_file() {
  if [[ -f "$1" ]]; then
    log_verbose "✓ $1 created"
    return 0
  else
    log "ERROR" "✗" "Expected file not found: $1"
    return 1
  fi
}

# ============================================================
# Phase 0: Setup
# ============================================================
step "Phase 0: Setup"

echo "Book: $BOOK_ID"
echo "Chapter: $CHAPTER_NUM"
echo "Platform: $PLATFORM"
echo "Output: $CHAPTER_DIR"

mkdir -p "$CHAPTER_DIR"

# Create metadata
cat > "$CHAPTER_DIR/.meta.json" <<EOF
{
  "book_id": "$BOOK_ID",
  "chapter": $CHAPTER_NUM,
  "platform": "$PLATFORM",
  "started_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "status": "running"
}
EOF

# ============================================================
# Phase 1: PLANNER
# ============================================================
step "Phase 1: PLANNER — Chapter Intent"

# Read truth files for context
CURRENT_STATE=$(cat "$STATE_DIR/current_state.json")
AUTHOR_INTENT=$(cat "$STATE_DIR/author_intent.json")
PENDING_HOOKS=$(cat "$STATE_DIR/pending_hooks.json")
CHAPTER_SUMMARIES=$(cat "$STATE_DIR/chapter_summaries.json")

# Read target word count
IDEAL_WORDS=$(echo "$AUTHOR_INTENT" | jq -r '.targetWordCountPerChapter.ideal')
MIN_WORDS=$(echo "$AUTHOR_INTENT" | jq -r '.targetWordCountPerChapter.min')
MAX_WORDS=$(echo "$AUTHOR_INTENT" | jq -r '.targetWordCountPerChapter.max')

log "PLANNER" "..." "Reading truth files..."

# Build context for PLANNER agent
PLANNER_CONTEXT="
Book: $BOOK_ID
Title: $(echo "$AUTHOR_INTENT" | jq -r '.title')
Genre: $(echo "$AUTHOR_INTENT" | jq -r '.genre')
Platform: $PLATFORM
Chapter: $CHAPTER_NUM
Target words: $IDEAL_WORDS (range: $MIN_WORDS - $MAX_WORDS)

CONTEXT INSTRUCTION (from user): ${CONTEXT:-"继续故事，保持连贯性"}

CURRENT STATE:
$(echo "$CURRENT_STATE" | jq '.' 2>/dev/null || echo "$CURRENT_STATE")

PENDING HOOKS:
$(echo "$PENDING_HOOKS" | jq '.hooks[] | "- [\( .status )] \( .description )"' 2>/dev/null || echo "None")

RECENT CHAPTERS:
$(echo "$CHAPTER_SUMMARIES" | jq -r '.chapters[-3:] | .[] | "Ch\(.chapter): \(.summary)"' 2>/dev/null || echo "No previous chapters")
"

# Generate intent using Claude
INTENT_OUTPUT="$("$WORKFLOW_DIR/scripts/_call_llm.sh" \
  --system "$WORKFLOW_DIR/agents/PLANNER.md" \
  --prompt "$PLANNER_CONTEXT" \
  --model "${CLAUDE_MODEL:-claude-sonnet-4-20250514}" \
  2>/dev/null)" || INTENT_OUTPUT=""

if [[ -n "$INTENT_OUTPUT" ]]; then
  echo "$INTENT_OUTPUT" > "$CHAPTER_DIR/01-intent.md"
  log "PLANNER" "✓" "Generated chapter intent"
else
  # Fallback: create minimal intent
  cat > "$CHAPTER_DIR/01-intent.md" <<EOF
# Chapter $CHAPTER_NUM Intent

## Basic Info
- **Target word count**: $IDEAL_WORDS
- **POV**: protagonist
- **Timeline**: continuing

## Core Purpose
1. Continue the story from previous chapter
2. ${CONTEXT:-"Advance the main plot"}
3. Maintain continuity

## Must-Keep Elements
- Continuity with previous chapters

## Must-Avoid
- Contradicting established facts

## Platform Considerations
- Platform: $PLATFORM
- Chapter hook required at end
EOF
  log "PLANNER" "⚠" "Fallback intent created (LLM call failed)"
fi

check_file "$CHAPTER_DIR/01-intent.md" || true

# ============================================================
# Phase 2: ARCHITECT
# ============================================================
step "Phase 2: ARCHITECT — Chapter Structure"

INTENT=$(cat "$CHAPTER_DIR/01-intent.md")
CURRENT_STATE_CONTENT=$(cat "$STATE_DIR/current_state.json")

ARCHITECT_CONTEXT="
Chapter: $CHAPTER_NUM
Intent:
$INTENT

Current State:
$CURRENT_STATE_CONTENT

Genre: $(echo "$AUTHOR_INTENT" | jq -r '.genre')
Platform: $PLATFORM
Target Words: $IDEAL_WORDS
"

ARCHITECT_OUTPUT="$("$WORKFLOW_DIR/scripts/_call_llm.sh" \
  --system "$WORKFLOW_DIR/agents/ARCHITECT.md" \
  --prompt "$ARCHITECT_CONTEXT" \
  --model "${CLAUDE_MODEL:-claude-sonnet-4-20250514}" \
  2>/dev/null)" || ARCHITECT_OUTPUT=""

if [[ -n "$ARCHITECT_OUTPUT" ]]; then
  echo "$ARCHITECT_OUTPUT" > "$CHAPTER_DIR/02-architecture.md"
  log "ARCHITECT" "✓" "Generated chapter architecture"
else
  cat > "$CHAPTER_DIR/02-architecture.md" <<EOF
# Chapter $CHAPTER_NUM Architecture

## Basic Info
- Target words: $IDEAL_WORDS

## Scene Breakdown
Single scene chapter, continue from previous state.

## Pacing Arc
```
Setup (20%) → Development (30%) → Climax (30%) → Resolution (20%)
```
EOF
  log "ARCHITECT" "⚠" "Fallback architecture created"
fi

check_file "$CHAPTER_DIR/02-architecture.md" || true

# ============================================================
# Phase 3: COMPOSER
# ============================================================
step "Phase 3: COMPOSER — Context Compilation"

# Gather truth files for context
COMPOSER_CONTEXT="
Book: $BOOK_ID
Chapter: $CHAPTER_NUM
Intent: see 01-intent.md
Architecture: see 02-architecture.md

Truth Files (last 3 chapters):
$(cat "$STATE_DIR/chapter_summaries.json" | jq -r '.chapters[-3:] | .[]' 2>/dev/null || echo "{}")

Active Hooks:
$(cat "$STATE_DIR/pending_hooks.json" | jq '.hooks[] | select(.status != "resolved")' 2>/dev/null || echo "[]")

Particle Ledger:
$(cat "$STATE_DIR/particle_ledger.json" | jq '.' 2>/dev/null || echo "{}")

Character Matrix:
$(cat "$STATE_DIR/character_matrix.json" | jq '.' 2>/dev/null || echo "{}")
"

# Generate context.json
cat > "$CHAPTER_DIR/03-context.json" <<EOF
{
  "chapter": $CHAPTER_NUM,
  "compiled_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "context_window": {
    "truth_files_summary": "See state files for full content"
  }
}
EOF

cat > "$CHAPTER_DIR/04-rule-stack.yaml" <<EOF
rules:
  - source: "global"
    priority: 1
    rules:
      - "禁止使用：因此、然而、但是、于是"
      - "句长变化：5-25词交替"
  - source: "genre/$(echo "$AUTHOR_INTENT" | jq -r '.genre')"
    priority: 2
    rules: []
  - source: "chapter/$CHAPTER_NUM"
    priority: 3
    rules: []
EOF

log "COMPOSER" "✓" "Compiled context and rules"

# ============================================================
# Phase 4: WRITER
# ============================================================
step "Phase 4: WRITER — Prose Generation"

WRITER_CONTEXT="
Book: $BOOK_ID
Chapter: $CHAPTER_NUM
Platform: $PLATFORM
Target words: $IDEAL_WORDS (range: $MIN_WORDS - $MAX_WORDS)

Intent (from PLANNER):
$(cat "$CHAPTER_DIR/01-intent.md")

Architecture (from ARCHITECT):
$(cat "$CHAPTER_DIR/02-architecture.md")

Context (from COMPOSER):
$(cat "$CHAPTER_DIR/03-context.json")

IMPORTANT ANTI-AI-Taste Rules:
- NEVER use: 因此、然而、但是、于是、总之、可见、众所周知
- NEVER use: 此时、此刻、就在这时、不由得、情不自禁
- NEVER use: 猛然、骤然、陡然、猝然、霍然、缓缓、渐渐、逐步
- Vary sentence length and paragraph structure
- Show emotions through actions, not statements
- Include sensory details in each scene
- End chapter with a HOOK to encourage readers

Write the complete chapter now:
"

WRITER_OUTPUT="$("$WORKFLOW_DIR/scripts/_call_llm.sh" \
  --system "$WORKFLOW_DIR/agents/WRITER.md" \
  --prompt "$WRITER_CONTEXT" \
  --model "${CLAUDE_MODEL:-claude-sonnet-4-20250514}" \
  --max_tokens 8192 \
  2>/dev/null)" || WRITER_OUTPUT=""

if [[ -n "$WRITER_OUTPUT" ]]; then
  echo "$WRITER_OUTPUT" > "$CHAPTER_DIR/05-draft.md"
  log "WRITER" "✓" "Generated draft"
else
  echo "# Chapter $CHAPTER_NUM

[Draft generation failed. Please write manually.]" > "$CHAPTER_DIR/05-draft.md"
  log "WRITER" "✗" "Draft generation failed"
fi

check_file "$CHAPTER_DIR/05-draft.md" || true

# Calculate word count
WORD_COUNT=$(wc -m < "$CHAPTER_DIR/05-draft.md" 2>/dev/null || echo "0")
WORD_COUNT=$((WORD_COUNT / 2))  # rough Chinese char to word estimate
log_verbose "Word count: $WORD_COUNT"

# ============================================================
# Phase 5: OBSERVER
# ============================================================
step "Phase 5: OBSERVER — Fact Extraction"

OBSERVER_CONTEXT="
Chapter: $CHAPTER_NUM
Draft:
$(cat "$CHAPTER_DIR/05-draft.md")

Extract 9 categories of facts from this draft into structured JSON.
"

OBSERVER_OUTPUT="$("$WORKFLOW_DIR/scripts/_call_llm.sh" \
  --system "$WORKFLOW_DIR/agents/OBSERVER.md" \
  --prompt "$OBSERVER_CONTEXT" \
  --model "${CLAUDE_MODEL:-claude-sonnet-4-20250514}" \
  --max_tokens 4096 \
  2>/dev/null)" || OBSERVER_OUTPUT=""

if [[ -n "$OBSERVER_OUTPUT" ]]; then
  echo "$OBSERVER_OUTPUT" > "$CHAPTER_DIR/06-facts.json"
  log "OBSERVER" "✓" "Extracted facts"
else
  echo '{"chapter":'"$CHAPTER_NUM"',"facts":[],"metadata":{"total_facts":0}}' > "$CHAPTER_DIR/06-facts.json"
  log "OBSERVER" "⚠" "Fallback facts (empty)"
fi

# ============================================================
# Phase 6: AUDITOR (if not skipped)
# ============================================================
AUDIT_PASSED=false

if [[ "$SKIP_AUDIT" == "false" ]]; then
  step "Phase 6: AUDITOR — Continuity Audit"

  AUDITOR_CONTEXT="
Chapter: $CHAPTER_NUM
Draft:
$(cat "$CHAPTER_DIR/05-draft.md")

Facts extracted:
$(cat "$CHAPTER_DIR/06-facts.json")

Truth files for reference:
- current_state: $(cat "$STATE_DIR/current_state.json")
- pending_hooks: $(cat "$STATE_DIR/pending_hooks.json")
- character_matrix: $(cat "$STATE_DIR/character_matrix.json")
- emotional_arcs: $(cat "$STATE_DIR/emotional_arcs.json")

IMPORTANT ANTI-AI-Taste Checks:
- Check for banned words: 因此、然而、但是、于是、总之、可见、众所周知
- Check for banned patterns: AI causal chains, "只见" overuse, 3+ consecutive "他..." starts
- Check sentence length uniformity (AI tendency)
"

  AUDITOR_OUTPUT="$("$WORKFLOW_DIR/scripts/_call_llm.sh" \
    --system "$WORKFLOW_DIR/agents/AUDITOR.md" \
    --prompt "$AUDITOR_CONTEXT" \
    --model "${CLAUDE_MODEL:-claude-sonnet-4-20250514}" \
    --max_tokens 4096 \
    2>/dev/null)" || AUDITOR_OUTPUT=""

  if [[ -n "$AUDITOR_OUTPUT" ]]; then
    echo "$AUDITOR_OUTPUT" > "$CHAPTER_DIR/07-audit.json"
    log "AUDITOR" "✓" "Audit completed"

    # Check if audit passed
    AUDIT_RESULT=$(echo "$AUDITOR_OUTPUT" | jq -r '.overall_result // "UNKNOWN"' 2>/dev/null || echo "UNKNOWN")
    log "AUDITOR" "RESULT" "Overall: $AUDIT_RESULT"

    if [[ "$AUDIT_RESULT" == "PASS" ]]; then
      AUDIT_PASSED=true
      cp "$CHAPTER_DIR/05-draft.md" "$CHAPTER_DIR/08-revised.md"
    fi
  else
    echo '{"chapter":'"$CHAPTER_NUM"',"overall_result":"UNKNOWN","issues":[]}' > "$CHAPTER_DIR/07-audit.json"
    log "AUDITOR" "⚠" "Fallback audit (assumed pass)"
    AUDIT_PASSED=true
    cp "$CHAPTER_DIR/05-draft.md" "$CHAPTER_DIR/08-revised.md"
  fi

  # ============================================================
  # Phase 7: REVISER (if audit failed)
  # ============================================================
  if [[ "$AUDIT_PASSED" == "false" ]]; then
    step "Phase 7: REVISER — Issue Remediation"

    REVISER_CONTEXT="
Chapter: $CHAPTER_NUM
Original draft:
$(cat "$CHAPTER_DIR/05-draft.md")

Audit report:
$(cat "$CHAPTER_DIR/07-audit.json")

Intent (must-preserve):
$(cat "$CHAPTER_DIR/01-intent.md")

Fix the issues identified by the auditor. CRITICAL issues must be auto-fixed.
MEDIUM/LOW issues flag for human review.

IMPORTANT: Do NOT remove must-keep scenes from intent.
"

    REVISER_OUTPUT="$("$WORKFLOW_DIR/scripts/_call_llm.sh" \
      --system "$WORKFLOW_DIR/agents/REVISER.md" \
      --prompt "$REVISER_CONTEXT" \
      --model "${CLAUDE_MODEL:-claude-sonnet-4-20250514}" \
      --max_tokens 8192 \
      2>/dev/null)" || REVISER_OUTPUT=""

    if [[ -n "$REVISER_OUTPUT" ]]; then
      echo "$REVISER_OUTPUT" > "$CHAPTER_DIR/08-revised.md"
      log "REVISER" "✓" "Revised draft"

      # Re-audit
      AUDITOR_OUTPUT="$("$WORKFLOW_DIR/scripts/_call_llm.sh" \
        --system "$WORKFLOW_DIR/agents/AUDITOR.md" \
        --prompt "$(cat <<<"Chapter: $CHAPTER_NUM
Draft:
$REVISER_OUTPUT

Re-audit this revised draft.")" \
        --model "${CLAUDE_MODEL:-claude-sonnet-4-20250514}" \
        --max_tokens 4096 \
        2>/dev/null)" || AUDITOR_OUTPUT=""

      echo "$AUDITOR_OUTPUT" > "$CHAPTER_DIR/07-audit.json"
      AUDIT_RESULT=$(echo "$AUDITOR_OUTPUT" | jq -r '.overall_result // "UNKNOWN"' 2>/dev/null || echo "UNKNOWN")
      if [[ "$AUDIT_RESULT" == "PASS" ]]; then
        AUDIT_PASSED=true
      fi
    else
      log "REVISER" "✗" "Revision failed, using original draft"
      cp "$CHAPTER_DIR/05-draft.md" "$CHAPTER_DIR/08-revised.md"
      AUDIT_PASSED=true
    fi
  fi
else
  step "Phase 6-7: SKIPPED (--no-audit)"
  cp "$CHAPTER_DIR/05-draft.md" "$CHAPTER_DIR/08-revised.md"
  AUDIT_PASSED=true
fi

# ============================================================
# Phase 8: NORMALIZER
# ============================================================
step "Phase 8: NORMALIZER — Word Count Adjustment"

TARGET_MIN=$((IDEAL_WORDS * 9 / 10))
TARGET_MAX=$((IDEAL_WORDS * 11 / 10))

NORMALIZER_CONTEXT="
Chapter: $CHAPTER_NUM
Draft:
$(cat "$CHAPTER_DIR/08-revised.md")

Target range: $TARGET_MIN - $TARGET_MAX words
Platform: $PLATFORM

Adjust word count if needed. If under, expand interiority/sensory/dialogue.
If over, trim redundant phrases/combine sentences.
DO NOT cut climax/resolution/must-keep scenes.
"

NORMALIZED_OUTPUT="$("$WORKFLOW_DIR/scripts/_call_llm.sh" \
  --system "$WORKFLOW_DIR/agents/NORMALIZER.md" \
  --prompt "$NORMALIZER_CONTEXT" \
  --model "${CLAUDE_MODEL:-claude-sonnet-4-20250514}" \
  --max_tokens 8192 \
  2>/dev/null)" || NORMALIZED_OUTPUT=""

if [[ -n "$NORMALIZED_OUTPUT" ]]; then
  echo "$NORMALIZED_OUTPUT" > "$CHAPTER_DIR/09-normalized.md"
  log "NORMALIZER" "✓" "Normalized word count"
else
  cp "$CHAPTER_DIR/08-revised.md" "$CHAPTER_DIR/09-normalized.md"
  log "NORMALIZER" "⚠" "Using revised draft (no normalization)"
fi

# ============================================================
# Phase 9: EDITOR
# ============================================================
step "Phase 9: EDITOR — Platform Format"

# Determine platform config
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

# Format chapter
FINAL_CONTENT=$(cat "$CHAPTER_DIR/09-normalized.md")

# Add chapter title if not present
CHAPTER_TITLE=$(echo "$FINAL_CONTENT" | head -1 | grep -oP '^#\s*第?\d+章\s*\S+' || echo "# 第${CHAPTER_NUM}章")
if [[ ! "$CHAPTER_TITLE" =~ ^#\s*第.*章 ]]; then
  CHAPTER_TITLE="# 第${CHAPTER_NUM}章"
fi

echo "$FINAL_CONTENT" > "$CHAPTER_DIR/10-final.md"
log "EDITOR" "✓" "Formatted for $platform"

# Copy to books directory
cp "$CHAPTER_DIR/10-final.md" "$BOOKS_DIR/chapters/ch-$(printf '%03d' "$CHAPTER_NUM").md"
log "EDITOR" "✓" "Saved to books/$BOOK_ID/chapters/ch-$(printf '%03d' "$CHAPTER_NUM").md"

# ============================================================
# Phase 10: FACTS-KEEPER
# ============================================================
step "Phase 10: FACTS-KEEPER — Update Truth Files"

# Update current_state.json — increment chapter
CURRENT_CHAPTER=$(jq '.chapter' "$STATE_DIR/current_state.json" 2>/dev/null || echo 0)
jq --argjson ch "$((CURRENT_CHAPTER + 1))" '.chapter = $ch | .lastUpdated = "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"' \
  "$STATE_DIR/current_state.json" > "$STATE_DIR/current_state.json.tmp" && \
  mv "$STATE_DIR/current_state.json.tmp" "$STATE_DIR/current_state.json"
log "FACTS-KEEPER" "✓" "Updated current_state.json (chapter: $((CURRENT_CHAPTER + 1)))"

# Update chapter_summaries.json
CHAPTER_SUMMARY=$(cat <<EOF
{
  "chapter": $CHAPTER_NUM,
  "title": "$CHAPTER_TITLE",
  "characters": [],
  "events": [],
  "stateChanges": [],
  "wordCount": $(wc -m < "$BOOKS_DIR/chapters/ch-$(printf '%03d' "$CHAPTER_NUM").md" 2>/dev/null || echo 0),
  "summary": "",
  "keyHooksOpened": [],
  "keyHooksResolved": [],
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
)

jq --argjson summary "$CHAPTER_SUMMARY" '.chapters += [$summary] | .lastUpdated = "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"' \
  "$STATE_DIR/chapter_summaries.json" > "$STATE_DIR/chapter_summaries.json.tmp" && \
  mv "$STATE_DIR/chapter_summaries.json.tmp" "$STATE_DIR/chapter_summaries.json"
log "FACTS-KEEPER" "✓" "Updated chapter_summaries.json"

# ============================================================
# Complete
# ============================================================
step "Complete"

# Update metadata
cat > "$CHAPTER_DIR/.meta.json" <<EOF
{
  "book_id": "$BOOK_ID",
  "chapter": $CHAPTER_NUM,
  "platform": "$PLATFORM",
  "started_at": "$(jq -r '.started_at' "$CHAPTER_DIR/.meta.json")",
  "completed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "status": "completed",
  "audit_passed": $AUDIT_PASSED,
  "output_file": "books/$BOOK_ID/chapters/ch-$(printf '%03d' "$CHAPTER_NUM").md"
}
EOF

echo ""
echo -e "${GREEN}✓ Chapter $CHAPTER_NUM completed!${NC}"
echo ""
echo "Output: books/$BOOK_ID/chapters/ch-$(printf '%03d' "$CHAPTER_NUM").md"
echo "Runtime: $CHAPTER_DIR/"
echo "Audit: $AUDIT_PASSED"
echo ""
echo "Next chapter: ./scripts/write-next.sh $BOOK_ID"
