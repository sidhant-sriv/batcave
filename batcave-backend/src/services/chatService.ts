import type { ChatTurn } from '../agent/format';
import { threadHistory } from '../agent/history';
import { RUN_TTL_SECONDS } from '../agent/runs';
import { deleteThread, selectLiveRun } from '../db/agentState';
import {
  deleteChat,
  insertChat,
  listChats,
  renameChat,
  selectActiveThread,
  selectChat,
  selectThreads,
  touchChat,
  type ChatRow,
} from '../db/chats';
import { ERRORS } from '../errors';
import { uuidv7 } from '../ids';
import {
  chatIdSchema,
  listChatsSchema,
  renameChatSchema,
  type ListChatsInput,
  type RenameChatInput,
} from '../schemas/chat';

/** Thrown when input fails validation inside the service. */
export class ChatValidationError extends Error {
  constructor(
    message: string,
    readonly issues: unknown,
  ) {
    super(message);
    this.name = 'ChatValidationError';
  }
}

/** Thrown when a chat id is well formed but not in the table. */
export class ChatNotFoundError extends Error {
  constructor(readonly id: string) {
    super(ERRORS.CHAT_NOT_FOUND);
    this.name = 'ChatNotFoundError';
  }
}

/** Thrown when a destructive change would race a turn that is still running. */
export class ChatBusyError extends Error {
  constructor(readonly id: string) {
    super(ERRORS.CHAT_BUSY);
    this.name = 'ChatBusyError';
  }
}

const AUTO_TITLE_MAX = 60;

/**
 * A chat names itself after its first message, shortened to something a list
 * can render on one line. Deliberately shorter than the length a client may
 * set by hand, since this one is a guess.
 */
export function titleFrom(message: string): string {
  const text = message.trim().replace(/\s+/g, ' ');
  return text.length <= AUTO_TITLE_MAX
    ? text
    : `${text.slice(0, AUTO_TITLE_MAX - 3).trimEnd()}...`;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * Single source of truth for conversations: the chat a client addresses, and
 * the threads the agent actually runs on. Callers deal in chat ids only; which
 * thread a turn lands on is this service's business.
 *
 * Unlike `TaskService` this one does import from `agent/`, which is honest
 * rather than a leak: tasks exist without the agent, conversations do not.
 *
 * Scoped to one login, like `TaskService`. `chat_threads`, the checkpoints and
 * the run rows carry no owner of their own; they are only ever reached after a
 * chat has been resolved for this owner, which is what makes `db/agentState.ts`
 * safe to leave keyed on `thread_id` alone.
 */
export class ChatService {
  constructor(
    private readonly db: D1Database,
    private readonly owner: string,
  ) {}

  /** A new conversation and the thread it starts on. */
  async create(): Promise<{ chat: ChatRow; threadId: string }> {
    const now = new Date().toISOString();
    const chat: ChatRow = {
      id: uuidv7(),
      user_id: this.owner,
      title: null,
      turn_count: 0,
      created_at: now,
      last_message_at: now,
    };

    const threadId = uuidv7();
    await insertChat(this.db, chat, threadId);

    return { chat, threadId };
  }

  async get(chatId: string): Promise<ChatRow> {
    const id = this.validId(chatId);
    const chat = await selectChat(this.db, id, this.owner);
    if (!chat) throw new ChatNotFoundError(id);
    return chat;
  }

  /** The thread the next turn should run on. */
  async activeThread(chatId: string): Promise<string> {
    const id = this.validId(chatId);
    const threadId = await selectActiveThread(this.db, id, this.owner);
    if (!threadId) throw new ChatNotFoundError(id);
    return threadId;
  }

  async list(input: ListChatsInput = {}): Promise<{ chats: ChatRow[]; truncated: boolean }> {
    const parsed = listChatsSchema.safeParse(input);
    if (!parsed.success) {
      throw new ChatValidationError(ERRORS.INVALID_CHAT_LIST, parsed.error.issues);
    }

    const { limit } = parsed.data;
    const rows = await listChats(this.db, limit, this.owner);

    return { chats: rows.slice(0, limit), truncated: rows.length > limit };
  }

  /**
   * Every turn the conversation has had, across every thread it has run on.
   * That is one thread today. After a compaction the older segments are still
   * here, which is the whole reason threads are a table rather than a column:
   * the agent sees only the newest, the reader sees all of them.
   */
  async history(chatId: string): Promise<ChatTurn[]> {
    const id = this.validId(chatId);
    await this.get(id);

    const turns: ChatTurn[] = [];
    for (const threadId of await selectThreads(this.db, id, this.owner)) {
      turns.push(...((await threadHistory(this.db, threadId)) ?? []));
    }

    return turns;
  }

  /**
   * Records an answered turn: bumps recency and the count, and names the chat
   * if it is still untitled. Returns the row it wrote, so a caller answering a
   * turn does not need a second read to report the chat's new state.
   */
  async touch(chatId: string, message: string): Promise<ChatRow> {
    const id = this.validId(chatId);
    const row = await touchChat(
      this.db,
      id,
      new Date().toISOString(),
      titleFrom(message),
      this.owner,
    );
    if (!row) throw new ChatNotFoundError(id);
    return row;
  }

  async rename(chatId: string, input: RenameChatInput): Promise<ChatRow> {
    const id = this.validId(chatId);
    const parsed = renameChatSchema.safeParse(input);
    if (!parsed.success) {
      throw new ChatValidationError(ERRORS.INVALID_CHAT_UPDATE, parsed.error.issues);
    }

    const row = await renameChat(this.db, id, parsed.data.title ?? null, this.owner);
    if (!row) throw new ChatNotFoundError(id);
    return row;
  }

  /**
   * The conversation and everything the agent left behind for it. Thread data
   * goes first: interrupted halfway that leaves a chat with no history, which
   * a retry finishes off, whereas the other order would strand checkpoints
   * that nothing points at any more.
   */
  async remove(chatId: string): Promise<void> {
    const id = this.validId(chatId);
    await this.get(id);

    const threadIds = await selectThreads(this.db, id, this.owner);
    const live = await selectLiveRun(this.db, threadIds, nowSeconds() - RUN_TTL_SECONDS);
    if (live) throw new ChatBusyError(id);

    for (const threadId of threadIds) {
      await deleteThread(this.db, threadId);
    }
    await deleteChat(this.db, id, this.owner);
  }

  private validId(chatId: string): string {
    const parsed = chatIdSchema.safeParse(chatId);
    if (!parsed.success) {
      throw new ChatValidationError(ERRORS.CHAT_ID_INVALID, parsed.error.issues);
    }
    return parsed.data;
  }
}
