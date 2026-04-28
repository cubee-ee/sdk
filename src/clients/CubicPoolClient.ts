import { PublicKey, Commitment } from "@solana/web3.js";
import BN from "bn.js";
import { CubeConfig } from "../config";
import { PoolInfo, PoolTokenInfo } from "../types/pool";
import { SdkResult, err, ok } from "../types/result";
import { SwapQuote, SingleTokenDepositQuote } from "../types/tx";
import { CubicPoolEvent } from "../types/events";
import { RpcClient } from "./RpcClient";
import { decodePoolAccount } from "../parsers/poolAccount";
import { decodeMintAccount } from "../parsers/mintAccount";
import { parseCubicPoolEvents } from "../parsers/events";
import { deriveAta, deriveBptMint, deriveHelperPda } from "../utils/pda";
import { resolveKnownToken } from "../config/tokens";
import {
  calcBptOutGivenExactTokensIn,
  calcOutGivenIn,
  calcSpotOut,
  calcTokensOutGivenBptIn,
} from "../math/cubicMath";
import { applySlippage, applySwapFee, lpBalances, priceImpactHbps } from "../math/slippage";
import { computeAllocations, computeTwoTokenOptimalAllocations } from "../math/singleToken";
import {
  buildAddLiquidityTx,
  buildRemoveLiquidityTx,
  buildSingleTokenDepositTx,
  buildSwapTx,
} from "./tx-builders";
import {
  AddLiquidityParams,
  BuiltTx,
  RemoveLiquidityParams,
  SingleTokenDepositParams,
  SwapParams,
} from "../types/tx";
import { SingleTokenDepositClient } from "./SingleTokenDepositClient";

const MULTI_TOKEN_PENDING_FEES_SINGLE_DEPOSIT_MESSAGE =
  "Single-token deposit is unavailable while protocol fees are pending in pools with more than two tokens. Collect protocol fees or use proportional deposit.";

function hasPendingProtocolFees(pool: PoolInfo): boolean {
  return pool.tokens.some((t) => BigInt(t.protocolFeesOwed.toString()) > 0n);
}

export interface CubicPoolClientParams {
  config: CubeConfig;
  poolAddress: PublicKey;
  rpc:
    | RpcClient
    | {
        endpoint: string;
        apiKey?: string;
        commitment?: Commitment;
      };
}

/**
 * Per-pool client. Fetch the state with `sync()`, then call any of the
 * quote / buildTx methods off the cached snapshot.
 */
export class CubicPoolClient {
  readonly config: CubeConfig;
  readonly poolAddress: PublicKey;
  readonly rpc: RpcClient;

  private cache: PoolInfo | undefined;

  constructor(params: CubicPoolClientParams) {
    this.config = params.config;
    this.poolAddress = params.poolAddress;
    this.rpc =
      params.rpc instanceof RpcClient
        ? params.rpc
        : new RpcClient({
            endpoint: params.rpc.endpoint,
            apiKey: params.rpc.apiKey,
            commitment: params.rpc.commitment ?? params.config.defaults.rpcCommitment,
          });
  }

  /** Last-fetched pool state. `undefined` before first `sync()`. */
  getCached(): PoolInfo | undefined {
    return this.cache;
  }

