#!/usr/bin/env bash
# write-next-native.sh — Native Claude Code multi-agent pipeline
#
# Uses Node.js orchestrator to spawn each phase agent via
# claude --print --agent <name> "<prompt>"
#
# Usage:
#   ./write-next-native.sh <book-id> [--chapter <n>] [--context "<text>"] [--skip-audit]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKFLOW_DIR="$(dirname "$SCRIPT_DIR")"
SRC_DIR="$WORKFLOW_DIR/src"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

usage() {
  cat <<EOF
Usage: $(basename "$0") <book-id> [OPTIONS]

Execute the complete write-next-chapter pipeline using native Claude Code agents:
  PLANNER → ARCHITECT → COMPOSER → WRITER → OBSERVER → AUDITOR → REVISER → NORMALIZER → EDITOR → FACTS-KEEPER

Arguments:
  book-id              Book ID (required)

Options:
  --chapter <n>       Chapter number (default: next chapter)
  --context <text>    Writing context/instruction for PLANNER
  --skip-audit        Skip audit/revision (write draft only)
  --force             Force rewrite even if chapter exists
  --verbose           Show detailed progress
  --help              Show this help

Examples:
  $(basename "$0") my-book
  $(basename "$0") my-book --chapter 5 --context "聚焦师徒矛盾"
  $(basename "$0") my-book --skip-audit  # draft only

EOF
  exit 1
}

# Check if claude command is available
if ! command -v claude &> /dev/null; then
  echo -e "${RED}Error: 'claude' command not found. Please install Claude Code CLI.${NC}"
  exit 1
fi

# Check for API key
if [[ -z "${ANTHROPIC_API_KEY:-}" ]] && [[ -z "${CLAUDE_API_KEY:-}" ]] && [[ -z "${ANTHROPIC_AUTH_TOKEN:-}" ]]; then
  echo -e "${RED}Error: ANTHROPIC_API_KEY, CLAUDE_API_KEY, or ANTHROPIC_AUTH_TOKEN not set${NC}"
  exit 1
fi

# Determine how to run TypeScript
cd "$WORKFLOW_DIR"
if [[ -f "node_modules/.bin/tsx" ]]; then
  RUNNER="./node_modules/.bin/tsx"
elif command -v tsx &> /dev/null; then
  RUNNER="tsx"
elif command -v ts-node &> /dev/null; then
  RUNNER="ts-node"
else
  echo -e "${RED}Error: tsx or ts-node not found. Install with: npm install -D tsx${NC}"
  exit 1
fi

# Run the orchestrator
exec "$RUNNER" "$SRC_DIR/orchestrator.ts" "$@"
