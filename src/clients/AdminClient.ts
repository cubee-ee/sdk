import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  AccountMeta,
  Connection,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import { CubeConfig } from "../config";
import { PROTOCOL_ADMIN_IDL } from "../idl";
import { deriveTreasuryPda } from "../utils/pda";

/**
 * AdminClient — wraps `protocol_admin` with treasury-routed admin
 * operations.
 *
 * The cubic_pool program enforces that every admin instruction must be
 * signed by the Treasury PDA (`seeds = [b"treasury"]`, owned by
 * protocol_admin). This client builds the canonical flow:
 *
 *     admin wallet
 *       → protocol_admin.<wrapper>     (treasury.admin == signer)
 *       → CPI cubic_pool.<admin_ix>             (signer == TREASURY_PDA)
 *
 * Direct calls into cubic_pool admin instructions will fail on-chain.
 *
 * Note: every method returns a `TransactionInstruction`. Compose into a tx
 * with `@solana/web3.js` and sign with the admin wallet.
 */
export class AdminClient {
  readonly program: Program;
  readonly cubicPoolProgramId: PublicKey;
  readonly treasuryPda: PublicKey;

  constructor(opts: { config: CubeConfig; provider: anchor.AnchorProvider }) {
    const { config, provider } = opts;
    const idl = JSON.parse(JSON.stringify(PROTOCOL_ADMIN_IDL)) as any;
    idl.address = config.programs.protocolAdmin.toString();
    this.program = new Program(idl, provider) as any;
    this.cubicPoolProgramId = config.programs.cubicPool;
    [this.treasuryPda] = deriveTreasuryPda(config.programs.protocolAdmin);
  }

