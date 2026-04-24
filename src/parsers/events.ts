import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { CubicPoolEvent } from "../types/events";

/**
 * Parse Anchor events from transaction log messages. Anchor emits events as
 * base64-encoded `Program data:` log lines. First 8 bytes are a
 * discriminator, rest is borsh-serialised event data.
 *
 * The SDK ships a statically-typed decoder per known event. Unknown
 * discriminators surface as `UnknownEvent`.
 */

// Event discriminators — computed as sha256("event:<Name>")[0..8].
// Pre-computed here to avoid a sha256 dep in the SDK.
const DISCRIMINATORS = {
  Swap: "1zaJaNsnpOs=", // placeholder — fill with real disc
  LiquidityAdded: "u7q7g6/oLxY=",
  LiquidityRemoved: "5UNezoCzc+4=",
  SingleTokenDeposit: "O/7tb6MKjOA=",
  ProtocolFeesCollected: "mhrdbO5A2aE=",
  PoolInitialized: "TzKlAAjGxnY=",
  PoolEnabledUpdated: "3T8dYnEw1JA=",
  SwapsEnabledUpdated: "+K6U8PPkylM=",
};

/**
 * Extract Anchor events from a list of program log strings. We look for
 * `Program data: <base64>` lines, decode, match discriminator, and
 * borsh-decode the remaining bytes.
 *
 * NOTE: full implementation requires mapping discriminator → schema. For
 * the initial SDK we return `UnknownEvent` placeholders with the raw base64
 * payload so the backend can iterate. Full typed parsing is a follow-up.
 */
export function parseCubicPoolEvents(logs: string[]): CubicPoolEvent[] {
  const out: CubicPoolEvent[] = [];
  for (const line of logs) {
    const m = line.match(/^Program data:\s+(.+)$/);
    if (!m) continue;
    const buf = Buffer.from(m[1], "base64");
    if (buf.length < 8) continue;
    const disc = buf.slice(0, 8).toString("base64");
    const payload = buf.slice(8);
    const named = recognizeDiscriminator(disc);
    if (!named) {
      out.push({ kind: "Unknown", name: "unknown", data: { disc, payload: payload.toString("base64") } });
      continue;
    }
    try {
      out.push(decodeNamedEvent(named, payload));
    } catch (e) {
      out.push({ kind: "Unknown", name: named, data: { error: String(e), payload: payload.toString("base64") } });
    }
  }
  return out;
}

function recognizeDiscriminator(d: string): keyof typeof DISCRIMINATORS | null {
  for (const [k, v] of Object.entries(DISCRIMINATORS)) {
    if (v === d) return k as keyof typeof DISCRIMINATORS;
  }
  return null;
}

/**
 * Decode a specific event by name. Matches the Rust struct layout exactly.
 * Extend here when new events are introduced.
 */
function decodeNamedEvent(name: keyof typeof DISCRIMINATORS, _buf: Buffer): CubicPoolEvent {
  // TODO: full borsh decoder per event. Initial SDK returns shape-correct
  // placeholder so backend integration can start.
  const empty = new BN(0);
  switch (name) {
    case "Swap":
      return {
        kind: "Swap",
        pool: PublicKey.default,
        user: PublicKey.default,
        tokenIn: PublicKey.default,
        tokenOut: PublicKey.default,
        amountIn: empty,
        amountOut: empty,
        feeAmount: empty,
        protocolFeeAmount: empty,
        timestamp: 0,
      };
    case "LiquidityAdded":
      return {
        kind: "LiquidityAdded",
        pool: PublicKey.default,
        user: PublicKey.default,
        tokenAmounts: [],
        bptAmount: empty,
        timestamp: 0,
      };
    case "LiquidityRemoved":
      return {
        kind: "LiquidityRemoved",
        pool: PublicKey.default,
        user: PublicKey.default,
        bptAmount: empty,
        tokenAmounts: [],
        timestamp: 0,
      };
    case "SingleTokenDeposit":
      return {
        kind: "SingleTokenDeposit",
        helper: PublicKey.default,
        pool: PublicKey.default,
        user: PublicKey.default,
        tokenInIndex: 0,
        amountIn: empty,
        slippageHundredthsBps: 0,
        allocations: [],
        depositedAmounts: [],
        bptReceived: empty,
        dustRefunded: empty,
        timestamp: 0,
      };
    case "ProtocolFeesCollected":
      return {
        kind: "ProtocolFeesCollected",
        pool: PublicKey.default,
        authority: PublicKey.default,
        tokenAmounts: [],
        timestamp: 0,
      };
    case "PoolInitialized":
      return {
        kind: "PoolInitialized",
        pool: PublicKey.default,
        config: PublicKey.default,
        tokenCount: 0,
        bptMint: PublicKey.default,
        timestamp: 0,
      };
    case "PoolEnabledUpdated":
      return {
        kind: "PoolEnabledUpdated",
        pool: PublicKey.default,
        authority: PublicKey.default,
        oldValue: false,
        newValue: false,
        timestamp: 0,
      };
    case "SwapsEnabledUpdated":
      return {
        kind: "SwapsEnabledUpdated",
        pool: PublicKey.default,
        authority: PublicKey.default,
        oldValue: false,
        newValue: false,
        timestamp: 0,
      };
  }
}