  /**
   * Fetch and decode the pool account + BPT mint + per-token mint decimals.
   * Safe to call repeatedly; subsequent calls replace the cache.
   */
  async sync(): Promise<SdkResult<PoolInfo>> {
    const poolInfo = await this.rpc.getAccountInfo(this.poolAddress);
    if (!poolInfo.ok) return poolInfo;
    if (poolInfo.data === null) {
      return err("account_not_found", `Pool ${this.poolAddress.toBase58()} does not exist on-chain`);
    }
    let raw;
    try {
      raw = decodePoolAccount(poolInfo.data.data);
    } catch (e) {
      return err("parse_failure", "Could not decode pool account", e);
    }
    const n = raw.tokenCount;
    const mintAddrs = raw.tokenMints.slice(0, n);
    const [bptMint, _bptBump] = deriveBptMint(this.config.programs.cubicPool, this.poolAddress);

    const mintInfos = await this.rpc.getMultipleAccountsInfo([bptMint, ...mintAddrs]);
    if (!mintInfos.ok) return mintInfos;
    const [bptMintData, ...tokenMintDatas] = mintInfos.data;
    if (!bptMintData) {
      return err("account_not_found", "BPT mint account missing");
    }
    let bptMintAcc;
    try {
      bptMintAcc = decodeMintAccount(bptMintData);
    } catch (e) {
      return err("parse_failure", "Could not decode BPT mint", e);
    }
    const tokens: PoolTokenInfo[] = [];
    for (let i = 0; i < n; i++) {
      const mintRaw = tokenMintDatas[i];
      if (!mintRaw) {
        return err("account_not_found", `Mint account missing for token index ${i}`);
      }
      let mintAcc;
      try {
        mintAcc = decodeMintAccount(mintRaw);
      } catch (e) {
        return err("parse_failure", `Could not decode mint ${mintAddrs[i].toBase58()}`, e);
      }
      const actualBalance = raw.actualBalances[i];
      const virtualBalance = raw.virtualBalances[i];
      const concentration =
        virtualBalance.isZero() ? 0 : actualBalance.mul(new BN(1_000_000)).div(virtualBalance).toNumber() / 1_000_000;
      tokens.push({
        index: i,
        mint: raw.tokenMints[i],
        tokenProgram: raw.tokenPrograms[i],
        decimals: mintAcc.decimals,
        weightBps: raw.normalizedWeights[i].toNumber(),
        virtualBalance,
        actualBalance,
        protocolFeesOwed: raw.protocolFeesOwed[i],
        vault: deriveAta(this.poolAddress, raw.tokenMints[i], raw.tokenPrograms[i]),
        metadata:
          this.config.tokens?.[raw.tokenMints[i].toBase58()] ??
          resolveKnownToken(raw.tokenMints[i].toBase58()),
        concentration,
      });
    }

    const info: PoolInfo = {
      address: this.poolAddress,
      config: raw.config,
      bump: raw.bump,
      poolId: raw.poolId,
      tokenCount: n,
      tokens,
      bptMint,
      bptTotalSupply: bptMintAcc.supply,
      swapFeeRate: raw.swapFeeRate,
      protocolFeeRate: raw.protocolFeeRate,
      poolEnabled: raw.poolEnabled,
      swapsEnabled: raw.swapsEnabled,
      createdAt: raw.createdAt.toNumber(),
      syncedAt: Date.now(),
    };
    this.cache = info;
    return ok(info);
  }

  /** Derived helper PDA for this pool (used by single-token-deposit). */
  helperPda(): PublicKey {
    return deriveHelperPda(this.config.programs.singleTokenLiquidity, this.poolAddress)[0];
  }

  // ---------- Quote helpers (pure, require sync()) ----------

