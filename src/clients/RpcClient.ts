import { Commitment, Connection, PublicKey } from "@solana/web3.js";
import { SdkResult } from "../types/result";
import { safeCall, RetryOptions } from "../utils/retry";

export interface RpcClientParams {
  endpoint: string;
  apiKey?: string;
  commitment?: Commitment;
  /** Optional headers (e.g. for Helius/Triton auth). */
  headers?: Record<string, string>;
}

/**
 * Thin wrapper around `@solana/web3.js` Connection with built-in retry +
 * human-readable error mapping. Every public method returns a SdkResult<T>.
 */
export class RpcClient {
  readonly connection: Connection;
  private readonly defaultCommitment: Commitment;

  constructor(params: RpcClientParams) {
    const endpoint = params.apiKey
      ? appendApiKey(params.endpoint, params.apiKey)
      : params.endpoint;
    this.defaultCommitment = params.commitment ?? "confirmed";
    this.connection = new Connection(endpoint, {
      commitment: this.defaultCommitment,
      httpHeaders: params.headers,
    });
  }

  call<T>(
    fn: (conn: Connection) => Promise<T>,
    retry: RetryOptions = {}
  ): Promise<SdkResult<T>> {
    return safeCall(() => fn(this.connection), retry);
  }

  getAccountInfo(
    pk: PublicKey,
    retry: RetryOptions = {}
  ): Promise<SdkResult<{ data: Buffer; owner: PublicKey; lamports: number } | null>> {
    return safeCall(async () => {
      const info = await this.connection.getAccountInfo(pk, this.defaultCommitment);
      if (!info) return null;
      return {
        data: info.data,
        owner: info.owner,
        lamports: info.lamports,
      };
    }, retry);
  }

  getMultipleAccountsInfo(
    pks: PublicKey[],
    retry: RetryOptions = {}
  ): Promise<SdkResult<(Buffer | null)[]>> {
    return safeCall(async () => {
      const infos = await this.connection.getMultipleAccountsInfo(pks, this.defaultCommitment);
      return infos.map((i) => (i ? i.data : null));
    }, retry);
  }

  getSlot(retry: RetryOptions = {}): Promise<SdkResult<number>> {
    return safeCall(() => this.connection.getSlot(this.defaultCommitment), retry);
  }
}

function appendApiKey(endpoint: string, apiKey: string): string {
  try {
    const u = new URL(endpoint);
    u.searchParams.set("api-key", apiKey);
    return u.toString();
  } catch {
    const sep = endpoint.includes("?") ? "&" : "?";
    return `${endpoint}${sep}api-key=${encodeURIComponent(apiKey)}`;
  }
}
