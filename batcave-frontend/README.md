# batcave-frontend

The interface for `batcave-backend`: a deterministic task surface and an agent
console over the same data, on Cloudflare Pages.

Dark-first, dense, and built on a three-tier token layer. There is one accent
colour and it means something.

## Stack

| Concern         | Choice                                          |
| --------------- | ----------------------------------------------- |
| Build           | Vite 7                                          |
| UI              | React 19 + TypeScript                           |
| Styling         | Tailwind v4, over CSS custom properties         |
| Server state    | TanStack Query                                  |
| Routing         | React Router                                    |
| Headless behaviour | Radix (`radix-ui`) — dialog, dropdown        |
| Icons           | Lucide, stroke 1.5, sizes 14/16/20              |
| Package manager | Bun                                             |
| Hosting         | Cloudflare Pages                                |

## Setup

```sh
bun install
cp .env.example .env
```

`.env` holds one variable:

```
VITE_API_BASE_URL=http://localhost:8787
```

Run the backend and the frontend together:

```sh
cd ../batcave-backend && bun run dev   # :8787
bun run dev                            # :5173
```

```sh
bun run typecheck        # tsc
bun run test             # vitest — the pure logic, no DOM, no network
bun run check:contrast   # every documented contrast pair, both themes
bun run build            # typecheck + vite build
```

## Structure

```
src/
├── main.tsx                    query client, router, retry policy
├── App.tsx                     shell: nav rail, routes, agent dock
├── styles/
│   ├── tokens.css              THE TOKEN LAYER — tiers 1/2/3, both themes
│   ├── theme.css               Tailwind @theme mapping
│   └── base.css                reset, @font-face, focus, keyframes
├── api/
│   ├── client.ts               fetch wrapper, ApiError, Idempotency-Key
│   ├── types.ts                the wire contract, mirrored from the backend
│   ├── tasks.ts                list/get/create/update + changedFields()
│   └── chats.ts                create/send/history/list/rename/remove
├── lib/
│   ├── dueDate.ts              the five derived due buckets, UTC today
│   ├── disambiguation.ts       "the agent is asking you to choose"
│   ├── ordinals.ts             01/02/03 and "the first one"
│   ├── mutationLog.ts          cross-surface update acknowledgment
│   ├── inlineMarkdown.tsx      three inline constructs, no parser
│   ├── prefs.ts                theme and density, localStorage
│   └── time.ts                 terse mono timestamps
├── components/
│   ├── primitives/             Button, Field, Modal (over Radix)
│   ├── task/                   StatusPill, PriorityRail, DueChip, Row, Card,
│   │                           DetailModal, CreateForm
│   ├── agent/                  Console, Turn, ToolChip, ToolResultBlock,
│   │                           Composer, ExecutingRail, ChatList, ChatHeader
│   └── state/                  empty, loading, error, offline
└── routes/
    ├── TaskIndex.tsx           list + board, filters, density
    └── AgentRoute.tsx          /agent and /agent/:chatId
```

## The token layer

`src/styles/tokens.css` is the whole design system. Three tiers, strictly
ordered, and one rule that makes it work:

> **A component may only read a tier 2 or tier 3 token.** If a component
> references `--ink-4` or `--amber-base` directly, theming stops being a
> single-file change.

| Tier | What | Example |
| --- | --- | --- |
| 1 — primitives | raw values, named for what they are | `--ink-7`, `--amber-base`, `--space-4` |
| 2 — semantic | roles, named for what they mean | `--text-muted`, `--status-progress-fg` |
| 3 — component | per-component, named for where | `--task-row-h`, `--toolchip-indent` |

`theme.css` maps tier 2 into Tailwind with `@theme inline`. The `inline` matters:
it keeps the `var()` reference in the generated utility, so switching
`data-theme` re-paints every utility at runtime.

`base.css` is imported with `layer(base)`. That also matters — unlayered CSS
beats every layered rule regardless of specificity, so importing the reset
plainly would put `*{padding:0}` above every `px-*` utility and silently zero it.

### Themes

- **`night`** (default, dark) — elevation by rising lightness, over a warm
  near-black. Depth is layered surfaces and hairlines. There are no shadow
  tokens; a shadow appearing in this codebase means the design was violated.
- **`day`** (light) — *not* an inversion. Rising lightness has nowhere to go
  above white, so elevation is carried by **a tinted ground plus mandatory
  hairlines**: the app background is warm off-white, panels are near-pure white
  above it, wells sit below it.

`day` redefines **tier 1 only**. Every semantic alias is untouched, which is also
the proof a high-contrast theme is possible: it would override tier 2 alone and
need to touch neither a primitive nor a component.

The theme is stamped on `<html data-theme>` by an inline script in `index.html`
before first paint, so there is no flash.

### Encoding rules

Status and priority sit side by side on every row, so they are separated by
channel rather than hue:

