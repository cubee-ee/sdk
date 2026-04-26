import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

/**
 * Raw binary layout of CubicPool (see
 * `contracts/programs/cubic-pool/src/state/cubic_pool.rs`). Borsh-serialised.
 *
 * We decode manually to avoid bundling an Anchor Program instance into the
 * SDK: the SDK is consumed by both frontend and backend, where dragging a
 * full Anchor runtime is heavy. The on-chain layout is stable (reserved[128]
 * at the tail).
 */
export interface RawPoolAccount {
  config: PublicKey;
  bump: number;
  tokenCount: number;
  poolId: BN;
  tokenMints: PublicKey[]; // length 10
  tokenPrograms: PublicKey[]; // length 10
  normalizedWeights: BN[]; // length 10
  virtualBalances: BN[]; // length 10
  actualBalances: BN[]; // length 10
  swapFeeRate: number;
  protocolFeeRate: number;
  protocolFeesOwed: BN[]; // length 10
  createdAt: BN;
  poolEnabled: boolean;
  swapsEnabled: boolean;
}

/** 8-byte anchor discriminator for CubicPool. */
export const POOL_DISCRIMINATOR_LEN = 8;
const MAX_TOKENS = 10;

export function decodePoolAccount(data: Buffer): RawPoolAccount {
  if (data.length < POOL_DISCRIMINATOR_LEN + 1000) {
    throw new Error(`decodePoolAccount: data too short (${data.length} bytes)`);
  }
  let off = POOL_DISCRIMINATOR_LEN;

  const config = new PublicKey(data.slice(off, off + 32));
  off += 32;
  const bump = data.readUInt8(off);
  off += 1;
  const tokenCount = data.readUInt8(off);
  off += 1;
  const poolId = readU64LE(data, off);
  off += 8;

  const tokenMints: PublicKey[] = [];
  for (let i = 0; i < MAX_TOKENS; i++) {
    tokenMints.push(new PublicKey(data.slice(off, off + 32)));
    off += 32;
  }
  const tokenPrograms: PublicKey[] = [];
  for (let i = 0; i < MAX_TOKENS; i++) {
    tokenPrograms.push(new PublicKey(data.slice(off, off + 32)));
    off += 32;
  }
  const normalizedWeights: BN[] = [];
  for (let i = 0; i < MAX_TOKENS; i++) {
    normalizedWeights.push(readU64LE(data, off));
    off += 8;
  }
  const virtualBalances: BN[] = [];
  for (let i = 0; i < MAX_TOKENS; i++) {
    virtualBalances.push(readU64LE(data, off));
    off += 8;
  }
  const actualBalances: BN[] = [];
  for (let i = 0; i < MAX_TOKENS; i++) {
    actualBalances.push(readU64LE(data, off));
    off += 8;
  }
  const swapFeeRate = data.readUInt32LE(off);
  off += 4;
  const protocolFeeRate = data.readUInt16LE(off);
  off += 2;
  const protocolFeesOwed: BN[] = [];
  for (let i = 0; i < MAX_TOKENS; i++) {
    protocolFeesOwed.push(readU64LE(data, off));
    off += 8;
  }
  const createdAt = readU64LE(data, off); // i64 — but Solana ts ≥ 0
  off += 8;
  const poolEnabled = data.readUInt8(off) !== 0;
  off += 1;
  const swapsEnabled = data.readUInt8(off) !== 0;
  off += 1;
  // reserved[128] trails — ignored.

  return {
    config,
    bump,
    tokenCount,
    poolId,
    tokenMints,
    tokenPrograms,
    normalizedWeights,
    virtualBalances,
    actualBalances,
    swapFeeRate,
    protocolFeeRate,
    protocolFeesOwed,
    createdAt,
    poolEnabled,
    swapsEnabled,
  };
}

function readU64LE(data: Buffer, off: number): BN {
  return new BN(data.slice(off, off + 8), "le");
}
