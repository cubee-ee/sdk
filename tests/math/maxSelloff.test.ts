import {
  computeSelloffStatus,
  formatWindowDuration,
  type RawSelloffState,
} from "../../src/math/maxSelloff";

const PERIOD = 3600; // 1h window
const WINDOW_START = 1_000_000;

const base = (over: Partial<RawSelloffState> = {}): RawSelloffState => ({
  maxSelloff: 1000n,
  periodLength: PERIOD,
  previousSelloff: 0n,
  currentSelloff: 0n,
  windowStartTimestamp: BigInt(WINDOW_START),
  ...over,
});

describe("computeSelloffStatus", () => {
  test("is disabled when cap is zero", () => {
    const s = computeSelloffStatus(base({ maxSelloff: 0n }), WINDOW_START);
    expect(s.enabled).toBe(false);
    expect(s.fraction).toBe(0);
  });

  test("is disabled when period is zero", () => {
    const s = computeSelloffStatus(base({ periodLength: 0 }), WINDOW_START);
    expect(s.enabled).toBe(false);
  });

  test("counts current-window volume at window start", () => {
    const s = computeSelloffStatus(base({ currentSelloff: 250n }), WINDOW_START);
    expect(s.enabled).toBe(true);
    expect(s.used).toBe(250n);
    expect(s.remaining).toBe(750n);
    expect(s.fraction).toBeCloseTo(0.25, 5);
  });

  test("decays the previous window linearly (no rotation, mid-window)", () => {
    // previous=400, halfway through window → weighted = 400 * (period/2)/period = 200
    const s = computeSelloffStatus(
      base({ previousSelloff: 400n, currentSelloff: 100n }),
      WINDOW_START + PERIOD / 2,
    );
    expect(s.used).toBe(300n); // 200 weighted prev + 100 current
  });

  test("previous window contributes 100% exactly at the boundary", () => {
    const s = computeSelloffStatus(
      base({ previousSelloff: 400n, currentSelloff: 100n }),
      WINDOW_START, // elapsed 0 → full weight
    );
    expect(s.used).toBe(500n);
  });

  test("rotates one boundary: current becomes previous, then decays", () => {
    // elapsed = 1.5 * period → rotate: prev=current(800), current=0,
    // new window start += period, elapsedInWindow = 0.5*period →
    // weighted = 800 * 0.5 = 400
    const s = computeSelloffStatus(
      base({ previousSelloff: 999n, currentSelloff: 800n }),
      WINDOW_START + PERIOD + PERIOD / 2,
    );
    expect(s.used).toBe(400n);
  });

  test("resets both buckets after two full periods", () => {
    const s = computeSelloffStatus(
      base({ previousSelloff: 999n, currentSelloff: 999n }),
      WINDOW_START + 2 * PERIOD + 10,
    );
    expect(s.used).toBe(0n);
    expect(s.remaining).toBe(1000n);
    expect(s.fraction).toBe(0);
  });

  test("clamps elapsed at zero on backwards clock skew", () => {
    const s = computeSelloffStatus(
      base({ previousSelloff: 400n, currentSelloff: 100n }),
      WINDOW_START - 500, // now before window start
    );
    // elapsed clamped to 0 → previous fully weighted
    expect(s.used).toBe(500n);
  });

  test("caps fraction at 1 when over the limit", () => {
    const s = computeSelloffStatus(base({ currentSelloff: 5000n }), WINDOW_START);
    expect(s.fraction).toBe(1);
    expect(s.remaining).toBe(0n);
  });

  test("handles large raw u64 amounts without precision loss", () => {
    const big = 1_000_000_000_000_000n; // 1e15 raw units
    const s = computeSelloffStatus(
      base({ maxSelloff: big * 2n, previousSelloff: big, currentSelloff: 0n }),
      WINDOW_START, // full weight
    );
    expect(s.used).toBe(big);
    expect(s.remaining).toBe(big);
    expect(s.fraction).toBeCloseTo(0.5, 5);
  });
});

describe("formatWindowDuration", () => {
  test("formats sub-minute as seconds", () => {
    expect(formatWindowDuration(45)).toBe("45s");
  });
  test("formats minutes", () => {
    expect(formatWindowDuration(1800)).toBe("30m");
  });
  test("formats whole hours", () => {
    expect(formatWindowDuration(3600)).toBe("1h");
  });
  test("formats whole days", () => {
    expect(formatWindowDuration(7 * 86400)).toBe("7d");
  });
  test("guards against non-positive input", () => {
    expect(formatWindowDuration(0)).toBe("0s");
  });
});
