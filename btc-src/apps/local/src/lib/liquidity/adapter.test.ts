import { afterEach, it, expect, vi } from "vitest";
import { selector, word, words, symbol, uniswapV3, pricePositions } from "./uniswap-v3";
import { explore } from "./market";
afterEach(() => vi.unstubAllGlobals());
it("canonical ABI selectors, signed arguments, malformed ABI", () => { expect(selector("balanceOf(address)")).toBe("70a08231"); expect(word(-1n)).toBe("f".repeat(64)); expect(() => words("0x00", 1)).toThrow(); expect(symbol("0x" + "55534443".padEnd(64, "0"), "?")).toBe("USDC"); });
it("empty wallet is confirmed at one immutable block", async () => { const calls: any[] = []; vi.stubGlobal("fetch", vi.fn(async (_u, opts) => { const body = JSON.parse(String(opts?.body)); calls.push(body); return { ok: true, json: async () => ({ result: body.method === "eth_blockNumber" ? "0x123" : body.params[0].data.startsWith("0x70a08231") ? "0x" + word(0n) : "0x" + word("0x" + "1".repeat(40)) }) }; })); const r = await uniswapV3.discover("synthetic", "0x" + "2".repeat(40), 1, 0, new AbortController().signal); expect(r.positions).toEqual([]); expect(r.complete).toBe(true); expect(calls.slice(1).every(c => c.params[1] === "0x123")).toBe(true); });
it("invalid owners never initiate RPC calls", async () => { const f = vi.fn(); vi.stubGlobal("fetch", f); await expect(uniswapV3.discover("s", "private key", 1, 0, new AbortController().signal)).rejects.toThrow(); expect(f).not.toHaveBeenCalled(); });
it("RPC failure is not interpreted as an empty portfolio", async () => { vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 429 }))); await expect(uniswapV3.discover("s", "0x" + "2".repeat(40), 1, 0, new AbortController().signal)).rejects.toThrow("429"); });
it("empty prices are a no-op", async () => expect(await pricePositions([], new AbortController().signal)).toEqual([]));
it("market absence remains null; no invented APY or seven-day volume", async () => { vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ pairs: [{ chainId: "ethereum", dexId: "uniswap", pairAddress: "0x" + "3".repeat(40), baseToken: { symbol: "A" }, quoteToken: { symbol: "B" }, liquidity: { usd: 200000 }, volume: { h24: 10000 } }] }) }))); const rows = await explore("synthetic-test-1", "DexScreener", new AbortController().signal); expect(rows[0]!.apy).toBeNull(); expect(rows[0]!.volume7).toBeNull(); expect(rows[0]!.tvl).toBe(200000); });
it("Llama UUID is never assumed to be the pool contract", async () => { vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: [{ chain: "Base", project: "uniswap-v3", pool: "synthetic-uuid", symbol: "ETH-USDC", tvlUsd: 1000, apy: 12.5 }] }) }))); const rows = await explore("", "DefiLlama", new AbortController().signal); expect(rows[0]!.pool).toBeNull(); expect(rows[0]!.apy).toBe(12.5); expect(rows[0]!.id).toBe("llama:synthetic-uuid"); });
it.each([{ tick: 0, liq: 1000000n, status: "IN RANGE" }, { tick: 200, liq: 1000000n, status: "OUT OF RANGE" }, { tick: 0, liq: 0n, status: "CLOSED" }])("decodes NFT quantities and range without fake historical PnL: $status", async ({ tick, liq, status }) => {
    const manager = "0xc36442b4a4522e871399cd717abdd847ab11fe88", token0 = "0x" + "3".repeat(40), token1 = "0x" + "4".repeat(40), pool = "0x" + "5".repeat(40), factory = "0x" + "6".repeat(40);
    const encode = (items: (string | bigint)[]) => "0x" + items.map(word).join("");
    vi.stubGlobal("fetch", vi.fn(async (_url, opts) => {
        const body = JSON.parse(String(opts?.body));
        if (body.method === "eth_blockNumber")
            return { ok: true, json: async () => ({ result: "0x123" }) };
        const data = body.params[0].data as string, sel = data.slice(2, 10);
        let result = "0x";
        if (sel === selector("balanceOf(address)"))
            result = encode([1n]);
        else if (sel === selector("factory()"))
            result = encode([factory]);
        else if (sel === selector("tokenOfOwnerByIndex(address,uint256)"))
            result = encode([123n]);
        else if (sel === selector("positions(uint256)"))
            result = encode([0n, "0x" + "0".repeat(40), token0, token1, 3000n, -100n, 100n, liq, 0n, 0n, 0n, 0n]);
        else if (sel === selector("getPool(address,address,uint24)"))
            result = encode([pool]);
        else if (sel === selector("slot0()"))
            result = encode([2n ** 96n, BigInt(tick)]);
        else if (sel === selector("decimals()"))
            result = encode([18n]);
        else if (sel === selector("symbol()"))
            result = "0x" + "414141".padEnd(64, "0");
        return { ok: true, json: async () => ({ result }) };
    }));
    const r = await uniswapV3.discover("synthetic", "0x" + "2".repeat(40), 1, 0, new AbortController().signal);
    expect(r.notes).toEqual([]);
    expect(r.positions[0]!.status).toBe(status);
    expect(r.positions[0]!.valueUsd).toBeNull();
    expect(r.positions[0]!.historyComplete).toBe(false);
    expect(r.positions[0]!.id).toBe(`eip155:1:uniswap-v3:${manager}:123`);
});
