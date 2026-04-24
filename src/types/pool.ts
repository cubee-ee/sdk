import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { TokenInfo } from "../config/tokens";

/**
 * A single token slot inside a Cubic Pool, enriched with off-chain metadata
 * (ticker, logo, coingeckoId) when available.
 */
export interface PoolTokenInfo {
  index: number;
  mint: PublicKey;
  tokenProgram: PublicKey;
  decimals: number;
  /** Basis points, sum across all tokens == 10_000. */
  weightBps: number;
  /** In native token units (u64). */
  virtualBalance: BN;
  actualBalance: BN;
  protocolFeesOwed: BN;
  /** PDA: ATA(pool, mint, tokenProgram). */
  vault: PublicKey;
  /** Cached off-chain metadata; `undefined` if no registry hit. */
  metadata?: TokenInfo;
  /** factBalance / virtBalance as a float, for display/math. */
  concentration: number;
}

/**
 * Fully parsed pool state. Returned by `CubicPoolClient.sync()`.
 * All raw on-chain numerics plus a few convenience derivations.
 */
export interface PoolInfo {
  /** Pool PDA address. */
  address: PublicKey;
  /** Pool config account referenced by the pool. */
  config: PublicKey;
  /** `Account<CubicPool>.bump`. */
  bump: number;
  /** Integer identifier salt. Pools under the same config differ by pool_id. */
  poolId: BN;
  tokenCount: number;
  tokens: PoolTokenInfo[];
  bptMint: PublicKey;
  /** Total supply of BPT tokens at snapshot time. */
  bptTotalSupply: BN;
  /** Hundredths-of-basis-point units (1_000_000 == 100 %). */
  swapFeeRate: number;
  /** Basis points (10_000 == 100 %). */
  protocolFeeRate: number;
  poolEnabled: boolean;
  swapsEnabled: boolean;
  createdAt: number;
  /** Unix timestamp (ms) when sync() ran. Useful for staleness checks. */
  syncedAt: number;
}

export interface PoolSummary {
  address: string;
  tvlUsd?: number;
  volume24hUsd?: number;
  feeApr7d?: number;
  poolEnabled: boolean;
  tokens: Array<{ mint: string; symbol?: string; weightBps: number }>;
}
