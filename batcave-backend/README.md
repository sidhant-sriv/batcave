# batcave-backend

Task management API on Cloudflare Workers — Hono, D1, Zod, and a Groq-powered
natural-language endpoint.

This first iteration supports **task creation only**. There is no search,
update, delete, auth, or user management yet.

## Stack

| Concern       | Choice                              |
| ------------- | ----------------------------------- |
| Runtime       | Cloudflare Workers                  |
| HTTP          | Hono                                |
| Database      | Cloudflare D1 (binding `DB`)        |
| Validation    | Zod                                 |
| LLM           | Groq (OpenAI-compatible API)        |
| Package manager | Bun                               |
| Local dev     | Wrangler                            |

## Architecture

Both entry points converge on one write path, so ids, timestamps and defaults
are produced in exactly one place:

```
POST /api/tasks ──► Zod ──────────────────┐
                                          ├──► TaskService.create() ──► db/tasks.ts ──► D1
POST /api/chat ──► Groq ──► create_task ──┘
                            tool call
                            + Zod
```

The LLM never touches D1. It only proposes tool arguments, which are re-validated
with the same `createTaskSchema` before `TaskService` writes anything.

```
src/
├── index.ts                    Hono app, routing, error mapping
├── routes/
│   ├── tasks.ts                POST /api/tasks
│   └── chat.ts                 POST /api/chat
├── agent/
│   ├── agent.ts                Groq call + tool dispatch
│   └── tools/createTask.ts     Tool definition, arg validation
├── services/taskService.ts     Single source of truth for writes
├── db/tasks.ts                 The only file that talks to D1
├── schemas/task.ts             Zod schemas
└── types/task.ts               Task model, status/priority, Env

migrations/0001_create_tasks.sql
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

Apply the migration to the local D1 database:

```sh
bun run db:migrate:local
```

Run the Worker:

```sh
bun run dev          # http://localhost:8787
```

## API

### `POST /api/tasks`

```sh
curl -X POST http://localhost:8787/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Build the backend",
    "description": "Implement the initial API",
    "priority": "high",
    "due_date": "2026-09-10"
  }'
```

`201 Created`:

```json
{
  "task": {
    "id": "d786f365-b155-4a0d-b89e-e18e52422d5e",
    "title": "Build the backend",
    "description": "Implement the initial API",
    "status": "todo",
    "priority": "high",
    "due_date": "2026-09-10",
    "created_at": "2026-09-04T11:24:39.735Z",
    "updated_at": "2026-09-04T11:24:39.735Z"
  }
}
```

Only `title` is required. `priority` defaults to `medium`, `status` is always
`todo` on creation, and `id`/`created_at`/`updated_at` are generated
server-side — values sent by the client for those are ignored.

### `POST /api/chat`

```sh
curl -X POST http://localhost:8787/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message": "Create a high priority task to finish the backend by Friday."}'
```

When Groq calls `create_task`, the arguments are validated and persisted, and
the response is `201` with the created task:

```json
{ "task": { "...": "..." }, "message": null }
```

When the message is not a task request, no tool is called and the reply comes
back as `200` with `task: null`:

```json
{ "task": null, "message": "The capital of France is Paris." }
```

### `GET /health`

```json
{ "status": "ok" }
```

### Errors

| Status | Meaning                                                   |
| ------ | --------------------------------------------------------- |
| 400    | Malformed JSON, or Zod validation failed (`issues` included) |
| 404    | Unknown route                                             |
| 500    | `GROQ_API_KEY` unset, or an unexpected/database failure     |
| 502    | Groq unreachable or returned an error                      |

## Inspecting D1 locally

```sh
bun run db:query:local "SELECT * FROM tasks;"
```

## Task model

| Column        | Notes                                    |
| ------------- | ---------------------------------------- |
| `id`          | UUID, generated server-side              |
| `title`       | required, 1–200 chars                    |
| `description` | optional; blank strings stored as `NULL` |
| `status`      | `todo` \| `in_progress` \| `done`        |
| `priority`    | `low` \| `medium` \| `high`              |
| `due_date`    | optional `YYYY-MM-DD`                    |
| `created_at`  | ISO 8601, server-generated               |
| `updated_at`  | ISO 8601, server-generated               |

`status` and `priority` are enforced by both Zod and D1 `CHECK` constraints.

## Groq model

Configured via the `GROQ_MODEL` var in `wrangler.jsonc`, defaulting to
`openai/gpt-oss-120b`. It must support tool calling. To see what your key can
reach:

```sh
curl -s https://api.groq.com/openai/v1/models \
  -H "Authorization: Bearer $GROQ_API_KEY"
```

## Deploying

The remote resources are already provisioned:

- D1 database `batcave-db` (`43c4d147-b426-4ac3-859f-d2daaeae1b5f`, region APAC),
  with migration `0001` applied and its id set in `wrangler.jsonc`
- Worker `batcave-backend` created, with `GROQ_API_KEY` uploaded as a secret

So a deploy is just:

```sh
bun run deploy
```

Re-run these only when something changes:

```sh
bun run db:migrate:remote            # after adding a migration
bunx wrangler secret put GROQ_API_KEY  # to rotate the key
```

Note that the local D1 database is keyed by `database_id`, so if that id ever
changes you need to re-run `bun run db:migrate:local` against the fresh local
database.

## Extending

The pieces deliberately left thin so the excluded features drop in later:

- **More endpoints** — add a route file under `src/routes/`, mount it in `index.ts`.
- **Read/update/delete** — add queries to `src/db/tasks.ts` and methods to
  `TaskService`; routes stay free of SQL.
- **More agent tools** — add a file under `src/agent/tools/`, register it in the
  `tools` array in `agent.ts`, and dispatch on its name. Every tool should
  validate with Zod and go through a service, never straight to D1.
- **Auth** — Hono middleware in `index.ts`, ahead of the route mounts.
