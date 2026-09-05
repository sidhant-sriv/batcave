import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarClock, ListChecks, Moon, PanelRightClose, Sun, Terminal } from 'lucide-react';
import type { ChatRow, Task } from '@/api/types';
import { ChatHeader } from '@/components/agent/ChatHeader';
import { Console } from '@/components/agent/Console';
import { IconButton } from '@/components/primitives/Button';
import { OfflineBanner } from '@/components/state/States';
import { TaskDetailModal } from '@/components/task/TaskDetailModal';
import { AgentRoute } from '@/routes/AgentRoute';
import { TaskIndex } from '@/routes/TaskIndex';
import { cn } from '@/lib/cn';
import { useTheme } from '@/lib/prefs';

/**
 * The shell: a 56px nav rail, the active surface, and an optional agent dock.
 *
 * THE DOCK is the reason the layout is shaped this way. Cross-surface mutation
 * — the agent rewriting a task the user is looking at — is only legible if both
 * things are on screen at once. So the console can be pinned beside the index
 * (⌘J), where a row visibly flashes as the turn that changed it resolves.
 *
 * The dock deliberately shows one conversation and hides the conversation list;
 * the full /agent route is where conversations are managed.
 */

export function App() {
  const location = useLocation();
  const [theme, setTheme] = useTheme();
  const [dockOpen, setDockOpen] = useState(false);

  // The dock only makes sense over the deterministic surface. On /agent the
  // console is already the whole page.
  const dockAvailable = location.pathname.startsWith('/tasks');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        setDockOpen((open) => !open);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <OfflineBanner />

      <div className="flex min-h-0 flex-1">
        <nav
          className={cn(
            'flex w-[var(--shell-rail-w)] shrink-0 flex-col items-center',
            'border-r border-divider bg-app py-[var(--space-3)]',
          )}
        >
          <div className="flex flex-1 flex-col items-center gap-[var(--space-1)]">
            <RailLink to="/tasks" label="Tasks" icon={<ListChecks size={20} strokeWidth={1.5} />} />
            <RailLink to="/agent" label="Agent" icon={<Terminal size={20} strokeWidth={1.5} />} />

            {/*
             * Reserved for Workflows — durable scheduled automations. Disabled
             * rather than hidden so the navigation's eventual shape is visible
             * now and the surface does not have to be re-laid-out later. It has
             * no handler and no route: the slot is the whole feature today.
             */}
            <div
              aria-disabled
              title="Scheduled automations — not yet available"
              className={cn(
                'flex w-full cursor-not-allowed flex-col items-center gap-[2px]',
                'py-[var(--space-2)] text-disabled opacity-50',
              )}
            >
              <CalendarClock size={20} strokeWidth={1.5} />
              <span className="font-mono text-micro uppercase">Sched</span>
            </div>
          </div>

          <div className="flex flex-col items-center gap-[var(--space-2)]">
            <IconButton
              title={theme === 'night' ? 'Switch to day' : 'Switch to night'}
              onClick={() => setTheme(theme === 'night' ? 'day' : 'night')}
            >
              {theme === 'night' ? (
                <Sun size={16} strokeWidth={1.5} />
              ) : (
                <Moon size={16} strokeWidth={1.5} />
              )}
            </IconButton>

            {/*
             * Structural slot for the account menu. There is no auth, so there
             * is nothing to put here — but the rail's bottom-aligned geometry is
             * decided now rather than discovered later.
             */}
            <div
              aria-hidden
              className="size-[26px] rounded-full border border-dashed border-hairline"
            />
          </div>
        </nav>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Routes>
            <Route path="/" element={<Navigate to="/tasks" replace />} />
            <Route path="/tasks" element={<TaskIndex />} />
            <Route path="/agent" element={<AgentRoute />} />
            <Route path="/agent/:chatId" element={<AgentRoute />} />
            <Route path="*" element={<Navigate to="/tasks" replace />} />
          </Routes>
        </main>

        {dockAvailable && dockOpen ? <AgentDock onClose={() => setDockOpen(false)} /> : null}
      </div>
    </div>
  );
}

function RailLink({ to, label, icon }: { to: string; label: string; icon: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'relative flex w-full flex-col items-center gap-[2px] py-[var(--space-2)]',
          'transition-colors duration-[90ms] ease-sharp',
          isActive ? 'text-primary' : 'text-muted hover:text-secondary',
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            aria-hidden
            className={cn(
              'absolute inset-y-[2px] left-0 w-[var(--bw-rail)]',
              isActive ? 'bg-accent' : 'bg-transparent',
            )}
          />
          {icon}
          <span className="font-mono text-micro uppercase">{label}</span>
        </>
      )}
    </NavLink>
  );
}

/**
 * The console, docked beside the index.
 *
 * Holds its own chat id in component state rather than in the URL: the dock is
 * a companion to whatever surface is open, and putting its conversation in the
 * address bar would fight with the route the user is actually on.
 */
function AgentDock({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [chat, setChat] = useState<ChatRow | null>(null);
  const [openTask, setOpenTask] = useState<Task | null>(null);

  return (
    <aside
      className={cn(
        'flex w-[var(--dock-w)] min-w-[var(--dock-w-min)] max-w-[var(--dock-w-max)]',
        'shrink-0 flex-col border-l border-[var(--dock-border)] bg-[var(--dock-bg)]',
        'motion-safe:animate-reveal',
      )}
    >
      <div className="flex items-center">
        <ChatHeader chat={chat} className="min-w-0 flex-1" />
        <IconButton title="Close dock (⌘J)" onClick={onClose} className="mr-[var(--space-2)]">
          <PanelRightClose size={16} strokeWidth={1.5} />
        </IconButton>
      </div>

      <Console
        chatId={chat?.id ?? null}
        onChatCreated={(created) => {
          setChat(created);
          void queryClient.invalidateQueries({ queryKey: ['chats'] });
        }}
        onChatUpdated={setChat}
        onOpenTask={(task) => setOpenTask(task as Task)}
      />

      <TaskDetailModal task={openTask} onOpenChange={(open) => !open && setOpenTask(null)} />
    </aside>
  );
}
