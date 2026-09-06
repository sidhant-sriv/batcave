import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Plus } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { ApiError } from '@/api/client';
import { createChat, deleteChat, listChats, renameChat } from '@/api/chats';
import type { ChatRow } from '@/api/types';
import { IconButton } from '@/components/primitives/Button';
import { ConfirmDialog } from '@/components/primitives/Modal';
import { EmptyState, ErrorBanner, LoadingRows } from '@/components/state/States';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/time';

/**
 * Conversations, newest first, inside the navigator.
 *
 * A chat names itself after its first message and counts its own turns, so this
 * list needs no extra reads — `turn_count` exists precisely so that listing
 * conversations never decodes a checkpoint. An untitled chat is one that has
 * not been answered yet; it says UNTITLED rather than rendering an empty row,
 * because an absent name is information.
 *
 * It lives in the navigator rather than beside the console because a
 * conversation is a thing you pick, like a view — not a thing the console is
 * responsible for managing while you are reading one.
 */

interface Props {
  activeChatId: string | null;
  onSelect: (chatId: string) => void;
  /** Called when the conversation being deleted is the one that was open. */
  onCleared: () => void;
  touch?: boolean;
  className?: string;
}

export function ConversationList({
  activeChatId,
  onSelect,
  onCleared,
  touch = false,
  className,
}: Props) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<ChatRow | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const chats = useQuery({ queryKey: ['chats'], queryFn: () => listChats() });

  const create = useMutation({
    mutationFn: createChat,
    onSuccess: async (chat) => {
      await queryClient.invalidateQueries({ queryKey: ['chats'] });
      onSelect(chat.id);
    },
  });

  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string | null }) => renameChat(id, title),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['chats'] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteChat(id),
    onSuccess: async (_result, id) => {
      setConfirming(null);
      await queryClient.invalidateQueries({ queryKey: ['chats'] });
      if (id === activeChatId) onCleared();
    },
  });

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col border-t border-divider', className)}>
      <header
        className={cn(
          'flex shrink-0 items-center justify-between',
          'px-[var(--nav-pad-x)] font-mono text-micro uppercase text-disabled',
          touch ? 'h-[40px]' : 'h-[32px]',
        )}
      >
        <span>Conversations</span>
        <IconButton
          title="New conversation"
          onClick={() => create.mutate()}
          disabled={create.isPending}
        >
          <Plus size={14} strokeWidth={1.5} />
        </IconButton>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {chats.isLoading ? <LoadingRows rows={4} /> : null}

        {chats.isError ? (
          <ErrorBanner
            error={chats.error}
            onRetry={() => chats.refetch()}
            className="m-[var(--space-3)]"
          />
        ) : null}

        {chats.data?.chats.length === 0 ? (
          <EmptyState
            label="No conversations"
            message="Start one to give the agent something to do."
            className="py-[var(--space-6)]"
          />
        ) : null}

        <ul>
          {chats.data?.chats.map((chat) => (
            <ConversationItem
              key={chat.id}
              chat={chat}
              active={chat.id === activeChatId}
              renaming={renaming === chat.id}
              touch={touch}
              onSelect={() => onSelect(chat.id)}
              onStartRename={() => setRenaming(chat.id)}
              onRename={(title) => {
                setRenaming(null);
                // An unchanged title is not a write. An emptied one is a reset
                // to untitled, which lets the next message auto-name it again.
                if (title !== chat.title) rename.mutate({ id: chat.id, title });
              }}
              onDelete={() => setConfirming(chat)}
            />
          ))}
        </ul>

        {chats.data?.truncated ? (
          <p className="px-[var(--nav-pad-x)] py-[var(--space-3)] font-mono text-micro uppercase text-disabled">
            Showing {chats.data.chats.length} · more exist
          </p>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirming(null);
            remove.reset();
          }
        }}
        title="Delete conversation"
        description={`"${confirming?.title ?? 'Untitled'}" and everything the agent stored for it will be discarded. Tasks it created are not affected.`}
        confirmLabel="Delete"
        pending={remove.isPending}
        error={
          // 409 is a refusal, not a failure: the graph is still writing
          // checkpoints for this conversation and deleting now would strand them.
          remove.error instanceof ApiError && remove.error.busy
            ? 'Cannot delete — a turn is still running on this conversation.'
            : remove.error instanceof Error
              ? remove.error.message
              : null
        }
        onConfirm={() => confirming && remove.mutate(confirming.id)}
      />
    </div>
  );
}

