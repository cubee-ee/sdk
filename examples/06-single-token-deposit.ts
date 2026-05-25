/**
 * Example 06 — Quote a single-token deposit.
 */
import BN from "bn.js";
import { CubicPoolClient, getConfig } from "../src";
import { PublicKey } from "@solana/web3.js";

async function main() {
  const cfg = getConfig("devnet");
  const addr = new PublicKey(process.env.POOL_ADDRESS ?? "11111111111111111111111111111111");
  const pool = new CubicPoolClient({
    config: cfg,
    poolAddress: addr,
  });
  const sync = await pool.sync();
  if (!sync.ok) throw new Error(sync.error.humanMessage);

  const amountIn = new BN(1_000_000_000);
  const q = pool.quoteSingleTokenDeposit(0, amountIn, 50_000 /* 5 % */);
  if (!q.ok) {
    console.error(q.error);
    process.exit(1);
  }
  const quote = q.data;
  console.log("=== single-token deposit quote ===");
  console.log("allocations:", quote.allocations.map((b) => b.toString()));
  console.log("expectedOuts:", quote.expectedOuts.map((b) => b.toString()));
  console.log("minOuts:", quote.minOuts.map((b) => b.toString()));
  console.log("estimatedBpt:", quote.estimatedBpt.toString());
  console.log("sidelined:", quote.sidelinedTokenIndices);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
