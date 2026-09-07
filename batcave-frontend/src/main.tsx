import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { AuthProvider } from '@/auth/AuthProvider';
import { App } from '@/App';
import '@/styles/theme.css';

/**
 * Retry policy.
 *
 * The default "retry three times on anything" is wrong here: a 400 or a 404 is
 * a statement about the request and repeating it changes nothing, while a 409
 * means another turn is running and hammering it would only lengthen the queue.
 * Only the genuinely transient statuses are worth a second attempt, and the
 * `retryable` getter on ApiError is the single place that decision lives.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      retry: (attempt, error) => attempt < 2 && error instanceof ApiError && error.retryable,
    },
    mutations: {
      // Never automatic for mutations. A turn that failed is offered a retry
      // button, because re-running the model is the user's call to make.
      retry: false,
    },
  },
});

/*
 * `AuthProvider` sits above the query client because a 401 is not a query
 * failure to be retried — it is the session ending, and the whole shell is
 * replaced rather than any one query being re-run. The client below never sees
 * one it should act on: `api/client.ts` refreshes and retries first.
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </AuthProvider>
  </StrictMode>,
);
