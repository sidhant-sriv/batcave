import { useState } from 'react';
import { Github } from 'lucide-react';
import { Button } from '@/components/primitives/Button';
import { beginSignIn } from '@/auth/session';
import { cn } from '@/lib/cn';

/**
 * The signed-out screen, and the whole app when nobody is signed in.
 *
 * It carries the repository link, which the About page carries too — but About
 * is behind the gate, and a reviewer who arrives here without a GitHub account
 * should still be able to reach the code. That is the only reason this page
 * says anything about itself at all.
 *
 * The button does not open a dialog or fetch anything the user can see: it
 * leaves the page. So it goes into a pending state and stays there, because a
 * control that springs back while the browser is mid-navigation reads as a
 * click that did not register.
 */

const REPO = 'https://github.com/sidhant-sriv/batcave';

export function SignInRoute() {
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setLeaving(true);
    setError(null);
    try {
      await beginSignIn();
    } catch {
      // The only failure before the redirect is the config request, which means
      // the Worker is unreachable. Worth saying plainly rather than leaving a
      // button that appears to do nothing.
      setError('Could not reach the sign-in service. Try again in a moment.');
      setLeaving(false);
    }
  };

  return (
    <main className="flex min-h-0 flex-1 items-center justify-center bg-app px-[var(--space-4)]">
      <div className="flex w-full max-w-[380px] flex-col gap-[var(--space-6)]">
        <header className="flex flex-col gap-[var(--space-2)]">
          <span className="font-mono text-micro uppercase text-accent">Batcave</span>
          <h1 className="font-prose text-display text-primary text-balance">
            A task list you can talk to.
          </h1>
          <p className="font-prose text-body-sm text-muted text-pretty">
            Tasks are the record; the console beside them is an agent that can create, search,
            update and schedule those same rows.
          </p>
        </header>

        <div className="flex flex-col gap-[var(--space-3)]">
          <Button
            variant="primary"
            onClick={() => void start()}
            disabled={leaving}
            icon={<Github size={14} strokeWidth={1.5} />}
            className="w-full"
          >
            {leaving ? 'Redirecting…' : 'Continue with GitHub'}
          </Button>

          {error ? (
            <p role="alert" className="font-prose text-body-sm text-[var(--danger-fg)]">
              {error}
            </p>
          ) : null}
        </div>

        <div className={cn('flex flex-col gap-[var(--space-3)]', 'border-t border-divider pt-[var(--space-4)]')}>
          <p className="font-prose text-body-sm text-muted text-pretty">
            Batcave asks GitHub for your username and nothing else — no repositories, no email. Your
            tasks and conversations are visible only to your account.
          </p>

          <a
            href={REPO}
            target="_blank"
            rel="noreferrer"
            className={cn(
              'font-mono text-micro uppercase text-disabled underline underline-offset-[3px]',
              'transition-colors duration-[90ms] ease-sharp hover:text-secondary',
            )}
          >
            github.com/sidhant-sriv/batcave
          </a>
        </div>
      </div>
    </main>
  );
}