  /**
   * Quote a swap. Requires the cache to be populated (call `sync()` first).
   * Returns exact on-chain math result + spot bound + price impact +
   * slippage-derived minAmountOut.
   */
  quoteSwap(
    tokenInIndex: number,
    tokenOutIndex: number,
    amountIn: BN,
    slippageHundredthsBps?: number
  ): SdkResult<SwapQuote> {
    const pool = this.requireCache();
    if (!pool.ok) return pool;
    const { tokens, swapFeeRate, protocolFeeRate } = pool.data;
    if (
      tokenInIndex < 0 ||
      tokenInIndex >= tokens.length ||
      tokenOutIndex < 0 ||
      tokenOutIndex >= tokens.length ||
      tokenInIndex === tokenOutIndex
    ) {
      return err("invalid_input", "Invalid tokenInIndex / tokenOutIndex");
    }
    const inTok = tokens[tokenInIndex];
    const outTok = tokens[tokenOutIndex];
    const slip = slippageHundredthsBps ?? this.config.defaults.slippageHundredthsBps;

    try {
      const amountBI = BigInt(amountIn.toString());
      const amountAfterFee = applySwapFee(amountBI, swapFeeRate);
      const feeAmount = amountBI - amountAfterFee;
      const protocolFeeAmount =
        (feeAmount * BigInt(protocolFeeRate)) / BigInt(10_000);

      const { lpActual: _lpActualIn, lpVirtual: lpVirtIn } = lpBalances(
        BigInt(inTok.actualBalance.toString()),
        BigInt(inTok.virtualBalance.toString()),
        BigInt(inTok.protocolFeesOwed.toString())
      );
      const { lpActual: lpActualOut, lpVirtual: lpVirtOut } = lpBalances(
        BigInt(outTok.actualBalance.toString()),
        BigInt(outTok.virtualBalance.toString()),
        BigInt(outTok.protocolFeesOwed.toString())
      );

      const amountOut = calcOutGivenIn({
        virtualBalanceIn: lpVirtIn,
        weightInBps: BigInt(inTok.weightBps),
        virtualBalanceOut: lpVirtOut,
        weightOutBps: BigInt(outTok.weightBps),
        amountIn: amountAfterFee,
        actualBalanceOut: lpActualOut,
      });

      const spotOut = calcSpotOut({
        virtualBalanceIn: lpVirtIn,
        weightInBps: BigInt(inTok.weightBps),
        virtualBalanceOut: lpVirtOut,
        weightOutBps: BigInt(outTok.weightBps),
        amountIn: amountAfterFee,
      });

      const minAmountOut = applySlippage(amountOut, slip);
      const impact = priceImpactHbps(spotOut, amountOut);
      return ok({
        tokenInIndex,
        tokenOutIndex,
        amountIn,
        amountOut: new BN(amountOut.toString()),
        spotOut: new BN(spotOut.toString()),
        priceImpactHbps: impact,
        feeAmount: new BN(feeAmount.toString()),
        protocolFeeAmount: new BN(protocolFeeAmount.toString()),
        minAmountOut: new BN(minAmountOut.toString()),
      });
    } catch (e) {
      return err("math_overflow", "Swap quote math overflow", e);
    }
  }

