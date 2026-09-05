#!/usr/bin/env bash
# Manual smoke test for the agent against a running server. Needs a real Groq
# key, so it is not part of `bun run test`; the automated tests script the model
# instead. Run `bun run dev` first.
#
#   ./scripts/chat-eval.sh [base-url]
#
# Every prompt runs on one thread, so the later ones exercise the memory that
# makes "the first one" resolvable.

set -euo pipefail

BASE="${1:-http://localhost:8787}"
THREAD=""

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

  THREAD=$(printf '%s' "$response" | jq -r '.thread_id // empty')
  printf '%s' "$response" | jq -r '"   reply:   \(.reply // "(none)")"'
  printf '%s' "$response" | jq -r '.actions[]? | "   action:  \(.tool) ok=\(.ok) \(.error // "")"'
}

command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }

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

echo
echo "thread: $THREAD"
