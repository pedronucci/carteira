/**
 * Inteligência de mercado com fonte e horário: derivativos do BTC na Hyperliquid (funding, open interest, volume,
 * prêmio) e dominância do BTC (CoinGecko). Sem fonte confiável e gratuita, o dado aparece como indisponível
 * (fluxos de ETF, liquidações agregadas, calendário macro) — nunca inventado.
 */
export interface Sourced<T> { value: T; at: number; source: string }
export interface MarketIntel {
  funding1h: Sourced<number> | null; fundingAnnual: number | null; openInterestBtc: Sourced<number> | null; openInterestUsd: number | null;
  volume24hUsd: Sourced<number> | null; premium: Sourced<number> | null; markPx: number | null; oraclePx: number | null;
  btcDominance: Sourced<number> | null; errors: string[];
}

let cache: { at: number; v: MarketIntel } | null = null;
const subs = new Set<() => void>();
export const subscribeIntel = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const marketIntel = () => cache?.v ?? null;

export async function refreshMarketIntel(force = false): Promise<MarketIntel> {
  if (!force && cache && Date.now() - cache.at < 120e3) return cache.v;
  const errors: string[] = [];
  const prev = cache?.v;
  const v: MarketIntel = { funding1h: null, fundingAnnual: null, openInterestBtc: null, openInterestUsd: null, volume24hUsd: null, premium: null, markPx: null, oraclePx: null, btcDominance: prev?.btcDominance ?? null, errors };
  try {
    const r = await fetch("https://api.hyperliquid.xyz/info", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "metaAndAssetCtxs" }) });
    if (!r.ok) throw new Error(`Hyperliquid respondeu ${r.status}`);
    const [meta, ctxs] = (await r.json()) as [{ universe: { name: string }[] }, { funding: string; openInterest: string; dayNtlVlm: string; premium: string | null; markPx: string; oraclePx: string }[]];
    const i = meta.universe.findIndex((u) => u.name === "BTC");
    const c = ctxs[i];
    if (!c) throw new Error("BTC não encontrado na Hyperliquid");
    const at = Date.now(), src = "Hyperliquid (perpétuo BTC)";
    const f = Number(c.funding), oi = Number(c.openInterest), mark = Number(c.markPx);
    Object.assign(v, { funding1h: { value: f, at, source: src }, fundingAnnual: f * 24 * 365, openInterestBtc: { value: oi, at, source: src }, openInterestUsd: oi * mark,
      volume24hUsd: { value: Number(c.dayNtlVlm), at, source: src }, premium: c.premium != null ? { value: Number(c.premium), at, source: src } : null, markPx: mark, oraclePx: Number(c.oraclePx) });
  } catch (e) { errors.push((e as Error).message); }
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/global");
    if (!r.ok) throw new Error(r.status === 429 ? "CoinGecko limitou as consultas" : `CoinGecko respondeu ${r.status}`);
    const j = (await r.json()) as { data: { market_cap_percentage: { btc: number }; updated_at: number } };
    v.btcDominance = { value: j.data.market_cap_percentage.btc / 100, at: j.data.updated_at * 1000, source: "CoinGecko" };
  } catch (e) { errors.push(`Dominância: ${(e as Error).message}`); }
  cache = { at: Date.now(), v };
  subs.forEach((s) => s());
  return v;
}
