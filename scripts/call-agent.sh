#!/usr/bin/env bash
# call-agent.sh — Call a Claude Code agent with a specific task
#
# Usage:
#   ./call-agent.sh <agent-name> "<task-prompt>"
#
# Example:
#   ./call-agent.sh PLANNER "Execute PLANNER phase for test-book..."

set -euo pipefail

AGENT_NAME="$1"
TASK_PROMPT="$2"

if [[ -z "$AGENT_NAME" ]] || [[ -z "$TASK_PROMPT" ]]; then
  echo "Usage: call-agent.sh <agent-name> <task-prompt>"
  exit 1
fi

# Check for API key
export CLAUDE_API_KEY="${CLAUDE_API_KEY:-${ANTHROPIC_API_KEY:-}}"

if [[ -z "$CLAUDE_API_KEY" ]]; then
  echo "Error: ANTHROPIC_API_KEY or CLAUDE_API_KEY not set"
  exit 1
fi

# Execute via claude --print --agent
claude --print \
  --agent "$AGENT_NAME" \
  "$TASK_PROMPT" \
  2>&1
