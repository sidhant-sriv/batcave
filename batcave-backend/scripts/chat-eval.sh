#!/usr/bin/env bash
# Manual smoke test for the agent against a running server. Needs a real Groq
# key, so it is not part of `bun run test`; the automated tests script the model
# instead. Run `bun run dev` first.
#
#   ./scripts/chat-eval.sh [base-url]
#
# Every prompt runs on one thread, so the later ones exercise the memory that
# makes "the first one" resolvable. The run ends by replaying that thread out of
# the checkpoint through GET /api/chat/:thread_id, which is the same history the
# model saw, rebuilt from D1 rather than from anything this script kept.

set -euo pipefail

BASE="${1:-http://localhost:8787}"
THREAD=""
ASKED=0

command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }

curl -fsS "$BASE/health" >/dev/null 2>&1 || {
  echo "No server at $BASE. Start one with 'bun run dev'." >&2
  exit 1
}

ask() {
  local message="$1"
  local body

  if [ -z "$THREAD" ]; then
    body=$(printf '{"message":%s}' "$(printf '%s' "$message" | jq -Rs .)")
  else
    body=$(printf '{"message":%s,"thread_id":"%s"}' "$(printf '%s' "$message" | jq -Rs .)" "$THREAD")
  fi

  echo
  echo "── $message"

  local response
  response=$(curl -sS -X POST "$BASE/api/chat" -H 'Content-Type: application/json' -d "$body")

  # An error body has no thread_id, so keep the one we had and say what broke.
  if [ "$(printf '%s' "$response" | jq -r 'has("error")')" = "true" ]; then
    printf '%s' "$response" | jq -r '"   ERROR:   \(.error)"'
    return
  fi

  THREAD=$(printf '%s' "$response" | jq -r '.thread_id // empty')
  ASKED=$((ASKED + 1))
  printf '%s' "$response" | jq -r '"   reply:   \(.reply // "(none)")"'
  printf '%s' "$response" | jq -r '.actions[]? | "   action:  \(.tool) ok=\(.ok) \(.error // "")"'
}

# Reads the thread back out of D1. No model, no run claim, so this is fast and
# safe to call even if a turn above failed.
replay() {
  local response turns
  response=$(curl -sS "$BASE/api/chat/$THREAD")

  turns=$(printf '%s' "$response" | jq '.turns | length')
  echo
  echo "── replaying thread $THREAD"
  echo "   $turns turn(s) rebuilt from the checkpoint, $ASKED asked"

  printf '%s' "$response" | jq -r '
    .turns
    | to_entries[]
    | "   \(.key + 1). > \(.value.message)"
      + "\n      reply:  \(.value.reply // "(none)")"
      + ( [ .value.actions[]? | "\n      action: \(.tool) ok=\(.ok)" ] | join("") )
  '

  [ "$turns" = "$ASKED" ] || {
    echo "   MISMATCH: replayed $turns turns but asked $ASKED" >&2
    return 1
  }
}

# The two ways to ask for a thread that is not there.
check_missing() {
  local unknown status
  unknown=$(printf '%s' "$THREAD" | sed 's/^......../00000000/')

  echo
  echo "── error paths"
  status=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/api/chat/$unknown")
  echo "   unknown thread: $status (want 404)"
  status=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/api/chat/not-a-uuid")
  echo "   malformed id:   $status (want 400)"
}

# One tool: a create, then two searches.
ask "show me all my tasks"
ask "Show me my unfinished tasks"
ask "What is due this week?"

# # Two tools: search then update, on a task the agent has only just seen.
ask "Mark the domain renewal as done"

# # Ambiguity: should ask rather than guess when several tasks match.
# ask "Add a task to write the backend tests"
# ask "Add a task to deploy the backend"
# ask "Mark the backend task as done"

# # Cross-turn memory: resolves against the list from the previous answer.
# ask "The first one"

# # No tool at all.
ask "Is Cloudflare a CDN?"

replay
check_missing

echo
echo "thread: $THREAD"
