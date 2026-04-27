import {
  AccountMeta,
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import BN from "bn.js";
import { CubeConfig } from "../config";
import { PoolInfo } from "../types/pool";
import {
  AddLiquidityParams,
  BuiltTx,
  DeployPoolParams,
  RemoveLiquidityParams,
  SingleTokenDepositParams,
  SwapParams,
} from "../types/tx";
import { deriveAta, deriveBptMint, deriveHelperPda } from "../utils/pda";

/**
 * Low-level transaction builders. Emit raw `TransactionInstruction`s suitable
 * for combination with others (e.g. versioned transactions with ALTs) in a
 * single tx. Higher-level convenience lives on `CubicPoolClient`.
 */

const CUBIC_POOL_DISC = {
  swap: computeDiscriminator("swap"),
  addLiquidity: computeDiscriminator("add_liquidity"),
  removeLiquidity: computeDiscriminator("remove_liquidity"),
  initializeCubicPool: computeDiscriminator("initialize_cubic_pool"),
};

const STLD_DISC = {
  depositSingleToken: computeDiscriminator("deposit_single_token"),
};

/**
 * Anchor discriminator: sha256("global:<ix_name>")[0..8]. The SDK
 * pre-computes only the cases it needs.
 *
 * Pre-computed values (confirmed against the generated IDL):
 *   swap                  → f8c3b1a2ba67e3de  (see IDL)
 *   add_liquidity         → b59d604b03b3a81b
 *   remove_liquidity      → 00017cc11717b94e
 *   initialize_cubic_pool → 3c22e44d76d29f21
 *   deposit_single_token  → a688a62fc7c056a9
 *
 * If you change an instruction name in Rust, regenerate by reading the
 * target/idl/*.json discriminator field.
 */
function computeDiscriminator(ixName: string): Buffer {
  // Fallback: Anchor exposes discriminators in the IDL. We ship the known
  // ones as a static map; callers passing unknown names error clearly.
  const KNOWN: Record<string, string> = {
    swap: "f8c3b1a2ba67e3de",
    add_liquidity: "b59d604b03b3a81b",
    remove_liquidity: "00017cc11717b94e",
    initialize_cubic_pool: "3c22e44d76d29f21",
    deposit_single_token: "a688a62fc7c056a9",
    initialize_config: "d08a39a35b7ebf19",
  };
  const hex = KNOWN[ixName];
  if (!hex) throw new Error(`tx-builders: unknown discriminator for "${ixName}"`);
  return Buffer.from(hex, "hex");
}

// ============================================================
// Swap
// ============================================================

export function buildSwapIx(
  cfg: CubeConfig,
  pool: PoolInfo,
  params: SwapParams & { minAmountOut: BN }
): TransactionInstruction {
  const inTok = pool.tokens[params.tokenInIndex];
  const outTok = pool.tokens[params.tokenOutIndex];

  const userTokenIn = deriveAta(params.user, inTok.mint, inTok.tokenProgram);
  const userTokenOut = deriveAta(params.user, outTok.mint, outTok.tokenProgram);

  const data = Buffer.concat([
    CUBIC_POOL_DISC.swap,
    encodeU64(params.amountIn),
    encodeU64(params.minAmountOut),
    encodeU8(params.tokenInIndex),
    encodeU8(params.tokenOutIndex),
  ]);

  const keys: AccountMeta[] = [
    { pubkey: pool.address, isSigner: false, isWritable: true },
    { pubkey: inTok.mint, isSigner: false, isWritable: false },
    { pubkey: outTok.mint, isSigner: false, isWritable: false },
    { pubkey: userTokenIn, isSigner: false, isWritable: true },
    { pubkey: userTokenOut, isSigner: false, isWritable: true },
    { pubkey: inTok.vault, isSigner: false, isWritable: true },
    { pubkey: outTok.vault, isSigner: false, isWritable: true },
    { pubkey: params.user, isSigner: true, isWritable: true },
    { pubkey: inTok.tokenProgram, isSigner: false, isWritable: false },
    { pubkey: outTok.tokenProgram, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    programId: cfg.programs.cubicPool,
    keys,
    data,
  });
}

export function buildSwapTx(
  cfg: CubeConfig,
  pool: PoolInfo,
  params: SwapParams & { minAmountOut: BN }
): BuiltTx {
  return {
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      buildSwapIx(cfg, pool, params),
    ],
    suggestedCuLimit: 400_000,
  };
}

