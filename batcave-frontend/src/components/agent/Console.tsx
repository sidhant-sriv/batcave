import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { createChatWithMessage, getChat, sendMessage } from '@/api/chats';
import type { AnyTask, ChatRow, ChatTurn } from '@/api/types';
import { ErrorBanner, EmptyState, LoadingRows } from '@/components/state/States';
import { cn } from '@/lib/cn';
import { recordActions } from '@/lib/mutationLog';
import { Composer } from './Composer';
import { ExecutingRail, SessionBoundary } from './ExecutingRail';
import { Turn } from './Turn';

/**
 * The conversation surface.
 *
 * A turn is atomic here, because it is atomic on the wire: the request goes out,
 * the whole tool loop runs on the Worker, and one JSON response comes back with
 * the prose and everything that ran. There is no streaming to render, so the
 * console does not pretend otherwise — the user's message appears immediately,
 * an indeterminate EXECUTING rail sits below it, and the chips and result
 * blocks land together when the answer does.
 *
 * The idempotency key is minted once per attempt and reused across retries of
 * that attempt. That is what makes retrying a 503 safe: the backend returns the
 * stored answer, or takes the interrupted run over, instead of asking the model
 * the same thing twice.
 */

interface Props {
  chatId: string | null;
  /** Called when a first message creates a conversation, so the route can move. */
  onChatCreated?: (chat: ChatRow) => void;
  onChatUpdated?: (chat: ChatRow) => void;
  onOpenTask?: (task: AnyTask) => void;
  className?: string;
}

interface Pending {
  message: string;
  key: string;
}

export function Console({ chatId, onChatCreated, onChatUpdated, onOpenTask, className }: Props) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<Pending | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const history = useQuery({
    queryKey: ['chat', chatId],
    queryFn: () => getChat(chatId!),
    enabled: Boolean(chatId),
  });

  /**
   * How many turns were already on the record when this conversation was
   * opened — the position of the "session resumed" boundary.
   *
   * Frozen on first load, because a boundary that slides down as you talk is
   * not a boundary. `spoke` is what keeps it honest across the create-then-
   * navigate flow: a first message creates the chat, the route moves to its
   * id, and history then loads carrying the turn that was just said. Without
   * this, that turn would be mistaken for pre-existing history and a brand-new
   * conversation would claim to have been resumed.
   */
  const [resumedAt, setResumedAt] = useState<number | null>(null);
  const spoke = useRef(false);

  useEffect(() => {
    if (spoke.current) return;
    setResumedAt(null);
  }, [chatId]);

  useEffect(() => {
    if (resumedAt === null && history.data) {
      setResumedAt(spoke.current ? 0 : history.data.turns.length);
    }
  }, [history.data, resumedAt]);

  const turns: ChatTurn[] = useMemo(() => history.data?.turns ?? [], [history.data]);

  const turn = useMutation({
    mutationFn: ({ message, key }: Pending) =>
      chatId ? sendMessage(chatId, message, key) : createChatWithMessage(message, key),
    onSuccess: async (response) => {
      // Any task the agent wrote is logged before the cache is touched, so the
      // index rows are already flagged by the time they re-render.
      recordActions(response.actions ?? []);

      setPending(null);

      if (!chatId) {
        onChatCreated?.(response.chat);
      } else {
        onChatUpdated?.(response.chat);
        await queryClient.invalidateQueries({ queryKey: ['chat', chatId] });
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['chats'] }),
      ]);
    },
    // The pending message is deliberately kept on failure: it is what a retry
    // re-sends, and losing someone's typing because the model timed out would
    // be its own small betrayal.
  });

  const send = useCallback(
    (message: string) => {
      const next = { message, key: crypto.randomUUID() };
      spoke.current = true;
      setResumedAt((current) => current ?? 0);
      setPending(next);
      turn.mutate(next);
    },
    [turn],
  );

  const retry = useCallback(() => {
    if (pending) turn.mutate(pending);
  }, [pending, turn]);

  // Follow the transcript as it grows, but only to the bottom — never yank the
  // view while someone is reading further up.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, turn.isPending, pending]);

  const busy = turn.isPending;
  const failed = turn.isError ? turn.error : null;
  const isBusyConflict = failed instanceof ApiError && failed.busy;

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-[var(--msg-gap)] px-[var(--space-4)] py-[var(--space-5)]">
          {history.isLoading ? <LoadingRows rows={3} /> : null}

          {history.isError ? (
            <ErrorBanner error={history.error} onRetry={() => history.refetch()} />
          ) : null}

          {!chatId && !pending && !busy ? (
            <EmptyState
              label="No conversation"
              message="Ask the agent to find, create or change a task. It can call several tools in one turn, and everything it does is recorded here."
            />
          ) : null}

          {chatId && turns.length === 0 && !history.isLoading && !pending ? (
            <EmptyState
              label="Empty conversation"
              message="Nothing has been said yet. Send the first message below."
            />
          ) : null}

          {turns.map((entry, index) => (
            <div key={index} className="flex flex-col gap-[var(--msg-gap)]">
              {resumedAt !== null && resumedAt > 0 && index === resumedAt ? (
                <SessionBoundary turns={resumedAt} />
              ) : null}
              <Turn turn={entry} onOpenTask={onOpenTask} onChoose={busy ? undefined : send} />
            </div>
          ))}

          {/* The boundary sits after the last replayed turn when nothing new has
              been said yet, so a resumed conversation is legible on arrival. */}
          {resumedAt !== null && resumedAt > 0 && turns.length === resumedAt && !pending ? (
            <SessionBoundary turns={resumedAt} />
          ) : null}

          {/* The in-flight turn: the message is echoed optimistically, and the
              rail sits under it until the real answer replaces both. */}
          {pending ? (
            <div className="flex flex-col gap-[var(--space-3)]">
              <Turn turn={{ message: pending.message, reply: null, actions: [] }} />
              {busy ? <ExecutingRail /> : null}
            </div>
          ) : null}

          {failed ? <ErrorBanner error={failed} onRetry={retry} /> : null}
        </div>
      </div>

      <Composer
        onSend={send}
        disabled={busy}
        autoFocus
        status={
          busy
            ? 'Executing — one turn runs at a time'
            : isBusyConflict
              ? 'Conversation busy — another turn is still running'
              : undefined
        }
      />
    </div>
  );
}
