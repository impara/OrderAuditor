import { logger } from "./logger";

export interface FetchWithRetryOptions extends RequestInit {
  maxRetries?: number;
  /** When false, only retry GET/HEAD/OPTIONS and idempotent PUT/DELETE. */
  idempotent?: boolean;
  /** Label for log messages */
  label?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number, method: string, idempotent: boolean): boolean {
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }

  if (status >= 400 && status < 500) {
    return false;
  }

  if (status >= 500) {
    return true;
  }

  return idempotent && method !== "POST";
}

function isRetryableNetworkError(error: unknown): boolean {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const lowerMessage = errorMessage.toLowerCase();

  return (
    lowerMessage.includes("network") ||
    lowerMessage.includes("fetch failed") ||
    lowerMessage.includes("econnrefused") ||
    lowerMessage.includes("etimedout") ||
    lowerMessage.includes("timeout") ||
    lowerMessage.includes("enotfound")
  );
}

function parseRetryAfterMs(response: Response): number | null {
  const header = response.headers.get("Retry-After");
  if (!header) {
    return null;
  }

  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return Math.max(seconds, 1) * 1000;
  }

  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) {
    return Math.max(dateMs - Date.now(), 1000);
  }

  return null;
}

function isIdempotentMethod(method: string): boolean {
  const normalized = method.toUpperCase();
  return normalized === "GET" || normalized === "HEAD" || normalized === "OPTIONS";
}

export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {}
): Promise<Response> {
  const {
    maxRetries = 3,
    idempotent,
    label = url,
    ...fetchOptions
  } = options;

  const method = (fetchOptions.method || "GET").toUpperCase();
  const treatAsIdempotent = idempotent ?? isIdempotentMethod(method);
  let lastResponse: Response | null = null;
  let lastError: unknown = null;
  let nextDelayMs = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      logger.info(
        `[FetchRetry] Retrying ${label} (attempt ${attempt + 1}/${maxRetries + 1}) after ${nextDelayMs}ms`
      );
      await sleep(nextDelayMs);
    }

    try {
      const response = await fetch(url, fetchOptions);
      lastResponse = response;

      if (response.ok) {
        return response;
      }

      if (!isRetryableStatus(response.status, method, treatAsIdempotent)) {
        return response;
      }

      if (attempt < maxRetries) {
        const retryAfterMs = parseRetryAfterMs(response);
        if (retryAfterMs) {
          nextDelayMs = retryAfterMs;
          logger.warn(
            `[FetchRetry] ${label} received ${response.status}, honoring Retry-After (${retryAfterMs}ms)`
          );
        } else {
          nextDelayMs = Math.pow(2, attempt) * 1000;
        }
      }
    } catch (error) {
      lastError = error;
      if (!isRetryableNetworkError(error) || attempt >= maxRetries) {
        throw error;
      }
      nextDelayMs = Math.pow(2, attempt) * 1000;
    }
  }

  if (lastResponse) {
    return lastResponse;
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Request failed after retries: ${label}`);
}

/**
 * Retry policy for billing POSTs: only when caller confirms idempotency
 * or after a read-after-write check.
 */
export async function fetchBillingWithRetry(
  url: string,
  options: FetchWithRetryOptions & { confirmedIdempotent?: boolean }
): Promise<Response> {
  const { confirmedIdempotent = false, ...rest } = options;

  if (!confirmedIdempotent) {
    return fetch(url, rest);
  }

  return fetchWithRetry(url, {
    ...rest,
    idempotent: true,
    maxRetries: rest.maxRetries ?? 2,
  });
}
