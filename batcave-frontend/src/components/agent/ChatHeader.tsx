import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { renameChat } from '@/api/chats';
import type { ChatRow } from '@/api/types';
import { cn } from '@/lib/cn';
import { fullTimestamp, relativeTime, shortId } from '@/lib/time';

/**
 * The conversation's identity strip.
 *
 * The short id is the operator-grade detail that makes a conversation feel
 * addressable rather than ambient — it is a handle, not something the interface
 * ever looks anything up by. Chat ids are uuidv7, so the prefix is a timestamp
 * and sorts, which is why eight characters is enough to tell two apart.
 *
 * The title is editable in place. It is the only field on a chat a client owns;
 * everything else is server-generated.
 */

interface Props {
  chat: ChatRow | null;
  className?: string;
}

export function ChatHeader({ chat, className }: Props) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);

  const rename = useMutation({
    mutationFn: (title: string | null) => renameChat(chat!.id, title),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['chats'] }),
        queryClient.invalidateQueries({ queryKey: ['chat', chat?.id] }),
      ]),
  });

  if (!chat) {
    return (
      <header
        className={cn(
          'flex h-[var(--shell-header-h)] shrink-0 items-center',
          'border-b border-divider px-[var(--space-4)]',
          className,
        )}
      >
        <span className="font-mono text-micro uppercase text-muted">New conversation</span>
      </header>
    );
  }

  return (
    <header
      className={cn(
        'flex h-[var(--shell-header-h)] shrink-0 items-center gap-[var(--space-4)]',
        'border-b border-divider px-[var(--space-4)]',
        className,
      )}
    >
      {editing ? (
        <input
          autoFocus
          defaultValue={chat.title ?? ''}
          maxLength={100}
          placeholder="Untitled"
          onBlur={(event) => {
            const next = event.target.value.trim() || null;
            setEditing(false);
            if (next !== chat.title) rename.mutate(next);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              event.currentTarget.value = chat.title ?? '';
              event.currentTarget.blur();
            }
          }}
          className="min-w-0 flex-1 bg-well px-[var(--space-2)] py-[2px] font-prose text-body-sm text-primary"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Rename conversation"
          className="min-w-0 flex-1 truncate text-left"
        >
          {chat.title ? (
            <span className="font-prose text-body-sm text-primary">{chat.title}</span>
          ) : (
            <span className="font-mono text-micro uppercase text-disabled">Untitled</span>
          )}
        </button>
      )}

      <div className="flex shrink-0 items-center gap-[var(--space-3)] font-mono text-micro uppercase text-muted">
        <span title={chat.id}>{shortId(chat.id)}</span>
        <span aria-hidden>·</span>
        <span>
          {chat.turn_count} {chat.turn_count === 1 ? 'turn' : 'turns'}
        </span>
        <span aria-hidden>·</span>
        <span title={fullTimestamp(chat.last_message_at)}>
          {relativeTime(chat.last_message_at)}
        </span>
      </div>
    </header>
  );
}
