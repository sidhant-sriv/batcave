import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { MessageSquare } from 'lucide-react';
import { getChat } from '@/api/chats';
import { ConsolePane } from '@/components/agent/ConsolePane';
import { Navigator } from '@/components/nav/Navigator';
import { OfflineBanner } from '@/components/state/States';
import { AboutRoute } from '@/routes/AboutRoute';
import { SchedRoute } from '@/routes/SchedRoute';
import { TaskIndex } from '@/routes/TaskIndex';
import { cn } from '@/lib/cn';
import { useLayout } from '@/lib/layout';
import { useConsoleOpen } from '@/lib/prefs';
import { ShellContext, type Shell } from '@/lib/shell';

/**
 * The shell: a navigator, the active surface, and the console beside it.
 *
 * THE CONSOLE IS NOT A DESTINATION. Tasks are the product; the console is how
 * you operate on them, so it sits alongside the record rather than behind a tab
 * of its own. Cross-surface mutation — the agent rewriting a task you are
 * looking at — is only legible when both are on screen, and that is the whole
 * reason the layout is shaped this way.
 *
 * A SCHEDULE IS A FACET OF A TASK, not a third thing. It belongs to exactly one
 * task, so it appears as a saved view, a column on the row, and a section in
 * the task's own detail — never as its own top-level noun.
 *
 * The conversation lives in `?chat=`, not in the path: it is a companion to
 * whatever surface is open, and putting it in the path would fight with the
 * route the user is actually on. It stays in the URL rather than in component
 * state so a conversation is still linkable and survives a reload.
 */

export function App() {
  const layout = useLayout();
  const [searchParams, setSearchParams] = useSearchParams();
  const [dockOpen, setDockOpen] = useConsoleOpen();
  const [navSheet, setNavSheet] = useState(false);
  const [overlayConsole, setOverlayConsole] = useState(false);

  const narrow = layout === 'narrow';
  const chatId = searchParams.get('chat');

  const selectChat = useCallback(
    (id: string | null) => {
      setSearchParams(
        (params) => {
          const next = new URLSearchParams(params);
          if (id) next.set('chat', id);
          else next.delete('chat');
          return next;
        },
        { replace: true },
      );

      // On a phone the console is somewhere else entirely, so choosing a
      // conversation has to take you there or the choice appears to do nothing.
      if (narrow) setOverlayConsole(true);
    },
    [narrow, setSearchParams],
  );

  const openConsole = useCallback(() => {
    if (narrow) setOverlayConsole(true);
    else setDockOpen(true);
  }, [narrow, setDockOpen]);

  const consoleVisible = narrow ? overlayConsole : dockOpen;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        if (narrow) setOverlayConsole((open) => !open);
        else setDockOpen(!dockOpen);
      }

      // Escape dismisses the overlays, innermost first. Only ever the ones this
      // component owns: a modal or a menu stops the event before it gets here.
      if (event.key === 'Escape') {
        if (navSheet) setNavSheet(false);
        else if (narrow && overlayConsole) setOverlayConsole(false);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dockOpen, narrow, navSheet, overlayConsole, setDockOpen]);

  // Coming back to a wide window should not leave a sheet stranded on top of a
  // layout that has room for the real thing.
  useEffect(() => {
    if (!narrow) {
      setNavSheet(false);
      setOverlayConsole(false);
    }
  }, [narrow]);

  const shell = useMemo<Shell>(
    () => ({ layout, openNav: () => setNavSheet(true), openConsole }),
    [layout, openConsole],
  );

  return (
    <ShellContext value={shell}>
      <div className="flex h-full flex-col">
        <OfflineBanner />

        <div className="relative flex min-h-0 flex-1">
          {narrow ? null : (
            <Navigator
              variant={layout === 'wide' ? 'expanded' : 'rail'}
              activeChatId={chatId}
              onSelectChat={selectChat}
              onOpenConsole={openConsole}
            />
          )}

          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            <Routes>
              <Route path="/" element={<Navigate to="/tasks" replace />} />
              <Route path="/tasks" element={<TaskIndex />} />
              <Route path="/sched" element={<SchedRoute />} />
              <Route path="/about" element={<AboutRoute />} />
              {/* The console used to be a route. Anything still pointing at it
                  lands on the tasks it was always talking about. */}
              <Route path="/agent/*" element={<Navigate to="/tasks" replace />} />
              <Route path="*" element={<Navigate to="/tasks" replace />} />
            </Routes>
          </main>

          {consoleVisible ? (
            <ConsolePane
              chatId={chatId}
              overlay={narrow}
              onSelectChat={selectChat}
              onClose={() => (narrow ? setOverlayConsole(false) : setDockOpen(false))}
            />
          ) : null}

          {narrow && !overlayConsole ? <ConsoleBar chatId={chatId} onOpen={openConsole} /> : null}

          {navSheet ? <NavSheet chatId={chatId} onSelectChat={selectChat} onClose={() => setNavSheet(false)} /> : null}
        </div>
      </div>
    </ShellContext>
  );
}

/**
 * The console, reduced to one line at the bottom of a phone.
 *
 * It names the conversation it would open, because the alternative — an anonymous
 * "ask the agent" bar — hides the fact that there is a thread with history
 * behind it, and someone would send a message into a conversation they did not
 * know they were in.
 */
function ConsoleBar({ chatId, onOpen }: { chatId: string | null; onOpen: () => void }) {
  const chat = useQuery({
    queryKey: ['chat', chatId],
    queryFn: () => getChat(chatId!),
    enabled: Boolean(chatId),
  });

  const title = chat.data?.chat.title;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'absolute inset-x-0 bottom-0 z-dock flex items-center gap-[var(--space-3)]',
        'min-h-[56px] border-t border-divider bg-well px-[var(--space-3)] text-left',
      )}
    >
      <span className="min-w-0 flex-1 truncate font-prose text-body-sm text-disabled">
        Ask the agent…
      </span>
      <span className="flex max-w-[45%] shrink-0 items-center gap-[6px] font-mono text-micro uppercase text-muted">
        <MessageSquare size={14} strokeWidth={1.5} />
        <span className="truncate">{chatId ? (title ?? 'Untitled') : 'New'}</span>
      </span>
    </button>
  );
}

function NavSheet({
  chatId,
  onSelectChat,
  onClose,
}: {
  chatId: string | null;
  onSelectChat: (id: string | null) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-modal flex">
      <div
        className="w-full max-w-[320px] motion-safe:animate-reveal"
        role="dialog"
        aria-label="Views and conversations"
      >
        <Navigator
          variant="sheet"
          activeChatId={chatId}
          onSelectChat={onSelectChat}
          onClose={onClose}
          onNavigate={onClose}
        />
      </div>

      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="min-w-0 flex-1 bg-scrim"
      />
    </div>
  );
}
