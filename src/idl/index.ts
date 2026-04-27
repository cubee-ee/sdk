import cubicPoolIdl from "./cubic_pool.json";
import protocolFeesAuthorityIdl from "./protocol_fees_authority.json";
import singleTokenLiquidityIdl from "./single_token_liquidity.json";

export const CUBIC_POOL_IDL = cubicPoolIdl;
export const PROTOCOL_FEES_AUTHORITY_IDL = protocolFeesAuthorityIdl;
export const SINGLE_TOKEN_LIQUIDITY_IDL = singleTokenLiquidityIdl;

export const IDLS = {
  cubicPool: CUBIC_POOL_IDL,
  protocolFeesAuthority: PROTOCOL_FEES_AUTHORITY_IDL,
  singleTokenLiquidity: SINGLE_TOKEN_LIQUIDITY_IDL,
} as const;
