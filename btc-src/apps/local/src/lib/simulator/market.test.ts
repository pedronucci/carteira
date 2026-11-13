import { afterEach, expect, it, vi } from "vitest";
import { quotes } from "./market";
afterEach(() => vi.unstubAllGlobals());
const payload = () => [{ universe: [{ name: "BTC", maxLeverage: 40, marginTableId: 56 }, { name: "SOL", maxLeverage: 20, marginTableId: 20 }, { name: "HYPE", maxLeverage: 10, marginTableId: 999 }], marginTables: [[56, { marginTiers: [{ lowerBound: "0.0", maxLeverage: 40 }, { lowerBound: "150000000", maxLeverage: 20 }] }]] }, [0, 1, 2].map(() => ({ markPx: "100", oraclePx: "99", funding: "0.00001" }))];
it("normalizes published margin tables, implicit tables and unknown IDs safely", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => payload() }));
    vi.stubGlobal("fetch", fetcher);
    const r = await quotes(new AbortController().signal);
    expect(r.BTC!.tiers).toEqual([{ lower: 0, maxLeverage: 40 }, { lower: 150000000, maxLeverage: 20 }]);
    expect(r.SOL!.tiers).toEqual([{ lower: 0, maxLeverage: 20 }]);
    expect(r.HYPE!.tiers).toEqual([]);
    expect(r.BTC!.funding).toBe(.00001);
    expect(fetcher).toHaveBeenCalledWith("https://api.hyperliquid.xyz/info", expect.objectContaining({ body: JSON.stringify({ type: "metaAndAssetCtxs" }) }));
});
it("rejects missing, malformed, infinite or nonpositive prices", async () => {
    for (const response of [{}, [{}, []], [payload()[0], [{ markPx: "Infinity", oraclePx: "1", funding: "0" }]]]) {
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => response })));
        await expect(quotes(new AbortController().signal)).rejects.toThrow();
    }
});
it("propagates HTTP errors instead of treating failure as zero", async () => { vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 429 }))); await expect(quotes(new AbortController().signal)).rejects.toThrow("429"); });
