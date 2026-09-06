import { Info } from 'lucide-react';
import { NavToggle } from '@/components/nav/NavToggle';
import { cn } from '@/lib/cn';

/**
 * A static page, and deliberately the only one.
 *
 * It is reached from the navigator's footer rather than from Views, because it
 * is a destination but not a working surface — grouping it with the saved views
 * would put a page that never changes next to five that change constantly, and
 * overstate it every time someone scans the list.
 *
 * Its reader is someone assessing the project, so it answers their questions in
 * their order: what is this, why does it exist, what is it made of, what is
 * worth looking at in the code, and where is the code. Everything here is
 * either true of the running system or a bracketed blank. Nothing on an About
 * page is worth inventing: a wrong version string is read as fact by whoever
 * reads it next.
 */

const REPO = 'https://github.com/sidhant-sriv/batcave';

const STACK: Array<[string, React.ReactNode]> = [
  ['Frontend', 'React 19, Vite, TanStack Query, Tailwind 4, on Cloudflare Pages'],
  ['API', 'Hono on Cloudflare Workers'],
  ['Data', 'Cloudflare D1, with migrations'],
  ['Scheduling', 'Cloudflare Workflows, one instance per schedule'],
  ['Agent', 'LangGraph, with a Groq-hosted model'],
  ['Agent state', 'LangGraph checkpoints, stored in D1'],
];

/**
 * The four decisions worth a reviewer's time — the ones where the obvious
 * implementation is the wrong one. Each is checkable in the source.
 */
const NOTES: Array<[string, string]> = [
  [
    'One turn at a time, safely retried',
    'A turn is atomic: the whole tool loop runs on the Worker and returns one response. Each attempt mints an idempotency key and reuses it across retries, so retrying a timeout returns the stored answer or resumes the interrupted run rather than asking the model the same thing twice. A second concurrent turn is refused with a 409, not queued.',
  ],
  [
    'History lives on the server',
    'Conversation state is a LangGraph checkpoint in D1, so a reload resumes a conversation rather than replaying it from the client. Listing conversations never decodes a checkpoint: the turn count is denormalised onto the row precisely so the list stays one cheap read.',
  ],
  [
    'The schedule row is the source of truth',
    'Each schedule is a Workflow instance, but the instance carries only its id and re-reads the row at every step. Cancelling or replacing a schedule is therefore a D1 write and never a message to a running instance. A firing that lands on a finished task reopens it, and that is recorded rather than inferred.',
  ],
  [
    'The client states what the API can actually do',
    'The task list caps at 100 rows and reports truncation, with no cursor — so the index says so plainly in a footer instead of implying it is showing everything, and offers no sort control the API could not honour.',
  ],
];

const SOURCE: Array<[string, React.ReactNode]> = [
  ['Repository', <Link key="repo" href={REPO} label="github.com/sidhant-sriv/batcave" />],
  [
    'Live',
    <Link key="live" href="https://batcave-frontend.pages.dev/tasks" label="batcave-frontend.pages.dev" />,
  ],
  ['Prompt history', '[LINK — the prompts this was built with]'],
];

const AUTHOR: Array<[string, React.ReactNode]> = [
  ['Name', 'Sidhant Srivastava'],
  ['Currently', '[ROLE, COMPANY]'],
  ['Background', '[ONE OR TWO LINES FROM YOUR RESUME]'],
  ['Links', '[RESUME / LINKEDIN / EMAIL]'],
];

export function AboutRoute() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header
        className={cn(
          'flex h-[var(--shell-header-h)] shrink-0 items-center gap-[var(--space-3)]',
          'border-b border-divider px-[var(--space-4)]',
        )}
      >
        <NavToggle />
        <Info size={14} strokeWidth={1.5} className="text-muted" />
        <h1 className="font-mono text-micro uppercase text-muted">About</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex max-w-[640px] flex-col gap-[var(--space-8)] p-[var(--space-6)] pb-[var(--space-16)]">
          <section className="flex flex-col gap-[var(--space-3)]">
            <h2 className="font-prose text-display text-primary">Batcave</h2>
            <p className="font-prose text-body text-secondary text-pretty">
              A task list you can talk to. Tasks are the record; the console beside them is an agent
              that can create, search, update and schedule those same rows, so a change you ask for
              lands in the table you are already looking at.
            </p>
            <p className="font-prose text-body-sm text-muted text-pretty">
              Built as a portfolio project for a software engineering application at Cloudflare. It
              runs entirely on the Cloudflare platform — Workers for the API, D1 for the data and
              the agent's own memory, and Workflows for anything that has to happen later.
            </p>
          </section>

          <Section label="How a turn works">
            Your message goes out, the whole tool loop runs on the Worker, and one response comes
            back carrying the prose and every tool that ran. Conversation history is checkpointed
            server-side, so a reload resumes where you left off and a conversation is linkable.
          </Section>

          <Section label="Schedules">
            A schedule always belongs to one task, and a task has at most one. Recurring schedules
            are five-field cron in UTC; a one-shot fires once. Every firing is recorded, and one
            that lands on a finished task reopens it. There is no form for creating them — "every
            Monday" is language, and turning language into a cron is the agent's job.
          </Section>

          <section className="flex flex-col gap-[var(--space-4)]">
            <h3 className="font-mono text-micro uppercase text-disabled">Worth a look</h3>

            {NOTES.map(([title, body]) => (
              <div key={title} className="flex flex-col gap-[var(--space-1)]">
                <h4 className="font-prose text-body-sm text-primary">{title}</h4>
                <p className="font-prose text-body-sm text-muted text-pretty">{body}</p>
              </div>
            ))}
          </section>

          <Facts label="Built with" rows={STACK} />
          <Facts label="Source" rows={SOURCE} />
          <Facts label="Author" rows={AUTHOR} />
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-[var(--space-3)]">
      <h3 className="font-mono text-micro uppercase text-disabled">{label}</h3>
      <p className="font-prose text-body-sm text-secondary text-pretty">{children}</p>
    </section>
  );
}

function Facts({ label, rows }: { label: string; rows: Array<[string, React.ReactNode]> }) {
  return (
    <section className="flex flex-col">
      <h3 className="pb-[var(--space-2)] font-mono text-micro uppercase text-disabled">{label}</h3>

      <dl className="flex flex-col">
        {rows.map(([term, value]) => (
          <div
            key={term}
            className="flex gap-[var(--space-4)] border-b border-hairline py-[var(--space-2)]"
          >
            <dt className="w-[116px] shrink-0 font-mono text-micro uppercase text-disabled">
              {term}
            </dt>
            <dd className="min-w-0 flex-1 font-prose text-body-sm text-secondary">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Link({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-link underline decoration-hairline underline-offset-2 hover:text-accent-hover"
    >
      {label}
    </a>
  );
}
