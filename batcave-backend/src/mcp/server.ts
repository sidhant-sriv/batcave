import { McpServer, ResourceNotFoundError, ResourceTemplate } from '@modelcontextprotocol/server';
import { compactTask } from '../agent/tools/searchTasks';
import {
  CANCEL_SCHEDULE,
  CREATE_TASK,
  SCHEDULE_RECURRING,
  SCHEDULE_REMINDER,
  SEARCH_TASKS,
  UPDATE_TASK,
} from '../agent/tools/names';
import { scheduleResult } from '../agent/tools/scheduleResult';
import { uuidv7 } from '../ids';
import {
  cancelScheduleToolSchema,
  scheduleRecurringToolSchema,
  scheduleReminderToolSchema,
} from '../schemas/schedule';
import { createTaskSchema, searchTasksToolSchema, updateTaskToolSchema } from '../schemas/task';
import type { ScheduleService } from '../services/scheduleService';
import type { TaskService } from '../services/taskService';
import { toolResult } from './result';

/**
 * Batcave over MCP: the same six capabilities the in-app agent has, offered to
 * any client that speaks the protocol.
 *
 * THE SEAM IS THE SERVICE LAYER, not the agent's tools. `TaskService` and
 * `ScheduleService` are free of HTTP and of LangChain, validate their own input
 * on entry, and are already the single path the REST routes, the agent and the
 * Workflow all take. This is the fourth caller, and it earns the same
 * guarantees without inheriting a graph runtime it has no use for.
 *
 * TWO THINGS THE AGENT HAS THAT THIS DELIBERATELY DOES NOT:
 *
 * `taskIdGuard` — the middleware that refuses a task id the model never saw in
 * a search result on that thread. It exists because the agent's conversation
 * and its tool calls are the same process, so "did you see this id" is a
 * question with an answer. Over MCP the conversation lives in the client and
 * the server sees one call at a time, so there is no thread to check against.
 * The services still reject a malformed id and a row that is not there, which
 * is the boundary that was ever really enforceable here.
 *
 * Exactly-once creates — the agent derives a task's primary key from LangChain's
 * `toolCallId` (see `agent/taskId.ts`), so a retried tool call upserts rather
 * than duplicating. MCP has no per-call identifier a server may trust: JSON-RPC
 * ids are chosen by the client and restart at 1 every session, so seeding from
 * one would make two unrelated calls collide on the same row. These creates use
 * a fresh `uuidv7()` and are therefore at-least-once under client retry, which
 * is the honest trade rather than a silently wrong one.
 *
 * The descriptions below are adapted from the agent's rather than shared with
 * them, because two of them are only true there: `search_tasks` tells the agent
 * it is the only way to obtain an id, which the guard makes true and MCP does
 * not, since a client can read one out of a resource.
 */

export interface McpDeps {
  tasks: TaskService;
  schedules: ScheduleService;
}

/** Open work, for the resources. Done tasks are history and are asked for by name. */
const OPEN = ['todo', 'in_progress'] as const;

const RESOURCE_LIMIT = 100;

const json = (uri: URL, payload: unknown) => ({
  contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(payload, null, 2) }],
});