  /**
   * Quote a single-token deposit: split amountIn by W-based shares, quote
   * each swap leg, estimate resulting BPT.
   */
  quoteSingleTokenDeposit(
    tokenInIndex: number,
    amountIn: BN,
    slippageHundredthsBps?: number
  ): SdkResult<SingleTokenDepositQuote> {
    const poolRes = this.requireCache();
    if (!poolRes.ok) return poolRes;
    const pool = poolRes.data;
    if (tokenInIndex < 0 || tokenInIndex >= pool.tokens.length) {
      return err("invalid_input", "Invalid tokenInIndex");
    }
    const inTok = pool.tokens[tokenInIndex];
    if (inTok.actualBalance.isZero()) {
      return err("invalid_input", "Input token is sidelined (actualBalance=0); pick a live token");
    }
    const slip = slippageHundredthsBps ?? this.config.defaults.slippageHundredthsBps;

    try {
      const actualBalances = pool.tokens.map((t) => BigInt(t.actualBalance.toString()));
      const virtualBalances = pool.tokens.map((t) => BigInt(t.virtualBalance.toString()));
      const protocolFeesOwed = pool.tokens.map((t) => BigInt(t.protocolFeesOwed.toString()));
      const weightsBps = pool.tokens.map((t) => t.weightBps);
      const amountInBI = BigInt(amountIn.toString());
      const hasPendingProtocolFees = protocolFeesOwed.some((fee) => fee > 0n);
      if (hasPendingProtocolFees && pool.tokens.length !== 2) {
        return err(
          "unsupported_pool_state",
          MULTI_TOKEN_PENDING_FEES_SINGLE_DEPOSIT_MESSAGE
        );
      }
      const alloc = hasPendingProtocolFees
        ? (() => {
            const twoTokenInIndex = tokenInIndex as 0 | 1;
            return computeTwoTokenOptimalAllocations({
              actualBalances: [actualBalances[0], actualBalances[1]],
              virtualBalances: [virtualBalances[0], virtualBalances[1]],
              protocolFeesOwed: [protocolFeesOwed[0], protocolFeesOwed[1]],
              weightsBps: [weightsBps[0], weightsBps[1]],
              amountIn: amountInBI,
              tokenInIndex: twoTokenInIndex,
              swapFeeRate: pool.swapFeeRate,
              protocolFeeRate: pool.protocolFeeRate,
            });
          })()
        : computeAllocations({
            actualBalances,
            virtualBalances,
            weightsBps,
            amountIn: amountInBI,
            tokenInIndex,
          });

      const expectedOuts: BN[] = [];
      const minOuts: BN[] = [];
      const sidelined: number[] = [];
      const simActual = [...actualBalances];
      const simVirtual = [...virtualBalances];
      const simProtocolFees = [...protocolFeesOwed];
      const depositAmounts = pool.tokens.map(() => 0n);
      let remainingInput = amountInBI;
      for (let i = 0; i < pool.tokens.length; i++) {
        if (actualBalances[i] === 0n) {
          sidelined.push(i);
          expectedOuts.push(new BN(0));
          minOuts.push(new BN(0));
          continue;
        }
        if (i === tokenInIndex || alloc.allocations[i] === 0n) {
          expectedOuts.push(new BN(0));
          minOuts.push(new BN(0));
          continue;
        }
        const swapAmount = alloc.allocations[i];
        remainingInput -= swapAmount;
        const amountAfterFee = applySwapFee(swapAmount, pool.swapFeeRate);
        const feeAmount = swapAmount - amountAfterFee;
        const protocolFeeAmount =
          (feeAmount * BigInt(pool.protocolFeeRate)) / 10_000n;
        const inLp = lpBalances(
          simActual[tokenInIndex],
          simVirtual[tokenInIndex],
          simProtocolFees[tokenInIndex]
        );
        const outLp = lpBalances(
          simActual[i],
          simVirtual[i],
          simProtocolFees[i]
        );
        const out = calcOutGivenIn({
          virtualBalanceIn: inLp.lpVirtual,
          weightInBps: BigInt(weightsBps[tokenInIndex]),
          virtualBalanceOut: outLp.lpVirtual,
          weightOutBps: BigInt(weightsBps[i]),
          amountIn: amountAfterFee,
          actualBalanceOut: outLp.lpActual,
        });
        const min = applySlippage(out, slip);
        expectedOuts.push(new BN(out.toString()));
        minOuts.push(new BN(min.toString()));

        simActual[tokenInIndex] += swapAmount;
        simVirtual[tokenInIndex] += amountAfterFee;
        simProtocolFees[tokenInIndex] += protocolFeeAmount;
        simActual[i] -= out;
        simVirtual[i] -= out;
        depositAmounts[i] = out;
      }
      depositAmounts[tokenInIndex] = remainingInput;

      const lpBalancesForAdd = simActual.map((actual, i) =>
        actual > simProtocolFees[i] ? actual - simProtocolFees[i] : 0n
      );
      const estBpt = calcBptOutGivenExactTokensIn(
        lpBalancesForAdd,
        depositAmounts,
        BigInt(pool.bptTotalSupply.toString())
      );

      return ok({
        tokenInIndex,
        amountIn,
        allocations: alloc.allocations.map((b) => new BN(b.toString())),
        expectedOuts,
        minOuts,
        estimatedBpt: new BN(estBpt.toString()),
        sidelinedTokenIndices: sidelined,
      });
    } catch (e) {
      return err("math_overflow", "Single-token deposit quote failed", e);
    }
  }

  /** Proportional-withdraw quote for a given BPT amount. */
  quoteRemove(bptIn: BN): SdkResult<{ tokenOuts: BN[] }> {
    const poolRes = this.requireCache();
    if (!poolRes.ok) return poolRes;
    const pool = poolRes.data;
    if (pool.bptTotalSupply.isZero()) {
      return err("invalid_input", "Pool has zero BPT supply");
    }
    try {
      const bals = pool.tokens.map((t) => {
        const actual = BigInt(t.actualBalance.toString());
        const fees = BigInt(t.protocolFeesOwed.toString());
        return actual > fees ? actual - fees : 0n;
      });
      const outs = calcTokensOutGivenBptIn(bals, BigInt(bptIn.toString()), BigInt(pool.bptTotalSupply.toString()));
      return ok({ tokenOuts: outs.map((o) => new BN(o.toString())) });
    } catch (e) {
      return err("math_overflow", "Remove quote failed", e);
    }
  }

