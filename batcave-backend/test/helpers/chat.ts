import { env } from 'cloudflare:test';
import type { Hono } from 'hono';
import type { ChatResponse } from '../../src/routes/chat';
import { ChatService } from '../../src/services/chatService';
import type { AppEnv, Env } from '../../src/types/task';
import { OWNER } from './auth';

export interface StartedChat {
  chatId: string;
  threadId: string;
}

/**
 * A conversation with no turns yet, and the thread it will run on. Tests want
 * both: the chat id to address the API, the thread id to reach the run rows and
 * checkpoints the API deliberately hides.
 */
export async function startChat(): Promise<StartedChat> {
  const { chat, threadId } = await new ChatService(env.DB, OWNER).create();
  return { chatId: chat.id, threadId };
}

export async function send(
  app: Hono<AppEnv>,
  chatId: string,
  message: string,
  options: { key?: string; bindings?: Partial<Env> } = {},
): Promise<{ status: number; body: ChatResponse & { error?: string } }> {
  const response = await app.request(
    `/api/chats/${chatId}/messages`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(options.key ? { 'Idempotency-Key': options.key } : {}),
      },
      body: JSON.stringify({ message }),
    },
    { ...env, ...options.bindings },
  );

  return {
    status: response.status,
    body: (await response.json()) as ChatResponse & { error?: string },
  };
}
