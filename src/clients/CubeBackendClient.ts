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
}
