/**
 * Fixed-point arithmetic with 1e18 precision. Port of
 * `contracts/programs/cubic-pool/src/math/fixed_point.rs`. All functions
 * operate on bigint to match the Rust u128/i128 semantics exactly.
 */

export const ONE = 1_000_000_000_000_000_000n; // 1e18

export function mulDown(a: bigint, b: bigint): bigint {
  const product = a * b;
  return product / ONE;
}

export function mulUp(a: bigint, b: bigint): bigint {
  const product = a * b;
  if (product === 0n) return 0n;
  return (product - 1n) / ONE + 1n;
}

export function divDown(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error("fixedPoint.divDown: divide by zero");
  return (a * ONE) / b;
}

export function divUp(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error("fixedPoint.divUp: divide by zero");
  if (a === 0n) return 0n;
  return (a * ONE - 1n) / b + 1n;
}

export function complement(x: bigint): bigint {
  return x < ONE ? ONE - x : 0n;
}

/** Convert bps → 1e18 fixed point. 5000 bps → 5e17. */
export function weightToFp(weightBps: bigint | number): bigint {
  const w = typeof weightBps === "number" ? BigInt(weightBps) : weightBps;
  return (w * ONE) / 10_000n;
}
