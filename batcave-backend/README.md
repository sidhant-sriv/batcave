# batcave-backend

Task management API on Cloudflare Workers — Hono, D1, Zod, and a LangGraph agent
over Groq for the natural-language endpoint.

The agent creates, searches and updates tasks, runs a bounded tool loop, and
remembers the conversation server-side. There is no delete, auth, or user
management yet.

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
| Package manager | Bun                                               |
| Local dev       | Wrangler                                          |
| Tests           | Vitest on `@cloudflare/vitest-pool-workers`       |

## Architecture

Both entry points converge on one write path, so ids, timestamps and defaults
are produced in exactly one place. The model never touches D1: it proposes tool
arguments, which are validated by the same Zod schemas the REST routes use.

```
REST      ──► Zod ─────────────────────────┐
                                           ├─► TaskService ─► db/tasks.ts ─► D1 (tasks)
chat ─► ChatGroq ─► tool call ─► Zod ──────┘
             └───► CloudflareD1Saver ──────────────────────► D1 (checkpoints, writes)
             └───► agent_runs claim ────────────────────────► D1 (agent_runs)
```

The checkpointer is the one exception to "`db/tasks.ts` is the only file that
speaks SQL": it owns its own two tables, whose schema lives in migration `0002`.

```
src/
├── index.ts                       Hono app, routing, error mapping
├── ids.ts                         uuidv7() and derivedUuid()
├── routes/
│   ├── tasks.ts                   REST: POST, GET (filtered), GET /:id, PATCH
│   ├── searchParams.ts            query-string bag to filter object
│   └── chat.ts                    POST /api/chat: threads, claims, takeover
├── agent/
│   ├── agent.ts                   buildAgent(env), recursion limit, thread config
│   ├── model.ts                   ChatGroq construction
│   ├── prompt.ts                  system prompt, rebuilt per model call
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
├── services/taskService.ts        Single source of truth for reads and writes
├── db/
│   ├── tasks.ts                   Task SQL, including buildSearchQuery()
│   └── agentState.ts              agent_runs SQL, checkpoint pruning
├── schemas/task.ts                Zod schemas shared by REST and the tools
└── types/task.ts                  Task model, status/priority, Env

migrations/
├── 0001_create_tasks.sql
└── 0002_agent_state.sql           checkpoints, writes, agent_runs
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
| `limit`    | 1–100, default 20                                         |

```sh
curl 'http://localhost:8787/api/tasks?status=todo,in_progress&query=cloudflare'
```

```json
{ "tasks": [ { "...": "..." } ], "truncated": false }
```

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

### `POST /api/chat`

```sh
curl -X POST http://localhost:8787/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message": "Create a high priority task to finish the backend by Friday."}'
```

```json
{
  "thread_id": "0199...",
  "reply": "Added \"Finish the backend\", due 11 September, at high priority.",
  "actions": [{ "tool": "create_task", "ok": true, "task": { "...": "..." } }]
}
```

Send `thread_id` back on the next request to continue the conversation; omit it
to start a new one. History lives in D1, so the client holds nothing but the id:

```sh
curl -X POST http://localhost:8787/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message": "Mark the first one as done", "thread_id": "0199..."}'
```

`actions` is what actually ran, so a UI can render created and updated tasks
without parsing the prose. `reply` is the assistant's text, or `null` if it only
called tools.

**`Idempotency-Key`.** Send one and a retry of the same turn returns the stored
response instead of running it again. Without the header the key is derived from
the thread's state plus the message, which covers an honest retry but is not
exact — send the header if the client retries on timeouts.

Only one turn runs on a thread at a time; a second concurrent request gets
`409`.

### `GET /health`

```json
{ "status": "ok" }
```

### Errors

| Status | Meaning                                                           |
| ------ | ----------------------------------------------------------------- |
| 400    | Malformed JSON, or Zod validation failed (`issues` included)       |
| 404    | Unknown route, or an unknown task id on `PATCH`/`GET /:id`         |
| 409    | Another turn is already running on this `thread_id`                |
| 500    | `GROQ_API_KEY` unset, or an unexpected failure                     |
| 502    | Groq unreachable or returned an error                              |
| 503    | A tool could not reach the database; the turn is resumable         |
| 504    | Groq timed out                                                     |

A turn that hits the round limit is still a `200`: the reply says it could not
finish and `actions` lists what did run.

## How the agent behaves

- **Bounded loop.** At most 5 tool rounds per turn, enforced by LangGraph's
  recursion limit.
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
bun run db:migrate:remote   # 0002 has not been applied remotely yet
bun run deploy
```

Rotate the key with `bunx wrangler secret put GROQ_API_KEY`.

Note that the local D1 database is keyed by `database_id`, so if that id ever
changes you need to re-run `bun run db:migrate:local` against the fresh local
database.

## Extending

- **More endpoints** — add a route file under `src/routes/`, mount it in `index.ts`.
- **More agent tools** — add a file under `src/agent/tools/` and register it in
  `tools/index.ts`. Every tool validates with Zod, goes through a service rather
  than straight to D1, and returns a compact JSON envelope.
- **Long conversations** — `summarizationMiddleware` or `trimMessages` in a
  `wrapModelCall` caps what the model sees. Checkpoint rows are already pruned
  to the newest three per thread after every turn.
- **Strict concurrency** — the run claim bounds it, but its TTL is the weak
  point. Moving the graph into a Durable Object is the structural fix.
- **Auth** — Hono middleware in `index.ts`, ahead of the route mounts.

## Design notes

`docs/LANGGRAPH_PLAN.md` is the plan this implementation follows, including why
LangGraph rather than Cloudflare Think (`docs/THINK_RESEARCH.md`), and what each
failure point leaves behind. `docs/V2_PLAN.md` covers the search and update
design.
