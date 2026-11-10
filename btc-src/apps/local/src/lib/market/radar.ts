/**
 * Market Intelligence: classificação, relevância, impacto no portfólio e correlação. TUDO por regras determinísticas
 * (sem IA, sem sentimento inventado). Funções puras: nada aqui acessa rede ou armazenamento.
 */
import type { Flow, PSnapshot } from "@bst/domain";
import { rangeEvolution } from "../analytics/analytics";

export interface NewsItem { id: string; title: string; url: string; source: string; publishedAt: number; summary: string }
export interface CalEvent { id: string; title: string; start: number; source: string; kind: string; country: string; importance: "alta" | "media" | "baixa" }
export type Theme = "macro" | "regulacao" | "etf" | "seguranca" | "derivativos" | "stablecoins" | "mercado";
export const THEMES: { value: Theme; label: string }[] = [
  { value: "macro", label: "Macro" }, { value: "regulacao", label: "Regulação" }, { value: "etf", label: "ETFs" }, { value: "seguranca", label: "Segurança" },
  { value: "derivativos", label: "Derivativos" }, { value: "stablecoins", label: "Stablecoins" }, { value: "mercado", label: "Mercado" },
];
export const ASSETS = ["BTC", "ETH", "SOL", "HYPE", "USDC"] as const;

const ASSET_RE: Record<string, RegExp> = {
  BTC: /\b(bitcoin|btc)\b/i, ETH: /\b(ethereum|ether|eth)\b/i, SOL: /\b(solana|sol)\b/i, HYPE: /\b(hyperliquid|hype)\b/i, USDC: /\b(usdc|circle)\b/i,
};
const THEME_RE: Record<Theme, RegExp> = {
  macro: /\b(fed|fomc|juros|infla[cç][aã]o|cpi|ipca|payroll|pce|pib|selic|copom|treasur(y|ies)|d[oó]lar|recess[aã]o|tarifa|banco central)\b/i,
  regulacao: /\b(sec|cvm|regula[cç][aã]o|regulament|projeto de lei|proib|aprova[cç][aã]o|tribut|imposto|receita federal|congresso|senado)\w*/i,
  etf: /\b(etf|etfs|blackrock|fidelity|grayscale|ibit)\b/i,
  seguranca: /\b(hack|hacker|ataque|invas[aã]o|exploit|vazamento|roubo|golpe|fraude|drenad|bridge)\w*/i,
  derivativos: /\b(liquida[cç][oõ]es|liquidad|funding|open interest|interesse em aberto|futuros|alavanc|opç[oõ]es|perp[eé]tuo)\w*/i,
  stablecoins: /\b(stablecoin|stablecoins|usdt|usdc|tether|circle)\b/i,
  mercado: /\b(recorde|m[aá]xima|m[ií]nima|dispara|despenca|desaba|sobe|cai|rompe|suporte|resist[eê]ncia)\b/i,
};

export interface Tagged extends NewsItem { assets: string[]; themes: Theme[] }
export function classify(n: NewsItem): Tagged {
  // "Mercado Bitcoin" é uma corretora, não notícia sobre o ativo BTC
  const t = `${n.title} ${n.summary}`.replace(/mercado bitcoin/gi, "MB");
  return { ...n, assets: ASSETS.filter((a) => ASSET_RE[a]!.test(t)), themes: THEMES.map((x) => x.value).filter((th) => THEME_RE[th].test(t)) };
}

export interface Held {
  equity: number | null;
  /** alavancagem efetiva dos perpétuos (nocional / equity da Hyperliquid), como no app; se ausente, calcula sobre o patrimônio */
  effLeverage?: number | null;
  /** valor em US$ por ativo no portfólio consolidado (à vista) */
  spot: Record<string, number>;
  perps: { coin: string; dir: "LONG" | "SHORT"; notional: number; leverage: number; liqDistance: number | null }[];
}
export const NO_HELD: Held = { equity: null, spot: {}, perps: [] };
export const isHeld = (h: Held, asset: string) => (h.spot[asset] ?? 0) > 0.5 || h.perps.some((p) => p.coin === asset);

