/**
 * Linhas e marcadores do gráfico da posição (puro). Três origens, sempre distintas:
 *  - "exchange": ordens e valores informados pela Hyperliquid (entrada, liquidação, TP/SL reais);
 *  - "plan": níveis planejados pelo usuário no app (NÃO são ordens e nunca são enviados);
 *  - "live": preços de referência (mark price e último preço negociado).
 */
import type { ClassifiedOrders } from "./orders";
import type { Exec } from "./exec";

export type LineTone = "entry" | "liq" | "tp" | "sl" | "mark" | "last" | "plan-tp" | "plan-sl" | "plan-entry" | "history-tp" | "history-sl" | "pending";
export interface ChartLine { id: string; price: number; tone: LineTone; title: string; dash: "solid" | "dashed" | "dotted"; width: 1 | 2; source: "exchange" | "plan" | "live" | "history"; label: boolean }

export interface PlannedLevel { id: string; accountId: string; coin: string; kind: "TP" | "SL" | "ENTRY"; price: number; qty: number | null; note?: string; tradeUid?: string | null; createdAt: number }
/** Nível real visto na exchange durante a operação e guardado (continua no gráfico depois que a posição fecha). */
export interface HistoricLevel { oid: number; kind: "TP" | "SL"; price: number; qty: number | null; firstSeen: number; lastSeen: number; active: boolean }

const nf = (n: number, d = 4) => n.toLocaleString("pt-BR", { maximumFractionDigits: d });
export const fmtQty = (q: number | null) => (q == null ? "" : nf(q, q >= 100 ? 2 : 4));
const pct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

export interface LineInput {
  coin: string; dir: "LONG" | "SHORT" | null; entry: number | null; liq: number | null;
  /** mark price (referência de lucro/risco) e último preço negociado: duas linhas diferentes */ mark: number | null; last: number | null;
  orders: ClassifiedOrders | null; planned: PlannedLevel[]; history?: HistoricLevel[];
}
export function buildLines(i: LineInput): ChartLine[] {
  const out: ChartLine[] = [];
  const ref = i.mark ?? i.last;
  if (i.entry != null && i.dir) out.push({ id: "entry", price: i.entry, tone: "entry", title: `${i.dir} · entrada ${nf(i.entry, 4)}`, dash: "solid", width: 2, source: "exchange", label: true });
  if (i.liq != null) {
    const dist = ref ? (i.dir === "SHORT" ? (i.liq - ref) / ref : (ref - i.liq) / ref) : null;
    out.push({ id: "liq", price: i.liq, tone: "liq", title: `LIQ${dist != null ? ` ${pct(-dist)}` : ""}`, dash: "solid", width: 2, source: "exchange", label: true });
  }
  for (const o of i.orders?.tps ?? []) out.push({ id: `tp|${o.oid}`, price: o.price, tone: "tp", title: `${o.label}${o.qty != null ? ` · ${fmtQty(o.qty)}` : ""}${o.wholePosition ? " (posição)" : ""}`, dash: "solid", width: 1, source: "exchange", label: true });
  for (const o of i.orders?.sls ?? []) out.push({ id: `sl|${o.oid}`, price: o.price, tone: "sl", title: `${o.label}${o.qty != null ? ` · ${fmtQty(o.qty)}` : ""}${o.wholePosition ? " (posição)" : ""}`, dash: "solid", width: 1, source: "exchange", label: true });
  for (const p of i.planned) {
    const tone: LineTone = p.kind === "TP" ? "plan-tp" : p.kind === "SL" ? "plan-sl" : "plan-entry";
    out.push({ id: `plan|${p.id}`, price: p.price, tone, title: `${p.kind === "TP" ? "TP" : p.kind === "SL" ? "SL" : "Entrada"} planejado${p.qty != null ? ` · ${fmtQty(p.qty)}` : ""}`, dash: "dashed", width: 1, source: "plan", label: true });
  }
  for (const h of i.history ?? []) if (!h.active) out.push({ id: `hist|${h.oid}`, price: h.price, tone: h.kind === "TP" ? "history-tp" : "history-sl", title: `${h.kind} histórico`, dash: "dotted", width: 1, source: "history", label: false });
  if (i.mark != null) out.push({ id: "mark", price: i.mark, tone: "mark", title: "MARK", dash: "dotted", width: 1, source: "live", label: true });
  return out;
}

/** Preços que a escala vertical precisa conter para mostrar as linhas (liquidação só se estiver perto, para não achatar os candles). */
export function scaleExtras(lines: ChartLine[], ref: number | null, liqWithin = 0.35): number[] {
  return lines.filter((l) => l.tone !== "last" && l.tone !== "history-tp" && l.tone !== "history-sl" && !(l.tone === "liq" && ref != null && Math.abs(l.price - ref) / ref > liqWithin)).map((l) => l.price);
}

// ───────── marcadores de execuções ─────────
export interface ChartMarker { id: string; time: number; position: "aboveBar" | "belowBar"; shape: "arrowUp" | "arrowDown" | "circle" | "square"; tone: "gain" | "loss" | "neutral" | "gold"; text: string }

/** Abertura da vela que contém o instante (velas ordenadas, tempos em segundos). null se o instante é anterior a todas as velas. */
export function candleTimeFor(candleTimes: number[], tSec: number): number | null {
  let lo = 0, hi = candleTimes.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (candleTimes[m]! <= tSec) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans < 0 ? null : candleTimes[ans]!;
}

export function buildMarkers(execs: Exec[], candleTimes: number[], intervalSec: number): ChartMarker[] {
  if (!candleTimes.length) return [];
  const last = candleTimes[candleTimes.length - 1]! + intervalSec;
  const out: ChartMarker[] = [];
  for (const e of execs) {
    const ts = Math.floor(e.fill.time / 1000);
    if (ts >= last) continue; // depois da última vela carregada
    const time = candleTimeFor(candleTimes, ts);
    if (time == null) continue; // antes da janela carregada
    const long = e.dir === "LONG";
    const entering = e.kind === "ENTRY" || e.kind === "ADD";
    let m: Omit<ChartMarker, "id" | "time">;
    if (e.trigger === "LIQ") m = { position: long ? "aboveBar" : "belowBar", shape: "square", tone: "loss", text: "LIQ" };
    else if (e.trigger === "SL") m = { position: long ? "aboveBar" : "belowBar", shape: long ? "arrowDown" : "arrowUp", tone: "loss", text: "SL" };
    else if (e.trigger === "TP") m = { position: long ? "aboveBar" : "belowBar", shape: long ? "arrowDown" : "arrowUp", tone: "gain", text: "TP" };
    else if (e.kind === "ENTRY") m = { position: long ? "belowBar" : "aboveBar", shape: long ? "arrowUp" : "arrowDown", tone: long ? "gain" : "loss", text: long ? "L" : "S" };
    else if (e.kind === "ADD") m = { position: long ? "belowBar" : "aboveBar", shape: "circle", tone: "gold", text: "+" };
    else if (e.kind === "REDUCE") m = { position: long ? "aboveBar" : "belowBar", shape: "circle", tone: "neutral", text: "−" };
    else m = { position: long ? "aboveBar" : "belowBar", shape: "square", tone: e.fill.closedPnl >= 0 ? "gain" : "loss", text: "×" };
    void entering;
    out.push({ id: e.fill.key, time, ...m });
  }
  return out.sort((a, b) => a.time - b.time);
}
