import { PublicKey } from "@solana/web3.js";

export type Network = "mainnet" | "devnet" | "localnet";

export interface NetworkPrograms {
  cubicPool: PublicKey;
  singleTokenLiquidity: PublicKey;
  protocolFeesAuthority: PublicKey;
}

export const NETWORK_PROGRAMS: Record<Network, NetworkPrograms> = {
  mainnet: {
    // TODO: fill in on launch
    cubicPool: new PublicKey("62J6JWH4ubU9uXqHB7SKcgcxG5FgZc4fyJQCE4cEDsjT"),
    singleTokenLiquidity: new PublicKey(
      "66wPN8onWHnJV5tYXxcNX1rMkBBePAmgCRp3c5xHXJ3u"
    ),
    protocolFeesAuthority: new PublicKey(
      "8Q3K6jZEJSaXGL1VS1w7bmqNVzDTmw68jaWi5mmU9LD5"
    ),
  },
  devnet: {
    cubicPool: new PublicKey("62J6JWH4ubU9uXqHB7SKcgcxG5FgZc4fyJQCE4cEDsjT"),
    singleTokenLiquidity: new PublicKey(
      "66wPN8onWHnJV5tYXxcNX1rMkBBePAmgCRp3c5xHXJ3u"
    ),
    protocolFeesAuthority: new PublicKey(
      "8Q3K6jZEJSaXGL1VS1w7bmqNVzDTmw68jaWi5mmU9LD5"
    ),
  },
  localnet: {
    cubicPool: new PublicKey("62J6JWH4ubU9uXqHB7SKcgcxG5FgZc4fyJQCE4cEDsjT"),
    singleTokenLiquidity: new PublicKey(
      "66wPN8onWHnJV5tYXxcNX1rMkBBePAmgCRp3c5xHXJ3u"
    ),
    protocolFeesAuthority: new PublicKey(
      "8Q3K6jZEJSaXGL1VS1w7bmqNVzDTmw68jaWi5mmU9LD5"
    ),
  },
};

export const DEFAULT_RPC_ENDPOINT: Record<Network, string> = {
  mainnet: "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
  localnet: "http://127.0.0.1:8899",
};
