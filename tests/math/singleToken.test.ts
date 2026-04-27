import { calcBptOutGivenExactTokensIn, calcOutGivenIn } from "../../src/math/cubicMath";
import { ONE } from "../../src/math/fixedPoint";
import { computeAllocations, computeTwoTokenOptimalAllocations } from "../../src/math/singleToken";
import { lpBalances } from "../../src/math/slippage";

function simulateSingleTokenPath(params: {
  actualBalances: [bigint, bigint];
  virtualBalances: [bigint, bigint];
  protocolFeesOwed: [bigint, bigint];
  amountIn: bigint;
  swapToTokenOne: bigint;
}): { bptOut: bigint; amountOut: bigint; depositAmounts: [bigint, bigint] } {
  const { actualBalances, virtualBalances, protocolFeesOwed, amountIn, swapToTokenOne } = params;
  const inLp = lpBalances(actualBalances[0], virtualBalances[0], protocolFeesOwed[0]);
  const outLp = lpBalances(actualBalances[1], virtualBalances[1], protocolFeesOwed[1]);
  const amountOut = calcOutGivenIn({
    virtualBalanceIn: inLp.lpVirtual,
    weightInBps: 5000n,
    virtualBalanceOut: outLp.lpVirtual,
    weightOutBps: 5000n,
    amountIn: swapToTokenOne,
    actualBalanceOut: outLp.lpActual,
  });

  const actualAfterSwap: [bigint, bigint] = [
    actualBalances[0] + swapToTokenOne,
    actualBalances[1] - amountOut,
  ];
  const lpBalancesAfterSwap: [bigint, bigint] = [
    actualAfterSwap[0] - protocolFeesOwed[0],
    actualAfterSwap[1] - protocolFeesOwed[1],
  ];
  const depositAmounts: [bigint, bigint] = [amountIn - swapToTokenOne, amountOut];
  return {
    bptOut: calcBptOutGivenExactTokensIn(lpBalancesAfterSwap, depositAmounts, 1000n),
    amountOut,
    depositAmounts,
  };
}

