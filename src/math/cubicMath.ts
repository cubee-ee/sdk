import { complement, divDown, divUp, mulDown, ONE, weightToFp } from "./fixedPoint";
import { powFp } from "./logExp";

/**
 * Port of `CubicMath::calc_out_given_in` from
 * `contracts/programs/cubic-pool/src/math/cubic_math.rs`.
 *
 * Formula:   aO = bO * (1 - (bI / (bI + aI))^(wI / wO))
 *
 * Inputs are u64 raw amounts (bigint here to avoid overflow). Decimals
 * cancel in the ratio bI/(bI+aI), so no scaling needed.
 */
export function calcOutGivenIn(params: {
  virtualBalanceIn: bigint;
  weightInBps: bigint;
  virtualBalanceOut: bigint;
  weightOutBps: bigint;
  amountIn: bigint;
  actualBalanceOut: bigint;
}): bigint {
  const { virtualBalanceIn, weightInBps, virtualBalanceOut, weightOutBps, amountIn, actualBalanceOut } =
    params;
  const denom = virtualBalanceIn + amountIn;
  const base = divUp(virtualBalanceIn, denom);
  const exp = divDown(weightToFp(weightInBps), weightToFp(weightOutBps));
  let power = powFp(base, exp);
  // Match Rust's +1 bias + clamp to ONE.
  power = power + 1n;
  if (power > ONE) power = ONE;
  const comp = complement(power);
  let out = mulDown(virtualBalanceOut, comp);
  if (out > actualBalanceOut) out = actualBalanceOut;
  return out;
}

/**
 * Port of `CubicMath::calc_bpt_out_given_exact_tokens_in`.
 * Proportional join: `bpt = total_supply * min(amount_i / actual_balance_i)`
 * across tokens with `actual_balance_i > 0`.
 */
export function calcBptOutGivenExactTokensIn(
  actualBalances: bigint[],
  amountsIn: bigint[],
  bptTotalSupply: bigint
): bigint {
  if (actualBalances.length !== amountsIn.length) {
    throw new Error("cubicMath: balances/amounts length mismatch");
  }
  let ratioMin: bigint | null = null;
  for (let i = 0; i < actualBalances.length; i++) {
    if (actualBalances[i] === 0n) continue;
    const ratio = divDown(amountsIn[i], actualBalances[i]);
    ratioMin = ratioMin === null || ratio < ratioMin ? ratio : ratioMin;
  }
  if (ratioMin === null) throw new Error("cubicMath: no live tokens");
  return (bptTotalSupply * ratioMin) / ONE;
}

/**
 * Port of `CubicMath::calc_tokens_out_given_bpt_in`. Proportional exit.
 */
export function calcTokensOutGivenBptIn(
  actualBalances: bigint[],
  bptAmount: bigint,
  bptTotalSupply: bigint
): bigint[] {
  if (bptTotalSupply === 0n) throw new Error("cubicMath: zero total supply");
  const ratio = divDown(bptAmount, bptTotalSupply);
  return actualBalances.map((bal) => mulDown(bal, ratio));
}

/**
 * Spot amount-out: aO = aI * (bO * wI) / (bI * wO). Always ≥
 * `calcOutGivenIn` for the same inputs (curve slippage drags the real
 * value below spot). Useful for UI "price impact" calculations.
 */
export function calcSpotOut(params: {
  virtualBalanceIn: bigint;
  weightInBps: bigint;
  virtualBalanceOut: bigint;
  weightOutBps: bigint;
  amountIn: bigint;
}): bigint {
  const { virtualBalanceIn, weightInBps, virtualBalanceOut, weightOutBps, amountIn } = params;
  if (virtualBalanceIn === 0n || weightOutBps === 0n) return 0n;
  return (amountIn * virtualBalanceOut * weightInBps) / (virtualBalanceIn * weightOutBps);
}
