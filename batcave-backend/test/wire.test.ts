import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildAgent, threadConfig } from '../src/agent/agent';
import { DEFAULT_MODEL } from '../src/agent/model';
import { onError } from '../src/index';
import { createChatRoute } from '../src/routes/chat';
import type { Env } from '../src/types/task';
import { resetDb } from './helpers/reset';

beforeEach(resetDb);

interface GroqRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  tools?: Array<{ function: { name: string; parameters: Record<string, unknown> } }>;
  parallel_tool_calls?: boolean;
}

/**
 * Stands in for Groq so the request body can be inspected. Nothing here talks
 * to the network, and the assertions are about what we send rather than what a
 * model happens to reply.
 */
function cannedGroq(reply = 'Hello.') {
  const requests: GroqRequest[] = [];

  const fetchImpl = (async (_input: unknown, init: RequestInit) => {
    requests.push(JSON.parse(init.body as string) as GroqRequest);
    return Response.json({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: 1_788_000_000,
      model: 'test',
      choices: [
        { index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  }) as unknown as typeof fetch;

  return { requests, fetchImpl };
}

const failingGroq = (status: number, body: unknown) =>
  (async () => Response.json(body, { status })) as unknown as typeof fetch;

describe('what reaches Groq', () => {
  it('sends the tools, the configured model and one-tool-call-at-a-time', async () => {
    const { requests, fetchImpl } = cannedGroq();
    const agent = buildAgent(env, { fetch: fetchImpl });

    await agent.invoke(
      { messages: [{ role: 'user', content: 'hello' }] },
      threadConfig(crypto.randomUUID()),
    );

    expect(requests).toHaveLength(1);
    const [request] = requests;

    expect(request!.parallel_tool_calls).toBe(false);
    expect(request!.model).toBe(env.GROQ_MODEL ?? DEFAULT_MODEL);
    expect(request!.tools?.map((tool) => tool.function.name).sort()).toEqual([
      'create_task',
      'search_tasks',
      'update_task',
    ]);
  });

  it('puts today into the system prompt', async () => {
    const { requests, fetchImpl } = cannedGroq();
    const agent = buildAgent(env, { fetch: fetchImpl });

    await agent.invoke(
      { messages: [{ role: 'user', content: 'hello' }] },
      threadConfig(crypto.randomUUID()),
    );

    const system = requests[0]!.messages.find((message) => message.role === 'system');
    expect(system?.content).toContain(new Date().toISOString().slice(0, 10));
  });

  it('describes create_task with the fields the service accepts', async () => {
    const { requests, fetchImpl } = cannedGroq();
    const agent = buildAgent(env, { fetch: fetchImpl });

    await agent.invoke(
      { messages: [{ role: 'user', content: 'hello' }] },
      threadConfig(crypto.randomUUID()),
    );

    const create = requests[0]!.tools?.find((tool) => tool.function.name === 'create_task');
    const properties = create?.function.parameters.properties as Record<string, unknown>;
    expect(Object.keys(properties).sort()).toEqual(['description', 'due_date', 'priority', 'title']);
  });
});

describe('when Groq fails', () => {
  const app = (fetchImpl: typeof fetch) => {
    const instance = new Hono<{ Bindings: Env }>();
    instance.route('/api/chat', createChatRoute({ fetch: fetchImpl }));
    instance.onError(onError);
    return instance;
  };

  const ask = (instance: Hono<{ Bindings: Env }>) =>
    instance.request(
      '/api/chat',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'hello' }),
      },
      env,
    );

  it('answers 502 rather than 500, so the client knows it is upstream', async () => {
    const response = await ask(app(failingGroq(400, { error: { message: 'bad model' } })));

    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: string }).error).toContain('Could not reach');
  });
});
