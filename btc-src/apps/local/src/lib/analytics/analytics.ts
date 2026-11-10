/**
 * Performance Analytics — cálculos puros (sem tela). Metodologia (também na página):
 *  - Resultado operacional líquido = P&L realizado (closedPnl dos fills) − taxas + funding, sempre dentro do período.
 *    closedPnl não inclui taxas nem funding; cada um é somado UMA vez (sem dupla dedução).
 *  - P&L não realizado = posição aberta agora (não tem série histórica; não entra no resultado operacional do período).
 *  - Patrimônio, margem e notional ficam separados: notional nunca soma ao patrimônio; a equity já contém o P&L aberto.
 *  - Rentabilidade = TWR (ajustada por aportes/retiradas). Sem retratos suficientes: "Dados insuficientes".
 */
import { portfolioReturns, type Flow, type PAccount, type PSnapshot } from "@bst/domain";
import type { Trade } from "../perps/trades";

export type RangeKind = "1" | "7" | "30" | "90" | "ytd" | "all" | "custom";
export interface Range { from: number | null; to: number }
export interface FundingRow { time: number; coin: string; usd: number }

export function resolveRange(kind: RangeKind, now: number, custom?: { from: number; to: number }): Range {
  if (kind === "all") return { from: null, to: now };
  if (kind === "custom") return custom ? { from: Math.min(custom.from, custom.to), to: Math.max(custom.from, custom.to) } : { from: null, to: now };
  if (kind === "ytd") return { from: new Date(new Date(now).getFullYear(), 0, 1).getTime(), to: now };
  return { from: now - Number(kind) * 86400e3, to: now };
}
const inR = (t: number, r: Range) => (r.from == null || t >= r.from) && t <= r.to;

export interface CoinPerf {
  coin: string; dirs: ("LONG" | "SHORT")[]; realized: number; funding: number; fees: number; net: number;
  /** posição aberta agora (não é do período) */ unrealized: number | null;
  /** parcela do resultado líquido total (pode passar de 100% ou ser negativa); null se o total é zero */ contribution: number | null;
  /** parcela do notional aberto agora; null sem posições */ exposureShare: number | null;
  trades: number; inherited: boolean;
}
/** Resultado por instrumento (descoberto dinamicamente a partir dos fills, funding e posições). */
export function perfByCoin(trades: Trade[], funding: FundingRow[], positions: { coin: string; upnl: number; notional: number }[], range: Range): CoinPerf[] {
  const m = new Map<string, CoinPerf>();
  const get = (coin: string) => { let x = m.get(coin); if (!x) { x = { coin, dirs: [], realized: 0, funding: 0, fees: 0, net: 0, unrealized: null, contribution: null, exposureShare: null, trades: 0, inherited: false }; m.set(coin, x); } return x; };
  for (const t of trades) {
    const x = get(t.coin);
    let touched = false;
    for (const f of t.fills) if (inR(f.time, range)) { x.realized += f.closedPnl; x.fees += f.fee; touched = true; }
    if (touched) { x.trades += 1; if (!x.dirs.includes(t.dir)) x.dirs.push(t.dir); if (t.inherited) x.inherited = true; }
  }
  for (const f of funding) if (inR(f.time, range)) get(f.coin).funding += f.usd;
  const gross = positions.reduce((a, p) => a + Math.abs(p.notional), 0);
  for (const p of positions) { const x = get(p.coin); x.unrealized = (x.unrealized ?? 0) + p.upnl; x.exposureShare = gross > 0 ? (x.exposureShare ?? 0) + Math.abs(p.notional) / gross : null; }
  const rows = [...m.values()];
  for (const x of rows) x.net = x.realized - x.fees + x.funding;
  const total = rows.reduce((a, x) => a + x.net, 0);
  for (const x of rows) x.contribution = Math.abs(total) > 1e-9 ? x.net / total : null;
  return rows.filter((x) => x.trades || x.funding || x.fees || x.realized || x.unrealized != null);
}

export interface Waterfall { gross: number; funding: number; fees: number; others: number; net: number }
/** Decomposição: resultado bruto de trading → funding → taxas → líquido. Taxas e funding entram uma única vez. */
export function waterfall(rows: Pick<CoinPerf, "realized" | "funding" | "fees">[]): Waterfall {
  const gross = rows.reduce((a, r) => a + r.realized, 0), funding = rows.reduce((a, r) => a + r.funding, 0), fees = rows.reduce((a, r) => a + r.fees, 0);
  return { gross, funding, fees: -fees, others: 0, net: gross + funding - fees };
}

export type SortKey = "net" | "loss" | "fees" | "funding" | "contribution";
export function sortPerf(rows: CoinPerf[], key: SortKey): CoinPerf[] {
  const v: Record<SortKey, (r: CoinPerf) => number> = { net: (r) => -r.net, loss: (r) => r.net, fees: (r) => -r.fees, funding: (r) => r.funding, contribution: (r) => -Math.abs(r.contribution ?? 0) };
  return [...rows].sort((a, b) => v[key](a) - v[key](b));
}