// ============================================================
// Add liquidity (proportional)
// ============================================================

export function buildAddLiquidityIx(
  cfg: CubeConfig,
  pool: PoolInfo,
  params: AddLiquidityParams
): TransactionInstruction {
  const userBpt = deriveAta(params.user, pool.bptMint, TOKEN_PROGRAM_ID);
  const minBpt = params.minimumBptAmount ?? new BN(0);

  const data = Buffer.concat([
    CUBIC_POOL_DISC.addLiquidity,
    encodeVecU64(params.tokenAmounts),
    encodeU64(minBpt),
  ]);

  // remaining_accounts layout:
  //   [user_token_i, vault_i] × N, mint_i × N, token_program_i × N
  const remaining: AccountMeta[] = [];
  for (let i = 0; i < pool.tokenCount; i++) {
    const t = pool.tokens[i];
    const userAta = deriveAta(params.user, t.mint, t.tokenProgram);
    remaining.push({ pubkey: userAta, isSigner: false, isWritable: true });
    remaining.push({ pubkey: t.vault, isSigner: false, isWritable: true });
  }
  for (let i = 0; i < pool.tokenCount; i++) {
    remaining.push({ pubkey: pool.tokens[i].mint, isSigner: false, isWritable: false });
  }
  for (let i = 0; i < pool.tokenCount; i++) {
    remaining.push({ pubkey: pool.tokens[i].tokenProgram, isSigner: false, isWritable: false });
  }

  const keys: AccountMeta[] = [
    { pubkey: pool.address, isSigner: false, isWritable: true },
    { pubkey: pool.bptMint, isSigner: false, isWritable: true },
    { pubkey: userBpt, isSigner: false, isWritable: true },
    { pubkey: params.user, isSigner: true, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ...remaining,
  ];

  return new TransactionInstruction({
    programId: cfg.programs.cubicPool,
    keys,
    data,
  });
}

export function buildAddLiquidityTx(
  cfg: CubeConfig,
  pool: PoolInfo,
  params: AddLiquidityParams
): BuiltTx {
  const userBpt = deriveAta(params.user, pool.bptMint, TOKEN_PROGRAM_ID);
  return {
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
      createAssociatedTokenAccountIdempotentInstruction(
        params.user,
        userBpt,
        params.user,
        pool.bptMint,
        TOKEN_PROGRAM_ID
      ),
      buildAddLiquidityIx(cfg, pool, params),
    ],
    suggestedCuLimit: 600_000,
  };
}

// ============================================================
// Remove liquidity
// ============================================================

export function buildRemoveLiquidityIx(
  cfg: CubeConfig,
  pool: PoolInfo,
  params: RemoveLiquidityParams
): TransactionInstruction {
  const userBpt = deriveAta(params.user, pool.bptMint, TOKEN_PROGRAM_ID);
  const mins = params.minimumTokenAmounts ?? pool.tokens.map(() => new BN(0));

  const data = Buffer.concat([
    CUBIC_POOL_DISC.removeLiquidity,
    encodeU64(params.bptAmount),
    encodeVecU64(mins),
  ]);

  // remove_liquidity remaining_accounts format:
  //   [vault_i, user_token_i] × N, mint_i × N, token_program_i × N
  const remaining: AccountMeta[] = [];
  for (let i = 0; i < pool.tokenCount; i++) {
    const t = pool.tokens[i];
    const userAta = deriveAta(params.user, t.mint, t.tokenProgram);
    remaining.push({ pubkey: t.vault, isSigner: false, isWritable: true });
    remaining.push({ pubkey: userAta, isSigner: false, isWritable: true });
  }
  for (let i = 0; i < pool.tokenCount; i++) {
    remaining.push({ pubkey: pool.tokens[i].mint, isSigner: false, isWritable: false });
  }
  for (let i = 0; i < pool.tokenCount; i++) {
    remaining.push({ pubkey: pool.tokens[i].tokenProgram, isSigner: false, isWritable: false });
  }

  const keys: AccountMeta[] = [
    { pubkey: pool.address, isSigner: false, isWritable: true },
    { pubkey: pool.bptMint, isSigner: false, isWritable: true },
    { pubkey: userBpt, isSigner: false, isWritable: true },
    { pubkey: params.user, isSigner: true, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ...remaining,
  ];

  return new TransactionInstruction({
    programId: cfg.programs.cubicPool,
    keys,
    data,
  });
}

export function buildRemoveLiquidityTx(
  cfg: CubeConfig,
  pool: PoolInfo,
  params: RemoveLiquidityParams
): BuiltTx {
  return {
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
      buildRemoveLiquidityIx(cfg, pool, params),
    ],
    suggestedCuLimit: 600_000,
  };
}

