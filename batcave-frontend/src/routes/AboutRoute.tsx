import { Info } from 'lucide-react';
import { SchemaDiagram } from '@/components/about/SchemaDiagram';
import { SystemDiagram } from '@/components/about/SystemDiagram';
import { TurnDiagram } from '@/components/about/TurnDiagram';
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
 * their order: what is this, how is it put together, what is worth looking at
 * in the code, and where is the code. Three diagrams carry most of that,
 * because the shape of a system is the part prose is worst at: a paragraph
 * describing four callers converging on one service layer takes longer to read
 * than the picture and is still less convincing.
 *
 * Everything here is either true of the running system or a bracketed blank.
 * Nothing on an About page is worth inventing: a wrong version string is read
 * as fact by whoever reads it next.
 */

const REPO = 'https://github.com/sidhant-sriv/batcave';

const STACK: Array<[string, React.ReactNode]> = [
  ['Frontend', 'React 19, Vite, TanStack Query, Tailwind 4, on Cloudflare Pages'],
  ['API', 'Hono on Cloudflare Workers'],
  ['MCP', 'Remote MCP server on the same Worker, behind OAuth 2.1 with GitHub sign-in'],
  ['Auth', 'The same OAuth 2.1 server signs in the web app — one authorization server, two clients'],
  ['Data', 'Cloudflare D1, with migrations'],
  ['Scheduling', 'Cloudflare Workflows, one instance per schedule'],
  ['Agent', 'LangGraph, with a Groq-hosted model'],
  ['Agent state', 'LangGraph checkpoints, stored in D1'],
];

/**
 * The decisions worth a reviewer's time — the ones where the obvious
 * implementation is the wrong one, and which the diagrams above cannot show
 * because each is a rule rather than a shape. Every one is checkable in the
 * source.
 */
const NOTES: Array<[string, string]> = [
  [
    'The agent cannot invent a task id',
    'A middleware refuses any tool call carrying a task id the model did not first see in a search or create result on that same thread. A model that guesses gets an error it can recover from, rather than a write to somebody else’s row.',
  ],
  [
    'The schedule row is the source of truth',
    'Each schedule is a Workflow instance, but the instance carries only its id and re-reads the row at every step. Cancelling or replacing a schedule is therefore a D1 write and never a message to a running instance. A firing that lands on a finished task reopens it, and that is recorded rather than inferred.',
  ],
  [
    'The agent is not the only way in',
    'The same six capabilities are served over the Model Context Protocol at /mcp, so any MCP client can drive the task list. It is stateless, per the 2026-07-28 revision, so it needs no Durable Object. Access is an OAuth 2.1 authorization server on the same Worker: the library issues tokens and enforces PKCE, and this Worker owns consent, the GitHub round trip, and the single-use state that binds the callback to the browser that started it.',
  ],
  [
    'One authorization server, two kinds of client',
    'The OAuth server was built so an MCP client could reach /mcp as a GitHub user; the web app is now a second client of the same server, and every task and conversation carries the login that owns it. The frontend is a public client, so PKCE is the only thing standing between a stolen authorization code and a token. It holds a bearer token rather than a session cookie because Pages and Workers are separate sites — a cookie between them would need SameSite=None, which Safari drops. Consent is skipped for the app itself and shown to every other client: "Allow Batcave to access Batcave?" only teaches people to click through consent screens.',
  ],
  [
    'The clock acts for nobody',
    'Every service is constructed with the login whose rows it may touch, so forgetting to scope a query is a compile error rather than a review catch. The one caller with no login is the Workflow, which wakes hours or weeks after the request that created its schedule; it passes an explicit SYSTEM symbol, which nothing derived from a request could ever produce by accident.',
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
  ['MCP endpoint', 'https://batcave-backend.sidhant-sriv.workers.dev/mcp'],
  // Committed alongside the code rather than linked out, so the prompts and the
  // commits they produced can be read against each other.
  [
    'Prompt history',
    <Link
      key="prompts"
      href={`${REPO}/blob/main/PROMPT_HISTORY.txt`}
      label="PROMPT_HISTORY.txt — every prompt this was built with, in order"
    />,
  ],
];

const AUTHOR: Array<[string, React.ReactNode]> = [
  ['Name', 'Sidhant Srivastava'],
  ['Currently', 'Software Engineer at Writesonic (YC S21)'],
  [
    'Background',
    'Agent infrastructure in production — multi-agent orchestration on LangGraph and Temporal, MCP servers, and eval suites that run as CI checks. Before that, backend and developer tooling in TypeScript and Go.',
  ],
  [
    'Links',
    <span key="links" className="flex flex-wrap gap-x-[var(--space-3)] gap-y-[var(--space-1)]">
      <Link href="https://github.com/sidhant-sriv" label="github" />
      <Link href="https://linkedin.com/in/sidhant-srivastava-41803620b" label="linkedin" />
      <Link href="mailto:sidhant.sriv@gmail.com" label="sidhant.sriv@gmail.com" />
    </span>,
  ],
];

/** Prose stays at a readable measure; only the diagrams use the full column. */
const PROSE = 'max-w-[600px]';

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
        <div className="flex max-w-[768px] flex-col gap-[var(--space-8)] p-[var(--space-6)] pb-[var(--space-16)]">
          <section className={cn(PROSE, 'flex flex-col gap-[var(--space-3)]')}>
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

          <Figure label="How it fits together">
            <SystemDiagram />
          </Figure>

          <Figure label="What one turn does">
            <TurnDiagram />
          </Figure>

          <Figure label="What is in the database">
            <SchemaDiagram />
          </Figure>

          <Section label="Schedules">
            A schedule always belongs to one task, and a task has at most one. Recurring schedules
            are five-field cron in UTC; a one-shot fires once. There is no form for creating them —
            "every Monday" is language, and turning language into a cron is the agent's job.
          </Section>

          <section className={cn(PROSE, 'flex flex-col gap-[var(--space-4)]')}>
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

/** A diagram under a heading. The caption belongs to the figure, not here. */
function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-[var(--space-4)]">
      <h3 className="font-mono text-micro uppercase text-disabled">{label}</h3>
      {children}
    </section>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className={cn(PROSE, 'flex flex-col gap-[var(--space-3)]')}>
      <h3 className="font-mono text-micro uppercase text-disabled">{label}</h3>
      <p className="font-prose text-body-sm text-secondary text-pretty">{children}</p>
    </section>
  );
}

function Facts({ label, rows }: { label: string; rows: Array<[string, React.ReactNode]> }) {
  return (
    <section className={cn(PROSE, 'flex flex-col')}>
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
