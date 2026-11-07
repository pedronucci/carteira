/**
 * Motor da estratégia binária USDC ↔ BTC (long em perpétuo), em dólar.
 *
 * Valor de um ciclo aberto, com capital C, alavancagem L, entrada E e preço P:
 *   C + C·L·(P/E − 1) − taxas + funding
 * Liquidação estimada (long, margem isolada, manutenção m):
 *   P_liq = (tam·E − C') / (tam·(1 − m)),  tam = C·L/E,  C' = C − taxas + funding
 * O preço de liquidação informado pela plataforma sempre prevalece.
 */
import {
  atr, bollinger, classifyScenario, d, DEFAULT_SCENARIO_RULES, last, realizedVol, rsi, sma,
  supportResistance, trendStructure, ZERO, type Decimal,
} from "@bst/domain";
import { getStore, type Add, type Cycle, type Store } from "./store";
import { closeUsdAt, prices, usdBrlAt } from "./prices";
import { hlState, type HlLive } from "./hl";
import { DAY as DAYS, maxDrawdown, replay, twr, windowEvents, type SEv, type SPoint, type StrategyCycle, type Trip } from "./strategy";

const DAY = DAYS;
export const tsOf = (iso: string) => Math.floor(new Date(iso.length === 10 ? `${iso}T12:00` : iso).getTime() / 1000);
export class NoPriceError extends Error {}

export interface Now { btcUsd: Decimal; usdBrl: Decimal | null; source: string; at: number | null; stale: boolean }

export function nowPrices(s: Store = getStore()): Now {
  const sp = prices().spot;
  const btc = sp?.btcUsd ? d(sp.btcUsd) : s.settings.manualBtcUsd ? d(s.settings.manualBtcUsd) : null;
  if (!btc) throw new NoPriceError("Sem cotação do BTC. Conecte-se à internet ou informe uma cotação manual em Ajustes.");
  const fx = sp?.usdBrl ? d(sp.usdBrl) : s.settings.manualUsdBrl ? d(s.settings.manualUsdBrl) : null;
  return { btcUsd: btc, usdBrl: fx, source: sp?.btcUsd ? sp.source : "cotação manual", at: sp?.at ?? null, stale: Boolean(sp?.stale || !sp?.btcUsd) };
}

// ───────── matemática do ciclo ─────────

export const cycleSizeBtc = (c: Cycle) => (c.sizeBtc ? d(c.sizeBtc) : d(c.capital).mul(c.leverage).div(c.entryPx));
export function cycleValue(c: Cycle, px: Decimal): Decimal {
  const v = d(c.capital).plus(cycleSizeBtc(c).mul(px.minus(c.entryPx))).minus(c.feesOpen || 0).plus(c.funding || 0);
  return v.gt(0) ? v : ZERO;
}

/** Soma um aumento à posição (altera o objeto): preço médio ponderado, como na corretora. */
export function foldAdd(c: Cycle, a: Add): Cycle {
  const s0 = cycleSizeBtc(c), n0 = s0.mul(c.entryPx);
  const sz = d(a.capital).mul(a.leverage).div(a.px);
  const C = d(c.capital).plus(a.capital), s = s0.plus(sz), n = n0.plus(sz.mul(a.px));
  c.capital = C.toFixed();
  c.sizeBtc = s.toFixed(12);
  c.entryPx = n.div(s).toFixed(2);
  c.leverage = n.div(C).toDecimalPlaces(2).toString();
  c.feesOpen = d(c.feesOpen || 0).plus(a.fees || 0).toFixed();
  c.liqPx = a.liqPx || undefined; // a liquidação anterior deixa de valer
  return c;
}
/** Ciclo com todos os aumentos já somados (cópia). */
export function withAdds(c: Cycle): Cycle {
  const out = { ...c };
  for (const a of [...(c.adds ?? [])].sort((x, y) => x.at.localeCompare(y.at))) foldAdd(out, a);
  return out;
}

export function estimateLiq(c: Cycle, mRate: string): Decimal | null {
  if (c.liqPx) return d(c.liqPx);
  const size = cycleSizeBtc(c), E = d(c.entryPx);
  const Cp = d(c.capital).minus(c.feesOpen || 0).plus(c.funding || 0);
  const px = size.mul(E).minus(Cp).div(size.mul(d(1).minus(mRate)));
  return px.gt(0) ? px : null; // 1x sem dívida: não há liquidação
}

