import { ONE } from "./fixedPoint";

export interface AllocationResult {
  /** Per-token integer amount allocations; sum = amountIn. */
  allocations: bigint[];
  /** Scaled W values, for inspection/debugging. */
  wScaled: bigint[];
  /** Sum of wScaled. */
  sumW: bigint;
}

/**
 * Port of stld `compute_allocations` from
 * `contracts/programs/single-token-liquidity/src/math.rs`.
 *
 * W_i = weight_i * factBalance_i / virtBalance_i (dimensionless concentration).
 * share_i = W_i / ΣW. amount_alloc[i] = amountIn * share_i.
 *
 * Integer truncation of per-token amounts routes the remainder to the
 * input-token slot so Σ allocations == amountIn exactly.
 */
export function computeAllocations(params: {
  actualBalances: bigint[];
  virtualBalances: bigint[];
  weightsBps: number[];
  amountIn: bigint;
  tokenInIndex: number;
}): AllocationResult {
  const { actualBalances, virtualBalances, weightsBps, amountIn, tokenInIndex } = params;
  const n = actualBalances.length;
  if (n !== virtualBalances.length || n !== weightsBps.length) {
    throw new Error("computeAllocations: length mismatch");
  }
  if (tokenInIndex < 0 || tokenInIndex >= n) {
    throw new Error("computeAllocations: tokenInIndex out of range");
  }
  const wScaled: bigint[] = [];
  for (let i = 0; i < n; i++) {
    if (virtualBalances[i] <= 0n) {
      throw new Error(`computeAllocations: virtualBalance[${i}] must be positive`);
    }
    const w = (BigInt(weightsBps[i]) * actualBalances[i] * ONE) / (virtualBalances[i] * 10_000n);
    wScaled.push(w);
  }
  const sumW = wScaled.reduce((a, b) => a + b, 0n);
  if (sumW === 0n) {
    throw new Error("computeAllocations: pool not seeded (ΣW = 0)");
  }
  const allocations: bigint[] = wScaled.map((w) => (amountIn * w) / sumW);
  const sumAlloc = allocations.reduce((a, b) => a + b, 0n);
  if (sumAlloc < amountIn) {
    allocations[tokenInIndex] += amountIn - sumAlloc;
  }
  return { allocations, wScaled, sumW };
}