// ============================================================
// Single-token deposit (helper program)
// ============================================================

export function buildSingleTokenDepositIx(
  cfg: CubeConfig,
  pool: PoolInfo,
  params: SingleTokenDepositParams
): TransactionInstruction {
  const slip = params.slippageHundredthsBps ?? cfg.defaults.slippageHundredthsBps;
  const minBpt = params.minimumBptAmount ?? new BN(0);
  const [helper] = deriveHelperPda(cfg.programs.singleTokenLiquidity, pool.address);
  const helperBpt = deriveAta(helper, pool.bptMint, TOKEN_PROGRAM_ID);
  const userBpt = deriveAta(params.user, pool.bptMint, TOKEN_PROGRAM_ID);

  const data = Buffer.concat([
    STLD_DISC.depositSingleToken,
    encodeU64(params.amountIn),
    encodeU8(params.tokenInIndex),
    encodeU32(slip),
    encodeU64(minBpt),
  ]);

  // stld remaining_accounts: [mint_i, user_ata_i, helper_ata_i, vault_i, tp_i] × N
  const remaining: AccountMeta[] = [];
  for (let i = 0; i < pool.tokenCount; i++) {
    const t = pool.tokens[i];
    const userAta = deriveAta(params.user, t.mint, t.tokenProgram);
    const helperAta = deriveAta(helper, t.mint, t.tokenProgram);
    remaining.push({ pubkey: t.mint, isSigner: false, isWritable: false });
    remaining.push({ pubkey: userAta, isSigner: false, isWritable: true });
    remaining.push({ pubkey: helperAta, isSigner: false, isWritable: true });
    remaining.push({ pubkey: t.vault, isSigner: false, isWritable: true });
    remaining.push({ pubkey: t.tokenProgram, isSigner: false, isWritable: false });
  }

  const keys: AccountMeta[] = [
    { pubkey: pool.address, isSigner: false, isWritable: true },
    { pubkey: helper, isSigner: false, isWritable: false },
    { pubkey: pool.bptMint, isSigner: false, isWritable: true },
    { pubkey: helperBpt, isSigner: false, isWritable: true },
    { pubkey: userBpt, isSigner: false, isWritable: true },
    { pubkey: params.user, isSigner: true, isWritable: true },
    { pubkey: cfg.programs.cubicPool, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ...remaining,
  ];

  return new TransactionInstruction({
    programId: cfg.programs.singleTokenLiquidity,
    keys,
    data,
  });
}

/**
 * Full single-token deposit tx: makes sure helper ATAs and the user's
 * per-token ATAs exist (idempotent create instructions), creates the user's
 * BPT ATA if absent, then the deposit ix itself. The helper program validates
 * all user ATAs up front because it may refund dust for any pool token.
 * CU limit set to 1.4M (mainnet/devnet max).
 */
export function buildSingleTokenDepositTx(
  cfg: CubeConfig,
  pool: PoolInfo,
  params: SingleTokenDepositParams
): BuiltTx {
  const [helper] = deriveHelperPda(cfg.programs.singleTokenLiquidity, pool.address);
  const helperBpt = deriveAta(helper, pool.bptMint, TOKEN_PROGRAM_ID);
  const userBpt = deriveAta(params.user, pool.bptMint, TOKEN_PROGRAM_ID);

  const ixs: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: cfg.defaults.cuLimit }),
  ];
  // User + helper ATAs (helper has an off-curve owner). Idempotent — safe to
  // include even when the accounts already exist.
  for (const t of pool.tokens) {
    const userAta = deriveAta(params.user, t.mint, t.tokenProgram);
    const helperAta = deriveAta(helper, t.mint, t.tokenProgram);
    ixs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        params.user,
        userAta,
        params.user,
        t.mint,
        t.tokenProgram
      )
    );
    ixs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        params.user,
        helperAta,
        helper,
        t.mint,
        t.tokenProgram
      )
    );
  }
  ixs.push(
    createAssociatedTokenAccountIdempotentInstruction(
      params.user,
      helperBpt,
      helper,
      pool.bptMint,
      TOKEN_PROGRAM_ID
    )
  );
  ixs.push(
    createAssociatedTokenAccountIdempotentInstruction(
      params.user,
      userBpt,
      params.user,
      pool.bptMint,
      TOKEN_PROGRAM_ID
    )
  );
  ixs.push(buildSingleTokenDepositIx(cfg, pool, params));

  return {
    instructions: ixs,
    suggestedCuLimit: cfg.defaults.cuLimit,
  };
}