/** Simulação de uma entrada (usada no formulário). */
export function simulateEntry(a: { capital: string; leverage: string; entryPx: string; feesOpen?: string; stopPx?: string; targetPx?: string; liqPx?: string }, mRate: string) {
  const c: Cycle = { id: "sim", openedAt: "", entryPx: a.entryPx, leverage: a.leverage, capital: a.capital, feesOpen: a.feesOpen, liqPx: a.liqPx };
  const E = d(a.entryPx), C = d(a.capital);
  const liq = estimateLiq(c, mRate);
  const at = (px: string | undefined) => (px && Number(px) > 0 ? cycleValue(c, d(px)).minus(C) : null);
  const loss = at(a.stopPx), gain = at(a.targetPx);
  return {
    sizeBtc: cycleSizeBtc(c), notional: C.mul(a.leverage), liq, liqDist: liq ? E.minus(liq).div(E) : null,
    lossAtStop: loss, gainAtTarget: gain, rr: loss && gain && loss.lt(0) ? gain.div(loss.abs()) : null,
    shocks: [-0.05, -0.1, -0.2, -0.3].map((s) => ({ shock: s, value: cycleValue(c, E.mul(1 + s)), liquidated: liq ? E.mul(1 + s).lte(liq) : false })),
  };
}

// ───────── conta: eventos normalizados ─────────

export interface Account {
  kind: "hl" | "manual";
  events: SEv[]; // histórico completo da conta (auditoria), ordenado
  firstT: number | null;
  live: HlLive | null; liveFresh: boolean; includeArb: boolean;
  otherCoins: string[]; truncated: boolean; address: string | null;
}

/** Lançamentos manuais → eventos: entrada = compra, aumento = compra, saída = venda; funding na saída. */
export function manualEvents(s: Store): SEv[] {
  const ev: SEv[] = [];
  for (const f of s.flows) ev.push({ t: tsOf(f.date) * 1000, k: "flow", usd: Number(f.amount) * (f.kind === "IN" ? 1 : -1), key: `m|${f.id}`, src: "manual", label: f.note ?? (f.kind === "IN" ? "Aporte" : "Retirada"), ref: f.id });
  for (const c of s.cycles) {
    const t0 = tsOf(c.openedAt) * 1000;
    ev.push({ t: t0, k: "trade", side: "B", px: Number(c.entryPx), sz: cycleSizeBtc(c).toNumber(), fee: Number(c.feesOpen || 0), key: `m|${c.id}|open`, src: "manual", ref: c.id, label: "abre long" });
    for (const a of c.adds ?? []) ev.push({ t: Math.max(t0 + 1, tsOf(a.at) * 1000), k: "trade", side: "B", px: Number(a.px), sz: Number(a.capital) * Number(a.leverage) / Number(a.px), fee: Number(a.fees || 0), key: `m|${c.id}|${a.id}`, src: "manual", ref: c.id, label: "aumenta posição" });
    const w = withAdds(c);
    if (c.closedAt && c.exitPx) {
      const t1 = Math.max(t0 + 2, tsOf(c.closedAt) * 1000);
      if (c.funding) ev.push({ t: t1 - 1, k: "funding", usd: Number(c.funding), key: `m|${c.id}|fund`, src: "manual", ref: c.id });
      ev.push({ t: t1, k: "trade", side: "A", px: Number(c.exitPx), sz: cycleSizeBtc(w).toNumber(), fee: Number(c.feesClose || 0), key: `m|${c.id}|close`, src: "manual", ref: c.id, label: "fecha long" });
    } else if (c.funding) ev.push({ t: Date.now() - 1, k: "funding", usd: Number(c.funding), key: `m|${c.id}|fund`, src: "manual", ref: c.id });
  }
  return ev.sort((x, y) => x.t - y.t);
}

