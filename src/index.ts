/**
 * @cube/sdk — client library for the Cubic Pool AMM on Solana.
 *
 * Entry point barrel. Most consumers will want to import from this root:
 *
 * ```ts
 * import { CubicPoolClient, CubeBackendClient, getConfig } from "@cube/sdk";
 *
 * const cfg = getConfig("mainnet", { backendEndpoint: "https://api.cube.fi" });
 * const pool = new CubicPoolClient({ config: cfg, poolAddress, rpc: { endpoint: cfg.defaults.rpcEndpoint } });
 * const info = await pool.sync();
 * if (info.ok) console.log(info.data.tokens.map(t => t.metadata?.symbol));
 * ```
 */

export * from "./config";
export * from "./types";
export * from "./utils";
export * from "./math";
export * from "./parsers";
export * from "./clients";
