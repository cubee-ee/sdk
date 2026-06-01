# Sign In With Solana (SIWS) — Frontend Integration Guide

## Overview

Cubee uses **Sign In With Solana (SIWS)** for wallet-based authentication. The flow:

1. Request a nonce from the backend
2. Sign the returned message with the wallet
3. Submit the signature to receive a JWT
4. Use the JWT for authenticated API calls

## Prerequisites

- `@cubee_ee/sdk` (already used for API calls)
- `@solana/wallet-adapter-react` (already used for wallet connection)

No additional dependencies needed.

## Integration

### React Hook Example

```tsx
import { useWallet } from "@solana/wallet-adapter-react";
import { useCallback, useRef } from "react";
import { CubeBackendClient } from "@cubee_ee/sdk";

// Use a shared client instance (or create via your SDK setup)
const client = new CubeBackendClient({
  apiEndpoint: "https://api.cubee.ee",
});

export function useAuth() {
  const { publicKey, signMessage } = useWallet();
  const tokenRef = useRef<string | null>(null);

  const signIn = useCallback(async () => {
    if (!publicKey || !signMessage) {
      throw new Error("Wallet not connected");
    }

    // 1. Request nonce
    const nonceRes = await client.getNonce(publicKey.toBase58());
    if (!nonceRes.ok) {
      throw new Error(nonceRes.error.humanMessage);
    }

    // 2. Sign the message
    const messageBytes = new TextEncoder().encode(nonceRes.data.message);
    const signatureBytes = await signMessage(messageBytes);
    const signatureBase64 = Buffer.from(signatureBytes).toString("base64");

    // 3. Verify and get JWT
    const authRes = await client.verifySignature(
      nonceRes.data.message,
      signatureBase64,
    );
    if (!authRes.ok) {
      throw new Error(authRes.error.humanMessage);
    }

    // 4. Set token for future requests
    client.setAccessToken(authRes.data.accessToken);
    tokenRef.current = authRes.data.accessToken;

    return authRes.data;
  }, [publicKey, signMessage]);

  const signOut = useCallback(() => {
    client.clearAccessToken();
    tokenRef.current = null;
  }, []);

  return { signIn, signOut, token: tokenRef.current };
}
```

### Browser Environment (no Buffer)

If `Buffer` is not available (plain browser without polyfill), use:

```ts
const signatureBase64 = btoa(
  String.fromCharCode(...signatureBytes),
);
```

## API Reference

### `client.getNonce(wallet: string)`

Request a single-use nonce and pre-built SIWS message.

**Returns:** `SdkResult<{ nonce: string; message: string }>`

### `client.verifySignature(message: string, signature: string)`

Submit the signed message and base64-encoded signature.

**Returns:** `SdkResult<{ accessToken: string; wallet: string; expiresIn: string }>`

### `client.setAccessToken(token: string)`

Set the JWT for all subsequent requests. Adds `Authorization: Bearer {token}` header.

### `client.clearAccessToken()`

Remove the JWT (logout). Subsequent requests are unauthenticated.

## Token Lifecycle

- **Expiration:** 24 hours by default
- **No refresh token.** Wallet-based auth doesn't need one — re-signing is instant (one popup).
- **Storage:** Store the token in memory or `sessionStorage`. Avoid `localStorage` for JWTs in production (XSS risk).

### Handling Expired Tokens

When the JWT expires, protected endpoints return **HTTP 401**. The wallet stays connected — only the JWT session is expired. The frontend should:

1. Catch the 401
2. Automatically call `signIn()` again (nonce + signMessage + verify)
3. Retry the original request with the new token

The user sees a single wallet popup to re-sign. No disconnect/reconnect needed.

```tsx
async function authenticatedRequest<T>(
  request: () => Promise<SdkResult<T>>,
  signIn: () => Promise<void>,
): Promise<SdkResult<T>> {
  const res = await request();

  // If 401 — token expired, re-authenticate and retry once
  if (!res.ok && res.error.humanMessage.includes("HTTP 401")) {
    await signIn();
    return request();
  }

  return res;
}
```

## Error Handling

```ts
const res = await client.verifySignature(message, signature);
if (!res.ok) {
  switch (res.error.code) {
    case "auth_failed":
      // Signature invalid, nonce expired, or message tampered
      break;
    case "backend_unavailable":
      // Server unreachable — retry later
      break;
    default:
      console.error(res.error.humanMessage);
  }
}
```