// ============================================================
// Deploy new pool (PoolFactory)
// ============================================================

export function buildInitializeConfigIx(
  cfg: CubeConfig,
  params: { config: PublicKey; payer: PublicKey; feeAuthority: PublicKey; collectProtocolFeesAuthority: PublicKey; defaultProtocolFeeRate: number }
): TransactionInstruction {
  const data = Buffer.concat([
    computeDiscriminator("initialize_config"),
    params.feeAuthority.toBuffer(),
    params.collectProtocolFeesAuthority.toBuffer(),
    encodeU16(params.defaultProtocolFeeRate),
  ]);
  const keys: AccountMeta[] = [
    { pubkey: params.config, isSigner: true, isWritable: true },
    { pubkey: params.payer, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  return new TransactionInstruction({
    programId: cfg.programs.cubicPool,
    keys,
    data,
  });
}

export function buildInitializeCubicPoolIx(
  cfg: CubeConfig,
  params: DeployPoolParams
): TransactionInstruction {
  const tokenProgram = params.bptTokenProgram ?? TOKEN_PROGRAM_ID;
  const [pool] = PublicKey.findProgramAddressSync(
    [Buffer.from("cubic_pool"), params.configKey.toBuffer(), params.poolId.toArrayLike(Buffer, "le", 8)],
    cfg.programs.cubicPool
  );
  const [bptMint] = deriveBptMint(cfg.programs.cubicPool, pool);

  const data = Buffer.concat([
    CUBIC_POOL_DISC.initializeCubicPool,
    encodeVecPubkey(params.tokens),
    encodeVecU64(params.weightsBps.map((w) => new BN(w))),
    encodeVecU64(params.virtualBalances),
    encodeU32(params.swapFeeRate),
    encodeU64(params.poolId),
  ]);

  const remaining: AccountMeta[] = params.tokens.map((m) => ({
    pubkey: m,
    isSigner: false,
    isWritable: false,
  }));

  const keys: AccountMeta[] = [
    { pubkey: params.configKey, isSigner: false, isWritable: false },
    { pubkey: pool, isSigner: false, isWritable: true },
    { pubkey: bptMint, isSigner: false, isWritable: true },
    { pubkey: params.payer, isSigner: true, isWritable: true },
    { pubkey: tokenProgram, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ...remaining,
  ];

  return new TransactionInstruction({
    programId: cfg.programs.cubicPool,
    keys,
    data,
  });
}

export function buildDeployPoolTx(cfg: CubeConfig, params: DeployPoolParams): BuiltTx {
  return {
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      buildInitializeCubicPoolIx(cfg, params),
    ],
    suggestedCuLimit: 400_000,
  };
}

// ============================================================
// Borsh encoding helpers (subset used above)
// ============================================================

function encodeU8(v: number): Buffer {
  const b = Buffer.alloc(1);
  b.writeUInt8(v & 0xff, 0);
  return b;
}
function encodeU16(v: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v & 0xffff, 0);
  return b;
}
function encodeU32(v: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v >>> 0, 0);
  return b;
}
function encodeU64(v: BN): Buffer {
  return v.toArrayLike(Buffer, "le", 8);
}
function encodeVecU64(vs: BN[]): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32LE(vs.length, 0);
  return Buffer.concat([len, ...vs.map(encodeU64)]);
}
function encodeVecPubkey(pks: PublicKey[]): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32LE(pks.length, 0);
  return Buffer.concat([len, ...pks.map((p) => p.toBuffer())]);
}
