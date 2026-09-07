import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { request } from '@/api/client';
import {
  getAccessToken,
  restore,
  signOut as endSession,
  subscribe,
  type SessionUser,
} from './session';

/**
 * Who is signed in, for the parts of the app that render.
 *
 * A thin layer over `auth/session.ts` on purpose. The session has to work
 * outside React — `api/client.ts` refreshes a token in the middle of a fetch,
 * with no component involved — so this subscribes to it rather than owning it,
 * and the one direction of travel is session → provider → UI.
 */

export type AuthStatus = 'loading' | 'anonymous' | 'signed-in';

interface Auth {
  status: AuthStatus;
  user: SessionUser | null;
  /**
   * Take up the session the tokens now describe. The callback route calls this
   * after an exchange: storing a token is something `auth/session.ts` does with
   * no component involved, so somebody has to ask who it belongs to.
   */
  adopt: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<Auth | null>(null);

export function useAuth(): Auth {
  const auth = use(AuthContext);
  if (!auth) throw new Error('useAuth must be used inside AuthProvider');
  return auth;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);

  /**
   * Who the current token belongs to. The login comes from the Worker rather
   * than out of the token, which is opaque to this app on purpose: nothing here
   * parses a credential.
   */
  const adopt = useCallback(async () => {
    if (!getAccessToken()) {
      setUser(null);
      setStatus('anonymous');
      return;
    }

    try {
      const { user: me } = await request<{ user: SessionUser }>('/api/auth/me');
      setUser(me);
      setStatus('signed-in');
    } catch {
      setStatus('anonymous');
    }
  }, []);

  /*
   * One attempt to pick the session back up, on mount. A reload throws the
   * access token away by design, so this is the ordinary path rather than a
   * recovery: the stored refresh token is spent for a new pair, and only then
   * is the shell allowed to render and start firing queries.
   */
  useEffect(() => {
    void restore().then(adopt);
  }, [adopt]);

  /*
   * The session can end without anyone clicking anything: a refresh that fails
   * mid-request clears the tokens from inside `api/client.ts`. This is how the
   * shell finds out and puts the sign-in screen back.
   */
  useEffect(
    () =>
      subscribe(() => {
        if (!getAccessToken()) {
          setUser(null);
          setStatus('anonymous');
        }
      }),
    [],
  );

  const signOut = useCallback(async () => {
    await endSession();
    setUser(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo<Auth>(
    () => ({ status, user, adopt, signOut }),
    [status, user, adopt, signOut],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}
