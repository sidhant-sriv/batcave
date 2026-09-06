import { useQuery } from '@tanstack/react-query';
import { NavLink, useLocation, useSearchParams } from 'react-router';
import {
  CalendarClock,
  CircleAlert,
  CircleCheck,
  CircleDot,
  Info,
  ListChecks,
  MessageSquare,
  Moon,
  Sun,
  Sunrise,
  X,
} from 'lucide-react';
import { listTasks } from '@/api/tasks';
import { IconButton } from '@/components/primitives/Button';
import { ALL_TASKS_FILTERS, VIEWS, countsOf, type ViewId } from '@/lib/views';
import { useDueNowCount } from '@/lib/schedules';
import { cn } from '@/lib/cn';
import { todayUtc } from '@/lib/dueDate';
import { useTheme } from '@/lib/prefs';
import { ConversationList } from './ConversationList';

/**
 * The left column.
 *
 * It answers two questions that used to need two destinations: which tasks am I
 * looking at, and which conversation is in the console. Putting both here is
 * what lets the console stop being a place you navigate to and start being a
 * pane you talk in.
 *
 * Three forms, one component:
 *   expanded  the full column, labels and counts
 *   rail      56px of icons, below 1280 — the conversation list is the first
 *             thing to go, because picking a conversation is rarer than reading
 *             one, and the console header can still switch it
 *   sheet     an overlay on a phone, with touch-sized rows
 *
 * View counts come from the one unfiltered task list the index already holds,
 * so the badges cost nothing and can never disagree with the rows they count.
 */

export type NavVariant = 'expanded' | 'rail' | 'sheet';

const VIEW_ICONS: Record<ViewId, typeof ListChecks> = {
  all: ListChecks,
  active: CircleDot,
  today: Sunrise,
  overdue: CircleAlert,
  done: CircleCheck,
};

interface Props {
  variant: NavVariant;
  activeChatId: string | null;
  onSelectChat: (chatId: string | null) => void;
  /** Rail only: the console is not on screen as a list, so it gets a button. */
  onOpenConsole?: () => void;
  /** Sheet only. */
  onClose?: () => void;
  /** Called after any navigation, so an overlay can dismiss itself. */
  onNavigate?: () => void;
}

export function Navigator({
  variant,
  activeChatId,
  onSelectChat,
  onOpenConsole,
  onClose,
  onNavigate,
}: Props) {
  const [theme, setTheme] = useTheme();
  const [searchParams] = useSearchParams();
  const { pathname } = useLocation();
  const dueNow = useDueNowCount();

  // The same request the index makes for the All view, so this is free there
  // and one read everywhere else.
  const tasks = useQuery({
    queryKey: ['tasks', ALL_TASKS_FILTERS],
    queryFn: () => listTasks(ALL_TASKS_FILTERS),
  });

  const counts = countsOf(tasks.data?.tasks ?? [], todayUtc());

  /*
   * Which view is lit. `NavLink` matches on pathname alone, so every view would
   * claim to be active on /tasks whatever `?view=` said — and All, whose link
   * has no search at all, would stay lit on every other surface too. The view
   * is a function of both halves of the URL, so it is decided here.
   */
  const onTasks = pathname.startsWith('/tasks');
  const activeView = onTasks ? (searchParams.get('view') ?? 'all') : null;
  const rail = variant === 'rail';
  const touch = variant === 'sheet';

  const themeToggle = (
    <IconButton
      title={theme === 'night' ? 'Switch to day' : 'Switch to night'}
      onClick={() => setTheme(theme === 'night' ? 'day' : 'night')}
    >
      {theme === 'night' ? <Sun size={16} strokeWidth={1.5} /> : <Moon size={16} strokeWidth={1.5} />}
    </IconButton>
  );

  /*
   * The account menu's slot. There is no auth, so there is nothing to put in
   * it — but the footer's geometry is decided now rather than discovered later.
   */
  const accountSlot = (
    <div aria-hidden className="size-[26px] shrink-0 rounded-full border border-dashed border-hairline" />
  );

  if (rail) {
    return (
      <nav
        aria-label="Views"
        className={cn(
          'flex w-[var(--shell-rail-w)] shrink-0 flex-col items-center',
          'border-r border-divider bg-app py-[var(--space-3)]',
        )}
      >
        <div className="flex flex-1 flex-col items-center gap-[var(--space-1)]">
          <RailItem to="/tasks" label="Tasks" icon={<ListChecks size={20} strokeWidth={1.5} />} />
          <RailItem
            to="/sched"
            label="Sched"
            icon={<CalendarClock size={20} strokeWidth={1.5} />}
            badge={dueNow}
          />
          <button
            type="button"
            onClick={onOpenConsole}
            title="Show the console"
            className={cn(
              'flex w-full flex-col items-center gap-[2px] py-[var(--space-2)]',
              'text-muted transition-colors duration-[90ms] ease-sharp hover:text-secondary',
            )}
          >
            <MessageSquare size={20} strokeWidth={1.5} />
            <span className="font-mono text-micro uppercase">Chats</span>
          </button>
        </div>

        <div className="flex flex-col items-center gap-[var(--space-2)]">
          <RailItem to="/about" label="About" icon={<Info size={20} strokeWidth={1.5} />} />
          {themeToggle}
          {accountSlot}
        </div>
      </nav>
    );
  }

  return (
    <nav
      aria-label="Views and conversations"
      className={cn(
        'flex min-h-0 flex-col border-r border-divider bg-app',
        variant === 'sheet' ? 'h-full w-full' : 'w-[var(--nav-w)] shrink-0',
      )}
    >
      <header
        className={cn(
          'flex h-[var(--shell-header-h)] shrink-0 items-center gap-[var(--space-2)]',
          'border-b border-divider px-[var(--nav-pad-x)]',
        )}
      >
        {touch ? (
          <IconButton title="Close" onClick={onClose}>
            <X size={16} strokeWidth={1.5} />
          </IconButton>
        ) : null}

        <span className="font-mono text-micro uppercase text-accent">Batcave</span>

        {touch ? (
          <span className="ml-auto flex items-center gap-[var(--space-2)]">
            {themeToggle}
            {accountSlot}
          </span>
        ) : null}
      </header>

      <div className="flex shrink-0 flex-col py-[var(--space-3)]">
        <span className="px-[var(--nav-pad-x)] pb-[var(--space-2)] font-mono text-micro uppercase text-disabled">
          Views
        </span>

        {VIEWS.map((view) => {
          const Icon = VIEW_ICONS[view.id];
          return (
            <ViewItem
              key={view.id}
              to={view.id === 'all' ? '/tasks' : `/tasks?view=${view.id}`}
              label={view.label}
              count={counts[view.id]}
              touch={touch}
              active={activeView === view.id}
              icon={<Icon size={touch ? 16 : 14} strokeWidth={1.5} />}
              onNavigate={onNavigate}
            />
          );
        })}

        <ViewItem
          to="/sched"
          label="Scheduled"
          count={dueNow}
          emphasis={dueNow > 0}
          touch={touch}
          icon={<CalendarClock size={touch ? 16 : 14} strokeWidth={1.5} />}
          onNavigate={onNavigate}
        />
      </div>

      <ConversationList
        activeChatId={activeChatId}
        touch={touch}
        onSelect={(id) => {
          onSelectChat(id);
          onNavigate?.();
        }}
        onCleared={() => onSelectChat(null)}
      />

      <footer
        className={cn(
          'flex shrink-0 items-center gap-[var(--space-2)]',
          'border-t border-divider px-[var(--nav-pad-x)]',
          touch ? 'h-[var(--nav-item-h-touch)]' : 'h-[var(--shell-header-h)]',
        )}
      >
        <NavLink
          to="/about"
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-[6px] font-mono text-micro uppercase',
              'transition-colors duration-[90ms] ease-sharp',
              isActive ? 'text-primary' : 'text-disabled hover:text-secondary',
            )
          }
        >
          <Info size={14} strokeWidth={1.5} />
          About
        </NavLink>

        {touch ? null : (
          <span className="ml-auto flex items-center gap-[var(--space-2)]">
            {themeToggle}
            {accountSlot}
          </span>
        )}
      </footer>
    </nav>
  );
}

