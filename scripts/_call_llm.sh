#!/usr/bin/env bash
# _call_llm.sh — Internal helper to call Claude LLM with cost tracking

set -euo pipefail

SYSTEM=""
PROMPT=""
MODEL="claude-sonnet-4-20250514"
MAX_TOKENS=8192
COST_LOG="${COST_LOG:-$HOME/.inkos/cost_log.json}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --system) SYSTEM="$2"; shift 2 ;;
    --prompt) PROMPT="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --max_tokens) MAX_TOKENS="$2"; shift 2 ;;
    --cost_log) COST_LOG="$2"; shift 2 ;;
    *) shift ;;
  esac
done

if [[ -z "$PROMPT" ]]; then
  echo "Error: --prompt is required" >&2
  exit 1
fi

# Check for Claude API key
if [[ -z "${ANTHROPIC_API_KEY:-}" ]] && [[ -z "${CLAUDE_API_KEY:-}" ]]; then
  CONFIG_FILE="${HOME}/.inkos/.env"
  if [[ -f "$CONFIG_FILE" ]]; then
    source "$CONFIG_FILE" 2>/dev/null || true
  fi
fi

API_KEY="${ANTHROPIC_API_KEY:-${CLAUDE_API_KEY:-}}"

if [[ -z "$API_KEY" ]]; then
  echo "Error: ANTHROPIC_API_KEY or CLAUDE_API_KEY not set" >&2
  exit 1
fi

# Prices per 1M tokens (Claude API)
case "$MODEL" in
  *opus*)     INPUT_PRICE=15; OUTPUT_PRICE=75 ;;
  *sonnet*)   INPUT_PRICE=3; OUTPUT_PRICE=15 ;;
  *haiku*)    INPUT_PRICE=0.25; OUTPUT_PRICE=1.25 ;;
  *)          INPUT_PRICE=3; OUTPUT_PRICE=15 ;;
esac

# Build JSON payload with proper string escaping
SYSTEM_JSON="$(printf '%s' "$SYSTEM" | jq -Rs '.' 2>/dev/null)"
PROMPT_JSON="$(printf '%s' "$PROMPT" | jq -Rs '.' 2>/dev/null)"

RESPONSE=$(
  curl -s -X POST \
    "https://api.anthropic.com/v1/messages" \
    -H "x-api-key: $API_KEY" \
    -H "anthropic-version: 2023-06-01" \
    -H "content-type: application/json" \
    -d "{
      \"model\": \"$MODEL\",
      \"max_tokens\": $MAX_TOKENS,
      \"system\": $SYSTEM_JSON,
      \"messages\": [
        {
          \"role\": \"user\",
          \"content\": $PROMPT_JSON
        }
      ]
    }" 2>/dev/null
)

# Extract output text
TEXT=$(echo "$RESPONSE" | jq -r '.content[0].text // empty' 2>/dev/null)

# Extract token usage
INPUT_TOKENS=$(echo "$RESPONSE" | jq -r '.usage.input_tokens // 0' 2>/dev/null)
OUTPUT_TOKENS=$(echo "$RESPONSE" | jq -r '.usage.output_tokens // 0' 2>/dev/null)

# Calculate cost
INPUT_COST=$(echo "scale=6; $INPUT_TOKENS * $INPUT_PRICE / 1000000" | bc)
OUTPUT_COST=$(echo "scale=6; $OUTPUT_TOKENS * $OUTPUT_PRICE / 1000000" | bc)
TOTAL_COST=$(echo "scale=6; $INPUT_COST + $OUTPUT_COST" | bc)

# Append to cost log
mkdir -p "$(dirname "$COST_LOG")"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
LOG_ENTRY=$(jq -n \
  --arg ts "$TIMESTAMP" \
  --arg model "$MODEL" \
  --arg book "${BOOK_ID:-unknown}" \
  --arg chapter "${CHAPTER_NUM:-unknown}" \
  --argjson input_tok "$INPUT_TOKENS" \
  --argjson output_tok "$OUTPUT_TOKENS" \
  --arg cost "$TOTAL_COST" \
  '{timestamp: $ts, model: $model, book_id: $book, chapter: $chapter, input_tokens: $input_tok, output_tokens: $output_tok, cost_usd: $cost}')

# Merge into existing log (keep last 1000 entries)
if [[ -f "$COST_LOG" ]]; then
  EXISTING=$(cat "$COST_LOG" | jq '.')
  NEW_LOG=$(echo "$EXISTING $LOG_ENTRY" | jq -s '.[-1000:]')
  echo "$NEW_LOG" > "$COST_LOG"
else
  echo "[$LOG_ENTRY]" > "$COST_LOG"
fi

# Print cost to stderr
echo "[COST] ${MODEL} input=${INPUT_TOKENS} output=${OUTPUT_TOKENS} cost=\$$TOTAL_COST" >&2

# Output the text response
echo "$TEXT"
