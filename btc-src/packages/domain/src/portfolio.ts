/**
 * Motor de consolidação patrimonial (puro: sem rede nem armazenamento).
 *
 * Regras que impedem contagem dupla:
 * - cada saldo é identificado por (conta, ativo exato); o mesmo par aparece uma vez só (a leitura mais recente vence);
 * - contas de exchange com derivativos entram pelo PATRIMÔNIO LÍQUIDO oficial (holding kind = "equity"):
 *   margem e P&L aberto já estão dentro dele; posições são listadas à parte e nunca somadas;
 * - o valor nocional de derivativos nunca entra no patrimônio;
 * - ativos são agrupados pelo ativo econômico (econ) só quando a identidade é conhecida: símbolos de exchange
 *   do registro abaixo ou contratos verificados; token desconhecido fica no próprio grupo (não é somado a outro
 *   só por ter o mesmo símbolo);
 * - transferência entre contas próprias não é aporte nem retirada (ver classifyFlows);
 * - saldo sem preço aparece como "sem preço" e não entra no total (nunca vale zero em silêncio, nunca é inventado).
 */
import { ASSETS } from "./assets";

export type AccountKind = "strategy" | "manual" | "csv" | "hyperliquid" | "okx" | "evm" | "bitcoin" | "solana";

export interface PAccount {
  id: string;
  kind: AccountKind;
  name: string;
  /** instituição ou custódia exibida (ex.: "OKX", "Rabby", "Carteira Bitcoin") */
  institution: string;
  /** rede principal (ex.: "bitcoin", "solana", "evm:42161", "hyperliquid", "okx") */
  network?: string;
  /** endereços públicos desta conta (para reconhecer transferências entre contas próprias) */
  addresses?: string[];
  /** configuração do conector (endereços observados, chaves públicas estendidas, redes) — nunca segredos */
  config?: Record<string, unknown>;
  createdAt: number;
}

export interface PHolding {
  accountId: string;
  /** identidade exata do ativo: "bitcoin:native", "evm:1:0xa0b8…", "okx:BTC", "manual:BTC" … */
  assetKey: string;
  /** ativo econômico para agrupar (ex.: "BTC", "USDC"); token desconhecido usa o próprio assetKey */
  econ: string;
  symbol: string;
  name?: string;
  network: string;
  qty: string;
  available?: string;
  locked?: string;
  /** preço informado pela fonte (USD), quando houver */
  priceUsd?: number | null;
  /** valor informado pela fonte (USD): obrigatório para kind "equity" (patrimônio líquido de conta com derivativos) */
  valueUsd?: number | null;
  kind: "spot" | "equity" | "earn";
  source: "sync" | "manual";
  /** representação de outro ativo (ex.: WBTC, cbBTC, UBTC representam BTC) */
  wrapped?: boolean;
  /** custo total de aquisição em USD, quando conhecido (null/ausente = desconhecido, nunca zero) */
  costUsd?: number | null;
  at: number;
  note?: string;
}

/** Posição de derivativo: só informativa. Nunca somada ao patrimônio. */
export interface PPosition {
  accountId: string; instrument: string; dir: "LONG" | "SHORT"; size: number; entry: number | null; mark: number | null;
  notional: number | null; margin: number | null; upnl: number | null; liq: number | null; leverage: number | null;
  funding?: number | null; fees?: number | null; at: number;
}

// ───────── identidade dos ativos ─────────

/** Símbolos de exchange com identidade econômica conhecida. Outros símbolos de exchange ficam no próprio grupo. */
const EXCHANGE_ECON: Record<string, { econ: string; wrapped?: boolean }> = {
  BTC: { econ: "BTC" }, UBTC: { econ: "BTC", wrapped: true },
  ETH: { econ: "ETH" }, UETH: { econ: "ETH", wrapped: true },
  SOL: { econ: "SOL" }, USOL: { econ: "SOL", wrapped: true },
  HYPE: { econ: "HYPE" }, ZEC: { econ: "ZEC" }, BNB: { econ: "BNB" },
  USDC: { econ: "USDC" }, USDT: { econ: "USDT" }, USDT0: { econ: "USDT", wrapped: true }, DAI: { econ: "DAI" },
};
const ASSET_CLASS_ECON: Record<string, string> = { BTC: "BTC", ETH: "ETH", BNB: "BNB" };

