import { SdkResult, err, ok } from "../types/result";
import { PoolSummary } from "../types/pool";
import { safeCall } from "../utils/retry";

export interface CubeBackendClientParams {
  apiEndpoint: string;
  apiKey?: string;
  defaultHeaders?: Record<string, string>;
}

export type StatsKind =
  | "tvl"
  | "volume"
  | "swap_count"
  | "avg_swap"
  | "median_swap"
  | "fees_lp"
  | "fees_protocol"
  | "users_total"
  | "dau"
  | "mau"
  | "deposits"
  | "removals";

export type StatsWindow = "1d" | "7d" | "30d" | "all";

export interface StatsSeriesPoint {
  t: number;
  v: number;
}
export interface StatsSeries {
  points: StatsSeriesPoint[];
}

export interface PriceMap {
  [mint: string]: number;
}

// ── Leaderboard types ──

export interface LeaderboardEntry {
  address: string;
  points: number;
  place: number;
}

export interface LeaderboardResponse {
  total: number;
  page: number;
  limit: number;
  data: LeaderboardEntry[];
}

export interface LeaderboardUserStats {
  place: number;
  address: string;
  points: number;
  lastAccrualSwapUsd: number;
  lastAccrualLiqUsd: number;
  lastAccrualAt: string | null;
  cumulativeSwapVolumeUsd: number;
  cumulativeNetLiquidityUsd: number;
}

/**
 * REST wrapper around the Cube backend. Every method is a SdkResult; no
 * exceptions escape. If a request fails, the result carries a
 * human-readable error plus the original cause.
 */
export class CubeBackendClient {
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;

  constructor(params: CubeBackendClientParams) {
    this.endpoint = params.apiEndpoint.replace(/\/$/, "");
    this.headers = {
      "Content-Type": "application/json",
      ...(params.apiKey ? { Authorization: `Bearer ${params.apiKey}` } : {}),
      ...(params.defaultHeaders ?? {}),
    };
  }

  listPools(): Promise<SdkResult<PoolSummary[]>> {
    return this.get<PoolSummary[]>("/api/pools");
  }

  getPool(addr: string): Promise<SdkResult<PoolSummary>> {
    return this.get<PoolSummary>(`/api/pools/${addr}`);
  }

  /**
   * Raw pool-list response in the same envelope the backend returns
   * (`{ data, hasMore, totalCount }`). Kept so the frontend's React
   * Query hooks can map directly.
   */
  listPoolsRaw(
    limit: number,
    offset: number
  ): Promise<SdkResult<{ data: unknown[]; hasMore: boolean; totalCount: number }>> {
    const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    return this.getEnvelope(`/api/pools?${qs.toString()}`);
  }

  getPoolRaw(addr: string): Promise<SdkResult<unknown>> {
    return this.getDataField<unknown>(`/api/pools/${addr}`);
  }

  createPool<T>(body: unknown): Promise<SdkResult<T>> {
    return this.postDataField<T>("/api/pools", body);
  }

  getPoolsByTokenPair<T>(tokenA: string, tokenB: string): Promise<SdkResult<T>> {
    const qs = new URLSearchParams({ tokenA, tokenB });
    return this.getDataField<T>(`/api/pools/by-pair?${qs.toString()}`);
  }

  getPlatformStats<T>(): Promise<SdkResult<T>> {
    return this.getDataField<T>("/api/pools/stats");
  }

  getPortfolio<T>(owner: string): Promise<SdkResult<T>> {
    return this.getDataField<T>(`/api/pools/portfolio?owner=${encodeURIComponent(owner)}`);
  }

  getAllTokens<T>(): Promise<SdkResult<T>> {
    return this.getDataField<T>("/api/pools/tokens");
  }

  getTopTokens<T>(limit: number = 20): Promise<SdkResult<T>> {
    return this.getDataField<T>(`/api/pools/top-tokens?limit=${limit}`);
  }

  getPoolTxStats<T>(addr: string): Promise<SdkResult<T>> {
    return this.getDataField<T>(`/api/pools/${addr}/tx-stats`);
  }

  getTransactions<T>(addr: string, limit: number = 20, offset: number = 0): Promise<SdkResult<T>> {
    const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    return this.getDataField<T>(`/api/pools/${addr}/transactions?${qs.toString()}`);
  }

  getSwapRoute<T>(
    tokenIn: string,
    tokenOut: string,
    amountIn: string
  ): Promise<SdkResult<T>> {
    const qs = new URLSearchParams({ tokenIn, tokenOut, amountIn });
    return this.getDataField<T>(`/api/swap/route?${qs.toString()}`);
  }

  // ── Leaderboard ──

  getLeaderboard(
    page: number = 1,
    limit: number = 20,
  ): Promise<SdkResult<LeaderboardResponse>> {
    const qs = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    });
    return this.get<LeaderboardResponse>(`/api/leaderboard?${qs.toString()}`);
  }

  getLeaderboardUser(
    address: string,
  ): Promise<SdkResult<LeaderboardUserStats>> {
    return this.getDataField<LeaderboardUserStats>(
      `/api/leaderboard/user/${encodeURIComponent(address)}`,
    );
  }

  getTokenPrices(mints: string[]): Promise<SdkResult<PriceMap>> {
    const qs = new URLSearchParams({ mints: mints.join(",") });
    return this.get<PriceMap>(`/api/prices?${qs.toString()}`);
  }

  getStats(
    kind: StatsKind,
    window: StatsWindow = "7d",
    poolAddr?: string,
    unit: "usd" | "token" = "usd"
  ): Promise<SdkResult<StatsSeries>> {
    const qs = new URLSearchParams({ window, unit });
    if (poolAddr) qs.set("pool", poolAddr);
    return this.get<StatsSeries>(`/api/stats/${kind}?${qs.toString()}`);
  }

  /** Generic GET with retry. Callers that need it for other endpoints. */
  get<T>(path: string): Promise<SdkResult<T>> {
    return this.request<T>("GET", path);
  }

  post<T>(path: string, body: unknown): Promise<SdkResult<T>> {
    return this.request<T>("POST", path, body);
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown
  ): Promise<SdkResult<T>> {
    const url = `${this.endpoint}${path}`;
    const fetchOpts: RequestInit = {
      method,
      headers: this.headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    };
    const raw = await safeCall(async () => {
      const res = await fetch(url, fetchOpts);
      if (!res.ok) {
        throw new Error(`${method} ${path} → HTTP ${res.status} ${res.statusText}`);
      }
      return (await res.json()) as T;
    });
    if (!raw.ok) return raw;
    return ok(raw.data);
  }

  /**
   * Fetch a response envelope of the form `{ data: T, ... }` and unwrap
   * the `.data` field. The existing Cube backend wraps most endpoints
   * this way.
   */
  private async getDataField<T>(path: string): Promise<SdkResult<T>> {
    const res = await this.get<{ data: T }>(path);
    if (!res.ok) return res;
    return ok(res.data?.data);
  }

  private async postDataField<T>(path: string, body: unknown): Promise<SdkResult<T>> {
    const res = await this.post<{ data: T }>(path, body);
    if (!res.ok) return res;
    return ok(res.data?.data);
  }

  /** Fetch the full envelope (for endpoints that return meta alongside data). */
  private async getEnvelope<T>(path: string): Promise<SdkResult<T>> {
    return this.get<T>(path);
  }
}
