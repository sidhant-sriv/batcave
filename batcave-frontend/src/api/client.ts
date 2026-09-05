import type { ApiErrorBody, ApiIssue } from './types';

/**
 * The single place a request leaves the app.
 *
 * Everything the UI needs to distinguish is carried on `ApiError.status`, so
 * components branch on a number they can reason about rather than on message
 * text. The statuses that actually change behaviour:
 *
 *   400  validation — `issues` maps to form fields
 *   404  the record is gone — an empty state, not an error banner
 *   409  a turn is already running on this conversation
 *   500  misconfiguration — not retryable
 *   502  the model was unreachable — retryable
 *   503  a tool could not reach D1 — retryable, and the backend resumes the turn
 *   504  the model timed out — retryable
 */

const BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues?: ApiIssue[],
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /**
   * Whether sending the identical request again is worth offering.
   *
   * 503 is included and is the interesting one: the backend marks the run
   * failed rather than completed, so the next request on that conversation
   * takes the interrupted turn over instead of asking the model twice.
   */
  get retryable(): boolean {
    return this.status === 502 || this.status === 503 || this.status === 504;
  }

  /** A turn is already running. The composer locks rather than erroring. */
  get busy(): boolean {
    return this.status === 409;
  }

  /** Field-level messages, keyed by the field they belong to.
   *  Object-level issues (an empty `path`) are collected under `_form`. */
  fieldErrors(): Record<string, string> {
    const errors: Record<string, string> = {};
    for (const issue of this.issues ?? []) {
      const key = issue.path.length > 0 ? String(issue.path[0]) : '_form';
      errors[key] ??= issue.message;
    }
    return errors;
  }
}

/** Thrown when the request never reached the Worker at all. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('Could not reach the API');
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /**
   * Sent as `Idempotency-Key`. Supply one for any turn the UI might retry, so
   * a retry after a timeout returns the stored answer instead of running the
   * model a second time.
   */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, idempotencyKey, signal } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    // An abort is the caller's own doing and must not be laundered into a
    // network failure the UI would show a banner for.
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new NetworkError(error);
  }

  // 204 No Content: DELETE succeeds with no body to parse.
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload: unknown = text ? safeParse(text) : null;

  if (!response.ok) {
    const error = (payload ?? {}) as ApiErrorBody;
    throw new ApiError(
      response.status,
      error.error ?? `Request failed with ${response.status}`,
      error.issues,
    );
  }

  return payload as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Builds a query string, dropping empty values and repeating array keys. */
export function queryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;

    if (Array.isArray(value)) {
      // The backend accepts repeated keys and comma-separated alike; repeated
      // keys avoid any question about escaping a comma inside a value.
      for (const entry of value) search.append(key, String(entry));
      continue;
    }

    search.set(key, String(value));
  }

  const query = search.toString();
  return query ? `?${query}` : '';
}

export { BASE_URL };
