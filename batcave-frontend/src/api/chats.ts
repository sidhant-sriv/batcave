import { queryString, request } from './client';
import type {
  ChatCreatedResponse,
  ChatHistoryResponse,
  ChatListResponse,
  ChatResponse,
  ChatRow,
  ChatTurnResponse,
} from './types';

/**
 * The conversation surface.
 *
 * Threads do not appear here. The backend keeps a chat (what a client holds a
 * handle to) separate from the thread it currently runs on, so that compaction
 * can one day move a conversation onto a fresh checkpoint partition without the
 * id in the URL changing. Nothing on this side needs to know that happened.
 */

export const CHAT_LIMIT_MAX = 100;
export const CHAT_MESSAGE_MAX = 2000;

export async function listChats(limit?: number): Promise<ChatListResponse> {
  return request<ChatListResponse>(`/api/chats${queryString({ limit })}`);
}

export async function getChat(chatId: string): Promise<ChatHistoryResponse> {
  return request<ChatHistoryResponse>(`/api/chats/${chatId}`);
}

/** An empty conversation, for the case where the user wants a blank surface. */
export async function createChat(): Promise<ChatRow> {
  const { chat } = await request<ChatCreatedResponse>('/api/chats', {
    method: 'POST',
    body: {},
  });
  return chat;
}

/**
 * Starts a conversation *and* runs its first turn, in one request. Worth the
 * separate function: the alternative is create-then-send, which costs a round
 * trip and briefly shows an untitled chat that has no content yet.
 */
export async function createChatWithMessage(
  message: string,
  idempotencyKey?: string,
): Promise<ChatTurnResponse> {
  return request<ChatTurnResponse>('/api/chats', {
    method: 'POST',
    body: { message },
    idempotencyKey,
  });
}

export async function sendMessage(
  chatId: string,
  message: string,
  idempotencyKey?: string,
): Promise<ChatTurnResponse> {
  return request<ChatTurnResponse>(`/api/chats/${chatId}/messages`, {
    method: 'POST',
    body: { message },
    idempotencyKey,
  });
}

/** `null` clears the title and lets the next message auto-name it again. */
export async function renameChat(chatId: string, title: string | null): Promise<ChatRow> {
  const { chat } = await request<ChatResponse>(`/api/chats/${chatId}`, {
    method: 'PATCH',
    body: { title },
  });
  return chat;
}

/** 409 while a turn is still running — the caller surfaces that as a refusal. */
export async function deleteChat(chatId: string): Promise<void> {
  await request<void>(`/api/chats/${chatId}`, { method: 'DELETE' });
}
