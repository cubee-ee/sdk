import { ComputeBudgetProgram, Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";
import { CubeConfig } from "../config";
import { SdkResult, err, ok } from "../types/result";
import { BuiltTx, DeployPoolParams } from "../types/tx";
import {
  buildDeployPoolTx,
  buildInitializeCubicPoolIx,
  buildInitializeConfigIx,
} from "./tx-builders";
import { derivePoolPda } from "../utils/pda";

export interface PoolFactoryClientParams {
  config: CubeConfig;
}

export interface InitializeConfigParams {
  payer: PublicKey;
  defaultProtocolFeeRate: number;
}

/**
 * Builds transactions for protocol governance / pool deployment. Consumed
 * by the deploy-pool UI flow and by the backend's admin tools.
 */
export class PoolFactoryClient {
  readonly config: CubeConfig;

  constructor(params: PoolFactoryClientParams) {
    this.config = params.config;
  }

  /**
   * Deploy a new pool atop an existing `CubicPoolConfig`. Caller is
   * responsible for funding `params.payer` with enough SOL to cover rent
   * for the pool account and the BPT mint PDA.
   *
   * Returns the `pool` and `bptMint` pubkeys it WILL create (derived PDAs)
   * plus the signable tx.
   */
  buildDeployPoolTx(params: DeployPoolParams): SdkResult<BuiltTx & { pool: PublicKey; bptMint: PublicKey }> {
    if (params.tokens.length < 2 || params.tokens.length > 10) {
      return err("invalid_input", "tokens.length must be in [2, 10]");
    }
    if (params.tokens.length !== params.weightsBps.length) {
      return err("invalid_input", "tokens/weightsBps length mismatch");
    }
    if (params.tokens.length !== params.virtualBalances.length) {
      return err("invalid_input", "tokens/virtualBalances length mismatch");
    }
    const sum = params.weightsBps.reduce((a, b) => a + b, 0);
    if (sum !== 10_000) return err("invalid_input", `weights must sum to 10000 (got ${sum})`);
    for (const vb of params.virtualBalances) {
      if (vb.isZero()) return err("invalid_input", "virtualBalances must all be > 0");
    }

    const [pool] = derivePoolPda(this.config.programs.cubicPool, params.configKey, params.poolId);
    const [bptMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("bpt_mint"), pool.toBuffer()],
      this.config.programs.cubicPool
    );
    try {
      const tx = buildDeployPoolTx(this.config, params);
      return ok({ ...tx, pool, bptMint });
    } catch (e) {
      return err("tx_build_failed", "Failed to build deploy-pool tx", e);
    }
  }

  /**
   * Initialize a new CubicPoolConfig. The `config` signer must be freshly
   * generated and paired with its keypair when signing the outer tx.
   * Returns the tx + the config keypair the caller should sign with.
   */
  buildInitializeConfigTx(params: InitializeConfigParams): SdkResult<
    BuiltTx & { configKeypair: Keypair }
  > {
    try {
      const configKeypair = Keypair.generate();
      const ix = buildInitializeConfigIx(this.config, {
        config: configKeypair.publicKey,
        payer: params.payer,
        defaultProtocolFeeRate: params.defaultProtocolFeeRate,
      });
      return ok({
        instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), ix],
        suggestedCuLimit: 200_000,
        configKeypair,
      });
    } catch (e) {
      return err("tx_build_failed", "Failed to build initialize_config tx", e);
    }
  }

  /**
   * Low-level: return the raw `initialize_cubic_pool` ix without a CU
   * budget or wrapping. Useful for combining with other ixs in the same tx.
   */
  initializeCubicPoolIx(params: DeployPoolParams): TransactionInstruction {
    return buildInitializeCubicPoolIx(this.config, params);
  }
}
