#!/usr/bin/env bash
# Manual smoke test for the agent against a running server. Needs a real Groq
# key, so it is not part of `bun run test`; the automated tests script the model
# instead. Run `bun run dev` first.
#
#   ./scripts/chat-eval.sh [base-url]
#
# Every prompt runs on one chat, so the later ones exercise the memory that
# makes "the first one" resolvable. The run ends by replaying that chat out of
# the checkpoint through GET /api/chats/:chat_id, which is the same history the
# model saw, rebuilt from D1 rather than from anything this script kept.

set -euo pipefail

BASE="${1:-http://localhost:8787}"
CHAT=""
ASKED=0

command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }

curl -fsS "$BASE/health" >/dev/null 2>&1 || {
  echo "No server at $BASE. Start one with 'bun run dev'." >&2
  exit 1
}

# The first prompt creates the conversation, so it posts to the collection; the
# rest address the chat the server minted. A client cannot pick its own id.
ask() {
  local message="$1" body url response

  body=$(printf '{"message":%s}' "$(printf '%s' "$message" | jq -Rs .)")
  if [ -z "$CHAT" ]; then
    url="$BASE/api/chats"
  else
    url="$BASE/api/chats/$CHAT/messages"
  fi

  echo
  echo "── $message"

  response=$(curl -sS -X POST "$url" -H 'Content-Type: application/json' -d "$body")

  # An error body has no chat, so keep the id we had and say what broke.
  if [ "$(printf '%s' "$response" | jq -r 'has("error")')" = "true" ]; then
    printf '%s' "$response" | jq -r '"   ERROR:   \(.error)"'
    return
  fi

  CHAT=$(printf '%s' "$response" | jq -r '.chat.id // empty')
  ASKED=$((ASKED + 1))
  printf '%s' "$response" | jq -r '"   reply:   \(.reply // "(none)")"'
  printf '%s' "$response" | jq -r '.actions[]? | "   action:  \(.tool) ok=\(.ok) \(.error // "")"'
}

# Reads the chat back out of D1. No model, no run claim, so this is fast and
# safe to call even if a turn above failed.
replay() {
  local response turns counted title

  response=$(curl -sS "$BASE/api/chats/$CHAT")
  turns=$(printf '%s' "$response" | jq '.turns | length')
  counted=$(printf '%s' "$response" | jq -r '.chat.turn_count')
  title=$(printf '%s' "$response" | jq -r '.chat.title // "(untitled)"')

  echo
  echo "── replaying chat $CHAT"
  echo "   titled \"$title\""
  echo "   $turns turn(s) rebuilt from the checkpoint, $ASKED asked, $counted counted"

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
  # The counter is denormalised, so it is worth checking it against the truth.
  [ "$counted" = "$ASKED" ] || {
    echo "   MISMATCH: chat counts $counted turns but $ASKED were asked" >&2
    return 1
  }
}

# A conversation can be opened before anything is said in it, which is what a
# UI does when the user clicks "new chat".
check_empty_chat() {
  local created id turns

  echo
  echo "── empty conversation"
  created=$(curl -sS -X POST "$BASE/api/chats")
  id=$(printf '%s' "$created" | jq -r '.chat.id')
  turns=$(curl -sS "$BASE/api/chats/$id" | jq '.turns | length')
  echo "   created $id with $turns turn(s) (want 0)"
}

# List, rename, delete: the conversation as a resource rather than an endpoint.
check_crud() {
  local listed title status

  echo
  echo "── conversation CRUD"
  listed=$(curl -sS "$BASE/api/chats?limit=50" | jq --arg id "$CHAT" '[.chats[] | select(.id == $id)] | length')
  echo "   listed:   $listed (want 1)"

  title=$(curl -sS -X PATCH "$BASE/api/chats/$CHAT" \
    -H 'Content-Type: application/json' -d '{"title":"eval run"}' | jq -r '.chat.title')
  echo "   renamed:  \"$title\" (want \"eval run\")"

  status=$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/chats/$CHAT")
  echo "   deleted:  $status (want 204)"
  status=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/api/chats/$CHAT")
  echo "   and gone: $status (want 404)"
}

# The three ways to ask for a conversation that is not there.
check_missing() {
  local unknown status

  unknown=$(printf '%s' "$CHAT" | sed 's/^......../00000000/')

  echo
  echo "── error paths"
  status=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/api/chats/$unknown")
  echo "   unknown chat:    $status (want 404)"
  status=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/api/chats/not-a-uuid")
  echo "   malformed id:    $status (want 400)"
  status=$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
    "$BASE/api/chats/$unknown/messages" \
    -H 'Content-Type: application/json' -d '{"message":"hello"}')
  echo "   message to none: $status (want 404)"
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
check_empty_chat
check_missing
# Last, because it deletes the chat everything above was checking.
check_crud

echo
echo "chat: $CHAT (deleted)"
