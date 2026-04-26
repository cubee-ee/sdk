import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

/**
 * SPL Token (or Token-2022) Mint parser. Reads the first 82 bytes; ignores
 * Token-2022 extensions (we don't need them for BPT metadata).
 *
 * Layout:
 *   0..36  COption<Pubkey>  mintAuthority  (4 bytes tag + 32 bytes pubkey)
 *   36..44 u64              supply
 *   44..45 u8               decimals
 *   45..46 u8               isInitialized
 *   46..82 COption<Pubkey>  freezeAuthority
 */
export interface RawMintAccount {
  mintAuthority: PublicKey | null;
  supply: BN;
  decimals: number;
  isInitialized: boolean;
  freezeAuthority: PublicKey | null;
}

export function decodeMintAccount(data: Buffer): RawMintAccount {
  if (data.length < 82) {
    throw new Error(`decodeMintAccount: data too short (${data.length})`);
  }
  const mintAuthTag = data.readUInt32LE(0);
  const mintAuthority =
    mintAuthTag === 0 ? null : new PublicKey(data.slice(4, 36));
  const supply = new BN(data.slice(36, 44), "le");
  const decimals = data.readUInt8(44);
  const isInitialized = data.readUInt8(45) !== 0;
  const freezeTag = data.readUInt32LE(46);
  const freezeAuthority =
    freezeTag === 0 ? null : new PublicKey(data.slice(50, 82));
  return { mintAuthority, supply, decimals, isInitialized, freezeAuthority };
}
