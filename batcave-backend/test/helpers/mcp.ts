import { createExecutionContext, env } from 'cloudflare:test';
import { mcpHandler, type GrantProps } from '../../src/mcp/handler';
import type { Env } from '../../src/types/task';

/**
 * One JSON-RPC call against the MCP endpoint, with the OAuth provider left out.
 *
 * The provider's whole contribution to a request is validating a bearer token
 * and putting the grant on `ctx.props`, so a test that wants to exercise a tool
 * can supply the props itself and skip the handshake. What the token flow does
 * is `test/oauth.test.ts`'s subject, and it is a different question.
 *
 * `https://test` is neither localhost nor a workers.dev host, so the wrapper
 * applies no Host validation — the same reason the other suites use it.
 */

const PROPS: GrantProps = { login: 'octocat', name: 'Octo Cat' };

export interface RpcOptions {
  props?: GrantProps;
  bindings?: Partial<Env>;
}

export async function rpc(
  method: string,
  params: Record<string, unknown> = {},
  options: RpcOptions = {},
): Promise<{ status: number; body: Record<string, any> }> {
  const request = new Request('https://test/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Both, because a modern exchange may answer with either.
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });

  const ctx = Object.assign(createExecutionContext(), { props: options.props ?? PROPS });
  const response = await mcpHandler.fetch(request, { ...env, ...options.bindings } as Env, ctx);

  return { status: response.status, body: await parse(response) };
}

/** A tool call, unwrapped to the payload the tool actually returned. */
export async function callTool(
  name: string,
  args: Record<string, unknown>,
  options: RpcOptions = {},
): Promise<{ isError: boolean; payload: Record<string, any>; text: string }> {
  const { body } = await rpc('tools/call', { name, arguments: args }, options);
  if (body.error) throw new Error(`JSON-RPC error: ${JSON.stringify(body.error)}`);

  const text = body.result.content[0].text as string;

  // Two kinds of refusal reach here. The SDK validates arguments against the
  // advertised schema before the handler runs, and reports a failure as plain
  // prose; anything the handler itself refused is our JSON envelope. Callers
  // that only care that it was refused read `isError`.
  let payload: Record<string, any>;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { ok: false, error: text };
  }

  return { isError: body.result.isError === true, payload, text };
}

/** The response is JSON, or one SSE frame carrying it. */
export async function parse(response: Response): Promise<Record<string, any>> {
  const body = await response.text();
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    const line = body.split('\n').find((entry) => entry.startsWith('data:'));
    return line ? JSON.parse(line.slice(5).trim()) : {};
  }
  return body ? JSON.parse(body) : {};
}
