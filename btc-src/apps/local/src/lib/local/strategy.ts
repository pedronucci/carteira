/**
 * Motor de CICLOS DA ESTRATÉGIA (puro: sem armazenamento, sem rede — testável).
 *
 * Modelo de conta de perpétuo, em dólar:
 *   patrimônio = colateral + tamanho × (preço − base)
 * - colateral muda com resultado realizado, taxas, funding e fluxos externos (aportes/retiradas);
 * - base = preço médio da posição *para a estratégia*. Uma posição herdada no início do ciclo
 *   entra com base = preço de mercado do início, então só o resultado posterior é atribuído ao ciclo.
 *   A entrada oficial da corretora continua disponível para exibição e reconciliação.
 *
 * Resultado da estratégia = patrimônio final − patrimônio inicial − aportes + retiradas.
 * Aportes nunca contam como lucro; retiradas nunca contam como prejuízo.
 */

export const DAY = 86400;

// ───────── entidades ─────────

export type AccountLink = { kind: "hyperliquid"; address: string; includeArb?: boolean } | { kind: "manual" };

export interface SnapPosition { coin: string; size: string; mark: string; officialEntry?: string; upnl?: string; marginUsed?: string; liqPx?: string }
export interface SnapBalance { coin: string; where: string; total: string; usd: string | null }

/** Retrato da conta no início do ciclo. */
export interface StartSnapshot {
  at: number; // ms UTC
  source: "live" | "reconstructed" | "manual";
  equityUsd: string;
  btcUsd: string; // preço de referência do BTC no início
  balances: SnapBalance[];
  positions: SnapPosition[];
  marginUsed?: string;
  accountPnlUsd?: string; // PnL acumulado da conta (Hyperliquid) no início
  note?: string;
}

export interface StrategyCycle {
  id: string;
  name: string;
  startAt: number; // ms UTC
  tz: string; // fuso usado para exibir/editar o início
  endAt?: number; // ms UTC
  status: "active" | "closed";
  accounts: AccountLink[];
  snapshot: StartSnapshot | null;
  endEquityUsd?: string; // patrimônio oficial no encerramento (quando conhecido)
  createdAt: number;
}

// ───────── eventos normalizados ─────────

export type SEv =
  | { t: number; k: "trade"; side: "B" | "A"; px: number; sz: number; fee: number; key: string; src: "hl" | "manual"; ref?: string; label?: string }
  | { t: number; k: "funding"; usd: number; key: string; src: "hl" | "manual"; ref?: string }
  | { t: number; k: "flow"; usd: number; key: string; src: "hl" | "manual"; label: string; ref?: string };

const RANK = { flow: 0, funding: 1, trade: 2 } as const;
export const sortEvents = (e: SEv[]) => [...e].sort((a, b) => a.t - b.t || RANK[a.k] - RANK[b.k] || a.key.localeCompare(b.key));

/** Remove duplicatas pela chave (sincronizações repetidas). */
export function dedupe<T extends { key: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true)));
}

// ───────── replay ─────────

export interface Trip {
  openT: number; closeT: number | null; inherited: boolean;
  entry: number; // base média da estratégia
  exit: number | null; // preço médio de saída
  maxSize: number; realized: number; fees: number; funding: number;
  pnl: number; // realizado − taxas + funding (+ aberto, se em andamento)
  equityAtOpen: number; pnlPct: number | null; btcMove: number | null;
}

export interface SPoint { ts: number; equity: number; netFlow: number; contrib: number; hodl: number | null; price: number; inBtc: boolean; size: number }

export interface ReplayInput {
  startT: number; // ms
  endT: number; // ms (agora ou fim do ciclo)
  equity0: number;
  size0: number; // BTC herdado
  px0: number; // preço de referência no início (base da posição herdada)
  events: SEv[]; // já filtrados para (startT, endT]
  closeAt: (daySec: number) => number | null; // fechamento diário do BTC (fim do dia, UTC)
  pxEnd: number; // preço no fim (agora: cotação atual)
}

