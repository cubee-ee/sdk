import { SdkError, SdkErrorCode } from "../types/result";

const CONTRACT_ERROR_MAP: Record<number, { code: SdkErrorCode; message: string }> = {
  // cubic-pool error codes (see programs/cubic-pool/src/errors.rs)
  6000: { code: "invalid_input", message: "Invalid token count" },
  6001: { code: "invalid_input", message: "Invalid token index" },
  6002: { code: "invalid_input", message: "Invalid weights — must sum to 10000" },
  6003: { code: "invalid_input", message: "Invalid virtual balances" },
  6004: { code: "insufficient_funds", message: "Insufficient pool liquidity" },
  6005: { code: "slippage_exceeded", message: "Slippage tolerance exceeded" },
  6006: { code: "invalid_input", message: "Invalid token amounts" },
  6007: { code: "slippage_exceeded", message: "BPT received is below the minimum requested" },
  6009: { code: "invalid_input", message: "Swap fee rate exceeds the allowed maximum" },
  6011: { code: "math_overflow", message: "Math overflow" },
  6012: { code: "math_overflow", message: "Math underflow" },
  6022: { code: "pool_disabled", message: "Pool is disabled" },
  6023: { code: "swaps_disabled", message: "Swaps are disabled on this pool" },
  6025: { code: "invalid_input", message: "Zero amount" },
};

/**
 * Convert a raw error (possibly from Anchor, web3.js, or fetch) into a
 * cleanly-typed SdkError. Used by safeCall wrappers so callers always
 * get structured errors, never exceptions.
 */
export function toSdkError(cause: unknown): SdkError {
  // Anchor-encoded program errors
  const msg = extractMessage(cause);
  const code = extractErrorCode(msg);
  if (code !== null && CONTRACT_ERROR_MAP[code]) {
    return {
      code: CONTRACT_ERROR_MAP[code].code,
      humanMessage: CONTRACT_ERROR_MAP[code].message,
      cause,
    };
  }
  // Common network strings
  if (/timed? ?out|ETIMEDOUT/i.test(msg)) {
    return { code: "rpc_timeout", humanMessage: "RPC timed out", cause };
  }
  if (/429|rate limit/i.test(msg)) {
    return { code: "rpc_rate_limited", humanMessage: "RPC rate-limited — slow down", cause };
  }
  if (/fetch failed|ECONNREFUSED|ENOTFOUND/i.test(msg)) {
    return { code: "rpc_unavailable", humanMessage: "RPC endpoint unreachable", cause };
  }
  if (/Account does not exist|account not found/i.test(msg)) {
    return { code: "account_not_found", humanMessage: "Account does not exist on-chain", cause };
  }
  if (/insufficient funds/i.test(msg)) {
    return { code: "insufficient_funds", humanMessage: "Insufficient funds for this operation", cause };
  }
  return { code: "unknown", humanMessage: msg || "Unknown error", cause };
}

function extractMessage(e: unknown): string {
  if (!e) return "";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null && "message" in e) {
    return String((e as { message?: string }).message ?? "");
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function extractErrorCode(msg: string): number | null {
  // Anchor error format: "custom program error: 0x1774"
  const hex = msg.match(/custom program error: 0x([0-9a-fA-F]+)/);
  if (hex) return parseInt(hex[1], 16);
  // Anchor SDK format: "Error Number: 6007"
  const dec = msg.match(/Error Number:\s*(\d+)/);
  if (dec) return parseInt(dec[1], 10);
  return null;
}