export function account(s: Store = getStore()): Account {
  const hl = hlState();
  const addr = s.settings.hl?.address?.toLowerCase() ?? null;
  const includeArb = Boolean(s.settings.hl?.includeArb);
  if (addr && hl.address === addr && hl.history) {
    const h = hl.history;
    const ev: SEv[] = [];
    const other = new Set<string>();
    for (const f of h.fills) {
      if (f.coin !== "BTC") { other.add(f.coin); continue; }
      ev.push({ t: f.time, k: "trade", side: f.side, px: f.px, sz: f.sz, fee: f.fee, key: f.key, src: "hl", label: /Open/.test(f.dir) ? "abre long" : /Close/.test(f.dir) ? "fecha long" : f.dir });
    }
    for (const u of h.funding) if (u.coin === "BTC") ev.push({ t: u.time, k: "funding", usd: u.usd, key: u.key, src: "hl" });
    for (const l of h.ledger) {
      if (l.kind === "INTERNAL") continue;
      if (includeArb && (l.type === "deposit" || l.type === "withdraw")) continue; // carteira somada: movimento interno
      ev.push({ t: l.time, k: "flow", usd: l.kind === "IN" ? l.amount : -l.amount, key: l.key, src: "hl", label: l.label });
    }
    for (const e of manualEvents({ ...s, cycles: [] })) ev.push(e); // aportes externos lançados à mão
    ev.sort((x, y) => x.t - y.t);
    const live = hl.live;
    return { kind: "hl", events: ev, firstT: ev[0]?.t ?? null, live, liveFresh: Boolean(live && Date.now() - live.at < 10 * 60e3), includeArb, otherCoins: [...other], truncated: h.truncated, address: addr };
  }
  const ev = manualEvents(s);
  const first = s.initial ? tsOf(s.initial.date) * 1000 : ev[0]?.t ?? null;
  return { kind: "manual", events: ev, firstT: first, live: null, liveFresh: false, includeArb: false, otherCoins: [], truncated: false, address: null };
}

/** Patrimônio oficial agora (Hyperliquid ao vivo), quando disponível. */
export function officialNow(acc: Account): number | null {
  if (!acc.liveFresh || !acc.live) return null;
  return acc.live.total + (acc.includeArb ? acc.live.arbTotal ?? 0 : 0);
}

// ───────── escopo: ciclo da estratégia ou conta inteira ─────────

export type Scope =
  | { kind: "strategy"; strategy: StrategyCycle; active: boolean }
  | { kind: "account" };

export function activeStrategy(s: Store = getStore()): StrategyCycle | null {
  return s.strategies.find((x) => x.status === "active") ?? null;
}
export function resolveScope(s: Store = getStore(), view: string = s.view): Scope | null {
  if (view === "account") return { kind: "account" };
  const st = view === "active" ? activeStrategy(s) : s.strategies.find((x) => x.id === view) ?? activeStrategy(s);
  if (st) return { kind: "strategy", strategy: st, active: st.status === "active" };
  return null;
}

export interface CPointN { ts: number; equity: number; netFlow: number; contrib: number; hodl: number | null; price: number; inBtc: boolean; btc: number }

export class NeedsSetup extends Error {}

const closeAt = (daySec: number) => closeUsdAt(daySec + DAY - 1);

