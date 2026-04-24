import { SLIPPAGE_PRECISION, SWAP_FEE_PRECISION } from "../config";

/**
 * min_out = expected * (SLIPPAGE_PRECISION - slippage_hbps) / SLIPPAGE_PRECISION.
 * Matches `apply_slippage` in stld's math.rs.
 */
export function applySlippage(expected: bigint, slippageHbps: number): bigint {
  if (slippageHbps < 0 || slippageHbps > SLIPPAGE_PRECISION) {
    throw new Error(`slippage: ${slippageHbps} out of [0, ${SLIPPAGE_PRECISION}]`);
  }
  const keep = BigInt(SLIPPAGE_PRECISION - slippageHbps);
  return (expected * keep) / BigInt(SLIPPAGE_PRECISION);
}

/**
 * fee = amount * rate / SWAP_FEE_PRECISION. Returns amount - fee.
 * Matches `apply_swap_fee`.
 */
export function applySwapFee(amount: bigint, swapFeeRate: number): bigint {
  if (swapFeeRate < 0) throw new Error("swapFee: negative rate");
  const fee = (amount * BigInt(swapFeeRate)) / BigInt(SWAP_FEE_PRECISION);
  return amount - fee;
}

/**
 * LP-accessible balances: lp_actual = actual - pfo; lp_virtual scaled to
 * match. Matches stld's `lp_balances`.
 */
export function lpBalances(actual: bigint, virtualBal: bigint, pfo: bigint): { lpActual: bigint; lpVirtual: bigint } {
  const lpActual = actual >= pfo ? actual - pfo : 0n;
  const lpVirtual =
    actual > 0n ? (virtualBal * lpActual) / actual : virtualBal;
  return { lpActual, lpVirtual };
}

/**
 * Price impact in hundredths of basis point: (spot - actual) / spot × 1_000_000.
 * 0 if spot is 0.
 */
export function priceImpactHbps(spot: bigint, actual: bigint): number {
  if (spot <= 0n) return 0;
  if (actual >= spot) return 0;
  const diff = spot - actual;
  const hbps = (diff * BigInt(SLIPPAGE_PRECISION)) / spot;
  return Number(hbps);
}
