#!/usr/bin/env bash
# daemon.sh — Background writing daemon with notifications

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

Start background writing daemon. Continuously writes chapters until:
  - --count chapters reached
  - Key issue detected (pauses for human review)
  - User stops with --stop

Arguments:
  book-id              Book ID

Options:
  --count <n>          Max chapters to write (default: unlimited)
  --interval <m>       Check interval in minutes (default: 30)
  --notify             Enable notifications
  --webhook <url>      Webhook URL for notifications
  --stop               Stop running daemon
  --status             Show daemon status
  --log <file>         Log file (default: logs/{book-id}/daemon.log)

Examples:
  $(basename "$0") my-book --count 10 --notify --webhook https://... &
  $(basename "$0") my-book --stop
  $(basename "$0") my-book --status

EOF
  exit 1
}

# Parse arguments
BOOK_ID=""
MAX_COUNT=""
INTERVAL=30
NOTIFY=false
WEBHOOK_URL=""
LOG_FILE=""
COMMAND="start"

while [[ $# -gt 0 ]]; do
  case $1 in
    --count) MAX_COUNT="$2"; shift 2 ;;
    --interval) INTERVAL="$2"; shift 2 ;;
    --notify) NOTIFY=true; shift ;;
    --webhook) WEBHOOK_URL="$2"; shift 2 ;;
    --stop) COMMAND="stop"; shift ;;
    --status) COMMAND="status"; shift ;;
    --log) LOG_FILE="$2"; shift 2 ;;
    --help|-h) usage ;;
    -*) echo -e "${RED}Unknown: $1${NC}"; usage ;;
    *) BOOK_ID="$1"; shift ;;
  esac
done

if [[ -z "$BOOK_ID" ]]; then
  echo -e "${RED}Error: book-id required${NC}"
  usage
fi

# Paths
STATE_DIR="$WORKFLOW_DIR/state/$BOOK_ID"
LOGS_DIR="$WORKFLOW_DIR/logs/$BOOK_ID"
DAEMON_STATE="$LOGS_DIR/daemon.state.json"

[[ -z "$LOG_FILE" ]] && LOG_FILE="$LOGS_DIR/daemon.log"

# ============================================================
# Helper: send notification
# ============================================================
send_notification() {
  local event="$1"
  local message="$2"

  echo -e "${GREEN}[NOTIFY]${NC} $message"

  if [[ "$NOTIFY" == "true" ]] && [[ -n "$WEBHOOK_URL" ]]; then
    curl -s -X POST "$WEBHOOK_URL" \
      -H "Content-Type: application/json" \
      -d "{
        \"event\": \"$event\",
        \"book_id\": \"$BOOK_ID\",
        \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
        \"message\": \"$message\"
      }" > /dev/null 2>&1 || true
  fi
}

# ============================================================
# Helper: update daemon state
# ============================================================
update_daemon_state() {
  local status="$1"
  local last_chapter="${2:-}"
  local pause_reason="${3:-}"

  mkdir -p "$LOGS_DIR"

  if [[ -f "$DAEMON_STATE" ]]; then
    # Update existing
    if [[ -n "$last_chapter" ]]; then
      jq --argjson ch "$last_chapter" \
         --arg status "$status" \
         --arg reason "$pause_reason" \
         --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
         '.last_chapter_completed = $ch | .status = $status | .pause_reason = $reason | .last_run_at = $now' \
         "$DAEMON_STATE" > "$DAEMON_STATE.tmp" && mv "$DAEMON_STATE.tmp" "$DAEMON_STATE"
    fi
  else
    # Create new
    mkdir -p "$LOGS_DIR"
    cat > "$DAEMON_STATE" <<EOF
{
  "daemon_id": "$(uuidgen 2>/dev/null || echo "daemon-$$")",
  "book_id": "$BOOK_ID",
  "started_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "last_run_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "last_chapter_completed": 0,
  "total_chapters_completed": 0,
  "consecutive_successes": 0,
  "status": "$status",
  "pause_reason": "$pause_reason",
  "config": {
    "max_count": ${MAX_COUNT:-null},
    "interval_minutes": $INTERVAL,
    "notify": $NOTIFY,
    "webhook": "${WEBHOOK_URL:-}"
  }
}
EOF
  fi
}

# ============================================================
# Command: stop
# ============================================================
stop_daemon() {
  if [[ -f "$DAEMON_STATE" ]]; then
    jq '.status = "stopped"' "$DAEMON_STATE" > "$DAEMON_STATE.tmp" && mv "$DAEMON_STATE.tmp" "$DAEMON_STATE"
    echo -e "${YELLOW}Daemon stopped${NC}"
    echo "State: $DAEMON_STATE"
  else
    echo -e "${RED}No daemon running for $BOOK_ID${NC}"
  fi
}