/** Relevância 0–100: o que é meu (ativo em carteira ou perpétuo aberto) + tema + recência. Sem ativo nem tema = 0 (fora do escopo). */
export function relevance(n: Tagged, h: Held, now: number): { score: number; level: "alta" | "media" | "baixa" } {
  if (!n.assets.length && !n.themes.length) return { score: 0, level: "baixa" };
  let s = 0;
  for (const a of n.assets) s += isHeld(h, a) ? 35 : a === "BTC" ? 15 : 8;
  s = Math.min(s, 60);
  const th = new Set(n.themes);
  if (th.has("macro")) s += 18;
  if (th.has("seguranca") && n.assets.some((a) => isHeld(h, a))) s += 25;
  if (th.has("regulacao")) s += 12;
  if (th.has("etf")) s += 8;
  if (th.has("derivativos") && h.perps.length) s += 10;
  const age = now - n.publishedAt;
  s += age <= 2 * 3600e3 ? 15 : age <= 6 * 3600e3 ? 10 : age <= 24 * 3600e3 ? 5 : age > 72 * 3600e3 ? -20 : 0;
  const score = Math.max(0, Math.min(100, Math.round(s)));
  return { score, level: score >= 60 ? "alta" : score >= 35 ? "media" : "baixa" };
}

export interface ImpactCard { id: string; rule: string; severity: "alta" | "media" | "info"; title: string; body: string; assets: string[]; refs: string[]; at: number }
const pct = (v: number) => `${(v * 100).toFixed(1).replace(".", ",")}%`;
const usd = (v: number) => `US$ ${Math.round(v).toLocaleString("pt-BR")}`;
const hrs = (ms: number) => (ms < 3600e3 * 2 ? `${Math.max(1, Math.round(ms / 60e3))} min` : `${Math.round(ms / 3600e3)} h`);