export interface ReplayOut {
  points: SPoint[];
  equity: number; // modelo no fim
  size: number; basis: number; collateral: number;
  flowsIn: number; flowsOut: number; fees: number; funding: number; realized: number; unrealized: number;
  contrib: number; // patrimônio inicial + aportes − retiradas
  result: number; // equity − contrib
  hodlUnits: number; hodl: number | null;
  trips: Trip[]; shortIgnored: boolean;
}

export function replay(inp: ReplayInput): ReplayOut {
  const ev = sortEvents(inp.events);
  let col = inp.equity0, size = inp.size0, basis = inp.size0 > 0 ? inp.px0 : 0;
  let flowsIn = 0, flowsOut = 0, fees = 0, funding = 0, realized = 0, shortIgnored = false;
  let hodlUnits = inp.px0 > 0 ? inp.equity0 / inp.px0 : 0;
  const trips: Trip[] = [];
  let trip: Trip | null = null;
  let exitN = 0, exitS = 0;
  const eqAt = (px: number) => col + size * (px - basis);
  if (size > 0) trip = { openT: inp.startT, closeT: null, inherited: true, entry: basis, exit: null, maxSize: size, realized: 0, fees: 0, funding: 0, pnl: 0, equityAtOpen: inp.equity0, pnlPct: null, btcMove: null };

  const apply = (e: SEv, pxHint: number) => {
    if (e.k === "flow") {
      col += e.usd;
      if (e.usd >= 0) flowsIn += e.usd; else flowsOut -= e.usd;
      const p = pxHint > 0 ? pxHint : 0;
      if (p > 0) hodlUnits += e.usd / p;
      return;
    }
    if (e.k === "funding") {
      col += e.usd; funding += e.usd;
      if (trip) trip.funding += e.usd;
      return;
    }
    // trade
    col -= e.fee; fees += e.fee;
    if (e.side === "B") {
      if (size <= 1e-12) { size = 0; basis = 0; trip = { openT: e.t, closeT: null, inherited: false, entry: 0, exit: null, maxSize: 0, realized: 0, fees: 0, funding: 0, pnl: 0, equityAtOpen: eqAt(e.px), pnlPct: null, btcMove: null }; exitN = 0; exitS = 0; }
      basis = (size * basis + e.sz * e.px) / (size + e.sz);
      size += e.sz;
      if (trip) { trip.entry = basis; trip.maxSize = Math.max(trip.maxSize, size); trip.fees += e.fee; }
    } else {
      const q = Math.min(e.sz, size);
      if (e.sz - q > 1e-9) shortIgnored = true;
      if (q <= 0) return;
      const r = (e.px - basis) * q;
      col += r; realized += r; size -= q;
      exitN += e.px * q; exitS += q;
      if (trip) { trip.realized += r; trip.fees += e.fee; }
      if (size <= 1e-9) {
        size = 0;
        if (trip) {
          trip.closeT = e.t; trip.exit = exitS ? exitN / exitS : null;
          trip.pnl = trip.realized - trip.fees + trip.funding;
          trip.pnlPct = trip.equityAtOpen > 0 ? trip.pnl / trip.equityAtOpen : null;
          trip.btcMove = trip.exit && trip.entry ? trip.exit / trip.entry - 1 : null;
          trips.push(trip); trip = null;
        }
        basis = 0;
      }
    }
  };

  // série diária (dias UTC); o último ponto usa o preço do fim
  const points: SPoint[] = [];
  const d0 = Math.floor(inp.startT / 1000 / DAY) * DAY;
  const dEnd = Math.floor(inp.endT / 1000 / DAY) * DAY;
  let i = 0, contrib = inp.equity0, lastPx = inp.px0;
  for (let day = d0; day <= dEnd; day += DAY) {
    const dayEndMs = (day + DAY) * 1000;
    let netFlow = 0;
    while (i < ev.length && ev[i]!.t < dayEndMs && ev[i]!.t <= inp.endT) {
      const e = ev[i++]!;
      const hint = e.k === "trade" ? e.px : inp.closeAt(Math.floor(e.t / 1000 / DAY) * DAY) ?? lastPx;
      apply(e, hint);
      if (e.k === "flow") { netFlow += e.usd; contrib += e.usd; }
    }
    const px = day === dEnd ? inp.pxEnd : inp.closeAt(day) ?? lastPx;
    if (!px) continue;
    lastPx = px;
    points.push({ ts: day, equity: eqAt(px), netFlow: points.length ? netFlow : 0, contrib, hodl: hodlUnits > 0 ? hodlUnits * px : null, price: px, inBtc: size > 0, size });
  }
  while (i < ev.length && ev[i]!.t <= inp.endT) { const e = ev[i++]!; apply(e, e.k === "trade" ? e.px : lastPx); if (e.k === "flow") contrib += e.usd; }

  const equity = eqAt(inp.pxEnd);
  if (trip) {
    const unreal = size * (inp.pxEnd - basis);
    trip.pnl = trip.realized - trip.fees + trip.funding + unreal;
    trip.pnlPct = trip.equityAtOpen > 0 ? trip.pnl / trip.equityAtOpen : null;
    trip.btcMove = trip.entry ? inp.pxEnd / trip.entry - 1 : null;
    trips.push(trip);
  }
  return {
    points, equity, size, basis, collateral: col, flowsIn, flowsOut, fees, funding, realized,
    unrealized: size * (inp.pxEnd - basis), contrib, result: equity - contrib,
    hodlUnits, hodl: hodlUnits > 0 ? hodlUnits * inp.pxEnd : null, trips, shortIgnored,
  };
}

