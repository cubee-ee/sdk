import { Commitment, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { CubeConfig } from "../config";
import { PoolInfo } from "../types/pool";
import { SdkResult, err, ok } from "../types/result";
import {
  BuiltTx,
  SingleTokenDepositParams,
  SingleTokenDepositQuote,
} from "../types/tx";
import { deriveHelperPda } from "../utils/pda";
import { buildSingleTokenDepositTx } from "./tx-builders";
import { RpcClient } from "./RpcClient";
import { CubicPoolClient } from "./CubicPoolClient";

export interface SingleTokenDepositClientParams {
  config: CubeConfig;
  poolAddress: PublicKey;
  /** Optional — reuses an existing one if provided. */
  rpc?: RpcClient | { endpoint: string; apiKey?: string; commitment?: Commitment };
  /**
   * Optional parent pool client — lets the deposit client reuse an already
   * synced PoolInfo instead of making a fresh RPC round-trip.
   */
  poolClient?: CubicPoolClient;
}

/**
 * Convenience class that wraps the single-token deposit flow end-to-end:
 * quoting, transaction building, and helper-PDA derivation.
 *
 * Most consumers don't need to instantiate this directly — they can call
 * `CubicPoolClient.singleTokenDeposit.*` which proxies here.
 */
export class SingleTokenDepositClient {
  readonly config: CubeConfig;
  readonly poolAddress: PublicKey;
  private readonly poolClient: CubicPoolClient;

  constructor(params: SingleTokenDepositClientParams) {
    this.config = params.config;
    this.poolAddress = params.poolAddress;
    this.poolClient =
      params.poolClient ??
      new CubicPoolClient({
        config: params.config,
        poolAddress: params.poolAddress,
        rpc:
          params.rpc ??
          {
            endpoint: params.config.defaults.rpcEndpoint,
            commitment: params.config.defaults.rpcCommitment,
          },
      });
  }

  /** Derived helper PDA for this pool. */
  helperPda(): PublicKey {
    return deriveHelperPda(this.config.programs.singleTokenLiquidity, this.poolAddress)[0];
  }

  /** Ensure pool state is loaded; populates the underlying CubicPoolClient cache. */
  async sync(): Promise<SdkResult<PoolInfo>> {
    return this.poolClient.sync();
  }

  /** Off-chain estimate of the deposit outcome. */
  quote(
    tokenInIndex: number,
    amountIn: BN,
    slippageHundredthsBps?: number
  ): SdkResult<SingleTokenDepositQuote> {
    return this.poolClient.quoteSingleTokenDeposit(tokenInIndex, amountIn, slippageHundredthsBps);
  }

  /** Build a ready-to-sign transaction. Includes idempotent helper-ATA creates. */
  buildTx(params: SingleTokenDepositParams): SdkResult<BuiltTx> {
    const pool = this.poolClient.getCached();
    if (!pool) return err("invalid_input", "Call sync() first to populate pool state");
    if (params.tokenInIndex < 0 || params.tokenInIndex >= pool.tokenCount) {
      return err("invalid_input", "Invalid tokenInIndex");
    }
    if (params.amountIn.lten(0)) return err("invalid_input", "amountIn must be > 0");
    try {
      const tx = buildSingleTokenDepositTx(this.config, pool, params);
      return ok(tx);
    } catch (e) {
      return err("tx_build_failed", "Failed to build single-token deposit tx", e);
    }
  }
}
