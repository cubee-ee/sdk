import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { PoolInfo } from "../types/pool";
import { BuiltTx } from "../types/tx";
import { SdkResult, err, ok } from "../types/result";

/**
 * Compile a set of instructions into a `VersionedTransaction` (v0),
 * optionally using a per-pool Address Lookup Table to shrink the wire
 * size below the 1232-byte legacy ceiling.
 *
 * ALT inclusion rules:
 *   - If `lookupTable` is `PublicKey.default` (or undefined) → no ALT
 *     is referenced; the tx is v0 but uses only static account keys.
 *   - Otherwise → fetch the ALT via `connection.getAddressLookupTable`
 *     and include it. If the fetch fails, the function returns an
 *     `alt_fetch_failed` error rather than silently falling back.
 *
 * Wallets supporting the standard `signTransaction(Transaction |
 * VersionedTransaction)` overload (Phantom, Solflare, Backpack, Glow,
 * the wallet-adapter set since 2023) sign these without changes.
 */
export async function buildVersionedTx(
  conn: Connection,
  payer: PublicKey,
  instructions: TransactionInstruction[],
  lookupTable: PublicKey | undefined,
): Promise<SdkResult<{ tx: VersionedTransaction; alts: AddressLookupTableAccount[] }>> {
  const alts: AddressLookupTableAccount[] = [];

  if (lookupTable && !lookupTable.equals(PublicKey.default)) {
    try {
      const res = await conn.getAddressLookupTable(lookupTable);
      if (!res.value) {
        return err(
          "alt_fetch_failed",
          `Lookup table ${lookupTable.toBase58()} not found on-chain. ` +
            "The pool advertises an ALT but the account is missing — " +
            "the ALT may have been closed or the RPC is stale.",
        );
      }
      alts.push(res.value);
    } catch (e) {
      return err(
        "alt_fetch_failed",
        `Failed to fetch lookup table ${lookupTable.toBase58()}`,
        e,
      );
    }
  }

  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(alts);

  return ok({ tx: new VersionedTransaction(msg), alts });
}

/**
 * Convenience: take a SDK-built `BuiltTx` and a pool snapshot, produce
 * a signed-ready `VersionedTransaction`. Picks up `pool.lookupTable`
 * automatically.
 */
export async function compileBuiltTx(
  conn: Connection,
  payer: PublicKey,
  built: BuiltTx,
  pool: Pick<PoolInfo, "lookupTable">,
): Promise<SdkResult<{ tx: VersionedTransaction; alts: AddressLookupTableAccount[] }>> {
  return buildVersionedTx(conn, payer, built.instructions, pool.lookupTable);
}
