import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getChat } from '@/api/chats';
import type { Task } from '@/api/types';
import { ChatHeader } from '@/components/agent/ChatHeader';
import { ChatList } from '@/components/agent/ChatList';
import { Console } from '@/components/agent/Console';
import { TaskDetailModal } from '@/components/task/TaskDetailModal';

/**
 * The full agent surface: conversation list, header, transcript, composer.
 *
 * The chat id lives in the URL, so a conversation is linkable and a reload
 * resumes it — which is the whole point of history being server-side. `/agent`
 * with no id is a new, uncreated conversation: the first message creates it and
 * the route moves to its id.
 */

export function AgentRoute() {
  const { chatId } = useParams<{ chatId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [openTask, setOpenTask] = useState<Task | null>(null);

  const chat = useQuery({
    queryKey: ['chat', chatId],
    queryFn: () => getChat(chatId!),
    enabled: Boolean(chatId),
  });

  return (
    <div className="flex min-h-0 flex-1">
      <ChatList
        activeChatId={chatId ?? null}
        onSelect={(id) => navigate(`/agent/${id}`)}
        onNew={() => navigate('/agent')}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ChatHeader chat={chat.data?.chat ?? null} />

        <Console
          chatId={chatId ?? null}
          onChatCreated={(created) => {
            // The response already carries the full row, so the list can be
            // primed rather than refetched, and the route moves straight to it.
            void queryClient.invalidateQueries({ queryKey: ['chats'] });
            navigate(`/agent/${created.id}`, { replace: true });
          }}
          onChatUpdated={() => void queryClient.invalidateQueries({ queryKey: ['chats'] })}
          onOpenTask={(task) => setOpenTask(task as Task)}
        />
      </div>

      <TaskDetailModal task={openTask} onOpenChange={(open) => !open && setOpenTask(null)} />
    </div>
  );
}
