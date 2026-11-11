/**
 * Proxy PÚBLICO do Market Intelligence. GET /news, GET /calendar, GET /health.
 * - Só lê fontes públicas de uma lista fixa; não recebe nem guarda dados do portfólio; sem cookies/credenciais.
 * - Cache de borda (notícias 5 min, calendário 6 h), falha isolada por fonte, limite de uso por IP (melhor esforço).
 */
import { dedupe, parseFeed, parseIcs, type CalEvent, type NewsItem } from "./parse";
import { BLS_ICS, FEEDS, blsStaticEvents, fedEvents } from "./sources";

export interface Env { ALLOWED_ORIGINS?: string }
export const VERSION = "2026-11-10.5";
const UA = "Mozilla/5.0 (compatible; BST-MarketProxy/1.0; +https://pedronucci.github.io/carteira/btc)"; // bls.gov recusa clientes sem identificação de navegador (HTTP 403)
const hits = new Map<string, { n: number; t: number }>();
export function limited(ip: string, now: number, max = 60, windowMs = 60e3): boolean {
  const h = hits.get(ip);
  if (!h || now - h.t > windowMs) { hits.set(ip, { n: 1, t: now }); if (hits.size > 5000) hits.clear(); return false; }
  h.n++; return h.n > max;
}
/** Origens padrão: não depender de variável de ambiente (sem ela o navegador bloquearia tudo com "Failed to fetch"). */
export const DEFAULT_ORIGINS = ["https://pedronucci.github.io", "https://carteira.pedro-nucci10.workers.dev"];
export const corsFor = (origin: string | null, allowed: string | undefined): Record<string, string> => {
  const extra = (allowed ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const list = [...new Set([...DEFAULT_ORIGINS, ...extra])];
  const ok = origin && (list.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  return { "Access-Control-Allow-Origin": ok ? origin! : list[0]!, Vary: "Origin", "Access-Control-Allow-Methods": "GET", "X-Content-Type-Options": "nosniff" };
};
const json = (body: unknown, status: number, cors: Record<string, string>, maxAge = 0) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store", ...cors } });

async function get(url: string, ttl: number): Promise<string> {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/calendar, text/xml, */*" }, signal: AbortSignal.timeout(7000), cf: { cacheTtl: ttl, cacheEverything: true } } as RequestInit);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

export async function loadNews(): Promise<{ items: NewsItem[]; sources: { id: string; name: string; ok: boolean; count: number; error?: string }[] }> {
  const res = await Promise.allSettled(FEEDS.map(async (f) => parseFeed(await get(f.url, 300), f.name)));
  const sources = res.map((r, i) => ({ id: FEEDS[i]!.id, name: FEEDS[i]!.name, ok: r.status === "fulfilled" && r.value.length > 0, count: r.status === "fulfilled" ? r.value.length : 0, ...(r.status === "rejected" ? { error: String((r.reason as Error)?.message ?? r.reason).slice(0, 80) } : r.value.length === 0 ? { error: "feed vazio ou formato inesperado" } : {}) }));
  const all = res.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  return { items: dedupe(all).slice(0, 150), sources };
}
type CalendarSource = { name: string; ok: boolean; error?: string; mode: "static" | "live"; coverageUntil: number };
export async function loadCalendar(): Promise<{ events: CalEvent[]; sources: CalendarSource[] }> {
  const fed = fedEvents(), fedUntil = Math.max(0, ...fed.map(e => e.start));
  const sources: CalendarSource[] = [{ name: "federalreserve.gov", mode: "static", coverageUntil: fedUntil, ok: fedUntil > Date.now() }];
  let bls: CalEvent[] = [];
  let liveErr = "";
  try { bls = parseIcs(await get(BLS_ICS, 21600), "bls.gov", "US").filter((e) => e.kind !== "OUTRO"); if (!bls.length) liveErr = "sem eventos"; }
  catch (e) { liveErr = String((e as Error).message).slice(0, 80); }
  if (bls.length) sources.push({ name: "bls.gov", mode: "live", coverageUntil: Math.max(...bls.map(e => e.start)), ok: true });
  else { bls = blsStaticEvents(); sources.push({ name: "bls.gov", mode: "static", coverageUntil: Math.max(0, ...bls.map(e => e.start)), ok: false, error: `Consulta ao vivo indisponível: ${liveErr}` }); }
  const events = [...fed, ...bls].sort((a, b) => a.start - b.start);
  return { events, sources };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const cors = corsFor(req.headers.get("Origin"), env.ALLOWED_ORIGINS);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "GET") return json({ error: "método não permitido" }, 405, cors);
    if (limited(req.headers.get("CF-Connecting-IP") ?? "?", Date.now())) return json({ error: "limite de uso" }, 429, cors);
    const path = new URL(req.url).pathname.replace(/\/+$/, "");
    if (path === "/news") { const d = await loadNews(); return json({ at: Date.now(), ...d }, 200, cors, 300); }
    if (path === "/calendar") { const d = await loadCalendar(); return json({ at: Date.now(), consensus: null, ...d }, 200, cors, 3600); }
    if (path === "/health" || path === "") return json({ ok: true, version: VERSION, at: Date.now(), feeds: FEEDS.map((f) => f.name) }, 200, cors);
    return json({ error: "não encontrado" }, 404, cors);
  },
};
