import type { PoolMarket } from "./types";
const cache = new Map<string, {
    at: number;
    data: PoolMarket[];
}>();
const pending = new Map<string, Promise<PoolMarket[]>>();
const n = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const chains = new Set(["ethereum", "arbitrum", "base", "optimism", "polygon", "bsc", "solana"]);
export async function explore(query: string, source: "DexScreener" | "DefiLlama", signal: AbortSignal): Promise<PoolMarket[]> {
    const key = source === "DefiLlama" ? source : source + query.trim(), old = cache.get(key);
    if (old && Date.now() - old.at < 300000)
        return old.data;
    const existing = pending.get(key);
    if (existing)
        return existing;
    const task = (async () => {
        const url = source === "DexScreener" ? `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query.trim())}` : "https://yields.llama.fi/pools";
        const r = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) });
        if (!r.ok)
            throw Error(`Fonte respondeu HTTP ${r.status}`);
        const j = await r.json();
        let rows: PoolMarket[] = [];
        if (source === "DexScreener") {
            if (!Array.isArray(j.pairs))
                throw Error("Resposta inválida do Explorer");
            rows = j.pairs.filter((p: any) => chains.has(p.chainId) && ["uniswap", "orca", "raydium"].includes(p.dexId)).map((p: any) => ({ id: `${p.chainId}:${p.dexId}:${p.pairAddress}`, pool: p.pairAddress, network: p.chainId, protocol: p.dexId + (Array.isArray(p.labels) ? " " + p.labels.join(" ") : ""), pair: `${p.baseToken?.symbol ?? "?"}/${p.quoteToken?.symbol ?? "?"}`, tvl: n(p.liquidity?.usd), volume24: n(p.volume?.h24), volume7: null, apy: null, feeTier: null, created: n(p.pairCreatedAt), url: p.chainId==="solana"&&typeof p.pairAddress==="string"?`https://dexscreener.com/solana/${p.pairAddress}`:typeof p.url === "string" && p.url.startsWith("https://dexscreener.com/") ? p.url : null, source, at: Date.now(), risks: [] }));
        }
        else {
            if (!Array.isArray(j.data))
                throw Error("Resposta inválida do agregador");
            const nets: Record<string, string> = { Ethereum: "ethereum", Arbitrum: "arbitrum", Base: "base", Optimism: "optimism", Polygon: "polygon", BSC: "bsc", Solana: "solana" };
            rows = j.data.filter((p: any) => nets[p.chain] && ["uniswap-v2", "uniswap-v3", "uniswap-v4", "orca-dex", "raydium-amm", "raydium-clmm", "raydium-cp"].includes(p.project)).map((p: any) => ({ id: `llama:${p.pool}`, pool: null, network: nets[p.chain]!, protocol: p.project, pair: p.symbol, tvl: n(p.tvlUsd), volume24: n(p.volumeUsd1d), volume7: n(p.volumeUsd7d), apy: n(p.apy), feeTier: typeof p.poolMeta === "string" ? p.poolMeta : null, created: null, url: null, source, at: Date.now(), risks: [] }));
        }
        for (const p of rows) {
            p.risks = [...(p.tvl == null ? ["TVL desconhecido"] : p.tvl < 100000 ? ["TVL abaixo de US$100 mil"] : []), ...(p.created && Date.now() - p.created < 7 * 86400000 ? ["Pool com menos de 7 dias"] : []), ...(p.apy != null && p.apy > 100 ? ["APY acima de 100%; verificar incentivos"] : []), "Risco de contratos e tokens não auditado pelo terminal"];
        }
        const data = [...new Map(rows.map(p => [p.id, p])).values()];
        cache.set(key, { at: Date.now(), data });
        return data;
    })();
    pending.set(key, task);
    try {
        return await task;
    }
    finally {
        pending.delete(key);
    }
}
