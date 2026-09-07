# batcave-backend

Task management API on Cloudflare Workers — Hono, D1, Zod, and a LangGraph agent
over Groq for the natural-language endpoint.

The agent creates, searches and updates tasks, runs a bounded tool loop, and
remembers the conversation server-side. Conversations are full CRUD; tasks have
no delete yet.

The same six capabilities are also served over [MCP](#mcp) at `/mcp`, so any MCP
client can drive the task list. Both surfaces sit behind one OAuth 2.1
authorization server with GitHub sign-in, and every task and conversation
belongs to the login that created it — see [Authorization](#authorization).

## Stack

| Concern         | Choice                                            |
| --------------- | ------------------------------------------------- |
| Runtime         | Cloudflare Workers                                |
| HTTP            | Hono                                              |
| Database        | Cloudflare D1 (binding `DB`)                      |
| Validation      | Zod                                               |
| Agent           | LangGraph via `langchain`'s `createAgent`         |
| LLM             | Groq, through `@langchain/groq`                   |
| Conversation    | D1 checkpointer (`langgraph-checkpoint-cloudflare-d1`) |
| MCP             | `@modelcontextprotocol/server` via `agents/mcp/server` |
| OAuth           | `@cloudflare/workers-oauth-provider` (binding `OAUTH_KV`) |
| Package manager | Bun                                               |
| Local dev       | Wrangler                                          |
| Tests           | Vitest on `@cloudflare/vitest-pool-workers`       |

## Architecture

Both entry points converge on one write path, so ids, timestamps and defaults
are produced in exactly one place. The model never touches D1: it proposes tool
arguments, which are validated by the same Zod schemas the REST routes use.

```
REST       ──► Zod ────────────────────────┐
MCP        ──► Zod ────────────────────────┤
                                           ├─► TaskService ─► db/tasks.ts ─► D1 (tasks)
chats ─► ChatGroq ─► tool call ─► Zod ─────┘        │
  │           └───► CloudflareD1Saver ──────────────┼──────► D1 (checkpoints, writes)
  │           └───► agent_runs claim ───────────────┼──────► D1 (agent_runs)
  └───► ChatService ─────────────────────► db/chats.ts ────► D1 (chats, chat_threads)

Every service is constructed with the login it acts for, and every statement
in db/ carries it. The Workflow is the one caller that passes SYSTEM instead.
```

The checkpointer is the one exception to "`db/tasks.ts` is the only file that
speaks SQL": it owns its own two tables, whose schema lives in migration `0002`.

A **chat** is the conversation a client holds a handle to; a **thread** is the
LangGraph checkpoint partition it runs on. `chat_threads` maps one to the other,
one row per chat today. They are kept apart so that compaction can move a chat
onto a fresh thread without the client's handle changing, and so ownership has
somewhere to live — which it now does, as `chats.user_id`. `ChatService` is the
only thing that knows which thread a chat is on; callers deal in chat ids.

```
src/
├── index.ts                       Hono app, routing, error mapping, OAuthProvider
├── ids.ts                         uuidv7() and derivedUuid()
├── actor.ts                       Actor: a login, or SYSTEM for the Workflow
├── origins.ts                     CORS_ORIGINS: allowlist and OAuth redirect URIs
├── middleware/auth.ts             requireUser: bearer to c.get('user')
├── routes/
│   ├── tasks.ts                   REST: POST, GET (filtered), GET /:id, PATCH
│   ├── searchParams.ts            query-string bag to filter object
│   ├── auth.ts                    /api/auth: config (open) and me
│   └── chat.ts                    /api/chats: turns, claims, takeover, history
├── oauth/
│   ├── github.ts                  /authorize, /callback, the GitHub round trip
│   ├── webClient.ts               the frontend, registered as a public client
│   ├── consent.ts                 the consent page, for third-party clients
│   └── state.ts                   single-use state tokens in KV
├── mcp/                           server.ts, handler.ts, result.ts
├── agent/
│   ├── agent.ts                   buildAgent(env, owner), recursion limit, config
│   ├── model.ts                   ChatGroq construction
│   ├── prompt.ts                  system prompt, rebuilt per model call
│   ├── state.ts                   agent state: the messages channel and reducer
│   ├── history.ts                 a thread read back out of the checkpoint
│   ├── checkpointer.ts            D1Saver: the saver, minus its per-request DDL
│   ├── runs.ts                    run keys, claim/complete/fail, TTL
│   ├── taskId.ts                  task id derived from a tool call id
│   ├── format.ts                  reply, actions and seen-ids from messages
│   ├── modelErrors.ts             Groq failures to HTTP statuses
│   ├── middleware/
│   │   ├── taskIdGuard.ts         update_task only for ids seen in this thread
│   │   ├── escalate.ts            infrastructure errors leave the graph
│   │   └── sequentialToolCalls.ts parallel_tool_calls: false
│   └── tools/                     create_task, search_tasks, update_task
├── services/
│   ├── taskService.ts             Single source of truth for reads and writes
│   └── chatService.ts             Conversations: chats, their threads, history
├── db/
│   ├── owner.ts                   the ownership predicate, spelled once
│   ├── tasks.ts                   Task SQL, including buildSearchQuery()
│   ├── chats.ts                   chats and chat_threads SQL
│   └── agentState.ts              agent_runs SQL, pruning, thread deletion
├── schemas/
│   ├── fields.ts                  optionalText, clearableText
│   ├── task.ts                    Zod schemas shared by REST and the tools
│   └── chat.ts                    chat id, rename, list options
└── types/task.ts                  Task model, status/priority, Env

migrations/
├── 0001_create_tasks.sql
├── 0002_agent_state.sql           checkpoints, writes, agent_runs
├── 0003_chats.sql                 chats, chat_threads, backfill from agent_runs
├── 0004_schedules.sql             schedules, notifications
└── 0005_ownership.sql             user_id on tasks and chats, owner-first indexes
```

## Setup

```sh
bun install
cp .dev.vars.example .dev.vars   # then paste your Groq key
```

`.dev.vars` holds the local secret and is gitignored — never commit it.

```
GROQ_API_KEY=gsk_...
```

Apply the migrations to the local D1 database:

```sh
bun run db:migrate:local
```

Run the Worker, the tests, or the type checker:

```sh
bun run dev          # http://localhost:8787
bun run test
bun run typecheck
```

## API

### `POST /api/tasks`

```sh
curl -X POST http://localhost:8787/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title": "Build the backend", "priority": "high", "due_date": "2026-09-10"}'
```

`201 Created` with `{ "task": { ... } }`. Only `title` is required. `priority`
defaults to `medium`, `status` is always `todo` on creation, and
`id`/`created_at`/`updated_at` are server-generated.

### `GET /api/tasks`

Every filter is optional and they narrow the result together. Arrays are
accepted as repeated keys or comma-separated.

| Param      | Notes                                                     |
| ---------- | --------------------------------------------------------- |
| `query`    | free text; every whitespace-separated term must match the title or description |
| `status`   | `todo`, `in_progress`, `done`                             |
| `priority` | `low`, `medium`, `high`                                   |
| `due_from` | inclusive `YYYY-MM-DD`; excludes undated tasks            |
| `due_to`   | inclusive `YYYY-MM-DD`; excludes undated tasks            |
| `scheduled`| `true` for tasks with an active reminder or cron, `false` for those without; omit for both |
| `limit`    | 1–100, default 20                                         |

```sh
curl 'http://localhost:8787/api/tasks?status=todo,in_progress&query=cloudflare'
```

```json
{ "tasks": [ { "...": "..." } ], "truncated": false }
```

Each task carries its active schedule joined in — `"schedule": { "kind",
"cron", "next_at" }`, or `null` when nothing notifies about it. A due date is
when work is expected; a schedule is when the user hears about it, so
`scheduled` and `due_from`/`due_to` answer different questions.

`truncated` is true when more rows matched than `limit`. Results are ordered
dated-first, then by due date, then priority, then age.

### `PATCH /api/tasks/:id`

Merge semantics: an absent field is left alone, `null` clears it. At least one
field is required, and unknown keys are rejected rather than ignored.

```sh
curl -X PATCH http://localhost:8787/api/tasks/$ID \
  -H 'Content-Type: application/json' \
  -d '{"status": "done", "due_date": null}'
```

`200` with `{ "task": { ... } }`, or `404` if the id is not there.

### `POST /api/chats`

Starts a conversation. Send a message with it to run the first turn in the same
request, or send nothing to open an empty one:

```sh
curl -X POST http://localhost:8787/api/chats \
  -H 'Content-Type: application/json' \
  -d '{"message": "Create a high priority task to finish the backend by Friday."}'
```

```json
{
  "chat": {
    "id": "01a0...",
    "title": "Create a high priority task to finish the backend by Fri...",
    "turn_count": 1,
    "created_at": "2026-09-05T12:15:10.291Z",
    "last_message_at": "2026-09-05T12:15:12.702Z"
  },
  "reply": "Added \"Finish the backend\", due 11 September, at high priority.",
  "actions": [{ "tool": "create_task", "ok": true, "task": { "...": "..." } }]
}
```

`201` either way. Without a message the body is just `{ "chat": { ... } }`. A
chat names itself after its first message and counts turns as they are answered;
both are server-owned, and the id is server-minted — a client cannot choose one.

### `POST /api/chats/:chat_id/messages`

Continues the conversation. History lives in D1, so the client holds nothing but
the id:

```sh
curl -X POST http://localhost:8787/api/chats/01a0.../messages \
  -H 'Content-Type: application/json' \
  -d '{"message": "Mark the first one as done"}'
```

`200` with the same body as above. `actions` is what actually ran, so a UI can
render created and updated tasks without parsing the prose. `reply` is the
assistant's text, or `null` if it only called tools. `404` if the chat is not
there — an unknown id is never created on the way past.

**`Idempotency-Key`.** Send one and a retry of the same turn returns the stored
response instead of running it again. Without the header the key is derived from
the conversation's state plus the message, which covers an honest retry but is
not exact — send the header if the client retries on timeouts.

Only one turn runs on a conversation at a time; a second concurrent request gets
`409`.

### `GET /api/chats/:chat_id`

The conversation so far, as turns:

```sh
curl http://localhost:8787/api/chats/01a0...
```

```json
{
  "chat": { "id": "01a0...", "title": "Renew the domain", "turn_count": 1, "...": "..." },
  "turns": [
    {
      "message": "Add a task to renew the domain by Friday",
      "reply": "Added \"Renew the domain\", due 11 September.",
      "actions": [{ "tool": "create_task", "ok": true, "task": { "...": "..." } }]
    }
  ]
}
```

Each turn has the same shape as a turn response, so a client can render replayed
history and a live reply with one code path. It reads the checkpoint directly:
no run is claimed, the model is never called, and a conversation whose last turn
failed still reads back. `404` if the chat is not there.

### `GET /api/chats`

Conversations, newest first. Metadata only — turns would cost a checkpoint
decode per chat, which is what `turn_count` exists to avoid:

```sh
curl 'http://localhost:8787/api/chats?limit=20'
```

```json
{
  "chats": [
    {
      "id": "01a0...",
      "title": "Add a task to renew the domain by Friday",
      "turn_count": 3,
      "created_at": "2026-09-05T12:15:10.291Z",
      "last_message_at": "2026-09-05T12:19:44.108Z"
    }
  ],
  "truncated": false
}
```

`limit` is 1–100, default 20. `truncated` is true when more chats matched.

### `PATCH /api/chats/:chat_id`

`title` is the only field a client owns; everything else is server-generated, so
anything else in the body is rejected rather than ignored.

```sh
curl -X PATCH http://localhost:8787/api/chats/01a0... \
  -H 'Content-Type: application/json' \
  -d '{"title": "Domain admin"}'
```

`200` with `{ "chat": { ... } }`. `{"title": null}` puts it back to untitled, and
the next message will auto-name it again.

### `DELETE /api/chats/:chat_id`

```sh
curl -X DELETE http://localhost:8787/api/chats/01a0...
```

`204`. Clears the conversation, its threads, and every checkpoint, write and run
row the agent left behind. `409` while a turn is still running, rather than
leaving the graph writing checkpoints nothing points at.

### `GET /health`

```json
{ "status": "ok" }
```

### CORS

`batcave-frontend` is a separate Pages deployment, so every browser call is
cross-origin. `/api/*` is wrapped in `hono/cors` with an allowlist read from the
`CORS_ORIGINS` var — comma separated, defaulting to `http://localhost:5173`:

```jsonc
"vars": { "CORS_ORIGINS": "http://localhost:5173,https://batcave-frontend.pages.dev" }
```

Allowlisted rather than `*` because `Idempotency-Key` and `Authorization` are
non-simple headers: the browser preflights any request that sends one, and a
wildcard would not name them. The request's own origin is echoed back, so the response stays cacheable per
origin. An origin that is not listed simply gets no `Access-Control-Allow-Origin`
header, which the browser turns into a blocked request.

Add the Pages URL here and redeploy the Worker after the first `pages deploy`.
The same var decides the frontend's registered OAuth redirect URIs
(`<origin>/auth/callback`), so an origin only has to be named once.

### Errors

| Status | Meaning                                                           |
| ------ | ----------------------------------------------------------------- |
| 400    | Malformed JSON, or Zod validation failed (`issues` included)       |
| 404    | Unknown route, an unknown task id, or an unknown `chat_id`         |
| 409    | A turn is already running on this conversation (send, or delete)   |
| 500    | `GROQ_API_KEY` unset, or an unexpected failure                     |
| 502    | Groq unreachable or returned an error                              |
| 503    | A tool could not reach the database; the turn is resumable         |
| 504    | Groq timed out                                                     |

A turn that hits the round limit is still a `200`: the reply says it could not
finish and `actions` lists what did run.

## MCP

`/mcp` is a remote [Model Context Protocol](https://modelcontextprotocol.io)
server speaking the 2026-07-28 revision. It offers the same six tools the
in-app agent has, plus three read-only resources, to any MCP client.

```sh
claude mcp add --transport http batcave https://batcave-backend.<account>.workers.dev/mcp
```

The first call opens a browser: a consent page, then GitHub, then back. After
that the client holds a token and the tools are available.

### What it offers

| Tool | Hints | Does |
| --- | --- | --- |
| `create_task` | — | Creates a task |
| `search_tasks` | read-only | Filters by keyword, status, priority, due date, whether it is scheduled |
| `update_task` | idempotent | Changes any field; `null` clears `description` or `due_date` |
| `schedule_reminder` | idempotent | One notification at an absolute time |
| `schedule_recurring` | idempotent | Five-field cron in UTC, no more often than every 15 minutes |
| `cancel_schedule` | destructive | Ends a task's schedule |

| Resource | Holds |
| --- | --- |
| `batcave://tasks/open` | Every task not yet done, with each one's schedule |
| `batcave://tasks/{id}` | One task and its active schedule |
| `batcave://schedules/upcoming` | Active schedules and when each next fires |

Tools act, resources are context. A client that wants to reason about the list
reads a resource; a client that wants to change it calls a tool.

### The server is stateless

The 2026-07-28 revision dropped the `initialize` handshake and session ids:
every request carries its own protocol version and capabilities. So there is no
Durable Object here and no `McpAgent` — the services, the MCP server and the
handler are all built per request, exactly like the REST routes, and
`src/mcp/handler.ts` is a plain `fetch`.

### Two things the agent has that MCP does not

**`taskIdGuard`.** The agent refuses a task id the model never saw in a search
result on that thread, because there the conversation and the tool calls are
one process. Over MCP the conversation lives in the client and the server sees
one call at a time, so there is no thread to check against. The services still
reject a malformed id and a row that is not there.

**Exactly-once creates.** The agent derives a task's primary key from
LangChain's `toolCallId`, so a retried tool call upserts. MCP has no per-call
identifier a server may trust — JSON-RPC ids are chosen by the client and
restart at 1 each session — so `create_task` mints a `uuidv7()` and is
at-least-once under client retry.

### Errors

A tool handler cannot signal "this call did not happen" by throwing: the SDK
catches it and returns the message as an `isError` result. So `src/mcp/result.ts`
keeps the classification `src/agent/tools/envelope.ts` uses and changes the
action — a caller's mistake comes back with the service's own message, and
anything else is logged and answered with a generic refusal. Resource reads are
the other half: there a throw is right, because `ResourceNotFoundError` maps
onto the JSON-RPC error the protocol defines for a URI that is not there.

## Authorization

`/mcp` sits behind an OAuth 2.1 authorization server
(`@cloudflare/workers-oauth-provider`). The library owns token issuance, PKCE,
client registration and the discovery documents; this Worker owns the part the
library cannot do, which is deciding who the user is.

```
client → POST /mcp                     401 + WWW-Authenticate: resource_metadata=…
       → /.well-known/oauth-protected-resource/mcp
       → /.well-known/oauth-authorization-server
       → POST /oauth/register          (or a Client ID Metadata Document)
       → GET  /authorize               consent page  ┐ ours
       → POST /authorize               → github.com  │ src/oauth/github.ts
       → GET  /callback                → code        ┘
       → POST /oauth/token             access token
       → POST /mcp  + Bearer           tools

browser → GET  /api/auth/config        client id + endpoints, the one open route
        → GET  /authorize              → github.com   (consent skipped, see below)
        → GET  /callback               → code
        → POST /oauth/token            access token + refresh token
        → GET  /api/tasks + Bearer     tasks
```

Who guards what:

| Property | Owner |
| --- | --- |
| PKCE, redirect-URI matching, single-use codes, hashed tokens, encrypted grant props, TTLs | library |
| Consent CSRF: a signed nonce cookie double-submitted with the form | ours |
| Upstream state: 256 random bits, parked in KV, deleted on read, paired with a signed cookie so the browser that returns is the one that left | ours |
| Least privilege: GitHub `read:user` only; the GitHub token is used once and never stored | ours |

Both cookies are `HttpOnly`, `SameSite=Lax`, ten minutes, and `Secure` on
https. On `http://localhost` they are not `Secure`, which Safari needs; Chrome
and Firefox treat localhost as secure either way.

### Two doors, one lock

Everything under `/api` is closed too, but guarded by `requireUser`
(`src/middleware/auth.ts`) inside the Hono app rather than by the library's
`apiRoute`. Both check the same tokens with the same `unwrapToken`; the split is
about what a caller gets when the check fails. The library answers `OPTIONS` on
anything it guards with `Access-Control-Allow-Origin` echoing whatever origin
asked, which would replace the deliberate allowlist above, and its 401 body is
RFC 9728 discovery — right for an MCP client, unreadable by the frontend's
`ApiError`. `/health` and the OAuth endpoints are the only open routes, plus
`/api/auth/config`, which exists because a browser with no token has to find out
where to get one.

### The frontend as a client

The web app is a public client of this same server: no secret, PKCE only. It is
registered on first use by `ensureWebClient` (`src/oauth/webClient.ts`), with a
redirect URI per `CORS_ORIGINS` entry, and its generated id is remembered in
`OAUTH_KV`. So there is no client id to configure anywhere — the frontend reads
one from `/api/auth/config`, and the GitHub OAuth app needs no new callback URL
because it only ever redirects to this Worker.

Consent is skipped for that one client and shown to every other. "Allow Batcave
to access Batcave?" is not a delegation anyone can meaningfully refuse, and
asking teaches people to click through consent screens without reading them.
Nothing else is skipped with it: the state token is still parked in KV and bound
to the browser by a signed cookie, which is what the callback actually checks.

**Bearer tokens rather than a session cookie**, because the frontend is on
`pages.dev` and this Worker on `workers.dev`. Both are on the public suffix
list, so those are separate sites and a session cookie between them would need
`SameSite=None` — which Safari blocks. The access token lives in memory and the
refresh token in `localStorage`, where any script on that origin can read it;
that is the real cost of a cross-site API, and a same-origin deployment serving
the frontend from this Worker could use an `HttpOnly` cookie instead and be
strictly safer.

### Ownership

`tasks.user_id` and `chats.user_id` hold the GitHub login. `schedules` and
`notifications` have no column of their own: both already reference
`tasks(id) ON DELETE CASCADE`, so the task is where ownership lives and the
queries reach it through `task_id`.

There is no `users` table. The OAuth grant is already the user registry —
`completeAuthorization` stores the login as its `userId` — and a copy in D1
could only go stale.

Scoping is structural rather than a review habit. Every function in `src/db/`
that touches an owned row takes the owner as a required argument, and every
service is constructed with it, so a query that forgets to scope itself does not
compile. `ScheduleService` is the only one that accepts a `SYSTEM` symbol
instead of a login, for its only caller with nobody behind it: the Workflow,
which wakes hours or weeks after the request that created its schedule.

A task belonging to someone else answers 404, never 403. Whether an id exists is
not a stranger's business.

### Local development

Register a GitHub OAuth app with a callback of `http://localhost:8787/callback`,
then fill in `.dev.vars` from `.dev.vars.example`. Check both doors:

```sh
curl -i http://localhost:8787/api/tasks
# HTTP/1.1 401 Unauthorized
# WWW-Authenticate: Bearer realm="batcave", scope="tasks"
# {"error":"Sign in to use this API"}

curl -i -X POST http://localhost:8787/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
# HTTP/1.1 401 Unauthorized
# WWW-Authenticate: Bearer …resource_metadata="http://localhost:8787/.well-known/oauth-protected-resource/mcp"
```

The port matters: the redirect URI the Worker sends to GitHub is derived from
the request, so a dev server that lands on a port other than 8787 gets
`redirect_uri_mismatch` until that port is registered too.

## How the agent behaves

- **Bounded loop.** At most 5 tool rounds per turn, enforced by LangGraph's
  recursion limit.
- **Memory is the message list.** `src/agent/state.ts` declares one state
  channel, `messages`, backed by LangGraph's `MessagesValue`. Its reducer
  appends and replaces-by-id, and the checkpointer writes the whole list on
  every super-step, so the newest checkpoint alone reconstructs the thread.
- **One tool call at a time.** `parallel_tool_calls: false` is sent to Groq, so
  a search and an update are never proposed in the same round.
- **Read before write.** `update_task` only accepts an id that appeared in a
  `search_tasks` or `create_task` result in this thread. A model that invents or
  misremembers an id gets a tool error telling it to search first, and recovers
  on the next round. This is enforced in code, not by the prompt.
- **Retries do not duplicate.** A `create_task` id is derived from the tool call
  that made it, and the insert is an upsert, so re-running an interrupted tool
  call lands on the same row.
- **Failures surface.** A tool that cannot reach D1 leaves the graph rather than
  handing the model an error to apologise about, so the client sees `503` and
  the turn is retried by the next request on the thread.

## Inspecting D1 locally

```sh
bun run db:query:local "SELECT * FROM tasks;"
bun run db:query:local "SELECT run_key, status, attempts, message FROM agent_runs;"
```

## Task model

| Column        | Notes                                        |
| ------------- | -------------------------------------------- |
| `id`          | UUID; v7 from REST, v8 derived from the tool call for the agent |
| `user_id`     | the owner's GitHub login; see [Ownership](#ownership) |
| `title`       | required, 1–200 chars                        |
| `description` | optional; blank strings stored as `NULL`     |
| `status`      | `todo` \| `in_progress` \| `done`            |
| `priority`    | `low` \| `medium` \| `high`                  |
| `due_date`    | optional `YYYY-MM-DD`                        |
| `created_at`  | ISO 8601, server-generated                   |
| `updated_at`  | ISO 8601, server-generated                   |

`status` and `priority` are enforced by both Zod and D1 `CHECK` constraints.

## Groq model

Configured via the `GROQ_MODEL` var in `wrangler.jsonc`, defaulting to the same
value in `src/agent/model.ts`. It must support tool calling. To see what your
key can reach:

```sh
curl -s https://api.groq.com/openai/v1/models \
  -H "Authorization: Bearer $GROQ_API_KEY"
```

## Tests

```sh
bun run test
```

Tests run inside workerd against a real local D1 with the migrations applied, so
the SQL, the D1 driver and the checkpointer schema are exercised for real. No
test calls Groq: the agent tests inject a scripted model, and the wire tests
inject a canned `fetch` to assert on the request body.

The pool ships its own workerd, older than the project's compatibility date, so
`vitest.config.ts` pins the date the test runtime accepts. `wrangler.jsonc` keeps
the production date.

## Deploying

The remote resources are already provisioned:

- D1 database `batcave-db` (`43c4d147-b426-4ac3-859f-d2daaeae1b5f`, region APAC),
  with its id set in `wrangler.jsonc`
- Worker `batcave-backend` created, with `GROQ_API_KEY` uploaded as a secret

```sh
bun run db:migrate:remote   # migrate before deploying, not after
bun run deploy
```

Order matters from `0005` on: the Worker's queries name `user_id`, so deploying
first leaves every request referencing a column that is not there yet.

### Claiming the pre-auth rows (one-off, per deployment)

`0005` adds the owner column and backfills nothing, so tasks and chats created
before there were accounts have a null owner and belong to no one — the
fail-closed half of that migration's design. On a fresh database there is
nothing to do. On a database with data predating auth, hand it to a login once:

```sh
bunx wrangler d1 execute batcave-db --remote \
  --command "UPDATE tasks SET user_id = 'your-github-login' WHERE user_id IS NULL;
             UPDATE chats SET user_id = 'your-github-login' WHERE user_id IS NULL;"
```

Deliberately not in the migration. Which account owns one deployment's history
is a fact about that deployment, not about the shape of the database, and a
migration that hardcodes a GitHub login is one every fork of this repository
would inherit. Sign in first and check `GET /api/auth/me` for the exact login
before running it — a typo here strands the rows rather than failing loudly.

Rotate the key with `bunx wrangler secret put GROQ_API_KEY`.

Note that the local D1 database is keyed by `database_id`, so if that id ever
changes you need to re-run `bun run db:migrate:local` against the fresh local
database.

## Extending

- **More endpoints** — add a route file under `src/routes/`, mount it in `index.ts`.
- **More agent tools** — add a file under `src/agent/tools/` and register it in
  `tools/index.ts`. Every tool validates with Zod, goes through a service rather
  than straight to D1, and returns a compact JSON envelope.
- **Long conversations** — nothing caps context yet: every turn ships the whole
  history to Groq. Cap it in a `wrapModelCall`, which rewrites only the model
  payload — `contextEditingMiddleware` with `ClearToolUsesEdit` fits, since the
  bulk is old tool-result JSON. Not `summarizationMiddleware`: it returns
  `RemoveMessage({ id: REMOVE_ALL_MESSAGES })` and so rewrites persisted state,
  which would delete the tool results `taskIdGuard` reads ids from and the
  message ids `turnAfter` looks for. Checkpoint *rows* are already pruned to the
  newest three per thread, which costs no history.
- **Strict concurrency** — the run claim bounds it, but its TTL is the weak
  point. Moving the graph into a Durable Object is the structural fix.
- **Deleting an account** — nothing removes a user's rows. `DELETE FROM tasks
  WHERE user_id = ?` cascades to schedules and notifications; chats need the
  checkpoints and run rows gone first, which `ChatService.remove` already does
  per chat. The running Workflow instances would need terminating too.
- **Per-account settings** — there is no `users` table, on purpose: the OAuth
  grant is the registry. The first thing that genuinely belongs to a person
  rather than to a device is what should create one.
- **Streaming** — deliberately not built: turns land in a couple of seconds, so
  a response-based client is fine. If it is ever wanted, `streamSSE` from
  `hono/streaming` plus `agent.stream(state, config)` covers it, and the last
  event should carry today's `{ chat, reply, actions }` body so replay and
  non-streaming clients need no second code path. Three things bite: once SSE
  headers are sent no status code can change, so `escalate`'s 503 and
  `classifyModelError`'s 502/504 have to become in-stream events; `fail()` must
  run before the stream closes rather than by rethrowing to `onError`; and
  `ScriptedModel` needs `_streamResponseChunks`, or token tests pass while
  asserting one chunk that happens to be the whole reply.

## Design notes

`docs/LANGGRAPH_PLAN.md` is the plan this implementation follows, including why
LangGraph rather than Cloudflare Think (`docs/THINK_RESEARCH.md`), and what each
failure point leaves behind. `docs/V2_PLAN.md` covers the search and update
design.
