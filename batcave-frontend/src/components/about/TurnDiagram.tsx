import { Arrow, Box, Diagram, Frame, Note } from './Diagram';

/**
 * One turn, end to end.
 *
 * The spine down the middle is the happy path and reads top to bottom. The
 * three chips on the right are what the claim can find instead of a free lane,
 * and they are the interesting part: two of them end the request without ever
 * calling the model, and the third picks a half-finished turn back up.
 *
 * The tool loop is drawn as a loop rather than a queue on purpose. The model
 * decides whether there is another round, the graph does not, and the bound is
 * a recursion limit rather than a counter anyone here maintains.
 */
export function TurnDiagram() {
  return (
    <Diagram
      label="A chat turn: claim a run row, run the model and tool loop to completion, store the answer, return one response."
      width={700}
      height={564}
      caption={
        <>
          A turn is atomic — the whole tool loop runs inside one request and returns one response
          carrying the prose and every tool that ran. The run row is what makes retrying safe: the
          same request replays the stored answer instead of asking the model twice, a second
          concurrent turn is refused rather than queued, and a worker that died mid-turn is taken
          over rather than started again.
        </>
      }
    >
      <Box
        x={8}
        y={8}
        w={404}
        h={52}
        title="POST /api/chats/:id/messages"
        lines={['Idempotency-Key: optional, and honoured']}
      />

      <Box
        x={8}
        y={84}
        w={404}
        h={52}
        title="Read the thread's latest checkpoint"
        lines={['one D1 read, and what a retry is compared against']}
      />

      <Box
        x={8}
        y={152}
        w={404}
        h={96}
        title="Claim the run"
        lines={[
          'key = the Idempotency-Key header, or',
          '(thread + checkpoint + message) hashed',
          'one row in agent_runs, and the row is the lock',
        ]}
        tone="seam"
      />

      <Box
        x={432}
        y={156}
        w={260}
        h={28}
        size="sm"
        dashed
        title="already answered → replay it, no model call"
      />
      <Box
        x={432}
        y={188}
        w={260}
        h={28}
        size="sm"
        dashed
        title="still running → 409, never queued"
      />
      <Box
        x={432}
        y={220}
        w={260}
        h={28}
        size="sm"
        title="stale → take the turn over, finish it"
      />

      <Frame x={8} y={272} w={404} h={116} label="Run the graph" />
      <Box x={40} y={302} w={104} h={44} title="model" lines={['Groq']} />
      <Box x={232} y={302} w={104} h={44} title="tools" lines={['≤ 5 rounds']} />

      <Box
        x={8}
        y={412}
        w={404}
        h={68}
        title="Settle"
        lines={[
          'answer stored on the run row · chat bumped',
          'thread pruned to its last three checkpoints',
        ]}
      />

      <Box
        x={8}
        y={504}
        w={404}
        h={52}
        title="One response"
        lines={['the prose, and every tool call that ran, in order']}
      />

      <Arrow points={[[210, 60], [210, 80]]} />
      <Arrow points={[[210, 136], [210, 148]]} />

      <Arrow points={[[412, 170], [428, 170]]} dashed />
      <Arrow points={[[412, 202], [428, 202]]} dashed />
      <Arrow points={[[412, 234], [428, 234]]} />

      <Arrow points={[[210, 248], [210, 268]]} />

      {/* The takeover rejoins the same graph: the user's message is already in
          the checkpoint, so the turn is finished off and never re-asked. */}
      <Arrow points={[[560, 248], [560, 300], [416, 300]]} />
      <Note x={470} y={294}>resumed</Note>

      <Arrow points={[[144, 318], [228, 318]]} />
      <Note x={186} y={313} anchor="middle">tool_calls</Note>

      <Arrow points={[[232, 332], [148, 332]]} />
      <Note x={190} y={344} anchor="middle">results</Note>

      <Arrow points={[[92, 346], [92, 366], [210, 366], [210, 408]]} />
      <Note x={100} y={362}>no tool calls left</Note>

      <Note x={240} y={380}>a checkpoint after every step</Note>

      <Arrow points={[[210, 480], [210, 500]]} />
    </Diagram>
  );
}
