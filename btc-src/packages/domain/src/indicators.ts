/**
 * Indicadores técnicos sobre candles OHLCV.
 * Usam `number` (ponto flutuante): são estatísticas de contexto, não valores monetários contábeis.
 * Todas as funções devolvem arrays alinhados aos candles de entrada (null até haver dados suficientes).
 */
export interface Candle {
  t: number; // abertura, unix seconds
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  synthetic?: boolean;
}

type S = (number | null)[];

export function sma(values: number[], period: number): S {
  const out: S = new Array(values.length).fill(null);
  let acc = 0;
  for (let i = 0; i < values.length; i++) {
    acc += values[i]!;
    if (i >= period) acc -= values[i - period]!;
    if (i >= period - 1) out[i] = acc / period;
  }
  return out;
}

export function ema(values: number[], period: number): S {
  const out: S = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** RSI de Wilder. */
export function rsi(closes: number[], period = 14): S {
  const out: S = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i]! - closes[i - 1]!;
    if (ch >= 0) gain += ch; else loss -= ch;
  }
  let avgG = gain / period, avgL = loss / period;
  out[period] = avgL === 0 ? (avgG === 0 ? 50 : 100) : 100 - 100 / (1 + avgG / avgL);
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i]! - closes[i - 1]!;
    avgG = (avgG * (period - 1) + Math.max(ch, 0)) / period;
    avgL = (avgL * (period - 1) + Math.max(-ch, 0)) / period;
    out[i] = avgL === 0 ? (avgG === 0 ? 50 : 100) : 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}

export function macd(closes: number[], fast = 12, slow = 26, signal = 9) {
  const ef = ema(closes, fast), es = ema(closes, slow);
  const line: S = closes.map((_, i) => (ef[i] != null && es[i] != null ? ef[i]! - es[i]! : null));
  const firstIdx = line.findIndex((v) => v != null);
  const sig: S = new Array(closes.length).fill(null);
  if (firstIdx >= 0) {
    const compact = line.slice(firstIdx) as number[];
    const e = ema(compact, signal);
    e.forEach((v, j) => (sig[firstIdx + j] = v));
  }
  const hist: S = line.map((v, i) => (v != null && sig[i] != null ? v - sig[i]! : null));
  return { line, signal: sig, hist };
}

export function bollinger(closes: number[], period = 20, mult = 2) {
  const mid = sma(closes, period);
  const upper: S = [], lower: S = [], width: S = [];
  for (let i = 0; i < closes.length; i++) {
    const m = mid[i];
    if (m == null) { upper.push(null); lower.push(null); width.push(null); continue; }
    const win = closes.slice(i - period + 1, i + 1);
    const sd = Math.sqrt(win.reduce((a, v) => a + (v - m) ** 2, 0) / period);
    upper.push(m + mult * sd); lower.push(m - mult * sd); width.push((2 * mult * sd) / m);
  }
  return { mid, upper, lower, width };
}

/** ATR de Wilder. */
export function atr(c: Candle[], period = 14): S {
  const out: S = new Array(c.length).fill(null);
  if (c.some((k) => k.synthetic)) return out;
  if (c.length <= period) return out;
  const tr = c.map((k, i) => (i === 0 ? k.h - k.l : Math.max(k.h - k.l, Math.abs(k.h - c[i - 1]!.c), Math.abs(k.l - c[i - 1]!.c))));
  let prev = tr.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  out[period] = prev;
  for (let i = period + 1; i < c.length; i++) {
    prev = (prev * (period - 1) + tr[i]!) / period;
    out[i] = prev;
  }
  return out;
}

/** VWAP móvel sobre `period` candles (preço típico × volume). */
export function rollingVwap(c: Candle[], period = 20): S {
  return c.map((_, i) => {
    if (i < period - 1) return null;
    let pv = 0, vol = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const k = c[j]!;
      pv += ((k.h + k.l + k.c) / 3) * k.v;
      vol += k.v;
    }
    return vol > 0 ? pv / vol : null;
  });
}

