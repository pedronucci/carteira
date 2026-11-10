/**
 * Velas da Hyperliquid com cache e sem consultas repetidas: pedidos iguais feitos ao mesmo tempo compartilham
 * a mesma resposta e o resultado fica guardado por alguns segundos. Somente leitura.
 */
import { fetchCandles, HL_INTERVALS, type HlCandle, type HlInterval } from "../local/hl";
declare const process: { env: Record<string, string | undefined> };

export { HL_INTERVALS };
export type { HlInterval, HlCandle };
export const TF_MS: Record<HlInterval, number> = { "1m": 60e3, "5m": 300e3, "15m": 900e3, "30m": 1800e3, "1h": 3600e3, "4h": 14400e3, "1d": 86400e3, "1w": 604800e3 };
export const TF_LABEL: Record<HlInterval, string> = { "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1h", "4h": "4h", "1d": "1D", "1w": "1W" };
/** Quantidade de velas por carga (a API aceita até 5.000). */
export const PAGE = 900;

const TTL = 15_000;
const cache = new Map<string, { at: number; rows: HlCandle[] }>();
const inflight = new Map<string, Promise<HlCandle[]>>();
export const cacheSize = () => cache.size;
export const clearCandleCache = () => { cache.clear(); inflight.clear(); };

/** Velas terminando em `end` (padrão: agora): as últimas `count`. */
export function loadCandles(coin: string, interval: HlInterval, end = Date.now(), count = PAGE): Promise<HlCandle[]> {
  const step = TF_MS[interval];
  const endBucket = Math.floor(end / step) * step + step; // alinha ao intervalo: pedidos próximos compartilham a chave
  const key = `${coin}|${interval}|${endBucket}|${count}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.rows);
  const run = inflight.get(key);
  if (run) return run;
  const p = (process.env.BST_DEMO === "1" ? Promise.resolve(demoCandles(coin, interval, endBucket, count)) : fetchCandles(coin, interval, endBucket - count * step, endBucket))
    .then((rows) => { cache.set(key, { at: Date.now(), rows }); return rows; })
    .finally(() => { inflight.delete(key); });
  inflight.set(key, p);
  return p;
}

/** Junta velas sem duplicar (a mais nova vence), em ordem de tempo. */
export function mergeCandles(a: HlCandle[], b: HlCandle[]): HlCandle[] {
  const m = new Map<number, HlCandle>();
  for (const c of a) m.set(c.t, c);
  for (const c of b) m.set(c.t, c);
  return [...m.values()].sort((x, y) => x.t - y.t);
}

/** Aplica uma vela recebida ao vivo: atualiza a vela atual ou acrescenta a nova. */
export function applyLive(rows: HlCandle[], c: HlCandle): HlCandle[] {
  const last = rows[rows.length - 1];
  if (!last || c.t > last.t) return [...rows, c];
  if (c.t === last.t) return [...rows.slice(0, -1), c];
  return mergeCandles(rows, [c]);
}

// Dados de exemplo só na prévia visual (BST_DEMO=1): removidos da versão publicada.
function demoCandles(coin: string, interval: HlInterval, end: number, count: number): HlCandle[] {
  const step = TF_MS[interval];
  const base = coin === "BTC" ? 76000 : coin === "HYPE" ? 41 : coin === "SOL" ? 165 : 100;
  let seed = [...coin].reduce((a, c) => a + c.charCodeAt(0), 7);
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const out: HlCandle[] = [];
  let px = base;
  for (let i = count; i > 0; i--) {
    const t = Math.floor((end - i * step) / step) * step;
    const o = px, c = Math.max(base * 0.4, o * (1 + (rnd() - 0.5) * 0.012));
    out.push({ t, T: t + step - 1, o, h: Math.max(o, c) * (1 + rnd() * 0.004), l: Math.min(o, c) * (1 - rnd() * 0.004), c, v: 200 + rnd() * 900, n: 50 });
    px = c;
  }
  return out;
}
