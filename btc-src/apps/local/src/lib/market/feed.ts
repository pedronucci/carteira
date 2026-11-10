/**
 * Cliente do proxy público (Cloudflare Worker). Só faz GET /news e /calendar: NADA do portfólio é enviado.
 * Guarda no navegador: endereço do proxy, cache da última resposta, itens lidos e alertas já vistos.
 */
import type { CalEvent, NewsItem } from "./radar";

const KEY = "bst.mi.v1", CACHE = "bst.mi.cache.v1";
/** Preenchido depois do deploy do Worker (ou pelo usuário na tela). Pode ser trocado na tela do Market Intelligence. */
export const DEFAULT_PROXY = "https://bst-market-proxy.pedro-nucci10.workers.dev";
export interface SourceStatus { name: string; ok: boolean; count?: number; error?: string }
export interface MiCache { newsAt: number | null; calAt: number | null; news: NewsItem[]; events: CalEvent[]; newsSources: SourceStatus[]; calSources: SourceStatus[] }
export interface MiPrefs { proxyUrl: string; read: string[]; seenAlerts: string[]; dismissed: string[]; alertsOn: boolean }
export interface MiState extends MiCache, MiPrefs { loading: boolean; error: string | null }

const EMPTY_CACHE: MiCache = { newsAt: null, calAt: null, news: [], events: [], newsSources: [], calSources: [] };
function read<T>(k: string, d: T): T { try { const v = JSON.parse(localStorage.getItem(k) ?? "null"); return v ? { ...d, ...v } : d; } catch { return d; } }
let state: MiState = { ...read<MiCache>(CACHE, EMPTY_CACHE), ...read<MiPrefs>(KEY, { proxyUrl: DEFAULT_PROXY, read: [], seenAlerts: [], dismissed: [], alertsOn: true }), loading: false, error: null };
const subs = new Set<() => void>();
export const subscribeMi = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const miState = () => state;
function set(p: Partial<MiState>) {
  state = { ...state, ...p };
  try {
    localStorage.setItem(KEY, JSON.stringify({ proxyUrl: state.proxyUrl, read: state.read.slice(-500), seenAlerts: state.seenAlerts.slice(-300), dismissed: state.dismissed.slice(-300), alertsOn: state.alertsOn }));
    localStorage.setItem(CACHE, JSON.stringify({ newsAt: state.newsAt, calAt: state.calAt, news: state.news, events: state.events, newsSources: state.newsSources, calSources: state.calSources }));
  } catch { /* cota cheia: segue sem cache */ }
  subs.forEach((f) => f());
}

/** Aceita só https (ou http em localhost); remove barra final. */
export function normalizeProxy(u: string): string | null {
  try { const x = new URL(u.trim()); if (x.protocol !== "https:" && !(x.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(x.hostname))) return null; return x.origin + x.pathname.replace(/\/+$/, ""); } catch { return null; }
}
export function setProxy(u: string): boolean {
  if (!u.trim()) { set({ proxyUrl: "", error: null }); return true; }
  const n = normalizeProxy(u); if (!n) return false;
  set({ proxyUrl: n, error: null }); return true;
}
export const markRead = (id: string) => { if (!state.read.includes(id)) set({ read: [...state.read, id] }); };
export const markAlertsSeen = (ids: string[]) => { const add = ids.filter((i) => !state.seenAlerts.includes(i)); if (add.length) set({ seenAlerts: [...state.seenAlerts, ...add] }); };
export const dismissAlert = (id: string) => set({ dismissed: [...state.dismissed, id] });
export const setAlertsOn = (on: boolean) => set({ alertsOn: on });

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { method: "GET", credentials: "omit", signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`o proxy respondeu ${r.status}`);
  return (await r.json()) as T;
}
const STALE_NEWS = 5 * 60e3, STALE_CAL = 3600e3;
let inflight: Promise<void> | null = null;
export function refreshMi(force = false): Promise<void> {
  if (!state.proxyUrl) return Promise.resolve();
  if (inflight) return inflight;
  const now = Date.now(), base = state.proxyUrl;
  const needNews = force || !state.newsAt || now - state.newsAt > STALE_NEWS, needCal = force || !state.calAt || now - state.calAt > STALE_CAL;
  if (!needNews && !needCal) return Promise.resolve();
  set({ loading: true });
  inflight = (async () => {
    const errs: string[] = [];
    const [n, c] = await Promise.allSettled([needNews ? getJson<{ items: NewsItem[]; sources: SourceStatus[] }>(`${base}/news`) : Promise.reject("skip"), needCal ? getJson<{ events: CalEvent[]; sources: SourceStatus[] }>(`${base}/calendar`) : Promise.reject("skip")]);
    const p: Partial<MiState> = {};
    if (n.status === "fulfilled") { p.news = n.value.items ?? []; p.newsSources = n.value.sources ?? []; p.newsAt = Date.now(); } else if (needNews) errs.push(`notícias: ${(n.reason as Error)?.message ?? "falha de rede"}`);
    if (c.status === "fulfilled") { p.events = c.value.events ?? []; p.calSources = c.value.sources ?? []; p.calAt = Date.now(); } else if (needCal) errs.push(`calendário: ${(c.reason as Error)?.message ?? "falha de rede"}`);
    set({ ...p, loading: false, error: errs.length ? errs.join(" · ") : null });
  })().finally(() => { inflight = null; });
  return inflight;
}
