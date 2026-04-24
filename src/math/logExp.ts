/**
 * Fixed-point ln/exp/pow over 1e18 precision. Port of
 * `contracts/programs/cubic-pool/src/math/log_exp_math.rs` via bigint —
 * results match the Rust version modulo identical rounding.
 *
 * Intended for off-chain quoting; on-chain calls go through cubic-pool's
 * own implementation.
 */

const ONE = 1_000_000_000_000_000_000n;
const TWO = 2n * ONE;
const LN2 = 693_147_180_559_945_309n; // ln(2) * 1e18

/** Natural logarithm. Accepts x > 0 in 1e18 fp, returns signed i128 in 1e18 fp. */
export function lnFp(x: bigint): bigint {
  if (x <= 0n) throw new Error("logExp.ln: x must be positive");
  if (x === ONE) return 0n;
  if (x < ONE) {
    const inv = (ONE * ONE + x - 1n) / x;
    return -lnPos(inv);
  }
  return lnPos(x);
}

function lnPos(x: bigint): bigint {
  let val = x;
  let acc = 0n;
  while (val >= TWO) {
    acc += LN2;
    val /= 2n;
  }
  const y = val - ONE;
  if (y === 0n) return acc;

  // Taylor series: ln(1+y) = y - y^2/2 + y^3/3 - ...
  let term = y;
  let sum = y;
  let sign = -1n;
  for (let k = 2n; k <= 30n; k++) {
    term = (term * y) / ONE;
    const tk = term / k;
    sum = sign < 0n ? sum - tk : sum + tk;
    sign = -sign;
    if (tk === 0n) break;
  }
  return acc + sum;
}

/** e^x. Accepts signed i128 1e18 fp, returns u128 1e18 fp. */
export function expFp(x: bigint): bigint {
  if (x === 0n) return ONE;
  if (x < 0n) {
    const pos = expFp(-x);
    return (ONE * ONE) / pos;
  }
  let ux = x;
  let k = 0n;
  while (ux >= LN2) {
    ux -= LN2;
    k += 1n;
  }
  // Taylor series: e^r = 1 + r + r^2/2! + ...
  let sum = ONE;
  let term = ONE;
  for (let i = 1n; i <= 30n; i++) {
    term = (term * ux) / ONE;
    term = term / i;
    sum += term;
    if (term === 0n) break;
  }
  return sum << BigInt(k);
}

/** Fixed-point pow: x^y where both are 1e18 fp. */
export function powFp(base: bigint, exponent: bigint): bigint {
  if (exponent === 0n) return ONE;
  if (base === ONE) return ONE;
  if (base === 0n) return 0n;
  const l = lnFp(base);
  const prod = (exponent * (l < 0n ? -l : l)) / ONE;
  return l < 0n ? expFp(-prod) : expFp(prod);
}