export interface PerpStats {
  closed: number; open: number; wins: number; losses: number; winRate: number | null; avgWin: number | null; avgLoss: number | null;
  profitFactor: number | null; expectancy: number | null; largestWin: number | null; largestLoss: number | null;
  byDir: Record<"LONG" | "SHORT", { n: number; net: number }>; curve: { t: number; cum: number }[]; inheritedClosed: number;
}
/** Estatísticas por operação (fills agrupados em operações; parciais não contam como operações). Operação entra pelo fechamento. */
export function perpStats(trades: Trade[], range: Range): PerpStats {
  const closed = trades.filter((t) => !t.open && t.closedAt != null && inR(t.closedAt, range)).sort((a, b) => a.closedAt! - b.closedAt!);
  const wins = closed.filter((t) => t.netPnl > 1e-9), losses = closed.filter((t) => t.netPnl < -1e-9);
  const gp = wins.reduce((a, t) => a + t.netPnl, 0), gl = -losses.reduce((a, t) => a + t.netPnl, 0);
  const byDir = { LONG: { n: 0, net: 0 }, SHORT: { n: 0, net: 0 } };
  let cum = 0; const curve: PerpStats["curve"] = [];
  for (const t of closed) { byDir[t.dir].n++; byDir[t.dir].net += t.netPnl; cum += t.netPnl; curve.push({ t: t.closedAt!, cum }); }
  const decided = wins.length + losses.length;
  return {
    closed: closed.length, open: trades.filter((t) => t.open).length, wins: wins.length, losses: losses.length,
    winRate: decided ? wins.length / decided : null, avgWin: wins.length ? gp / wins.length : null, avgLoss: losses.length ? gl / losses.length : null,
    profitFactor: gl > 1e-9 ? gp / gl : null, expectancy: closed.length ? cum / closed.length : null,
    largestWin: wins.length ? Math.max(...wins.map((t) => t.netPnl)) : null, largestLoss: losses.length ? Math.min(...losses.map((t) => t.netPnl)) : null,
    byDir, curve, inheritedClosed: closed.filter((t) => t.inherited).length,
  };
}

/**
 * Política explícita de atribuição na conta compartilhada: a Estratégia BTC/USDC fica só com os fills/funding do `coin`
 * (BTC) a partir do início do ciclo; o resto da conta é "Outros perpétuos". A equity não é dividida.
 */
export function splitStrategy(trades: Trade[], funding: FundingRow[], startT: number | null, range: Range, coin = "BTC") {
  const sum = (isStrat: boolean) => {
    let realized = 0, fees = 0, fund = 0;
    for (const t of trades) for (const f of t.fills) {
      if (!inR(f.time, range)) continue;
      if ((t.coin === coin && startT != null && f.time >= startT) === isStrat) { realized += f.closedPnl; fees += f.fee; }
    }
    for (const f of funding) { if (!inR(f.time, range)) continue; if ((f.coin === coin && startT != null && f.time >= startT) === isStrat) fund += f.usd; }
    return { realized, fees, funding: fund, net: realized - fees + fund };
  };
  return { strategy: sum(true), others: sum(false) };
}

export interface DrawdownResult { max: number | null; current: number | null; series: { t: number; dd: number; result: number }[]; incomplete: boolean }
/** Drawdown do índice TWR (descontados aportes/retiradas) dentro do período. */
export function drawdown(snaps: PSnapshot[], flows: Flow[], range: Range): DrawdownResult {
  const sel = snaps.filter((s) => inR(s.t, range)).sort((a, b) => a.t - b.t);
  if (sel.length < 2) return { max: null, current: null, series: [], incomplete: true };
  const rets = portfolioReturns(sel, flows);
  let peak = 1, max = 0;
  const series = rets.map((p) => { peak = Math.max(peak, p.index); const dd = peak > 0 ? 1 - p.index / peak : 0; max = Math.max(max, dd); return { t: p.t, dd, result: p.resultUsd }; });
  return { max, current: series.at(-1)!.dd, series, incomplete: false };
}

export type Origin = "Hyperliquid" | "OKX" | "Carteiras spot" | "Outras";
export const originOf = (a: Pick<PAccount, "kind">): Origin | null =>
  a.kind === "hyperliquid" ? "Hyperliquid" : a.kind === "okx" ? "OKX" : a.kind === "evm" || a.kind === "bitcoin" || a.kind === "solana" ? "Carteiras spot" : a.kind === "strategy" ? null : "Outras";

