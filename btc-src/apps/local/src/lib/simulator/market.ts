import type { Tier } from "./engine";
export interface Quote {
    mark: number;
    oracle: number;
    funding: number;
    maxLeverage: number;
    tiers: Tier[];
    at: number;
}
export async function quotes(signal: AbortSignal): Promise<Record<string, Quote>> {
    const res = await fetch("https://api.hyperliquid.xyz/info", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "metaAndAssetCtxs" }), signal });
    if (!res.ok)
        throw Error(`Hyperliquid HTTP ${res.status}`);
    const payload = await res.json();
    if (!Array.isArray(payload) || !Array.isArray(payload[0]?.universe) || !Array.isArray(payload[1]))
        throw Error("Resposta de mercado inválida.");
    const [meta, ctx] = payload;
    const out: Record<string, Quote> = {};
    for (const coin of ["BTC", "SOL", "HYPE"]) {
        const n = meta.universe.findIndex((u: {
            name: string;
        }) => u.name === coin);
        if (n < 0)
            continue;
        const u = meta.universe[n], c = ctx[n];
        const id = u.marginTableId;
        let tiers: Tier[] = [];
        const table = meta.marginTables?.find((t: [
            number,
            unknown
        ]) => t[0] === id)?.[1];
        if (table?.marginTiers)
            tiers = table.marginTiers.map((t: {
                lowerBound: string;
                maxLeverage: number;
            }) => ({ lower: Number(t.lowerBound), maxLeverage: t.maxLeverage }));
        else if (Number.isInteger(id) && id > 0 && id < 50)
            tiers = [{ lower: 0, maxLeverage: id }];
        const mark = Number(c?.markPx), oracle = Number(c?.oraclePx), funding = Number(c?.funding);
        if (!(Number.isFinite(mark) && mark > 0 && Number.isFinite(oracle) && oracle > 0 && c?.funding != null && Number.isFinite(funding)))
            throw Error("Cotação inválida da Hyperliquid.");
        out[coin] = { mark, oracle, funding, maxLeverage: u.maxLeverage, tiers, at: Date.now() };
    }
    return out;
}