/** Ativo econômico de um saldo de exchange (pelo símbolo da própria exchange). */
export function exchangeEcon(symbol: string): { econ: string; wrapped: boolean; known: boolean } {
  const e = EXCHANGE_ECON[symbol.toUpperCase()];
  return e ? { econ: e.econ, wrapped: Boolean(e.wrapped), known: true } : { econ: symbol.toUpperCase(), wrapped: false, known: false };
}

/** Ativo econômico de um token EVM: só contratos do registro verificado são agrupados. */
export function evmEcon(chainId: number, address: string): { econ: string; symbol: string; wrapped: boolean; known: boolean } {
  const a = ASSETS.find((x) => x.chainId === chainId && x.address === address.toLowerCase());
  if (!a) return { econ: `evm:${chainId}:${address.toLowerCase()}`, symbol: "?", wrapped: false, known: false };
  const econ = a.class === "STABLE_USD" ? a.symbol.replace(/\.e$/, "") : ASSET_CLASS_ECON[a.class] ?? a.symbol;
  return { econ, symbol: a.symbol, wrapped: address !== "native" && a.symbol !== econ, known: true };
}

// ───────── consolidação ─────────

export type PriceBook = Record<string, { usd: number; change24h?: number | null; at?: number; source?: string } | undefined>;

export interface SourceLine {
  accountId: string; account: string; institution: string; network: string; assetKey: string; symbol: string;
  qty: number; available: number | null; locked: number | null; valueUsd: number | null; wrapped: boolean; kind: PHolding["kind"]; source: PHolding["source"];
}
export interface EconLine {
  econ: string; symbol: string; qty: number; priceUsd: number | null; valueUsd: number | null; share: number | null;
  change24h: number | null; costUsd: number | null; pnlUsd: number | null; avgCostUsd: number | null; sources: SourceLine[];
}
export interface Consolidated {
  totalUsd: number; btcEquivalent: number | null; unpriced: SourceLine[];
  assets: EconLine[];
  byAccount: { accountId: string; name: string; institution: string; valueUsd: number; share: number }[];
  byInstitution: { key: string; valueUsd: number; share: number }[];
  byNetwork: { key: string; valueUsd: number; share: number }[];
  /** BTC efetivamente possuído (spot nativo + representações conhecidas), por local de custódia */
  btcHeld: { total: number; byInstitution: { key: string; qty: number }[] };
}

/** Mantém um saldo por (conta, ativo exato): o mais recente. */
export function dedupeHoldings(h: PHolding[]): PHolding[] {
  const m = new Map<string, PHolding>();
  for (const x of h) { const k = `${x.accountId}|${x.assetKey}`; const cur = m.get(k); if (!cur || x.at >= cur.at) m.set(k, x); }
  return [...m.values()];
}