export interface RangeEvo { resultUsd: number | null; twr: number | null; rawChangeUsd: number | null; flowsUsd: number; fromT: number | null; toT: number | null; incomplete: boolean; availableFrom: number | null; points: { t: number; usd: number; result: number; index: number }[] }
const sumAcc = (s: PSnapshot) => Object.values(s.byAccount).reduce((x, v) => x + v, 0);
/** Evolução num intervalo qualquer (inclui o último retrato anterior ao início como âncora). Poucos retratos → incompleto, sem estimar. */
export function rangeEvolution(snaps: PSnapshot[], flows: Flow[], range: Range): RangeEvo {
  const all = [...snaps].sort((a, b) => a.t - b.t);
  const from = range.from ?? -Infinity;
  let anchor = -1;
  for (let i = 0; i < all.length; i++) if (all[i]!.t <= from) anchor = i;
  const sel = all.filter((s, i) => s.t <= range.to && (anchor >= 0 ? i >= anchor : s.t >= from));
  if (sel.length < 2) return { resultUsd: null, twr: null, rawChangeUsd: null, flowsUsd: 0, fromT: sel[0]?.t ?? null, toT: sel.at(-1)?.t ?? null, incomplete: true, availableFrom: all[0]?.t ?? null, points: [] };
  const rets = portfolioReturns(sel, flows);
  const first = sel[0]!, last = sel.at(-1)!;
  const win = range.from == null ? null : range.to - range.from;
  const gap = win != null && anchor < 0 && first.t - from > win * 0.15;
  return {
    resultUsd: rets.at(-1)!.resultUsd, twr: rets.at(-1)!.index - 1, rawChangeUsd: sumAcc(last) - sumAcc(first),
    flowsUsd: flows.filter((f) => f.t > first.t && f.t <= last.t).reduce((x, f) => x + f.usd, 0),
    fromT: first.t, toT: last.t, incomplete: gap, availableFrom: gap ? first.t : null,
    points: rets.map((p) => ({ t: p.t, usd: p.valueUsd, result: p.resultUsd, index: p.index })),
  };
}

export interface OriginPerf { origin: Origin; accounts: number; value: number | null; resultUsd: number | null; twr: number | null; flowsUsd: number; incomplete: boolean; from: number | null }
/** Resultado por origem (somente fontes com contas). A conta da estratégia fica fora (é analisada à parte). */
export function byOrigin(snaps: PSnapshot[], flows: Flow[], accounts: Pick<PAccount, "id" | "kind">[], range: Range): OriginPerf[] {
  const groups = new Map<Origin, string[]>();
  for (const a of accounts) { const o = originOf(a); if (o) groups.set(o, [...(groups.get(o) ?? []), a.id]); }
  return [...groups].map(([origin, ids]) => {
    const set = new Set(ids);
    const sub = snaps.map((s) => ({ ...s, byAccount: Object.fromEntries(Object.entries(s.byAccount).filter(([id]) => set.has(id))) })).filter((s) => Object.keys(s.byAccount).length > 0);
    const e = rangeEvolution(sub, flows.filter((f) => set.has(f.accountId)), range);
    const last = sub.at(-1);
    return { origin, accounts: ids.length, value: last ? sumAcc(last) : null, resultUsd: e.resultUsd, twr: e.twr, flowsUsd: e.flowsUsd, incomplete: e.incomplete, from: e.fromT };
  });
}

export interface Hodl { resultUsd: number; invested: number; pct: number }
/**
 * Benchmark "tudo em X": mesmo capital inicial e MESMOS aportes/retiradas (convertidos ao preço do retrato anterior ao fluxo).
 * Resultado em USD, comparável ao resultado do portfólio. Sem preço gravado em algum ponto → null (dados insuficientes).
 */
export function hodlResult(snaps: PSnapshot[], flows: Flow[], sym: string, range: Range): Hodl | null {
  const price = (s: PSnapshot) => (sym === "BTC" ? s.btcUsd : s.px?.[sym]) ?? null;
  const sel = snaps.filter((s) => inR(s.t, range)).sort((a, b) => a.t - b.t);
  if (sel.length < 2) return null;
  const first = sel[0]!, last = sel.at(-1)!;
  const p0 = price(first), p1 = price(last);
  const v0 = Object.values(first.byAccount).reduce((x, v) => x + v, 0);
  if (!p0 || !p1) return null;
  let units = v0 / p0, invested = v0, flowsSum = 0;
  for (const f of flows.filter((x) => x.t > first.t && x.t <= last.t)) {
    const ref = [...sel].reverse().find((s) => s.t <= f.t); // retrato imediatamente anterior (preço velho demais não é usado)
    const px = ref ? price(ref) : null;
    if (!px) return null;
    units += f.usd / px; invested += f.usd; flowsSum += f.usd;
  }
  void flowsSum;
  const end = units * p1;
  return { resultUsd: end - invested, invested, pct: invested > 0 ? end / invested - 1 : 0 };
}
