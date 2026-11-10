/** Indicadores técnicos (puros). Cada série tem o mesmo tamanho da entrada; null = ainda sem dados suficientes. */
export type Series = (number | null)[];

export function sma(v: number[], n: number): Series {
  const out: Series = Array(v.length).fill(null);
  let sum = 0;
  for (let i = 0; i < v.length; i++) { sum += v[i]!; if (i >= n) sum -= v[i - n]!; if (i >= n - 1) out[i] = sum / n; }
  return out;
}
export function ema(v: number[], n: number): Series {
  const out: Series = Array(v.length).fill(null);
  if (v.length < n) return out;
  const k = 2 / (n + 1);
  let prev = v.slice(0, n).reduce((a, b) => a + b, 0) / n; // semente: média simples
  out[n - 1] = prev;
  for (let i = n; i < v.length; i++) { prev = v[i]! * k + prev * (1 - k); out[i] = prev; }
  return out;
}
/** RSI de Wilder. */
export function rsi(v: number[], n = 14): Series {
  const out: Series = Array(v.length).fill(null);
  if (v.length <= n) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = v[i]! - v[i - 1]!; if (d >= 0) g += d; else l -= d; }
  g /= n; l /= n;
  const calc = () => (l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l));
  out[n] = calc();
  for (let i = n + 1; i < v.length; i++) {
    const d = v[i]! - v[i - 1]!;
    g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = calc();
  }
  return out;
}
export interface Macd { macd: Series; signal: Series; hist: Series }
export function macd(v: number[], fast = 12, slow = 26, sig = 9): Macd {
  const f = ema(v, fast), s = ema(v, slow);
  const line: Series = v.map((_, i) => (f[i] != null && s[i] != null ? f[i]! - s[i]! : null));
  const first = line.findIndex((x) => x != null);
  const signal: Series = Array(v.length).fill(null);
  if (first >= 0) { const part = ema(line.slice(first) as number[], sig); part.forEach((x, i) => { signal[first + i] = x; }); }
  const hist: Series = line.map((x, i) => (x != null && signal[i] != null ? x - signal[i]! : null));
  return { macd: line, signal, hist };
}
export interface Boll { mid: Series; upper: Series; lower: Series }
/** Bandas de Bollinger (desvio padrão populacional, como nas plataformas de gráfico). */
export function bollinger(v: number[], n = 20, k = 2): Boll {
  const mid = sma(v, n);
  const upper: Series = Array(v.length).fill(null), lower: Series = Array(v.length).fill(null);
  for (let i = n - 1; i < v.length; i++) {
    const m = mid[i]!; let q = 0;
    for (let j = i - n + 1; j <= i; j++) q += (v[j]! - m) ** 2;
    const sd = Math.sqrt(q / n);
    upper[i] = m + k * sd; lower[i] = m - k * sd;
  }
  return { mid, upper, lower };
}