export function consolidate(accounts: PAccount[], holdings: PHolding[], prices: PriceBook): Consolidated {
  const acc = new Map(accounts.map((a) => [a.id, a]));
  const rows = dedupeHoldings(holdings).filter((h) => acc.has(h.accountId) && (Number(h.qty) !== 0 || h.kind === "equity"));
  const lines: (SourceLine & { econ: string; costUsd: number | null })[] = rows.map((h) => {
    const a = acc.get(h.accountId)!;
    const qty = Number(h.qty);
    const px = h.kind === "equity" ? null : h.priceUsd ?? prices[h.econ]?.usd ?? null;
    const value = h.valueUsd != null ? h.valueUsd : px != null ? qty * px : null;
    return {
      accountId: a.id, account: a.name, institution: a.institution, network: h.network, assetKey: h.assetKey, symbol: h.symbol, econ: h.econ,
      qty, available: h.available != null ? Number(h.available) : null, locked: h.locked != null ? Number(h.locked) : null,
      valueUsd: value, wrapped: Boolean(h.wrapped), kind: h.kind, source: h.source, costUsd: h.costUsd ?? null,
    };
  });
  const priced = lines.filter((l) => l.valueUsd != null);
  const total = priced.reduce((x, l) => x + l.valueUsd!, 0);
  const share = (v: number) => (total > 0 ? v / total : 0);

  const groups = new Map<string, typeof lines>();
  for (const l of lines) groups.set(l.econ, [...(groups.get(l.econ) ?? []), l]);
  const assets: EconLine[] = [...groups.entries()].map(([econ, ls]) => {
    const value = ls.every((l) => l.valueUsd == null) ? null : ls.reduce((x, l) => x + (l.valueUsd ?? 0), 0);
    const qty = ls.filter((l) => l.kind !== "equity").reduce((x, l) => x + l.qty, 0) + ls.filter((l) => l.kind === "equity").reduce((x, l) => x + (l.valueUsd ?? 0), 0);
    // custo só é conhecido se TODOS os saldos do grupo têm custo (senão seria uma média enganosa)
    const allCost = ls.every((l) => l.costUsd != null);
    const cost = allCost ? ls.reduce((x, l) => x + l.costUsd!, 0) : null;
    const p = prices[econ];
    return {
      econ, symbol: econ.includes(":") ? ls[0]!.symbol : econ, qty, priceUsd: p?.usd ?? null, valueUsd: value, share: value != null ? share(value) : null,
      change24h: p?.change24h ?? null, costUsd: cost, pnlUsd: cost != null && value != null ? value - cost : null, avgCostUsd: cost != null && qty > 0 ? cost / qty : null,
      sources: ls.map(({ econ: _e, costUsd: _c, ...rest }) => rest),
    };
  }).sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));

  const sumBy = (key: (l: (typeof lines)[number]) => string) => {
    const m = new Map<string, number>();
    for (const l of priced) m.set(key(l), (m.get(key(l)) ?? 0) + l.valueUsd!);
    return [...m.entries()].map(([k, v]) => ({ key: k, valueUsd: v, share: share(v) })).sort((a, b) => b.valueUsd - a.valueUsd);
  };
  const byAccount = sumBy((l) => l.accountId).map((x) => ({ accountId: x.key, name: acc.get(x.key)!.name, institution: acc.get(x.key)!.institution, valueUsd: x.valueUsd, share: x.share }));
  const btcLines = lines.filter((l) => l.econ === "BTC" && l.kind !== "equity");
  const btcInst = new Map<string, number>();
  for (const l of btcLines) btcInst.set(l.institution, (btcInst.get(l.institution) ?? 0) + l.qty);
  const btcPx = prices.BTC?.usd ?? null;
  return {
    totalUsd: total, btcEquivalent: btcPx ? total / btcPx : null, unpriced: lines.filter((l) => l.valueUsd == null),
    assets, byAccount, byInstitution: sumBy((l) => l.institution), byNetwork: sumBy((l) => l.network),
    btcHeld: { total: btcLines.reduce((x, l) => x + l.qty, 0), byInstitution: [...btcInst.entries()].map(([key, qty]) => ({ key, qty })).sort((a, b) => b.qty - a.qty) },
  };
}

// ───────── movimentações: externas × internas ─────────