/** Cartões de impacto. Cada um nasce de uma regra explícita e cita o que o disparou. Sem previsão de preço. */
export function impactCards(h: Held, events: CalEvent[], news: Tagged[], now: number): ImpactCard[] {
  const out: ImpactCard[] = [];
  const notional = h.perps.reduce((x, p) => x + p.notional, 0);
  const lev = h.effLeverage ?? (h.equity && h.equity > 0 ? notional / h.equity : null);
  const worst = h.perps.map((p) => p.liqDistance).filter((x): x is number => x != null).sort((a, b) => a - b)[0] ?? null;

  // R1: evento macro de alta importância nas próximas 48 h com posições perpétuas abertas
  for (const e of events.filter((e) => e.importance === "alta" && e.start > now && e.start - now <= 48 * 3600e3)) {
    if (!h.perps.length) continue;
    const near = worst != null && worst < 0.15;
    out.push({
      id: `R1:${e.id}`, rule: "R1 evento macro + perpétuos", severity: near || (lev != null && lev >= 2) ? "alta" : "media", at: e.start, assets: [...new Set(h.perps.map((p) => p.coin))], refs: [e.id],
      title: `${e.title} em ${hrs(e.start - now)}`,
      body: `Você tem ${h.perps.length} posição(ões) perpétua(s) abertas${lev != null ? ` (alavancagem efetiva ${lev.toFixed(1).replace(".", ",")}x)` : ""}${worst != null ? `; a liquidação mais próxima está a ${pct(worst)} do preço` : ""}. Eventos desse tipo costumam aumentar a volatilidade.`,
    });
  }
  // R2: várias notícias recentes sobre um ativo que você tem, com sua direção
  const day = news.filter((n) => now - n.publishedAt <= 24 * 3600e3);
  for (const a of ASSETS) {
    if (!isHeld(h, a)) continue;
    const list = day.filter((n) => n.assets.includes(a));
    if (list.length < 3) continue;
    const perp = h.perps.find((p) => p.coin === a);
    const spot = h.spot[a] ?? 0;
    out.push({
      id: `R2:${a}`, rule: "R2 volume de notícias em ativo em carteira", severity: list.length >= 6 ? "alta" : "media", at: Math.max(...list.map((n) => n.publishedAt)), assets: [a], refs: list.slice(0, 5).map((n) => n.id),
      title: `${list.length} notícias sobre ${a} em 24 h`,
      body: `Sua exposição: ${[spot > 0.5 ? `${usd(spot)} à vista` : null, perp ? `${perp.dir === "LONG" ? "long" : "short"} perpétuo de ${usd(perp.notional)}` : null].filter(Boolean).join(" + ")}. Leia as manchetes antes de ajustar posições.`,
    });
  }
  // R3: segurança / hack envolvendo ativo em carteira
  for (const n of day.filter((n) => n.themes.includes("seguranca") && n.assets.some((a) => isHeld(h, a)))) {
    out.push({ id: `R3:${n.id}`, rule: "R3 segurança em ativo em carteira", severity: "alta", at: n.publishedAt, assets: n.assets.filter((a) => isHeld(h, a)), refs: [n.id], title: "Notícia de segurança envolvendo ativo seu", body: n.title });
  }
  // R4: regulação ou ETF envolvendo BTC (núcleo da estratégia)
  for (const n of day.filter((n) => n.assets.includes("BTC") && (n.themes.includes("regulacao") || n.themes.includes("etf")))) {
    out.push({ id: `R4:${n.id}`, rule: "R4 regulação/ETF em BTC", severity: "info", at: n.publishedAt, assets: ["BTC"], refs: [n.id], title: n.themes.includes("etf") ? "ETF de Bitcoin em pauta" : "Regulação envolvendo Bitcoin", body: n.title });
  }
  // R5: risco já elevado + dia agitado (liquidação < 10%)
  if (worst != null && worst < 0.1 && day.filter((n) => n.themes.includes("derivativos") || n.themes.includes("mercado")).length >= 3) {
    out.push({ id: "R5:liq", rule: "R5 liquidação próxima + mercado agitado", severity: "alta", at: now, assets: [...new Set(h.perps.map((p) => p.coin))], refs: [], title: "Liquidação próxima em dia agitado", body: `A posição mais próxima da liquidação está a ${pct(worst)} do preço e as manchetes de 24 h falam de movimento forte/derivativos.` });
  }
  const rank = { alta: 0, media: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || b.at - a.at);
}

export const WINDOWS = [{ k: "1h", ms: 3600e3 }, { k: "4h", ms: 4 * 3600e3 }, { k: "24h", ms: 24 * 3600e3 }, { k: "7d", ms: 7 * 86400e3 }] as const;
export interface WindowResult { k: string; portfolioPct: number | null; btcPct: number | null }
const NA = null;
/**
 * Correlação evento↔performance: variação do portfólio (TWR, sem aportes/retiradas) e do BTC nas janelas após o evento.
 * Usa só retratos reais; sem retrato próximo do início/fim (tolerância de metade da janela, mínimo 1 h) → null. Correlação não é causalidade.
 */
export function correlate(t: number, snaps: PSnapshot[], flows: Flow[], now: number): WindowResult[] {
  const all = [...snaps].sort((a, b) => a.t - b.t);
  const near = (x: number, tol: number) => all.reduce<PSnapshot | null>((best, s) => (Math.abs(s.t - x) <= tol && (!best || Math.abs(s.t - x) < Math.abs(best.t - x)) ? s : best), null);
  return WINDOWS.map(({ k, ms }) => {
    if (t + ms > now) return { k, portfolioPct: NA, btcPct: NA };
    const tol = Math.max(3600e3, ms / 2);
    const a = near(t, tol), b = near(t + ms, tol);
    if (!a || !b || a.t >= b.t) return { k, portfolioPct: NA, btcPct: NA };
    const evo = rangeEvolution(snaps, flows, { from: a.t, to: b.t });
    return { k, portfolioPct: evo.incomplete ? NA : evo.twr, btcPct: a.btcUsd && b.btcUsd ? b.btcUsd / a.btcUsd - 1 : NA };
  });
}
