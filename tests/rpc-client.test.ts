import { PublicKey } from "@solana/web3.js";
import { RpcClient } from "../src/clients/RpcClient";

type FakeConnection = {
  getSlot?: jest.Mock;
  getAccountInfo?: jest.Mock;
  getMultipleAccountsInfo?: jest.Mock;
};

function makeRpcClient(
  connections: Record<string, FakeConnection>,
  timeoutMs = 5
): RpcClient {
  return new RpcClient({
    endpoints: Object.keys(connections),
    timeoutMs,
    backoffMs: [],
    connectionFactory: (endpoint: string) => connections[endpoint] as any,
  });
}

describe("RpcClient endpoint fallback", () => {
  test("moves to the next endpoint when the first endpoint times out", async () => {
    const hanging = jest.fn(() => new Promise<number>(() => undefined));
    const healthy = jest.fn(async () => 123);
    const rpc = makeRpcClient({
      "https://slow.rpc": { getSlot: hanging },
      "https://fast.rpc": { getSlot: healthy },
    });

    const res = await rpc.getSlot();

    expect(res).toEqual({ ok: true, data: 123 });
    expect(hanging).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledTimes(1);
  });

  test("starts the next request from the last healthy endpoint", async () => {
    const first = jest.fn()
      .mockRejectedValueOnce(new Error("Proxy error"))
      .mockResolvedValueOnce(111);
    const second = jest.fn(async () => 222);
    const rpc = makeRpcClient({
      "https://primary.rpc": { getSlot: first },
      "https://fallback.rpc": { getSlot: second },
    });

    const firstResult = await rpc.getSlot();
    const secondResult = await rpc.getSlot();

    expect(firstResult).toEqual({ ok: true, data: 222 });
    expect(secondResult).toEqual({ ok: true, data: 222 });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  test("returns the last transient error after all endpoints fail", async () => {
    const rpc = makeRpcClient({
      "https://one.rpc": { getSlot: jest.fn(async () => { throw new Error("Proxy error"); }) },
      "https://two.rpc": { getSlot: jest.fn(async () => { throw new Error("rate limit"); }) },
    });

    const res = await rpc.getSlot();

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("rpc_rate_limited");
    }
  });

  test("does not fallback for account_not_found results", async () => {
    const primary = jest.fn(async () => null);
    const fallback = jest.fn(async () => null);
    const rpc = makeRpcClient({
      "https://primary.rpc": { getAccountInfo: primary },
      "https://fallback.rpc": { getAccountInfo: fallback },
    });

    const res = await rpc.getAccountInfo(PublicKey.default);

    expect(res).toEqual({ ok: true, data: null });
    expect(primary).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });
});