describe("computeAllocations", () => {
  test("balanced pool splits 50/50", () => {
    const r = computeAllocations({
      actualBalances: [1_000_000n, 1_000_000n],
      virtualBalances: [1_000_000n, 1_000_000n],
      weightsBps: [5000, 5000],
      amountIn: 1000n,
      tokenInIndex: 0,
    });
    expect(r.allocations).toEqual([500n, 500n]);
  });

  test("sum(allocations) == amountIn after truncation redirect", () => {
    const r = computeAllocations({
      actualBalances: [3n, 7n, 11n, 13n],
      virtualBalances: [10n, 10n, 10n, 10n],
      weightsBps: [2500, 2500, 2500, 2500],
      amountIn: 1_000_000_007n,
      tokenInIndex: 1,
    });
    const sum = r.allocations.reduce((a, b) => a + b, 0n);
    expect(sum).toBe(1_000_000_007n);
  });

  test("sidelined (actBal=0) tokens get 0 allocation", () => {
    const r = computeAllocations({
      actualBalances: [1_000_000n, 0n, 1_000_000n],
      virtualBalances: [1_000_000n, 1_000_000n, 1_000_000n],
      weightsBps: [3333, 3334, 3333],
      amountIn: 900n,
      tokenInIndex: 0,
    });
    expect(r.allocations[1]).toBe(0n);
    expect(r.allocations[0] + r.allocations[2]).toBe(900n);
  });

  test("skewed concentrations shift allocations", () => {
    // Token 0 under-concentrated (0.5x), token 1 over-concentrated (2x).
    // Under-weighted → smaller W → smaller allocation.
    const r = computeAllocations({
      actualBalances: [500_000n, 2_000_000n],
      virtualBalances: [1_000_000n, 1_000_000n],
      weightsBps: [5000, 5000],
      amountIn: 1000n,
      tokenInIndex: 0,
    });
    expect(r.allocations[0]).toBeLessThan(r.allocations[1]);
  });

  test("throws when pool not seeded (ΣW=0)", () => {
    expect(() =>
      computeAllocations({
        actualBalances: [0n, 0n],
        virtualBalances: [1_000_000n, 1_000_000n],
        weightsBps: [5000, 5000],
        amountIn: 1000n,
        tokenInIndex: 0,
      })
    ).toThrow(/pool not seeded/);
  });

  test("throws on zero virtual balance", () => {
    expect(() =>
      computeAllocations({
        actualBalances: [1n, 1n],
        virtualBalances: [0n, 1n],
        weightsBps: [5000, 5000],
        amountIn: 1000n,
        tokenInIndex: 0,
      })
    ).toThrow(/virtualBalance.*positive/);
  });

  test("length mismatch throws", () => {
    expect(() =>
      computeAllocations({
        actualBalances: [1n, 1n],
        virtualBalances: [1n],
        weightsBps: [5000, 5000],
        amountIn: 1n,
        tokenInIndex: 0,
      })
    ).toThrow(/length mismatch/);
  });

  test("tokenInIndex out of range throws", () => {
    expect(() =>
      computeAllocations({
        actualBalances: [1n, 1n],
        virtualBalances: [1n, 1n],
        weightsBps: [5000, 5000],
        amountIn: 1n,
        tokenInIndex: 5,
      })
    ).toThrow(/out of range/);
  });

  test("audit PoC: protocol-fee reserves can make current allocation lose most BPT", () => {
    const actualBalances: [bigint, bigint] = [1000n, 1000n];
    const virtualBalances: [bigint, bigint] = [1000n, 1000n];
    const protocolFeesOwed: [bigint, bigint] = [990n, 100n];
    const amountIn = 100n;

    const current = computeAllocations({
      actualBalances,
      virtualBalances,
      weightsBps: [5000, 5000],
      amountIn,
      tokenInIndex: 0,
    }).allocations;
    expect(current).toEqual([50n, 50n]);

    let best = { swapToTokenOne: 0n, bptOut: 0n };
    for (let swapToTokenOne = 0n; swapToTokenOne <= amountIn; swapToTokenOne++) {
      const candidate = simulateSingleTokenPath({
        actualBalances,
        virtualBalances,
        protocolFeesOwed,
        amountIn,
        swapToTokenOne,
      });
      if (candidate.bptOut > best.bptOut) {
        best = { swapToTokenOne, bptOut: candidate.bptOut };
      }
    }

    const currentPath = simulateSingleTokenPath({
      actualBalances,
      virtualBalances,
      protocolFeesOwed,
      amountIn,
      swapToTokenOne: current[1],
    });

    expect(best.swapToTokenOne).toBe(23n);
    expect(currentPath.bptOut).toBe(833n);
    expect(best.bptOut).toBe(2296n);
    expect((currentPath.bptOut * ONE) / best.bptOut).toBeLessThan(ONE / 2n);
  });

  test("audit fix: two-token optimizer chooses the BPT-maximizing protocol-fee route", () => {
    const actualBalances: [bigint, bigint] = [1000n, 1000n];
    const virtualBalances: [bigint, bigint] = [1000n, 1000n];
    const protocolFeesOwed: [bigint, bigint] = [990n, 100n];
    const amountIn = 100n;

    const optimized = computeTwoTokenOptimalAllocations({
      actualBalances,
      virtualBalances,
      protocolFeesOwed,
      weightsBps: [5000, 5000],
      amountIn,
      tokenInIndex: 0,
      swapFeeRate: 0,
      protocolFeeRate: 0,
    }).allocations;
    const optimizedPath = simulateSingleTokenPath({
      actualBalances,
      virtualBalances,
      protocolFeesOwed,
      amountIn,
      swapToTokenOne: optimized[1],
    });

    expect(optimized).toEqual([77n, 23n]);
    expect(optimizedPath.bptOut).toBe(2296n);
  });
});