/** Volatilidade realizada anualizada (desvio-padrão dos log-retornos). */
export function realizedVol(closes: number[], period = 30, periodsPerYear = 365): S {
  const r = closes.map((v, i) => (i === 0 ? 0 : Math.log(v / closes[i - 1]!)));
  return closes.map((_, i) => {
    if (i < period) return null;
    const w = r.slice(i - period + 1, i + 1);
    const m = w.reduce((a, b) => a + b, 0) / period;
    const v = w.reduce((a, b) => a + (b - m) ** 2, 0) / (period - 1);
    return Math.sqrt(v) * Math.sqrt(periodsPerYear);
  });
}

export interface Level {
  price: number;
  kind: "SUPPORT" | "RESISTANCE";
  touches: number;
  lastTouch: number;
}

/**
 * Suportes e resistências por pivôs (máximas/mínimas locais com `lookback` candles de cada lado),
 * agrupados quando distam menos que `tolerance` (fração do preço).
 */
export function supportResistance(c: Candle[], lookback = 5, tolerance = 0.015, maxLevels = 6): Level[] {
  if (c.some((k) => k.synthetic)) return [];
  if (c.length < lookback * 2 + 1) return [];
  const pivots: { price: number; t: number }[] = [];
  for (let i = lookback; i < c.length - lookback; i++) {
    const win = c.slice(i - lookback, i + lookback + 1);
    if (win.every((k) => k.h <= c[i]!.h)) pivots.push({ price: c[i]!.h, t: c[i]!.t });
    if (win.every((k) => k.l >= c[i]!.l)) pivots.push({ price: c[i]!.l, t: c[i]!.t });
  }
  const clusters: { sum: number; n: number; last: number }[] = [];
  for (const p of pivots.sort((a, b) => a.price - b.price)) {
    const cl = clusters.find((x) => Math.abs(x.sum / x.n - p.price) / p.price < tolerance);
    if (cl) { cl.sum += p.price; cl.n++; cl.last = Math.max(cl.last, p.t); }
    else clusters.push({ sum: p.price, n: 1, last: p.t });
  }
  const last = c[c.length - 1]!.c;
  return clusters
    .map((x) => ({ price: x.sum / x.n, touches: x.n, lastTouch: x.last }))
    .sort((a, b) => b.touches - a.touches || b.lastTouch - a.lastTouch)
    .slice(0, maxLevels)
    .map((x) => ({ ...x, kind: (x.price < last ? "SUPPORT" : "RESISTANCE") as Level["kind"] }))
    .sort((a, b) => b.price - a.price);
}

export type TrendState = "ALTA" | "BAIXA" | "LATERAL";

/** Estrutura de tendência: posição vs médias e inclinação da MM50. */
export function trendStructure(closes: number[]): { state: TrendState; reasons: string[] } {
  const n = closes.length - 1;
  const m50 = sma(closes, 50), m200 = sma(closes, 200);
  const p = closes[n]!;
  const a = m50[n], b = m200[n], a20 = m50[n - 20];
  const reasons: string[] = [];
  if (a == null) return { state: "LATERAL", reasons: ["Histórico insuficiente para MM50."] };
  const slope = a20 != null ? (a - a20) / a20 : 0;
  let score = 0;
  if (p > a) { score++; reasons.push("Preço acima da MM50."); } else { score--; reasons.push("Preço abaixo da MM50."); }
  if (b != null) {
    if (a > b) { score++; reasons.push("MM50 acima da MM200."); } else { score--; reasons.push("MM50 abaixo da MM200."); }
  }
  if (slope > 0.02) { score++; reasons.push(`MM50 subindo ${(slope * 100).toFixed(1)}% em 20 períodos.`); }
  else if (slope < -0.02) { score--; reasons.push(`MM50 caindo ${(slope * 100).toFixed(1)}% em 20 períodos.`); }
  else reasons.push("MM50 praticamente plana.");
  return { state: score >= 2 ? "ALTA" : score <= -2 ? "BAIXA" : "LATERAL", reasons };
}

export const last = <T>(arr: (T | null)[]): T | null => {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i]!;
  return null;
};