export function compute(view?: string) {
  const s = getStore();
  const now = nowPrices(s);
  const acc = account(s);
  const scope = resolveScope(s, view);
  if (!scope) throw new NeedsSetup("Configure o ciclo da estratégia.");
  const warnings: string[] = [];
  const nowMs = Date.now();

  let startT: number, endT: number, equity0: number, size0 = 0, px0: number, label: string, snapSource: string;
  let inclusive = false;
  if (scope.kind === "account") {
    startT = acc.firstT ?? nowMs; endT = nowMs;
    equity0 = acc.kind === "manual" && s.initial ? Number(s.initial.usdc) : 0;
    px0 = closeAt(Math.floor(startT / 1000 / DAY) * DAY) ?? now.btcUsd.toNumber();
    inclusive = true; label = acc.kind === "hl" ? "Histórico completo da conta" : "Todos os lançamentos"; snapSource = "conta";
    if (acc.truncated) warnings.push("A Hyperliquid devolve só as execuções mais recentes; o começo do histórico da conta pode estar incompleto.");
  } else {
    const st = scope.strategy;
    if (!st.snapshot) throw new NeedsSetup("Defina o patrimônio inicial do ciclo.");
    startT = st.startAt; endT = st.endAt ?? nowMs;
    equity0 = Number(st.snapshot.equityUsd);
    const pos = st.snapshot.positions.find((p) => p.coin === "BTC");
    size0 = pos ? Number(pos.size) : 0;
    px0 = Number(st.snapshot.btcUsd) || (pos ? Number(pos.mark) : 0) || closeAt(Math.floor(startT / 1000 / DAY) * DAY) || now.btcUsd.toNumber();
    inclusive = acc.kind === "manual"; // lançamentos manuais no instante exato do início pertencem ao ciclo
    label = st.name; snapSource = st.snapshot.source;
    if (st.snapshot.source === "manual") warnings.push("Patrimônio inicial informado à mão (referência manual).");
  }
  const closed = scope.kind === "strategy" && !scope.active;
  const pxEnd = closed ? closeAt(Math.floor(endT / 1000 / DAY) * DAY) ?? now.btcUsd.toNumber() : now.btcUsd.toNumber();
  const events = windowEvents(acc.events, startT, endT, inclusive);
  const r = replay({ startT, endT, equity0, size0, px0, events, closeAt, pxEnd });

  // valor oficial: Hyperliquid ao vivo (ciclo atual / conta) ou o registrado no encerramento
  const official = !closed ? officialNow(acc) : scope.kind === "strategy" && scope.strategy.endEquityUsd ? Number(scope.strategy.endEquityUsd) : null;
  const equityN = official ?? r.equity;
  const reconciliation = official != null ? official - r.equity : null;
  const lp = r.points[r.points.length - 1];
  if (lp && official != null) lp.equity = official;
  const points: CPointN[] = r.points.map((p: SPoint) => ({ ...p, btc: p.price > 0 ? p.equity / p.price : 0 }));
  const result = equityN - r.contrib;

  if (acc.kind === "hl" && acc.live && !acc.liveFresh && !closed) warnings.push("Saldo da Hyperliquid desatualizado: sem conexão nos últimos minutos.");
  if (r.shortIgnored) warnings.push("Há vendas maiores que a posição (short). O app acompanha só posições compradas.");
  if (acc.otherCoins.length) warnings.push(`A conta também opera ${acc.otherCoins.slice(0, 4).join(", ")}. Esses resultados entram no patrimônio oficial, mas não no modelo dos ciclos (veja a reconciliação).`);
  if (reconciliation != null && Math.abs(reconciliation) > Math.max(5, equityN * 0.01)) warnings.push(`O modelo difere do saldo oficial em ${reconciliation.toFixed(2)} USD. O app usa o saldo oficial; confira o patrimônio inicial do ciclo.`);

  // posição aberta
  const openTrip = r.trips.find((t) => t.closeT == null) ?? null;
  const live = !closed && acc.liveFresh ? acc.live : null;
  const livePos = live?.positions.find((p) => p.coin === "BTC" && p.szi > 0) ?? null;
  const manualOpen = acc.kind === "manual" ? s.cycles.find((c) => !c.closedAt) ?? null : null;
  const manualW = manualOpen ? withAdds(manualOpen) : null;
  const mRate = s.settings.maintenanceRate;
  const pxNow = d(pxEnd);
  const current = openTrip && r.size > 0 ? (() => {
    const size = livePos?.szi ?? r.size;
    const notional = size * pxEnd;
    const liq = livePos ? (livePos.liqPx ? d(livePos.liqPx) : null) : manualW ? estimateLiq(manualW, mRate) : null;
    const officialEntry = livePos?.entryPx ?? (manualW ? Number(manualW.entryPx) : r.basis);
    return {
      trip: openTrip, cycle: manualW ?? null, inherited: openTrip.inherited,
      basis: r.basis, officialEntry, sizeBtc: d(size), notional, value: d(equityN), pnl: d(openTrip.pnl),
      pnlPct: openTrip.pnlPct != null ? d(openTrip.pnlPct) : null,
      btcMove: r.basis ? pxNow.div(r.basis).minus(1) : ZERO,
      liq, liqDist: liq ? pxNow.minus(liq).div(pxNow) : null,
      effLeverage: equityN > 0 ? notional / equityN : null, leverageSetting: livePos?.leverage ?? (manualW ? Number(manualW.leverage) : null),
      funding: livePos ? livePos.fundingSinceOpen : openTrip.funding,
      days: Math.max(0, Math.floor((nowMs - openTrip.openT) / 1000 / DAY)),
    };
  })() : null;
  if (current?.liqDist && current.liqDist.lt(s.settings.minLiqDistance)) warnings.unshift(`Preço a ${current.liqDist.mul(100).toFixed(1)}% da liquidação.`);

  // operações encerradas (entrada → saída) dentro do escopo
  const trips = r.trips.filter((t) => t.closeT != null).sort((a, b) => b.closeT! - a.closeT!);
  const wins = trips.filter((t) => t.pnl > 0), losses = trips.filter((t) => t.pnl < 0);
  const gw = wins.reduce((a, t) => a + t.pnl, 0), gl = losses.reduce((a, t) => a - t.pnl, 0);
  const stats = {
    count: trips.length, wins: wins.length, winRate: trips.length ? wins.length / trips.length : null,
    avgWinPct: wins.length ? wins.reduce((a, t) => a + (t.pnlPct ?? 0), 0) / wins.length : null,
    avgLossPct: losses.length ? losses.reduce((a, t) => a + (t.pnlPct ?? 0), 0) / losses.length : null,
    profitFactor: gl > 0 && wins.length ? gw / gl : null, net: gw - gl,
  };
  const lastExit = !current ? trips[0] ?? null : null;
  const sinceExit = lastExit && lastExit.exit ? { t: lastExit.closeT!, px: lastExit.exit, move: pxEnd / lastExit.exit - 1 } : null;

  const y = points.length >= 2 ? points[points.length - 2]! : null;
  const lastPt = points[points.length - 1];
  const dayChange = y && lastPt ? lastPt.equity - y.equity - lastPt.netFlow : null;
  const free = acc.kind === "hl" ? live?.withdrawable ?? null : equityN - (manualW ? cycleValue(manualW, pxNow).toNumber() : 0);

  return {
    s, now, acc, scope, label, snapSource, startT, endT, closed, events,
    equity: d(equityN), equity0, contrib: r.contrib, flowsIn: r.flowsIn, flowsOut: r.flowsOut, result, fees: r.fees, funding: r.funding,
    realized: r.realized, unrealized: r.unrealized, modelEquity: r.equity, official, reconciliation,
    twr: twr(r.points), maxDD: maxDrawdown(r.points), hodl: r.hodl, vsHodl: r.hodl != null ? equityN - r.hodl : null,
    vsHodlPct: r.hodl ? equityN / r.hodl - 1 : null, hodlRet: r.hodl && r.contrib > 0 ? r.hodl / r.contrib - 1 : null,
    state: current ? ("BTC" as const) : ("USDC" as const), current, trips, stats, sinceExit,
    inUsdcSince: !current ? (lastExit?.closeT ?? startT) : null,
    dayChange, dayChangePct: y && y.equity > 0 && dayChange != null ? dayChange / y.equity : null,
    points, warnings, livePos, live, free,
  };
}
export type Snapshot = ReturnType<typeof compute>;
export type { Trip };

