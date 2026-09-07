import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Button } from '@/components/primitives/Button';
import { useAuth } from '@/auth/AuthProvider';
import { completeSignIn } from '@/auth/session';

/**
 * Where GitHub sends the browser back, by way of the Worker.
 *
 * It renders almost nothing on the happy path, because there is nothing to
 * decide: spend the code, find out who that made us, and go where the user was.
 *
 * `completeSignIn` is memoised per page load rather than guarded here, because
 * the guard has to survive a second *call*, not just a second render. React's
 * StrictMode invokes every effect twice in development, and both the
 * authorization code and the PKCE verifier are single use — so without the memo
 * the first call would succeed while the second reported failure, and the
 * screen would show an error to someone who was by then signed in. That is a
 * bug this route had, and it is why the memo is in the session rather than
 * behind a ref up here.
 */

export function AuthCallbackRoute() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { adopt } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;

    void completeSignIn(params)
      // Storing tokens is not the same as being signed in: the provider has to
      // ask the Worker who they belong to before the shell will render.
      .then(async (returnTo) => {
        await adopt();
        return returnTo;
      })
      .then(
        (returnTo) => {
          // `replace`, so Back does not land on a callback URL whose code is
          // now spent — the one navigation here that must not be repeatable.
          if (live) void navigate(returnTo, { replace: true });
        },
        (cause: unknown) => {
          if (live) setError(cause instanceof Error ? cause.message : 'Sign-in failed.');
        },
      );

    return () => {
      live = false;
    };
    // Deliberately empty: this runs against the URL the page loaded with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="flex min-h-0 flex-1 items-center justify-center bg-app px-[var(--space-4)]">
      <div className="flex w-full max-w-[380px] flex-col gap-[var(--space-3)]">
        <span className="font-mono text-micro uppercase text-accent">Batcave</span>

        {error ? (
          <>
            <p role="alert" className="font-prose text-body text-primary text-pretty">
              {error}
            </p>
            <div>
              <Button onClick={() => void navigate('/tasks', { replace: true })}>Start again</Button>
            </div>
          </>
        ) : (
          <p className="font-prose text-body-sm text-muted motion-safe:animate-breathe">
            Signing you in…
          </p>
        )}
      </div>
    </main>
  );
}
