# @cube/sdk

Client library for the Cubic Pool AMM on Solana. Targeted at both frontend
and backend consumers; no bundler-specific code.

## Install (workspace-local)

```bash
cd sdk
npm install
npm run build
```

From sibling packages:

```json
{
  "dependencies": {
    "@cube/sdk": "file:../sdk"
  }
}
```

## Quick start

```ts
import { getConfig, CubicPoolClient, CubeBackendClient } from "@cube/sdk";
import { PublicKey } from "@solana/web3.js";

const config = getConfig("mainnet", {
  backendEndpoint: "https://api.cube.fi",
  slippageHundredthsBps: 30_000, // 3 %
});

const pool = new CubicPoolClient({
  config,
  poolAddress: new PublicKey("..."),
  rpc: { endpoint: config.defaults.rpcEndpoint, apiKey: process.env.RPC_API_KEY },
});

const res = await pool.sync();
if (!res.ok) {
  // res.error.humanMessage is safe to render to users
  console.error(res.error.humanMessage);
  return;
}
const info = res.data;
// info.tokens[i].metadata contains ticker / logo / decimals
// info.tokens[i].actualBalance is a bn.js BN in native units
```

## Architecture

```
config/       CubeConfig, program IDs per network, token registry
types/        Result<T> shape, PoolInfo, SwapQuote, SingleTokenDepositQuote,
              CubicPoolEvent
utils/        Error mapping, retry wrapper (safeCall), PDA helpers
math/         Pure math — port of cubic-pool + stld Rust math modules
parsers/      Binary layout decoders for CubicPool / Mint / events
clients/      RpcClient, CubeBackendClient, CubicPoolClient
idl/          Anchor IDL exports generated from the current contracts
examples/     Runnable scripts demonstrating each capability
```

Every public method returns `SdkResult<T>` — either `{ ok: true, data }`
or `{ ok: false, error: { code, humanMessage, cause? } }`. The SDK never
throws for I/O or parse errors.

## What lives in the SDK vs the frontend

**In the SDK:**
- All on-chain account parsing (pool, mint, events)
- All math (quote, allocations, slippage, price impact)
- All transaction building (swap, add/remove liquidity, single-token deposit, pool deploy)
- Current Anchor IDLs for `cubic_pool`, `single_token_liquidity`, and
  `protocol_fees_authority`
- Retry + fallback for RPC and backend calls
- Event log decoding

**In the frontend:** only UI rendering + state management (zustand / redux) + wallet integration. No raw RPC calls, no borsh, no math.

## Examples

See `examples/*.ts`:

- `01-init-sdk.ts` — initialisation patterns
- `02-fetch-pool.ts` — parse pool state
- `03-quote-swap.ts` — swap quote with slippage
- `06-single-token-deposit.ts` — single-token deposit quote
- `08-backend-stats.ts` — statistics via CubeBackendClient

Run: `npx ts-node examples/<name>.ts`.

## Error handling pattern

```ts
const res = await pool.sync();
if (!res.ok) {
  toast.error(res.error.humanMessage);
  logger.debug(res.error.cause);
  return;
}
const pool = res.data;
```

The SDK's `safeCall` helper retries transient errors (RPC timeouts, rate
limits, connection refused) up to 3 times with exponential backoff
(200ms / 500ms / 1500ms). Permanent errors (parse failure, invalid input,
insufficient funds) short-circuit.