export type FlowKind = "deposit" | "withdraw" | "transfer_in" | "transfer_out" | "buy" | "sell" | "swap" | "fee" | "funding" | "reward" | "adjust" | "unknown";
export interface PEvent {
  /** identificador estável (da fonte): evita duplicar a mesma movimentação em sincronizações repetidas */
  id: string; accountId: string; t: number; kind: FlowKind; econ: string; qty: number;
  /** valor em USD no instante, quando conhecido */
  usd?: number | null; txid?: string | null; counterparty?: string | null; note?: string;
}
export type FlowClass = "external" | "internal" | "pending" | "result";
export interface ClassifiedEvent extends PEvent { cls: FlowClass; matchedWith?: string; reason: string }

const ENTRY: FlowKind[] = ["deposit", "transfer_in"];
const EXIT: FlowKind[] = ["withdraw", "transfer_out"];

/**
 * Classifica movimentações:
 * - "internal": entre contas próprias (contraparte é endereço próprio, mesmo txid nos dois lados ou par
 *   saída→entrada do mesmo ativo, com quantidade compatível e no máximo 6 h de diferença);
 * - "external": aporte ou retirada de verdade (depósito/saque sem par interno);
 * - "pending": transferência sem par e sem informação suficiente (aparece para o usuário classificar);
 * - "result": compra, venda, swap, taxa, funding, recompensa (não são fluxos de capital).
 */
export function classifyFlows(events: PEvent[], accounts: PAccount[], opts: { maxGapMs?: number; maxFeePct?: number } = {}): ClassifiedEvent[] {
  const gap = opts.maxGapMs ?? 6 * 3600e3, feePct = opts.maxFeePct ?? 0.01;
  const own = new Set(accounts.flatMap((a) => (a.addresses ?? []).map((x) => x.toLowerCase())));
  const uniq = [...new Map(events.map((e) => [e.id, e])).values()].sort((a, b) => a.t - b.t);
  const out = new Map<string, ClassifiedEvent>();
  const used = new Set<string>();
  for (const e of uniq) {
    if (!ENTRY.includes(e.kind) && !EXIT.includes(e.kind)) out.set(e.id, { ...e, cls: e.kind === "adjust" ? "internal" : e.kind === "unknown" ? "pending" : "result", reason: e.kind === "adjust" ? "ajuste de cadastro" : e.kind === "unknown" ? "tipo desconhecido" : "resultado" });
  }
  const moves = uniq.filter((e) => ENTRY.includes(e.kind) || EXIT.includes(e.kind));
  // 1) contraparte é um endereço próprio
  for (const e of moves) if (e.counterparty && own.has(e.counterparty.toLowerCase())) { out.set(e.id, { ...e, cls: "internal", reason: "contraparte é carteira própria" }); used.add(e.id); }
  // 2) mesmo txid em duas contas
  for (const a of moves) {
    if (used.has(a.id) || !a.txid || !EXIT.includes(a.kind)) continue;
    const b = moves.find((x) => !used.has(x.id) && x.txid === a.txid && ENTRY.includes(x.kind) && x.accountId !== a.accountId);
    if (b) { out.set(a.id, { ...a, cls: "internal", matchedWith: b.id, reason: "mesmo txid" }); out.set(b.id, { ...b, cls: "internal", matchedWith: a.id, reason: "mesmo txid" }); used.add(a.id); used.add(b.id); }
  }
  // 3) par saída → entrada do mesmo ativo, quantidade compatível (taxa de até feePct), dentro da janela
  for (const a of moves) {
    if (used.has(a.id) || !EXIT.includes(a.kind)) continue;
    const cands = moves.filter((b) => !used.has(b.id) && ENTRY.includes(b.kind) && b.accountId !== a.accountId && b.econ === a.econ
      && b.t >= a.t - 10 * 60e3 && b.t - a.t <= gap && b.qty <= a.qty * (1 + 1e-9) && b.qty >= a.qty * (1 - feePct));
    const b = cands.sort((x, y) => Math.abs(x.t - a.t) - Math.abs(y.t - a.t))[0];
    if (b) { out.set(a.id, { ...a, cls: "internal", matchedWith: b.id, reason: "par de transferência entre contas próprias" }); out.set(b.id, { ...b, cls: "internal", matchedWith: a.id, reason: "par de transferência entre contas próprias" }); used.add(a.id); used.add(b.id); }
  }
  // 4) o que sobrou
  for (const e of moves) {
    if (used.has(e.id)) continue;
    if (e.kind === "deposit" || e.kind === "withdraw") out.set(e.id, { ...e, cls: "external", reason: e.kind === "deposit" ? "aporte externo" : "retirada externa" });
    else out.set(e.id, { ...e, cls: "pending", reason: "transferência sem par: confirme se é entre contas próprias" });
  }
  return uniq.map((e) => out.get(e.id)!);
}

