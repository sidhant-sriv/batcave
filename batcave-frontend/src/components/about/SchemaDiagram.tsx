import { Arrow, Diagram, GroupLabel, Note, Table, type Column } from './Diagram';

/**
 * What is actually in D1.
 *
 * Two clusters, and the gap between them is deliberate: there is no join from a
 * conversation to a task. The agent reaches tasks by calling a tool, the same
 * way the REST API and an MCP client do, so the record never learns that an
 * agent exists and could be deleted out from under one without breaking a
 * foreign key.
 *
 * Columns are the ones that carry a decision. Timestamps and the rest are in
 * `migrations/`, which is the copy that has to be right.
 */

const TASKS: Column[] = [
  { name: 'id', note: 'PK', key: 'pk' },
  { name: 'title' },
  { name: 'status', note: 'todo · in_progress · done' },
  { name: 'priority', note: 'low · medium · high' },
  { name: 'due_date', note: 'ISO date, nullable' },
];

const SCHEDULES: Column[] = [
  { name: 'id', note: 'PK', key: 'pk' },
  { name: 'task_id', note: '→ tasks', key: 'fk' },
  { name: 'kind', note: 'once · recurring' },
  { name: 'cron', note: 'five fields, UTC' },
  { name: 'next_at', note: 'ISO instant' },
  { name: 'status', note: 'active · ended · cancelled' },
];

const NOTIFICATIONS: Column[] = [
  { name: 'id', note: 'PK', key: 'pk' },
  { name: 'schedule_id', note: '→ schedules', key: 'fk' },
  { name: 'task_id', note: '→ tasks', key: 'fk' },
  { name: 'seq', note: 'unique per schedule' },
  { name: 'outcome', note: 'notified · skipped' },
  { name: 'acknowledged_at', note: 'set by a person, never a timer' },
];

const CHATS: Column[] = [
  { name: 'id', note: 'PK', key: 'pk' },
  { name: 'title', note: 'named after the first message' },
  { name: 'turn_count', note: 'denormalised, so listing is one read' },
  { name: 'last_message_at', note: 'ISO instant' },
];

const CHAT_THREADS: Column[] = [
  { name: 'thread_id', note: 'PK', key: 'pk' },
  { name: 'chat_id', note: '→ chats', key: 'fk' },
  { name: 'seq', note: '0, then one per compaction' },
];

const CHECKPOINTS: Column[] = [
  { name: 'thread_id' },
  { name: 'checkpoint_id', note: 'PK', key: 'pk' },
  { name: 'parent_checkpoint_id' },
  { name: 'checkpoint', note: 'BLOB — the conversation' },
];

const AGENT_RUNS: Column[] = [
  { name: 'run_key', note: 'PK', key: 'pk' },
  { name: 'thread_id' },
  { name: 'status', note: 'running · completed · failed' },
  { name: 'response', note: 'what a retry replays' },
  { name: 'start_checkpoint_id', note: 'interrupted, or finished' },
  { name: 'attempts', note: '1, then one per takeover' },
];

export function SchemaDiagram() {
  return (
    <Diagram
      label="The D1 schema: tasks, schedules and notifications on one side; chats, threads, checkpoints and agent runs on the other, with no join between them."
      width={700}
      height={556}
      caption={
        <>
          Two clusters, and no join between them. Tasks are the record; the conversation is the
          agent's own memory, and the two checkpoint tables belong to LangGraph rather than to this
          app — which is why they are the only ones here without a foreign key. Every firing a
          schedule produces is kept after the schedule ends, so the history of what rang outlives
          the Workflow instance that rang it.
        </>
      }
    >
      <GroupLabel x={8} y={22}>The record</GroupLabel>
      <GroupLabel x={372} y={22}>The conversation</GroupLabel>

      <Table x={8} y={40} w={304} name="tasks" columns={TASKS} />
      <Table x={8} y={185} w={304} name="schedules" columns={SCHEDULES} />
      <Table x={8} y={345} w={304} name="notifications" columns={NOTIFICATIONS} />

      <Table x={372} y={40} w={304} name="chats" columns={CHATS} />
      <Table x={372} y={170} w={304} name="chat_threads" columns={CHAT_THREADS} />
      <Table x={372} y={285} w={304} name="checkpoints" columns={CHECKPOINTS} />
      <Table x={372} y={415} w={304} name="agent_runs" columns={AGENT_RUNS} />

      {/* A partial unique index, not a column: scheduling again replaces the
          active one without anybody reading first. */}
      <Arrow points={[[160, 141], [160, 181]]} />
      <Note x={168} y={165}>at most one active</Note>

      <Arrow points={[[160, 301], [160, 341]]} />
      <Note x={168} y={325}>one row per firing</Note>

      {/* Denormalised onto the notification so the inbox never joins through a
          schedule that has since been cancelled. */}
      <Arrow points={[[312, 90], [340, 90], [340, 400], [312, 400]]} dashed />
      <Note x={346} y={250}>task_id</Note>

      <Arrow points={[[524, 126], [524, 166]]} />
      <Note x={532} y={150}>a compaction adds one</Note>

      <Arrow points={[[524, 241], [524, 281]]} dashed />
      <Note x={532} y={265}>thread_id</Note>

      <Arrow points={[[676, 205], [690, 205], [690, 455], [676, 455]]} dashed />

      <Note x={372} y={545}>thread_id, but not a foreign key — LangGraph owns these</Note>
    </Diagram>
  );
}