interface ViewItemProps {
  to: string;
  label: string;
  count: number;
  icon: React.ReactNode;
  touch: boolean;
  active?: boolean;
  /** The count is something waiting on the user, not just a total. */
  emphasis?: boolean;
  onNavigate?: () => void;
}

function ViewItem({
  to,
  label,
  count,
  icon,
  touch,
  active,
  emphasis = false,
  onNavigate,
}: ViewItemProps) {
  return (
    <NavLink
      to={to}
      end
      onClick={onNavigate}
      className={({ isActive }) => {
        const on = active ?? isActive;
        return cn(
          'relative flex items-center gap-[var(--space-2)] px-[var(--nav-pad-x)]',
          'transition-colors duration-[90ms] ease-sharp',
          touch ? 'min-h-[var(--nav-item-h-touch)]' : 'min-h-[var(--nav-item-h)]',
          on ? 'bg-selected text-primary' : 'text-secondary hover:bg-hover hover:text-primary',
        );
      }}
    >
      {({ isActive }) => {
        const on = active ?? isActive;
        return (
          <>
            <span
              aria-hidden
              className={cn(
                'absolute inset-y-0 left-0 w-[var(--bw-rail)]',
                on ? 'bg-accent' : 'bg-transparent',
              )}
            />
            <span className={on ? 'text-secondary' : 'text-disabled'}>{icon}</span>
            <span className="flex-1 truncate font-prose text-body-sm">{label}</span>
            <Count value={count} emphasis={emphasis} />
          </>
        );
      }}
    </NavLink>
  );
}

/**
 * A count, and — when something is waiting to be dismissed — a filled badge.
 *
 * The distinction is the point: every other number here is "how many are in
 * this view", which is context. This one is "how many need you", which is a
 * request, and a request that looks like context gets ignored.
 */
function Count({ value, emphasis }: { value: number; emphasis: boolean }) {
  if (emphasis && value > 0) {
    return (
      <span
        className={cn(
          'min-w-[16px] rounded-full bg-accent px-[4px] text-center',
          'font-mono text-micro leading-[16px] text-on-accent',
        )}
      >
        {value > 99 ? '99+' : value}
        <span className="sr-only"> waiting</span>
      </span>
    );
  }

  return <span className="font-mono text-micro text-disabled">{value > 0 ? value : ''}</span>;
}

function RailItem({
  to,
  label,
  icon,
  badge = 0,
}: {
  to: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}) {
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
          <span className="relative">
            {icon}
            {badge > 0 ? (
              <span
                aria-hidden
                className={cn(
                  'absolute -right-[6px] -top-[4px] min-w-[14px] rounded-full px-[3px]',
                  'bg-accent text-center font-mono text-[9px] leading-[14px] text-on-accent',
                )}
              >
                {badge > 9 ? '9+' : badge}
              </span>
            ) : null}
          </span>
          <span className="font-mono text-micro uppercase">{label}</span>
          {badge > 0 ? <span className="sr-only">{badge} waiting</span> : null}
        </>
      )}
    </NavLink>
  );
}