interface ItemProps {
  chat: ChatRow;
  active: boolean;
  renaming: boolean;
  touch: boolean;
  onSelect: () => void;
  onStartRename: () => void;
  onRename: (title: string | null) => void;
  onDelete: () => void;
}

function ConversationItem({
  chat,
  active,
  renaming,
  touch,
  onSelect,
  onStartRename,
  onRename,
  onDelete,
}: ItemProps) {
  const height = touch ? 'min-h-[56px]' : 'min-h-[var(--chatitem-h)]';

  return (
    <li
      className={cn(
        'group relative flex items-center',
        'border-b border-hairline',
        'transition-colors duration-[90ms] ease-sharp',
        active ? 'bg-[var(--chatitem-bg-active)]' : 'hover:bg-[var(--chatitem-bg-hover)]',
      )}
    >
      {/* The active conversation carries an accent rail — the same "this is the
          one that matters right now" signal the rest of the system uses. */}
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-0 left-0 w-[var(--chatitem-rail-w)]',
          active ? 'bg-[var(--chatitem-rail)]' : 'bg-transparent',
        )}
      />

      {renaming ? (
        <input
          autoFocus
          defaultValue={chat.title ?? ''}
          maxLength={100}
          placeholder="Untitled"
          onBlur={(event) => onRename(event.target.value.trim() || null)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              event.currentTarget.value = chat.title ?? '';
              event.currentTarget.blur();
            }
          }}
          className={cn(
            height,
            'w-full bg-well px-[var(--nav-pad-x)] font-prose text-body-sm text-primary',
          )}
        />
      ) : (
        <>
          <button
            type="button"
            onClick={onSelect}
            className={cn(
              height,
              'flex min-w-0 flex-1 flex-col justify-center gap-[2px]',
              'px-[var(--nav-pad-x)] py-[var(--space-1)] text-left',
            )}
          >
            {chat.title ? (
              <span
                className={cn(
                  'truncate font-prose text-body-sm',
                  active
                    ? 'text-[var(--chatitem-title-fg-active)]'
                    : 'text-[var(--chatitem-title-fg)]',
                )}
              >
                {chat.title}
              </span>
            ) : (
              <span className="font-mono text-micro uppercase text-[var(--chatitem-untitled-fg)]">
                Untitled
              </span>
            )}

            <span className="truncate font-mono text-micro uppercase text-[var(--chatitem-meta-fg)]">
              {chat.turn_count} {chat.turn_count === 1 ? 'turn' : 'turns'} ·{' '}
              {relativeTime(chat.last_message_at)}
            </span>
          </button>

          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <IconButton
                title="Conversation actions"
                className={cn(
                  'mr-[var(--space-1)] data-[state=open]:opacity-100',
                  // Hover-to-reveal needs a hover, and a touch screen has none.
                  touch ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                )}
              >
                <MoreHorizontal size={14} strokeWidth={1.5} />
              </IconButton>
            </DropdownMenu.Trigger>

            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={4}
                className={cn(
                  'z-popover min-w-[140px] rounded-xs border border-divider bg-modal',
                  'p-[var(--space-1)]',
                )}
              >
                <MenuItem onSelect={onStartRename}>Rename</MenuItem>
                {chat.title ? <MenuItem onSelect={() => onRename(null)}>Clear name</MenuItem> : null}
                <MenuItem onSelect={onDelete} danger>
                  Delete
                </MenuItem>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </>
      )}
    </li>
  );
}

function MenuItem({
  children,
  onSelect,
  danger,
}: {
  children: string;
  onSelect: () => void;
  danger?: boolean;
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className={cn(
        'cursor-pointer rounded-xs px-[var(--space-2)] py-[var(--space-1)]',
        'font-mono text-micro uppercase outline-none',
        danger ? 'text-danger data-highlighted:bg-danger-bg' : 'text-secondary',
        'data-highlighted:bg-hover data-highlighted:text-primary',
        danger && 'data-highlighted:text-danger',
      )}
    >
      {children}
    </DropdownMenu.Item>
  );
}
