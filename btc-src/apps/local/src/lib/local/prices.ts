/**
 * Cotações direto do navegador (APIs públicas com CORS), com cache local e fallback:
 * - Histórico diário BTC/USDT e BTC/BRL: Binance (api.binance.com → data-api.binance.vision) → CoinGecko (365 dias).
 * - Cotação atual: Binance → CoinGecko; USD/BRL: AwesomeAPI → implícito BTCBRL/BTCUSDT.
 * - Fear & Greed: alternative.me.
 * Sem internet, usa o cache e a cotação manual de Configurações. Nunca inventa preço.
 */
import type { Candle } from "@bst/domain";

const CACHE_KEY = "bst.prices.v1";
const DAY = 86400;
const HOSTS = ["https://api.binance.com", "https://data-api.binance.vision"];

export interface Spot { btcUsd: number | null; btcBrl: number | null; usdBrl: number | null; at: number | null; source: string; fxSource: string; stale: boolean; error?: string }
interface Cache { usd: Candle[]; brl: { t: number; c: number }[]; source: string; fetchedAt: number; spot?: Spot; fng?: { value: number; label: string; at: number } }

let cache: Cache = load();
const subs = new Set<() => void>();
export const subscribePrices = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const notify = () => subs.forEach((f) => f());

function load(): Cache {
  try { const c = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null"); if (c?.usd) return c; } catch { /* sem cache */ }
  return { usd: [], brl: [], source: "", fetchedAt: 0 };
}
function save() { try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* cota cheia: segue sem cache */ } }

async function getJson<T>(url: string, ms = 12000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()) as T;
  } finally { clearTimeout(t); }
}