export function buildMcpServer({ tasks, schedules }: McpDeps): McpServer {
  const server = new McpServer({ name: 'batcave', version: '0.1.0' });

  /* --- Tools ------------------------------------------------------------ */

  server.registerTool(
    CREATE_TASK,
    {
      title: 'Create a task',
      description:
        "Create a new task, for anything the user asks to be added to their list. Returns the task, including the id that update_task and the scheduling tools need — a task you just created can be updated or scheduled straight away, with no search first. A due date is only when the work is expected; it notifies nobody, so use schedule_reminder as well if the user asked to be reminded.",
      inputSchema: createTaskSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    (input) => toolResult(CREATE_TASK, async () => ({ task: await tasks.create(input, { id: uuidv7() }) })),
  );

  server.registerTool(
    SEARCH_TASKS,
    {
      title: 'Search tasks',
      description:
        "Find the user's tasks. Every filter is optional and they narrow the result together, so start broad: passing no filter at all lists recent tasks. Returns `{ count, truncated, tasks }`, and each task carries the id that update_task and the scheduling tools need. Each task also carries `schedule`: null when nothing notifies about it, otherwise `{ kind, cron, next_at }` for the reminder (\"once\") or recurring cron it has — so this tool, with `scheduled: true`, is how you answer what the user is being reminded about, and how you check what a new schedule would replace. `truncated` means more tasks matched than were returned; narrow the filters rather than paging. An empty result is a real answer: retry once with fewer or broader keywords, then say nothing matched.",
      inputSchema: searchTasksToolSchema.shape,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    (input) =>
      toolResult(SEARCH_TASKS, async () => {
        const { tasks: rows, truncated } = await tasks.search(input);
        return {
          count: rows.length,
          truncated,
          tasks: rows.map((task) => ({ ...compactTask(task), schedule: task.schedule })),
        };
      }),
  );

  server.registerTool(
    UPDATE_TASK,
    {
      title: 'Update a task',
      description:
        "Change an existing task: rename it, re-prioritise it, move its due date, or mark it done. Send every field that changes in one call and omit the rest — omitting a field leaves it alone, and passing null to `description` or `due_date` clears it. Returns the updated task and a `changed` list of the fields that actually moved. This never touches the task's schedule; use cancel_schedule for that.",
      inputSchema: updateTaskToolSchema.shape,
      // Idempotent because the same field values applied twice leave the same
      // row. Not destructive: nothing is removed, and `status: done` is a state
      // the user can move back out of.
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    (input) =>
      toolResult(UPDATE_TASK, async () => {
        const { id, ...changes } = input;
        const changed = Object.keys(changes).filter(
          (key) => changes[key as keyof typeof changes] !== undefined,
        );
        return { task: await tasks.update(id, changes), changed };
      }),
  );

  server.registerTool(
    SCHEDULE_REMINDER,
    {
      title: 'Remind once',
      description:
        "Notify the user about a task once, at an absolute time, for \"remind me on Friday\" or \"in two hours\". Reminding is not the same as a due date: this changes nothing about the task itself, it only puts a notification in the user's scheduled list. A task has at most one schedule, so this replaces whatever it had — the result reports the new schedule and, in `replaced`, the one it superseded, which is worth telling the user about. Use schedule_recurring instead if the reminder should repeat.",
      inputSchema: scheduleReminderToolSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    ({ id, remind_at }) =>
      toolResult(SCHEDULE_REMINDER, async () =>
        scheduleResult(tasks, id, await schedules.scheduleOnce(id, { remind_at }, { id: uuidv7() })),
      ),
  );

  server.registerTool(
    SCHEDULE_RECURRING,
    {
      title: 'Remind repeatedly',
      description:
        'Notify the user about a task over and over on a cron schedule, for "every Monday" or "daily at 6pm", until they cancel it. Unlike a one-off reminder this does change the task: every notification puts it back to todo if it was done, which is what makes it a recurring chore rather than a nag. A task has at most one schedule, so this replaces whatever it had — the result reports the new schedule and, in `replaced`, the one it superseded. Cron is five fields in UTC and must not fire more often than every 15 minutes.',
      inputSchema: scheduleRecurringToolSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    ({ id, cron }) =>
      toolResult(SCHEDULE_RECURRING, async () =>
        scheduleResult(tasks, id, await schedules.scheduleRecurring(id, { cron }, { id: uuidv7() })),
      ),
  );

  server.registerTool(
    CANCEL_SCHEDULE,
    {
      title: 'Cancel a schedule',
      description:
        "Stop the reminder or recurring schedule on a task, so it stops notifying the user. The task itself is untouched and notifications it already sent stay in the user's list. A task with no active schedule comes back as an error result — say so rather than retrying. To move a schedule rather than remove it, call schedule_reminder or schedule_recurring again; they replace in place, so cancelling first is unnecessary.",
      inputSchema: cancelScheduleToolSchema.shape,
      // The only destructive one: it ends something the user set up, and
      // calling it again on the same task is a refusal rather than a no-op.
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    ({ id }) =>
      toolResult(CANCEL_SCHEDULE, async () =>
        scheduleResult(tasks, id, { schedule: await schedules.cancelForTask(id), replaced: null }),
      ),
  );

  /* --- Resources --------------------------------------------------------
   * Tools act; resources are context a client can attach without spending a
   * tool call on it. The split is the point: a client that wants to reason
   * about the list reads it, and a client that wants to change it calls.
   * -------------------------------------------------------------------- */

  server.registerResource(
    'open-tasks',
    'batcave://tasks/open',
    {
      title: 'Open tasks',
      description: 'Every task not yet done, in the order the app shows them: dated first, then by due date, then priority.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const { tasks: rows, truncated } = await tasks.search({
        status: [...OPEN],
        limit: RESOURCE_LIMIT,
      });
      return json(uri, {
        count: rows.length,
        truncated,
        tasks: rows.map((task) => ({ ...compactTask(task), schedule: task.schedule })),
      });
    },
  );

  server.registerResource(
    'task',
    new ResourceTemplate('batcave://tasks/{id}', { list: undefined }),
    {
      title: 'One task',
      description: 'A single task by id, with its active schedule if it has one.',
      mimeType: 'application/json',
    },
    async (uri, { id }) => {
      const task = await tasks.getById(String(id));
      // The SDK maps this onto JSON-RPC -32002, which is what the protocol
      // defines for a URI that is not there. Unlike a tool, a resource read can
      // say "this does not exist" in the protocol's own words.
      if (!task) throw new ResourceNotFoundError(uri.href);

      // Two reads, because no service method fetches a schedule by task id —
      // `search` joins it for a list and `listSchedules` filters by status
      // only. At demo scale this is cheaper than the SQL it would take to fix,
      // and the obvious place to fix it is `ScheduleService`, not here.
      const { schedules: active } = await schedules.listSchedules({
        status: ['active'],
        limit: RESOURCE_LIMIT,
      });

      return json(uri, {
        task,
        schedule: active.find((row) => row.task_id === task.id) ?? null,
      });
    },
  );

  server.registerResource(
    'upcoming-schedules',
    'batcave://schedules/upcoming',
    {
      title: 'Upcoming notifications',
      description: 'Active schedules and when each next fires, with the task each belongs to. All times UTC.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const { schedules: rows, truncated } = await schedules.listSchedules({
        status: ['active'],
        limit: RESOURCE_LIMIT,
      });
      return json(uri, {
        count: rows.length,
        truncated,
        schedules: rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          cron: row.cron,
          next_at: row.next_at,
          notification_count: row.notification_count,
          task: compactTask(row.task),
        })),
      });
    },
  );

  return server;
}
