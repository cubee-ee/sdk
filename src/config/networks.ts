import { PublicKey } from "@solana/web3.js";

export type Network = "mainnet" | "devnet" | "localnet";

export interface NetworkPrograms {
  cubicPool: PublicKey;
  singleTokenLiquidity: PublicKey;
  protocolFeesAuthority: PublicKey;
}

export const NETWORK_PROGRAMS: Record<Network, NetworkPrograms> = {
  mainnet: {
    cubicPool: new PublicKey("8iQtGj9mcUfFUGaiCpPy89swC3s8YTC8FhVZWfgeZhwu"),
    // TODO(mainnet): single_token_liquidity is NOT deployed on mainnet — this
    // is the devnet program ID as a placeholder. Single-token deposit is
    // disabled in the frontend. If/when stld ships on mainnet, replace this
    // with the real mainnet program ID.
    singleTokenLiquidity: new PublicKey(
      "7BpdUH1tzTSXLuQNo6YpjJ8Eagw8AkrS6cnkxiJdCFS2"
    ),
    protocolFeesAuthority: new PublicKey(
      "3jiojHZbjJQ7QLMGSTjFwxVEmx4NtuRy34nLAmsJME81"
    ),
  },
  devnet: {
    cubicPool: new PublicKey("8iQtGj9mcUfFUGaiCpPy89swC3s8YTC8FhVZWfgeZhwu"),
    singleTokenLiquidity: new PublicKey(
      "7BpdUH1tzTSXLuQNo6YpjJ8Eagw8AkrS6cnkxiJdCFS2"
    ),
    protocolFeesAuthority: new PublicKey(
      "3jiojHZbjJQ7QLMGSTjFwxVEmx4NtuRy34nLAmsJME81"
    ),
  },
  localnet: {
    cubicPool: new PublicKey("8iQtGj9mcUfFUGaiCpPy89swC3s8YTC8FhVZWfgeZhwu"),
    singleTokenLiquidity: new PublicKey(
      "7BpdUH1tzTSXLuQNo6YpjJ8Eagw8AkrS6cnkxiJdCFS2"
    ),
    protocolFeesAuthority: new PublicKey(
      "3jiojHZbjJQ7QLMGSTjFwxVEmx4NtuRy34nLAmsJME81"
    ),
  },
};

export const DEFAULT_RPC_ENDPOINT: Record<Network, string> = {
  mainnet: "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
  localnet: "http://127.0.0.1:8899",
};