async function binanceKlines(symbol: string, startMs: number): Promise<unknown[][]> {
  let lastErr: unknown;
  for (const host of HOSTS) {
    try {
      const out: unknown[][] = [];
      let from = startMs;
      for (let i = 0; i < 20; i++) {
        const rows = await getJson<unknown[][]>(`${host}/api/v3/klines?symbol=${symbol}&interval=1d&startTime=${from}&limit=1000`);
        out.push(...rows);
        if (rows.length < 1000) break;
        from = Number(rows[rows.length - 1]![6]) + 1;
      }
      return out;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

/** Garante histórico diário desde `sinceTs` (mínimo 400 dias para MM200). */
export async function ensureHistory(sinceTs: number): Promise<void> {
  const start = Math.min(sinceTs - 250 * DAY, Date.now() / 1000 - 420 * DAY);
  const haveFrom = cache.usd[0]?.t ?? Infinity;
  const lastT = cache.usd[cache.usd.length - 1]?.t ?? 0;
  const fresh = Date.now() / 1000 - lastT < 1.5 * DAY && Date.now() - cache.fetchedAt < 3 * 3600e3;
  if (haveFrom <= start + DAY && fresh) return;
  const from = haveFrom <= start + DAY ? Math.max(lastT - 2 * DAY, start) : start;
  try {
    const [u, b] = await Promise.all([binanceKlines("BTCUSDT", from * 1000), binanceKlines("BTCBRL", from * 1000)]);
    const usd = u.map((r) => ({ t: Number(r[0]) / 1000, o: +r[1]!, h: +r[2]!, l: +r[3]!, c: +r[4]!, v: +r[5]! }));
    const brl = b.map((r) => ({ t: Number(r[0]) / 1000, c: +r[4]! }));
    cache.usd = merge(cache.usd, usd);
    cache.brl = merge(cache.brl, brl);
    cache.source = "Binance BTCUSDT/BTCBRL (diário)";
  } catch {
    // fallback: CoinGecko (somente fechamento, até 365 dias no plano público)
    const [u, b] = await Promise.all([
      getJson<{ prices: [number, number][] }>("https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=365&interval=daily"),
      getJson<{ prices: [number, number][] }>("https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=brl&days=365&interval=daily"),
    ]);
    const day = (ms: number) => Math.floor(ms / 1000 / DAY) * DAY;
    cache.usd = merge(cache.usd, u.prices.map(([t, c]) => ({ t: day(t) - DAY, o: c, h: c, l: c, c, v: 0, synthetic: true })));
    cache.brl = merge(cache.brl, b.prices.map(([t, c]) => ({ t: day(t) - DAY, c })));
    cache.source = "CoinGecko (fechamento diário, 365 dias)";
  }
  cache.fetchedAt = Date.now();
  save();
  notify();
}

function merge<T extends { t: number }>(a: T[], b: T[]): T[] {
  const m = new Map<number, T>();
  for (const x of a) m.set(x.t, x);
  for (const x of b) m.set(x.t, x);
  return [...m.values()].sort((x, y) => x.t - y.t);
}

export async function refreshSpot(): Promise<Spot> {
  let btcUsd: number | null = null, btcBrl: number | null = null, usdBrl: number | null = null, source = "", fxSource = "";
  let error: string | undefined;
  for (const host of HOSTS) {
    try {
      const [u, b] = await Promise.all([
        getJson<{ price: string }>(`${host}/api/v3/ticker/price?symbol=BTCUSDT`, 8000),
        getJson<{ price: string }>(`${host}/api/v3/ticker/price?symbol=BTCBRL`, 8000),
      ]);
      btcUsd = +u.price; btcBrl = +b.price; source = "Binance";
      break;
    } catch { /* próximo */ }
  }
  if (btcUsd == null) {
    try {
      const r = await getJson<{ bitcoin: { usd: number; brl: number } }>("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,brl", 8000);
      btcUsd = r.bitcoin.usd; btcBrl = r.bitcoin.brl; source = "CoinGecko";
    } catch (e) { error = (e as Error).message; }
  }
  try {
    const r = await getJson<{ USDBRL: { ask: string } }>("https://economia.awesomeapi.com.br/json/last/USD-BRL", 8000);
    usdBrl = +r.USDBRL.ask; fxSource = "AwesomeAPI";
  } catch {
    if (btcUsd && btcBrl) { usdBrl = btcBrl / btcUsd; fxSource = `implícito ${source} (BTCBRL ÷ BTCUSDT)`; }
  }
  if (btcUsd != null) {
    cache.spot = { btcUsd, btcBrl: btcBrl ?? (usdBrl ? btcUsd * usdBrl : null), usdBrl, at: Date.now(), source, fxSource, stale: false };
  } else if (cache.spot) {
    cache.spot = { ...cache.spot, stale: true, error };
  } else {
    cache.spot = { btcUsd: null, btcBrl: null, usdBrl: null, at: null, source: "", fxSource: "", stale: true, error: error ?? "sem conexão" };
  }
  try {
    const f = await getJson<{ data: { value: string; value_classification: string; timestamp: string }[] }>("https://api.alternative.me/fng/?limit=1", 8000);
    const x = f.data[0];
    if (x) cache.fng = { value: +x.value, label: x.value_classification, at: +x.timestamp * 1000 };
  } catch { /* opcional */ }
  save();
  notify();
  return cache.spot;
}

export const prices = () => cache;

/** Fechamento do dia em USD e BRL (busca o último candle até o instante). */
function lookup<T extends { t: number }>(arr: T[], ts: number): T | null {
  // Um fechamento só é conhecido no fim do candle, nunca em sua abertura.
  const availableAt = ts - DAY + 1;
  let lo = 0, hi = arr.length - 1, best = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m]!.t <= availableAt) { best = m; lo = m + 1; } else hi = m - 1; }
  if (best < 0 || ts - arr[best]!.t > 4 * DAY) return null;
  return arr[best]!;
}

export function closeUsdAt(ts: number): number | null { return lookup(cache.usd, ts)?.c ?? null; }
export function closeBrlAt(ts: number): number | null {
  const b = lookup(cache.brl, ts)?.c;
  if (b) return b;
  return null;
}
export function usdBrlAt(ts: number): number | null {
  const u = closeUsdAt(ts), b = lookup(cache.brl, ts)?.c;
  return u && b ? b / u : null;
}
