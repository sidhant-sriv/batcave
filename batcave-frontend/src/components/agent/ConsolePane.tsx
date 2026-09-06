import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, PanelRightClose, Plus } from 'lucide-react';
import { getChat } from '@/api/chats';
import type { Task } from '@/api/types';
import { IconButton } from '@/components/primitives/Button';
import { TaskDetailModal } from '@/components/task/TaskDetailModal';
import { cn } from '@/lib/cn';
import { ChatHeader } from './ChatHeader';
import { Console } from './Console';

/**
 * The console, docked beside whatever surface is open.
 *
 * This is the pane the old /agent route used to be. Making it a permanent
 * companion rather than a destination is the whole point of the shell: the
 * agent rewriting a task you are looking at is only legible if both things are
 * on screen at once, and a row visibly flashes as the turn that changed it
 * resolves.
 *
 * The conversation id lives in the URL as a search param, so a conversation is
 * still linkable and a reload still resumes it — which is what the server-side
 * history is for — while the path stays free for the surface underneath.
 */

interface Props {
  chatId: string | null;
  onSelectChat: (chatId: string | null) => void;
  onClose: () => void;
  /** Full-screen on a phone: the close control is a back arrow, not a collapse. */
  overlay?: boolean;
  className?: string;
}

export function ConsolePane({ chatId, onSelectChat, onClose, overlay = false, className }: Props) {
  const queryClient = useQueryClient();
  const [openTask, setOpenTask] = useState<Task | null>(null);

  const chat = useQuery({
    queryKey: ['chat', chatId],
    queryFn: () => getChat(chatId!),
    enabled: Boolean(chatId),
  });

  return (
    <aside
      aria-label="Agent console"
      className={cn(
        'flex min-h-0 flex-col bg-[var(--console-bg)]',
        overlay
          ? 'absolute inset-0 z-dock'
          : 'w-[var(--console-w-md)] shrink-0 border-l border-[var(--console-border)] xl:w-[var(--console-w)]',
        'motion-safe:animate-reveal',
        className,
      )}
    >
      <div className="flex shrink-0 items-center border-b border-divider">
        {overlay ? (
          <IconButton title="Back to tasks" onClick={onClose} className="ml-[var(--space-2)]">
            <ArrowLeft size={16} strokeWidth={1.5} />
          </IconButton>
        ) : null}

        <ChatHeader chat={chat.data?.chat ?? null} bordered={false} className="min-w-0 flex-1" />

        <div className="mr-[var(--space-2)] flex items-center gap-[var(--space-1)]">
          <IconButton title="New conversation" onClick={() => onSelectChat(null)}>
            <Plus size={16} strokeWidth={1.5} />
          </IconButton>

          {overlay ? null : (
            <IconButton title="Hide the console (⌘J)" onClick={onClose}>
              <PanelRightClose size={16} strokeWidth={1.5} />
            </IconButton>
          )}
        </div>
      </div>

      <Console
        chatId={chatId}
        onChatCreated={(created) => {
          // The response already carries the full row, so the list is primed
          // rather than refetched, and the URL moves to the new conversation.
          void queryClient.invalidateQueries({ queryKey: ['chats'] });
          onSelectChat(created.id);
        }}
        onChatUpdated={() => void queryClient.invalidateQueries({ queryKey: ['chats'] })}
        onOpenTask={(task) => setOpenTask(task as Task)}
      />

      <TaskDetailModal task={openTask} onOpenChange={(open) => !open && setOpenTask(null)} />
    </aside>
  );
}