// ───────── evolução e rentabilidade ─────────

/** Retrato periódico do portfólio: valor por conta (USD). */
export interface PSnapshot {
  t: number; byAccount: Record<string, number>;
  /** campos da versão 2 (opcionais: retratos antigos só têm `byAccount`) */
  v?: 2; total?: number; byAsset?: Record<string, number>; btcUsd?: number | null; usdBrl?: number | null; btcEq?: number | null;
  perps?: PSnapPerps; recon?: string; src?: string;
  /** preços USD de referência (ETH, SOL, HYPE…) para benchmarks; BTC fica em `btcUsd` */
  px?: Record<string, number>;
  /** 1 = conta unificada da Hyperliquid já sem a dupla contagem do P&L aberto (retratos antigos são corrigidos uma vez) */
  uf?: 1;
}
export interface PSnapPerps { upnl: number; notional: number; margin: number; count: number; positions: { id: string; coin: string; dir: "LONG" | "SHORT"; upnl: number; notional: number }[] }

/**
 * Rentabilidade ponderada no tempo do portfólio.
 * Em cada intervalo entre dois retratos, só entram as contas presentes nos dois (conta nova não vira lucro) e os
 * fluxos externos (aportes/retiradas e ajustes de cadastro) de cada conta saem do resultado.
 */
export function portfolioReturns(snaps: PSnapshot[], flows: { t: number; accountId: string; usd: number }[]) {
  const s = [...snaps].sort((a, b) => a.t - b.t);
  const points: { t: number; valueUsd: number; index: number; resultUsd: number }[] = [];
  let idx = 1, acc = 0;
  for (let i = 0; i < s.length; i++) {
    const cur = s[i]!;
    const total = Object.values(cur.byAccount).reduce((x, v) => x + v, 0);
    if (i > 0) {
      const prev = s[i - 1]!;
      let num = 0, den = 0;
      for (const [id, v1] of Object.entries(cur.byAccount)) {
        const v0 = prev.byAccount[id];
        if (v0 == null) continue;
        const fl = flows.filter((f) => f.accountId === id && f.t > prev.t && f.t <= cur.t);
        const F = fl.reduce((x, f) => x + f.usd, 0);
        const W = fl.reduce((x, f) => x + f.usd * (cur.t - f.t) / Math.max(1, cur.t - prev.t), 0);
        num += v1 - v0 - F; den += v0 + W;
      }
      if (den > 1e-9) idx *= 1 + num / den;
      acc += num;
    }
    points.push({ t: cur.t, valueUsd: total, index: idx, resultUsd: acc });
  }
  return points;
}
/** Rentabilidade e resultado desde `ms` atrás (null = desde o primeiro retrato). */
export function returnSince(points: ReturnType<typeof portfolioReturns>, ms: number | null) {
  if (points.length < 2) return null;
  const end = points[points.length - 1]!;
  const from = ms == null ? points[0]! : [...points].reverse().find((p) => p.t <= end.t - ms) ?? null;
  if (!from || from === end) return null;
  return { pct: end.index / from.index - 1, resultUsd: end.resultUsd - from.resultUsd, fromT: from.t };
}
