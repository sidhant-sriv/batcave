import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent, type RefObject } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, PanelRightClose, Plus } from 'lucide-react';
import { getChat } from '@/api/chats';
import type { Task } from '@/api/types';
import { IconButton } from '@/components/primitives/Button';
import { TaskDetailModal } from '@/components/task/TaskDetailModal';
import { cn } from '@/lib/cn';
import { useLayout } from '@/lib/layout';
import {
  CONSOLE_W_DEFAULT,
  CONSOLE_W_DEFAULT_MD,
  CONSOLE_W_MAX,
  CONSOLE_W_MIN,
  clampConsoleWidth,
  useConsoleWidth,
} from '@/lib/prefs';
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
  const paneRef = useRef<HTMLElement | null>(null);
  const layout = useLayout();
  const [storedWidth, setStoredWidth] = useConsoleWidth();

  // Two defaults and no stored width is the untouched case, and it has to stay
  // that way: the medium breakpoint is allowed to keep narrowing the console
  // until someone has actually said what they want it to be.
  const width = storedWidth ?? (layout === 'medium' ? CONSOLE_W_DEFAULT_MD : CONSOLE_W_DEFAULT);

  const chat = useQuery({
    queryKey: ['chat', chatId],
    queryFn: () => getChat(chatId!),
    enabled: Boolean(chatId),
  });

  return (
    <aside
      ref={paneRef}
      aria-label="Agent console"
      // The width is inline because it is data now, not a breakpoint. `max-w`
      // stays in CSS so a window shrinking under an already-dragged console is
      // handled by the browser rather than by a resize listener re-rendering
      // the whole transcript.
      style={overlay ? undefined : { width }}
      className={cn(
        'flex min-h-0 flex-col bg-[var(--console-bg)]',
        overlay
          ? 'absolute inset-0 z-dock'
          : 'relative max-w-[calc(100vw-var(--surface-w-min))] shrink-0 ' +
            'border-l border-[var(--console-border)]',
        'motion-safe:animate-reveal',
        className,
      )}
    >
      {overlay ? null : <ConsoleResizer paneRef={paneRef} width={width} onResize={setStoredWidth} />}

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

/**
 * The drag handle on the console's left edge.
 *
 * The split between the record and the agent is the one proportion in this
 * layout that has no right answer, so it is a drag rather than a third
 * breakpoint. It is a `separator` with a value rather than a button: the arrow
 * keys are then a documented affordance instead of a surprise, because a
 * pointer is not the only way anyone drives this shell.
 *
 * The drag writes straight to the pane's own style and only tells React on
 * release. A transcript with a hundred turns in it should not re-render once
 * per pixel, and the committed value is the one already on screen, so the
 * handover is invisible.
 */

/** One arrow press. Shift multiplies it, because 320→720 is 25 presses. */
const STEP = 16;

function ConsoleResizer({
  paneRef,
  width,
  onResize,
}: {
  paneRef: RefObject<HTMLElement | null>;
  width: number;
  onResize: (width: number | null) => void;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);

  // The cursor and the selection lock live on <body> so they hold while the
  // pointer is outside the 7px handle, which for a drag is nearly always.
  useEffect(() => () => setDragging(false), []);

  const widthFrom = (start: { x: number; width: number }, clientX: number) =>
    // The console is on the right, so dragging left is what widens it.
    clampConsoleWidth(start.width + (start.x - clientX), window.innerWidth);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const pane = paneRef.current;
    if (!pane || event.button !== 0) return;

    // Measured rather than taken from the prop: `max-w` may already have
    // narrowed the pane below the stored width, and a drag that jumped to the
    // stored one on the first pixel of movement would feel broken.
    drag.current = { x: event.clientX, width: pane.getBoundingClientRect().width };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    setDragging(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || !paneRef.current) return;
    paneRef.current.style.width = `${widthFrom(start, event.clientX)}px`;
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) return;

    drag.current = null;
    setDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
    onResize(widthFrom(start, event.clientX));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? STEP * 4 : STEP;

    if (event.key === 'ArrowLeft') onResize(clampConsoleWidth(width + step, window.innerWidth));
    else if (event.key === 'ArrowRight') onResize(clampConsoleWidth(width - step, window.innerWidth));
    else if (event.key === 'Home') onResize(CONSOLE_W_MIN);
    else if (event.key === 'End') onResize(clampConsoleWidth(CONSOLE_W_MAX, window.innerWidth));
    else return;

    event.preventDefault();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the console"
      aria-valuenow={Math.round(width)}
      aria-valuemin={CONSOLE_W_MIN}
      aria-valuemax={CONSOLE_W_MAX}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      // Forgetting the stored width, not writing the default into it: the pane
      // goes back to following the breakpoint the way it did before anyone
      // touched it.
      onDoubleClick={() => onResize(null)}
      className={cn(
        'absolute inset-y-0 z-rail w-[var(--console-resize-w)] cursor-col-resize touch-none',
        // Centred on the border it is grabbing, so the target straddles the
        // hairline instead of sitting beside it.
        'left-[calc(var(--console-resize-w)/-2)]',
        // The line that lights up is 1px; the 7px around it is only target. At
        // rest it paints nothing, because the pane's own border is already
        // drawing that edge and two lines would read as a seam.
        'after:absolute after:inset-y-0 after:left-[calc(var(--console-resize-w)/2)] after:w-px',
        'after:transition-colors after:duration-[90ms] after:ease-sharp',
        'hover:after:bg-strong active:after:bg-strong',
        'outline-none focus-visible:after:bg-focus focus-visible:after:w-[2px]',
      )}
    />
  );
}

function setDragging(on: boolean): void {
  // Pointer capture keeps the events coming, but the cursor and the selection
  // are the document's business, and a drag that leaves text selected in its
  // wake looks like a bug rather than a resize.
  document.body.style.cursor = on ? 'col-resize' : '';
  document.body.style.userSelect = on ? 'none' : '';
}