# ============================================================
# Command: status
# ============================================================
show_status() {
  if [[ -f "$DAEMON_STATE" ]]; then
    echo -e "${BLUE}Daemon Status for: $BOOK_ID${NC}"
    jq -r '
      "Status: \(.status)",
      "Started: \(.started_at)",
      "Last run: \(.last_run_at)",
      "Last chapter: \(.last_chapter_completed)",
      "Total completed: \(.total_chapters_completed)",
      "Consecutive: \(.consecutive_successes)",
      "Pause reason: \(.pause_reason // "none")"
    ' "$DAEMON_STATE"
  else
    echo -e "${RED}No daemon state found for $BOOK_ID${NC}"
  fi
}

# ============================================================
# Command: start
# ============================================================
start_daemon() {
  # Check book exists
  if [[ ! -d "$STATE_DIR" ]]; then
    echo -e "${RED}Error: Book '$BOOK_ID' not found${NC}"
    exit 1
  fi

  # Check if already running
  if [[ -f "$DAEMON_STATE" ]]; then
    CURRENT_STATUS=$(jq -r '.status' "$DAEMON_STATE" 2>/dev/null || echo "stopped")
    if [[ "$CURRENT_STATUS" == "running" ]]; then
      echo -e "${RED}Daemon already running for $BOOK_ID${NC}"
      show_status
      exit 1
    fi
  fi

  mkdir -p "$LOGS_DIR"
  echo -e "${GREEN}Starting daemon for: $BOOK_ID${NC}"
  echo "Max chapters: ${MAX_COUNT:-unlimited}"
  echo "Interval: ${INTERVAL}min"
  echo "Notify: $NOTIFY"
  echo "Log: $LOG_FILE"

  update_daemon_state "running"

  # Create PID file
  echo $$ > "$LOGS_DIR/daemon.pid"

  # Main loop
  CHAPTER_COUNT=0
  CONSECUTIVE=0

  while true; do
    # Check stop condition
    if [[ -f "$DAEMON_STATE" ]]; then
      STATUS=$(jq -r '.status' "$DAEMON_STATE" 2>/dev/null || echo "stopped")
      if [[ "$STATUS" != "running" ]]; then
        echo -e "${YELLOW}Daemon stopped externally${NC}"
        break
      fi
    fi

    # Check count limit
    if [[ -n "$MAX_COUNT" ]] && [[ "$CHAPTER_COUNT" -ge "$MAX_COUNT" ]]; then
      echo "Reached max chapters: $MAX_COUNT"
      update_daemon_state "stopped" "" "max_count_reached"
      break
    fi

    # Get current chapter
    CURRENT_CHAPTER=$(jq '.chapter' "$STATE_DIR/current_state.json" 2>/dev/null || echo 0)
    CHAPTER_TO_WRITE=$((CURRENT_CHAPTER + 1))

    echo ""
    echo -e "${BLUE}[$(date)]${NC} Writing chapter $CHAPTER_TO_WRITE..."

    # Run write-next
    START_TIME=$(date +%s)
    if "$SCRIPT_DIR/write-next.sh" "$BOOK_ID" --chapter "$CHAPTER_TO_WRITE" --json 2>&1 | tee -a "$LOG_FILE"; then
      END_TIME=$(date +%s)
      DURATION=$((END_TIME - START_TIME))

      CHAPTER_COUNT=$((CHAPTER_COUNT + 1))
      CONSECUTIVE=$((CONSECUTIVE + 1))

      update_daemon_state "running" "$CHAPTER_TO_WRITE"

      send_notification "chapter_completed" \
        "Chapter $CHAPTER_TO_WRITE completed in ${DURATION}s (total: $CHAPTER_COUNT)"

      echo -e "${GREEN}[$(date)]${NC} Chapter $CHAPTER_TO_WRITE done (${DURATION}s)"
    else
      echo -e "${RED}[$(date)]${NC} Chapter $CHAPTER_TO_WRITE failed"

      update_daemon_state "paused" "$CHAPTER_TO_WRITE" "write_failed"

      send_notification "chapter_failed" \
        "Chapter $CHAPTER_TO_WRITE failed - pausing for review"

      echo "Paused. Run './scripts/write-next.sh $BOOK_ID --chapter $CHAPTER_TO_WRITE' manually"
      echo "Then './scripts/daemon.sh $BOOK_ID --resume' to continue"
      break
    fi

    # Wait for next interval
    echo -e "${BLUE}[$(date)]${NC} Waiting ${INTERVAL}min before next chapter..."
    sleep "${INTERVAL}m"
  done

  echo -e "${GREEN}Daemon completed${NC}"
  echo "Total chapters written: $CHAPTER_COUNT"
}

# ============================================================
# Main
# ============================================================
case "$COMMAND" in
  stop) stop_daemon ;;
  status) show_status ;;
  start) start_daemon ;;
  *) echo -e "${RED}Unknown command: $COMMAND${NC}"; usage ;;
esac