/** Estado da conta em um instante (pelo próprio histórico): base para reconstruir o retrato inicial. */
export function accountStateAt(t: number) {
  const s = getStore();
  const acc = account(s);
  const start = acc.firstT;
  if (start == null || t < start) return { equity: acc.kind === "manual" && s.initial ? Number(s.initial.usdc) : 0, size: 0, px: closeAt(Math.floor(t / 1000 / DAY) * DAY) ?? 0, complete: !acc.truncated };
  const equity0 = acc.kind === "manual" && s.initial ? Number(s.initial.usdc) : 0;
  const px0 = closeAt(Math.floor(start / 1000 / DAY) * DAY) ?? nowPrices(s).btcUsd.toNumber();
  const today = Math.floor(Date.now() / 1000 / DAY) * DAY;
  const dayT = Math.floor(t / 1000 / DAY) * DAY;
  const pxT = (dayT >= today ? nowPrices(s).btcUsd.toNumber() : closeAt(dayT)) ?? nowPrices(s).btcUsd.toNumber();
  // estritamente antes do início: o que acontece no instante do início pertence ao novo ciclo
  const r = replay({ startT: start, endT: t - 1, equity0, size0: 0, px0, events: windowEvents(acc.events, start, t - 1, true), closeAt, pxEnd: pxT });
  return { equity: r.equity, size: r.size, px: pxT, complete: !acc.truncated };
}

// ───────── mercado ─────────

