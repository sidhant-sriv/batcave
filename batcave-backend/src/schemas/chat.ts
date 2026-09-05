import { z } from 'zod';
import { ERRORS } from '../errors';
import { clearableText } from './fields';

export const CHAT_TITLE_MAX = 100;
export const CHAT_LIST_LIMIT_MAX = 100;
export const CHAT_LIST_LIMIT_DEFAULT = 20;

export const chatIdSchema = z.uuid(ERRORS.CHAT_ID_INVALID);

export const CHAT_MESSAGE_MAX = 2000;

const message = z.string().trim().min(1, ERRORS.CHAT_MESSAGE_REQUIRED).max(CHAT_MESSAGE_MAX);

/** Body of POST /api/chats/:chat_id/messages. */
export const sendMessageSchema = z.strictObject({ message });

/**
 * Body of POST /api/chats. The message is optional: a client that wants an
 * empty conversation to open a view on sends nothing, and one that already has
 * the first message saves a round trip by sending it.
 */
export const createChatSchema = z.strictObject({ message: message.optional() });

/**
 * The only field a client owns. Everything else on a chat is server-generated,
 * so `strictObject` rejects an attempt to set `turns` or a timestamp rather
 * than ignoring it. `null` or "" resets the chat to untitled, and the key has
 * to be present: an empty body would otherwise be an accepted no-op.
 */
export const renameChatSchema = z
  .strictObject({ title: clearableText(CHAT_TITLE_MAX) })
  .refine((value) => value.title !== undefined, { message: ERRORS.CHAT_TITLE_REQUIRED });

/** `limit` is coerced because it arrives as a query parameter. */
export const listChatsSchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(CHAT_LIST_LIMIT_MAX)
    .default(CHAT_LIST_LIMIT_DEFAULT),
});

export type RenameChatInput = z.input<typeof renameChatSchema>;
export type ListChatsInput = z.input<typeof listChatsSchema>;
