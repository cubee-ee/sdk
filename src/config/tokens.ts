import { PublicKey } from "@solana/web3.js";

/** Metadata describing a token. Populated by backend or local registry. */
export interface TokenInfo {
  mint: PublicKey;
  symbol: string;
  name: string;
  decimals: number;
  logoUri?: string;
  coingeckoId?: string;
}

/**
 * Local fallback registry of well-known tokens. The backend registry takes
 * precedence; this is used when the backend is unreachable.
 */
export const KNOWN_TOKENS: Record<string, Omit<TokenInfo, "mint"> & { mint: string }> = {
  SOL: {
    mint: "So11111111111111111111111111111111111111112",
    symbol: "SOL",
    name: "Wrapped SOL",
    decimals: 9,
    logoUri:
      "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
    coingeckoId: "solana",
  },
  USDC: {
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    logoUri:
      "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png",
    coingeckoId: "usd-coin",
  },
  USDT: {
    mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
    coingeckoId: "tether",
  },
};

export function resolveKnownToken(mint: string): TokenInfo | undefined {
  for (const t of Object.values(KNOWN_TOKENS)) {
    if (t.mint === mint) {
      return { ...t, mint: new PublicKey(t.mint) };
    }
  }
  return undefined;
}