export function market() {
  const cd = prices().usd;
  if (cd.length < 30) throw new NoPriceError("Histórico de preços ainda não carregado. Conecte-se à internet e abra o app de novo.");
  const closes = cd.map((k) => k.c);
  const price = closes[closes.length - 1]!;
  const m200 = last(sma(closes, 200));
  const bb = bollinger(closes);
  const a = last(atr(cd, 14));
  const levels = supportResistance(cd.slice(-365), 5, 0.02, 8);
  const fng = prices().fng;
  let lev: number | null = null, liq: number | null = null;
  try { const snap = compute(); lev = snap.current?.effLeverage ?? null; liq = snap.current?.liqDist?.toNumber() ?? null; } catch { /* sem cotação ou sem ciclo */ }
  const rules = { ...DEFAULT_SCENARIO_RULES, ...(getStore().settings.scenarioRules ?? {}) };
  const scenario = classifyScenario({ dailyCandles: cd, fearGreed: fng?.value ?? null, fundingRate8h: null, portfolioLeverage: lev, minLiquidationDistance: liq }, rules);
  const high365 = Math.max(...cd.slice(-365).map((k) => k.h));
  return {
    candles: cd.slice(-400), source: prices().source || "Binance", updatedAt: new Date(cd[cd.length - 1]!.t * 1000).toISOString(),
    scenario, trend: closes.length >= 50 ? trendStructure(closes) : null,
    indicators: [
      { key: "rsi", label: "RSI (14 dias)", value: last(rsi(closes)), fmt: "num" as const, hint: "Abaixo de 30: sobrevendido. Acima de 70: sobrecomprado." },
      { key: "mayer", label: "Preço ÷ média de 200 dias", value: m200 ? price / m200 : null, fmt: "x" as const, hint: "Abaixo de 1: preço sob a média longa." },
      { key: "sma50", label: "Média de 50 dias", value: last(sma(closes, 50)), fmt: "usd" as const },
      { key: "sma200", label: "Média de 200 dias", value: m200, fmt: "usd" as const },
      { key: "dd", label: "Queda desde a máxima de 1 ano", value: high365 ? price / high365 - 1 : null, fmt: "pct" as const },
      { key: "vol", label: "Volatilidade (30 dias, anual)", value: last(realizedVol(closes, 30)), fmt: "pct" as const },
      { key: "atr", label: "Oscilação média diária (ATR 14)", value: a, fmt: "usd" as const },
      { key: "bb", label: "Faixa de Bollinger (20, 2)", value: null, range: [last(bb.lower), last(bb.upper)] as [number | null, number | null], fmt: "range" as const },
      { key: "fng", label: "Fear & Greed", value: fng?.value ?? null, fmt: "num" as const, hint: fng ? `${fng.label} · alternative.me` : "Sem conexão com alternative.me." },
    ],
    zones: a ? {
      buy: levels.filter((l) => l.kind === "SUPPORT").slice(0, 3).map((l) => ({ from: l.price - a * 0.5, to: l.price + a * 0.25, touches: l.touches })),
      sell: levels.filter((l) => l.kind === "RESISTANCE").slice(-3).map((l) => ({ from: l.price - a * 0.25, to: l.price + a * 0.5, touches: l.touches })),
    } : null,
    levels,
  };
}


// ───────── moeda de exibição ─────────

export type Ccy = "USD" | "BRL";
export type CPoint = CPointN;
/** Série convertida para a moeda escolhida, com o câmbio de cada dia (aportes somados no câmbio da data). */
export function inCcy(points: CPointN[], ccy: Ccy, fxNow: number | null): CPointN[] {
  let contrib = 0;
  return points.map((p, i) => {
    const fx = ccy === "BRL" ? usdBrlAt(p.ts + DAY - 1) ?? fxNow ?? 1 : 1;
    contrib = i === 0 ? p.contrib * fx : contrib + p.netFlow * fx;
    return { ...p, equity: p.equity * fx, netFlow: p.netFlow * fx, contrib, hodl: p.hodl != null ? p.hodl * fx : null };
  });
}
/** Retorno ponderado no tempo e resultado em dinheiro desde `days` atrás (null = desde o início). */
export function periodReturn(pts: CPointN[], days: number | null): { pct: number; money: number } | null {
  if (pts.length < 2) return null;
  const end = pts[pts.length - 1]!.ts;
  let i0 = 0;
  if (days != null) {
    const cut = end - days * DAY;
    if (pts[0]!.ts > cut) return null;
    i0 = pts.findIndex((p) => p.ts >= cut);
    if (i0 < 0) return null;
  }
  let g = 1, money = 0;
  for (let i = i0 + 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    if (a.equity > 0) g *= (b.equity - b.netFlow) / a.equity;
    money += b.equity - a.equity - b.netFlow;
  }
  if (days == null) money = pts[pts.length - 1]!.equity - pts[pts.length - 1]!.contrib;
  return { pct: g - 1, money };
}

export function usdBrlOn(iso: string) { return usdBrlAt(tsOf(iso)); }
