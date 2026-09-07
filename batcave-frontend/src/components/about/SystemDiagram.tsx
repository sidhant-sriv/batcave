import { Arrow, Box, Diagram, Frame, Note } from './Diagram';

/**
 * The whole system on one canvas.
 *
 * The layout is the claim: four callers enter at the top and the sides, and
 * every one of them funnels into the same two services before anything reaches
 * D1. That convergence is why the MCP server was a day's work rather than a
 * second implementation of the product — so it is drawn as the widest box on
 * the page, with every arrow pointing at it.
 *
 * Coordinates are absolute and hand-placed. They are only ever read together
 * with the boxes they connect, so they live here rather than in a table of
 * named constants that would have to be cross-referenced to picture anything.
 */
export function SystemDiagram() {
  return (
    <Diagram
      label="Architecture: browsers and MCP clients enter one Cloudflare Worker, which routes every write through a shared service layer onto D1 and Workflows."
      width={700}
      height={472}
      caption={
        <>
          Four callers, one seam. The REST API, the agent's tools, the MCP server and the Workflow
          instance all reach D1 through the same two services, which is what makes a new caller
          cheap: the validation, the ids and the ordering are already written down once.
        </>
      }
    >
      {/* Centred because both entry arrows cross the top border, and a label in
          the corner would have one drawn straight through it. */}
      <Frame x={144} y={96} w={548} h={272} label="One Worker — batcave-backend" align="middle" />

      {/* Callers, above the door each one comes in by. */}
      <Box
        x={164}
        y={16}
        w={232}
        h={56}
        title="Browser"
        lines={['React 19 · Vite · Cloudflare Pages']}
      />
      <Box
        x={440}
        y={16}
        w={232}
        h={56}
        title="MCP client"
        lines={['Claude, Inspector, anything']}
      />

      {/* The model is outside the platform, and is the only thing here that is. */}
      <Box
        x={8}
        y={216}
        w={112}
        h={56}
        title="Groq"
        lines={['qwen3.8-27b', 'one call a round']}
        tone="platform"
      />

      <Box
        x={164}
        y={136}
        w={232}
        h={56}
        title="Hono router"
        lines={['/api/tasks · /api/chats', '/api/schedules · /api/notifications']}
      />
      <Box
        x={440}
        y={136}
        w={232}
        h={56}
        title="OAuth 2.1 server"
        lines={['PKCE · GitHub sign-in', 'grants and tokens in KV']}
      />

      <Box
        x={164}
        y={216}
        w={200}
        h={56}
        title="Agent · LangGraph"
        lines={['6 tools, 5 rounds a turn']}
      />
      <Box
        x={440}
        y={216}
        w={232}
        h={56}
        title="MCP server · /mcp"
        lines={['the same six capabilities', 'stateless — no Durable Object']}
      />

      <Box
        x={164}
        y={296}
        w={508}
        h={56}
        title="Service layer — TaskService · ScheduleService"
        lines={['every write goes through here, whoever asked for it']}
        tone="seam"
      />

      <Box
        x={164}
        y={400}
        w={240}
        h={64}
        title="D1 · batcave-db"
        lines={['tasks · schedules · chats', 'checkpoints · agent_runs']}
        tone="platform"
      />
      <Box
        x={432}
        y={400}
        w={240}
        h={64}
        title="Workflows"
        lines={['one instance per schedule', 'instance id = schedule id']}
        tone="platform"
      />

      <Arrow points={[[280, 72], [280, 132]]} />
      <Note x={288} y={106}>/api/*</Note>

      <Arrow points={[[556, 72], [556, 132]]} />
      <Note x={564} y={106}>/mcp</Note>

      <Arrow points={[[232, 192], [232, 212]]} />
      <Note x={240} y={207}>chat turns</Note>

      {/* The routes that never touch the model still land on the same services,
          which is the point of drawing this line past the agent rather than
          through it. */}
      <Arrow points={[[380, 192], [380, 292]]} />
      <Note x={388} y={206}>everything else</Note>

      <Arrow points={[[232, 272], [232, 292]]} />
      <Note x={240} y={287}>6 tools</Note>

      <Arrow points={[[160, 244], [124, 244]]} back />

      <Arrow points={[[556, 192], [556, 212]]} />
      <Note x={564} y={207}>bearer token</Note>

      <Arrow points={[[556, 272], [556, 292]]} />

      <Arrow points={[[284, 352], [284, 396]]} />

      {/* Both ways: the instance is started from here, and re-reads the row it
          was started for at every step rather than trusting its own payload. */}
      <Arrow points={[[552, 352], [552, 396]]} back />
      <Note x={560} y={376}>starts · reads back</Note>
    </Diagram>
  );
}