  /**
   * Idempotent treasury init. Returns true if a new treasury was created.
   * Caller becomes the initial `treasury.admin`.
   */
  async initializeTreasuryIfMissing(connection: Connection, admin: PublicKey): Promise<boolean> {
    const info = await connection.getAccountInfo(this.treasuryPda);
    if (info) return false;
    await (this.program.methods as any)
      .initialize(admin)
      .accounts({
        treasury: this.treasuryPda,
        payer: admin,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    return true;
  }

  // ── Admin lifecycle ──────────────────────────────────────────────────────

  initiateAdminTransferIx(admin: PublicKey, newAdmin: PublicKey) {
    return (this.program.methods as any)
      .initiateAdminTransfer(newAdmin)
      .accounts({ treasury: this.treasuryPda, admin })
      .instruction();
  }

  acceptAdminTransferIx(newAdmin: PublicKey) {
    return (this.program.methods as any)
      .acceptAdminTransfer()
      .accounts({ treasury: this.treasuryPda, newAdmin })
      .instruction();
  }

  cancelAdminTransferIx(admin: PublicKey) {
    return (this.program.methods as any)
      .cancelAdminTransfer()
      .accounts({ treasury: this.treasuryPda, admin })
      .instruction();
  }

  // ── Treasury vault management ────────────────────────────────────────────

  registerTokenIx(admin: PublicKey, mint: PublicKey, tokenProgram = TOKEN_PROGRAM_ID) {
    const [vault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), mint.toBuffer()],
      this.program.programId,
    );
    return (this.program.methods as any)
      .registerToken()
      .accounts({
        treasury: this.treasuryPda,
        mint,
        vault,
        admin,
        tokenProgram,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  withdrawIx(
    admin: PublicKey,
    mint: PublicKey,
    recipient: PublicKey,
    amount: BN,
    tokenProgram = TOKEN_PROGRAM_ID,
  ) {
    const [vault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), mint.toBuffer()],
      this.program.programId,
    );
    return (this.program.methods as any)
      .withdraw(amount)
      .accounts({
        treasury: this.treasuryPda,
        vault,
        recipient,
        admin,
        tokenProgram,
      })
      .instruction();
  }

  // ── Pool config / pool admin (treasury-routed) ───────────────────────────

  poolInitializeConfigIx(admin: PublicKey, config: PublicKey, defaultProtocolFeeRate: number) {
    return (this.program.methods as any)
      .poolInitializeConfig(defaultProtocolFeeRate)
      .accounts({
        treasury: this.treasuryPda,
        admin,
        config,
        cubicPoolProgram: this.cubicPoolProgramId,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  // setSwapFeeRate has been removed from the protocol-admin wrapper —
  // it's a level-1 (pool-admin) instruction, signed directly by the
  // wallet stored in `pool.pool_admin`. Use `CubicPoolClient` for that
  // call instead.

  setProtocolFeeRateIx(admin: PublicKey, config: PublicKey, pool: PublicKey, protocolFeeRate: number) {
    return (this.program.methods as any)
      .poolSetProtocolFeeRate(protocolFeeRate)
      .accounts({ ...this.poolAdminAccounts(admin, config, pool) })
      .instruction();
  }

  setPoolEnabledIx(admin: PublicKey, config: PublicKey, pool: PublicKey, enabled: boolean) {
    return (this.program.methods as any)
      .poolSetPoolEnabled(enabled)
      .accounts({ ...this.poolAdminAccounts(admin, config, pool) })
      .instruction();
  }

  setSwapsEnabledIx(admin: PublicKey, config: PublicKey, pool: PublicKey, enabled: boolean) {
    return (this.program.methods as any)
      .poolSetSwapsEnabled(enabled)
      .accounts({ ...this.poolAdminAccounts(admin, config, pool) })
      .instruction();
  }

  setBannedExtensionsIx(admin: PublicKey, config: PublicKey, banned: BN) {
    return (this.program.methods as any)
      .poolSetBannedExtensions(banned)
      .accounts({
        treasury: this.treasuryPda,
        admin,
        config,
        cubicPoolProgram: this.cubicPoolProgramId,
      })
      .instruction();
  }

  /**
   * Collects protocol fees from a pool to the supplied recipient ATAs.
   *
   * `vaults` / `recipients` / `tokenPrograms` must be aligned with
   * `pool.token_mints` (one entry per token in pool order).
   */
  collectProtocolFeesIx(
    admin: PublicKey,
    config: PublicKey,
    pool: PublicKey,
    vaults: PublicKey[],
    recipients: PublicKey[],
    tokenPrograms: PublicKey[] = vaults.map(() => TOKEN_PROGRAM_ID),
  ) {
    const remaining: AccountMeta[] = this.tripleRemaining(vaults, recipients, tokenPrograms);
    return (this.program.methods as any)
      .poolCollectProtocolFees()
      .accounts({ ...this.poolAdminAccounts(admin, config, pool) })
      .remainingAccounts(remaining)
      .instruction();
  }

  /**
   * Emergency drain. Pool must be paused first. `amounts.length` must equal
   * the pool's token_count; pass 0 to skip a token.
   */
  debugWithdrawLiquidityIx(
    admin: PublicKey,
    config: PublicKey,
    pool: PublicKey,
    amounts: BN[],
    vaults: PublicKey[],
    recipients: PublicKey[],
    tokenPrograms: PublicKey[] = vaults.map(() => TOKEN_PROGRAM_ID),
  ) {
    const remaining: AccountMeta[] = this.tripleRemaining(vaults, recipients, tokenPrograms);
    return (this.program.methods as any)
      .poolDebugWithdrawLiquidity(amounts)
      .accounts({ ...this.poolAdminAccounts(admin, config, pool) })
      .remainingAccounts(remaining)
      .instruction();
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private poolAdminAccounts(admin: PublicKey, config: PublicKey, pool: PublicKey) {
    return {
      treasury: this.treasuryPda,
      admin,
      config,
      pool,
      cubicPoolProgram: this.cubicPoolProgramId,
    };
  }

  private tripleRemaining(
    vaults: PublicKey[],
    recipients: PublicKey[],
    tokenPrograms: PublicKey[],
  ): AccountMeta[] {
    if (vaults.length !== recipients.length || vaults.length !== tokenPrograms.length) {
      throw new Error("AdminClient: vaults/recipients/tokenPrograms must be the same length");
    }
    const acc: AccountMeta[] = [];
    for (let i = 0; i < vaults.length; i++) {
      acc.push({ pubkey: vaults[i], isSigner: false, isWritable: true });
      acc.push({ pubkey: recipients[i], isSigner: false, isWritable: true });
      acc.push({ pubkey: tokenPrograms[i], isSigner: false, isWritable: false });
    }
    return acc;
  }
}