  // ---------- Transaction builders ----------
  //
  // For external SDK users, deposit/swap/remove are one-call operations via
  // the CubicPoolClient. The `singleTokenDeposit` field is a proxy into the
  // dedicated SingleTokenDepositClient as the user expects: importing this
  // class is enough, no need to know the helper program exists.

  /** Build a swap transaction. Requires `sync()` first. */
  buildSwapTx(params: SwapParams): SdkResult<BuiltTx> {
    const poolRes = this.requireCache();
    if (!poolRes.ok) return poolRes;
    const slip = params.slippageHundredthsBps ?? this.config.defaults.slippageHundredthsBps;
    const minOut = params.minAmountOut
      ? params.minAmountOut
      : (() => {
          const q = this.quoteSwap(params.tokenInIndex, params.tokenOutIndex, params.amountIn, slip);
          return q.ok ? q.data.minAmountOut : new BN(0);
        })();
    try {
      const tx = buildSwapTx(this.config, poolRes.data, { ...params, minAmountOut: minOut });
      return ok(tx);
    } catch (e) {
      return err("tx_build_failed", "Failed to build swap tx", e);
    }
  }

  /** Build a proportional add-liquidity transaction. Requires `sync()` first. */
  buildAddLiquidityTx(params: AddLiquidityParams): SdkResult<BuiltTx> {
    const poolRes = this.requireCache();
    if (!poolRes.ok) return poolRes;
    if (params.tokenAmounts.length !== poolRes.data.tokenCount) {
      return err("invalid_input", "tokenAmounts length must equal pool.tokenCount");
    }
    try {
      return ok(buildAddLiquidityTx(this.config, poolRes.data, params));
    } catch (e) {
      return err("tx_build_failed", "Failed to build add_liquidity tx", e);
    }
  }

  /** Build a proportional remove-liquidity transaction. Requires `sync()` first. */
  buildRemoveLiquidityTx(params: RemoveLiquidityParams): SdkResult<BuiltTx> {
    const poolRes = this.requireCache();
    if (!poolRes.ok) return poolRes;
    if (
      params.minimumTokenAmounts &&
      params.minimumTokenAmounts.length !== poolRes.data.tokenCount
    ) {
      return err("invalid_input", "minimumTokenAmounts length must equal pool.tokenCount");
    }
    try {
      return ok(buildRemoveLiquidityTx(this.config, poolRes.data, params));
    } catch (e) {
      return err("tx_build_failed", "Failed to build remove_liquidity tx", e);
    }
  }

  /**
   * Build a single-token deposit transaction (swaps + add_liquidity via the
   * helper program + BPT forward to user). Requires `sync()` first.
   */
  buildSingleTokenDepositTx(params: SingleTokenDepositParams): SdkResult<BuiltTx> {
    const poolRes = this.requireCache();
    if (!poolRes.ok) return poolRes;
    if (params.amountIn.lten(0)) return err("invalid_input", "amountIn must be > 0");
    if (hasPendingProtocolFees(poolRes.data) && poolRes.data.tokenCount !== 2) {
      return err(
        "unsupported_pool_state",
        MULTI_TOKEN_PENDING_FEES_SINGLE_DEPOSIT_MESSAGE
      );
    }
    try {
      return ok(buildSingleTokenDepositTx(this.config, poolRes.data, params));
    } catch (e) {
      return err("tx_build_failed", "Failed to build single-token deposit tx", e);
    }
  }

  /** Proxy into the dedicated SingleTokenDepositClient for consumers who
   *  want the quote/build methods exposed on a focused object. */
  get singleTokenDeposit(): SingleTokenDepositClient {
    if (!this._std) {
      this._std = new SingleTokenDepositClient({
        config: this.config,
        poolAddress: this.poolAddress,
        poolClient: this,
      });
    }
    return this._std;
  }
  private _std?: SingleTokenDepositClient;

  // ---------- Event helpers ----------

  /** Parse logs from a confirmed transaction into typed events. */
  parseEventsFromLogs(logs: string[]): CubicPoolEvent[] {
    return parseCubicPoolEvents(logs);
  }

  // ---------- Internals ----------

  private requireCache(): SdkResult<PoolInfo> {
    if (!this.cache) {
      return err("invalid_input", "Call `sync()` first to populate pool state");
    }
    return ok(this.cache);
  }
}
