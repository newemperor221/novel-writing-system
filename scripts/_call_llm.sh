#!/usr/bin/env bash
# _call_llm.sh — Internal helper to call Claude LLM

set -euo pipefail

SYSTEM=""
PROMPT=""
MODEL="claude-sonnet-4-20250514"
MAX_TOKENS=8192

while [[ $# -gt 0 ]]; do
  case $1 in
    --system) SYSTEM="$2"; shift 2 ;;
    --prompt) PROMPT="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --max_tokens) MAX_TOKENS="$2"; shift 2 ;;
    *) shift ;;
  esac
done

if [[ -z "$PROMPT" ]]; then
  echo "Error: --prompt is required" >&2
  exit 1
fi

# Check for Claude API key
if [[ -z "${ANTHROPIC_API_KEY:-}" ]] && [[ -z "${CLAUDE_API_KEY:-}" ]]; then
  # Try to read from config
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

# Build curl command
curl -s -X POST \
  "https://api.anthropic.com/v1/messages" \
  -H "x-api-key: $API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{
    "model": "'"$MODEL"'",
    "max_tokens": '"$MAX_TOKENS"',
    "system": '"$(echo "$SYSTEM" | jq -Rs . 2>/dev/null || echo "\"$SYSTEM\"")"',
    "messages": [
      {
        "role": "user",
        "content": '"$(echo "$PROMPT" | jq -Rs . 2>/dev/null || echo "\"$PROMPT\"")"'
      }
    ]
  }' 2>/dev/null | jq -r '.content[0].text' 2>/dev/null || echo ""
