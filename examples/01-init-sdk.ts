/**
 * Example 01 — Initialise the SDK for a given network.
 *
 * Run: `npx ts-node examples/01-init-sdk.ts`
 */
import { getConfig, CubicPoolClient, CubeBackendClient } from "../src";
import { PublicKey } from "@solana/web3.js";

const config = getConfig("devnet", {
  backendEndpoint: "https://api-devnet.cube.fi",
  slippageHundredthsBps: 50_000, // 5 %
  cuLimit: 1_400_000,
});

console.log("Network:", config.network);
console.log("Programs:", {
  cubicPool: config.programs.cubicPool.toBase58(),
  singleTokenLiquidity: config.programs.singleTokenLiquidity.toBase58(),
});
console.log("RPC:", config.defaults.rpcEndpoint);

// Backend client
const backend = new CubeBackendClient({ apiEndpoint: config.backendEndpoint! });
void backend;

// Pool client (substitute a real pool address)
const poolAddr = new PublicKey("11111111111111111111111111111111");
const pool = new CubicPoolClient({
  config,
  poolAddress: poolAddr,
  rpc: { endpoint: config.defaults.rpcEndpoint },
});
void pool;
