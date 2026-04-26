import { SdkResult, err, ok } from "../types/result";
import { toSdkError } from "./errors";

export interface RetryOptions {
  /** Number of attempts total (1 = no retry). */
  attempts?: number;
  /** Per-attempt timeout (ms). */
  timeoutMs?: number;
  /** Backoff schedule (ms) between attempts. */
  backoffMs?: number[];
  /** Additional predicate: return `false` to stop retrying early. */
  shouldRetry?: (error: unknown) => boolean;
}

const DEFAULT_BACKOFF_MS = [200, 500, 1500];

/**
 * Retry-wrapped helper. Returns a SdkResult<T>. Never throws. Use for any
 * I/O: RPC calls, backend fetches, CPI simulations.
 *
 * ```ts
 * const res = await safeCall(() => connection.getAccountInfo(pk), { attempts: 3 });
 * if (!res.ok) showToast(res.error.humanMessage);
 * ```
 */
export async function safeCall<T>(
  operation: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<SdkResult<T>> {
  const attempts = opts.attempts ?? 3;
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const shouldRetry = opts.shouldRetry ?? defaultShouldRetry;

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const raced = await withTimeout(operation(), timeoutMs);
      return ok(raced);
    } catch (e) {
      lastError = e;
      if (!shouldRetry(e)) break;
      if (attempt < attempts - 1) {
        const delayIdx = Math.min(attempt, backoff.length - 1);
        await sleep(backoff[delayIdx]);
      }
    }
  }
  return err(
    toSdkError(lastError).code,
    toSdkError(lastError).humanMessage,
    lastError
  );
}

function defaultShouldRetry(e: unknown): boolean {
  const err = toSdkError(e);
  // Retry on transient network / rate-limit errors, stop on structural ones.
  return (
    err.code === "rpc_timeout" ||
    err.code === "rpc_unavailable" ||
    err.code === "rpc_rate_limited" ||
    err.code === "backend_unavailable"
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const h = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(h);
        resolve(v);
      },
      (e) => {
        clearTimeout(h);
        reject(e);
      }
    );
  });
}
