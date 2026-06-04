import type { RawPoolAccount } from "../parsers/poolAccount";

/**
 * Client-side mirror of the on-chain max-selloff sliding-window rate
 * limiter (`contracts/programs/cubic-pool/src/math/max_selloff.rs`).
 *
 * The contract caps the cumulative sell volume (`amount_in`) of a token
 * over a rolling window. State lives per-token in `AssetDynamics`
 * (`previous_selloff`, `current_selloff`, `window_start_timestamp`) and
 * the cap/window in `AssetConfig` (`max_selloff`, `max_selloff_period_length`).
 *
 * `computeSelloffStatus` reports the *current* effective usage (without a
 * pending swap's `amount_in`), so a UI can show how much of the sell
 * budget is already spent. All arithmetic is bigint to match the
 * contract's u128 intermediate math and avoid precision loss on raw u64s.
 */

/** Raw per-token selloff state, as decoded from the on-chain account. */
export interface RawSelloffState {
  maxSelloff: bigint;
  periodLength: number;
  previousSelloff: bigint;
  currentSelloff: bigint;
  windowStartTimestamp: bigint;
}

export interface SelloffStatus {
  enabled: boolean;
  cap: bigint;
  used: bigint;
  remaining: bigint;
  fraction: number;
  periodLength: number;
}

function clampNonNeg(value: bigint): bigint {
  return value < 0n ? 0n : value;
}

/**
 * Compute the effective selloff usage for a token at `nowSec`.
 *
 * Mirrors `check_and_advance` with `amount_in = 0`: it performs the same
 * bucket rotation and linear interpolation of the previous window, but
 * never mutates state — it only reports the value the next swap would be
 * checked against.
 */
export function computeSelloffStatus(
  state: RawSelloffState,
  nowSec: number,
): SelloffStatus {
  const cap = state.maxSelloff;
  const period = state.periodLength;

  if (cap <= 0n || period <= 0) {
    return {
      enabled: false,
      cap: 0n,
      used: 0n,
      remaining: 0n,
      fraction: 0,
      periodLength: period,
    };
  }

  const periodBig = BigInt(period);
  const now = BigInt(Math.floor(nowSec));
  const windowStart = state.windowStartTimestamp;

  // Solana clocks can step backwards slightly — clamp like the contract.
  const elapsed = clampNonNeg(now - windowStart);
  const twoPeriods = periodBig * 2n;

  let previous = state.previousSelloff;
  let current = state.currentSelloff;
  let elapsedInWindow: bigint;

  if (elapsed >= twoPeriods) {
    // Both buckets aged out → window fully reset.
    previous = 0n;
    current = 0n;
    elapsedInWindow = 0n;
  } else if (elapsed >= periodBig) {
    // One boundary crossed → current rotates into previous, window += period.
    previous = current;
    current = 0n;
    const newWindowStart = windowStart + periodBig;
    elapsedInWindow = clampNonNeg(now - newWindowStart);
  } else {
    elapsedInWindow = elapsed;
  }

  // remaining time is strictly within [0, period] given the branches above.
  const remainingTime = periodBig - elapsedInWindow;
  const weightedPrevious = (previous * remainingTime) / periodBig;
  const used = weightedPrevious + current;
  const remaining = clampNonNeg(cap - used);

  // 4-decimal precision fraction without overflowing Number on large u64s.
  const fractionBps = used >= cap ? 10000n : (used * 10000n) / cap;
  const fraction = Number(fractionBps) / 10000;

  return {
    enabled: true,
    cap,
    used,
    remaining,
    fraction,
    periodLength: period,
  };
}

/**
 * Convenience: build {@link RawSelloffState} for a single token from a
 * decoded {@link RawPoolAccount} (converting BN → bigint), then compute its
 * status. Throws if `tokenIndex` is out of range.
 */
export function computeSelloffStatusForToken(
  pool: RawPoolAccount,
  tokenIndex: number,
  nowSec: number,
): SelloffStatus {
  if (tokenIndex < 0 || tokenIndex >= pool.tokenCount) {
    throw new Error(
      `computeSelloffStatusForToken: tokenIndex ${tokenIndex} out of range ` +
        `[0, ${pool.tokenCount})`,
    );
  }
  const state: RawSelloffState = {
    maxSelloff: BigInt(pool.maxSelloff[tokenIndex].toString()),
    periodLength: pool.maxSelloffPeriodLength[tokenIndex],
    previousSelloff: BigInt(pool.previousSelloff[tokenIndex].toString()),
    currentSelloff: BigInt(pool.currentSelloff[tokenIndex].toString()),
    windowStartTimestamp: BigInt(
      pool.windowStartTimestamp[tokenIndex].toString(),
    ),
  };
  return computeSelloffStatus(state, nowSec);
}

/**
 * Format a window length (seconds) as a short human string: `45s`, `30m`,
 * `12h`, `7d`. Used for the selloff window label.
 */
export function formatWindowDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) {
    const hours = seconds / 3600;
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
  }
  const days = seconds / 86400;
  return `${Number.isInteger(days) ? days : days.toFixed(1)}d`;
}