- **Status** owns colour *and* a 7px square glyph — `□` todo, `◪` in progress,
  `■` done. `in_progress` is the only status carrying chroma anywhere in the
  product, and the only thing that pulses. `done` recedes.
- **Priority** is **entirely achromatic**: filled-segment count on a rail at the
  row's left edge. High priority is pure white on warm near-black, which reads
  harder than a colour and costs nothing from the accent budget.

Everything decodes in greyscale. `bun run check:contrast` gates the numbers.

### Accent economy

One high-chroma signal colour, permitted in exactly five places:

1. `in_progress` — the only status that reads as live
2. the focus ring
3. the primary button
4. the due-today chip
5. selection, and the update-acknowledgment flash

Anywhere else is a bug.

### Type

Two families, self-hosted from `public/fonts` (~60KB, latin subset):

| Role | Family | For |
| --- | --- | --- |
| Prose | **Instrument Sans** (variable) | agent messages, titles, descriptions |
| Metadata | **IBM Plex Mono** 400/500/600 | ids, timestamps, statuses, tool names, micro-labels |

The split is load-bearing and absolute: **if a string came out of the database
or names a machine concept it is mono; if a human or the model wrote it as
language it is prose.** There is no third case. It is also how the eye separates
*record* from *narrative*.

`--type-micro` — 10px uppercase mono at `0.14em` tracking — is the signature.

## Talking to the API

`VITE_API_BASE_URL` points at the Worker. Because the two are different origins,
the backend allowlists this one in its `CORS_ORIGINS` var; `Idempotency-Key` is a
non-simple header, so every turn is preflighted and the header must be named
explicitly there.

### Turns are atomic

`POST /api/chats/:id/messages` runs the entire tool loop on the Worker and
returns one JSON response. **There is no streaming**, so the console does not
pretend there is: the user's message appears immediately, an indeterminate
`EXECUTING` rail sits below it, and the chips and result blocks land together
when the answer does.

No fake per-tool progress. The backend cannot say which tool is running, and
inventing that is how a console stops being trustworthy.

Tokens named `--agent-thinking-fg` and `--agent-tool-running-fg` exist as aliases
of the in-flight state, so a future streaming endpoint has somewhere to land
without renaming anything a component consumes.

### Error handling

`ApiError.status` is what components branch on:

| Status | Treatment |
| --- | --- |
| 400 | field errors from `issues[].path`; an empty path is a form-level error |
| 404 | an empty state, not an error banner |
| 409 | composer locks (`THREAD_BUSY`), or a delete is refused (`CHAT_BUSY`) |
| 500 | not retryable — it needs fixing on the server |
| 502 / 504 | retryable |
| 503 | retryable, **and the turn is resumable** — the retry continues it |

Retries reuse the same `Idempotency-Key`, which is what makes a 503 retry safe:
the backend returns the stored answer or takes the interrupted run over rather
than asking the model twice.

### Disambiguation is a heuristic

The agent refuses to guess between similar tasks and asks which one — as prose.
There is no `awaiting_choice` flag on the wire, so `lib/disambiguation.ts` infers
it: a question mark, a multi-result `search_tasks`, and no write in the same
turn. It errs toward *not* claiming a disambiguation; a miss renders a normal
result block, which is merely less helpful.

### Ordinals

Search results in the transcript carry a zero-padded mono ordinal. Users say
"mark the first one as done", and for that to resolve the number on screen must
be the number the model saw — the position in the tool result array. **Never
sort, filter or de-duplicate a result block.**

## Deploying

```sh
bun run deploy      # build, then wrangler pages deploy dist
```

Order matters the first time: deploy Pages, then add its URL to the backend's
`CORS_ORIGINS` var in `batcave-backend/wrangler.jsonc` and redeploy the Worker.
Until that happens the browser will block every call.

`public/_redirects` sends all paths to `index.html` so deep links resolve.
`public/_headers` sets immutable caching for `/fonts/*` and `/assets/*`.

## Reserved, deliberately

- **`SCHED`** — a disabled nav item holding navigation space for Workflows
  (durable scheduled automations). No route, no handler; the slot is the feature.
- **The account slot** — an empty box at the bottom of the nav rail. There is no
  auth, but the rail's geometry is decided now rather than discovered later.
- **Compaction** — the backend can move a chat onto a new thread. The client
  never sees threads, so it already works.

## Known limits

- **The index caps at 100 rows.** `GET /api/tasks` has `limit` (max 100) and a
  `truncated` flag — no offset, no cursor, and a fixed server-side sort. So the
  index asks for the maximum and says plainly when there is more, rather than
  implying it shows everything. Real pagination is a backend change.
- **Tool chips cannot show arguments.** `AgentAction` keeps the result envelope
  but not the validated tool input, so a chip reports what ran and how it went,
  never what it was asked.
- **Chat titles are the first message**, truncated at 60 characters by the
  backend. Serviceable, noisy in a 240px sidebar.