/** Eventos dentro da janela do ciclo: depois do início e até o fim. */
export const windowEvents = (ev: SEv[], startT: number, endT: number, inclusiveStart = false) =>
  ev.filter((e) => (inclusiveStart ? e.t >= startT : e.t > startT) && e.t <= endT);

/** Estado da posição em um instante, a partir das execuções (tamanho e entrada oficial: média das compras). */
export function positionAt(trades: Extract<SEv, { k: "trade" }>[], t: number, size0 = 0, entry0 = 0) {
  let size = size0, entry = entry0;
  for (const e of sortEvents(trades) as Extract<SEv, { k: "trade" }>[]) {
    if (e.t > t) break;
    if (e.side === "B") { entry = (size * entry + e.sz * e.px) / (size + e.sz); size += e.sz; }
    else { size = Math.max(0, size - e.sz); if (size <= 1e-9) { size = 0; entry = 0; } }
  }
  return { size, entry };
}

/** Retorno ponderado no tempo da série. */
export function twr(points: SPoint[]): number | null {
  if (points.length < 2) return null;
  let g = 1;
  for (let i = 1; i < points.length; i++) { const a = points[i - 1]!, b = points[i]!; if (a.equity > 0) g *= (b.equity - b.netFlow) / a.equity; }
  return g - 1;
}
export function maxDrawdown(points: SPoint[]): number {
  let idx = 1, peak = 1, mdd = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    if (a.equity > 0) idx *= (b.equity - b.netFlow) / a.equity;
    peak = Math.max(peak, idx); mdd = Math.max(mdd, 1 - idx / peak);
  }
  return mdd;
}

// ───────── fuso horário ─────────

/** Offset (ms) do fuso em um instante UTC. */
function tzOffset(utcMs: number, tz: string): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour! % 24, +p.minute!, +p.second!);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}
/** "2026-11-05" + "00:00" no fuso → ms UTC. */
export function zonedToUtc(date: string, time: string, tz: string): number {
  const [y, m, dd] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = (time || "00:00").split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, dd, hh, mm);
  let t = guess - tzOffset(guess, tz);
  t = guess - tzOffset(t, tz); // ajuste em viradas de horário de verão
  return t;
}
/** ms UTC → { date, time } no fuso. */
export function utcToZoned(ms: number, tz: string): { date: string; time: string } {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
export const fmtZoned = (ms: number, tz: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
