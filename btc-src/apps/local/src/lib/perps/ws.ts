/**
 * WebSocket público da Hyperliquid (somente leitura): velas, mark price e eventos da conta.
 * Uma única conexão compartilhada, com assinaturas contadas (a mesma assinatura nunca é enviada duas vezes),
 * batimento (ping), reconexão automática com recuo progressivo e reassinatura após cair.
 */
import { HL_WS } from "../local/hl";

export type WsStatus = "idle" | "connecting" | "open" | "reconnecting" | "unavailable";
export type Sub =
  | { type: "candle"; coin: string; interval: string }
  | { type: "activeAssetCtx"; coin: string }
  | { type: "userFills"; user: string }
  | { type: "orderUpdates"; user: string };

export const subKey = (s: Sub): string => (s.type === "candle" ? `candle|${s.coin}|${s.interval}` : s.type === "activeAssetCtx" ? `ctx|${s.coin}` : `${s.type}|${s.user.toLowerCase()}`);

interface Msg { channel?: string; data?: unknown }
/** Chave de assinatura a que a mensagem pertence (null = ignorar). */
export function routeKey(m: Msg): string | null {
  const d = m.data as Record<string, unknown> | unknown[] | undefined;
  switch (m.channel) {
    case "candle": return d && !Array.isArray(d) ? `candle|${String(d.s)}|${String(d.i)}` : null;
    case "activeAssetCtx": return d && !Array.isArray(d) ? `ctx|${String(d.coin)}` : null;
    case "userFills": return d && !Array.isArray(d) && typeof d.user === "string" ? `userFills|${d.user.toLowerCase()}` : null;
    case "orderUpdates": return "orderUpdates|*";
    default: return null;
  }
}

type WsCtor = new (url: string) => WebSocket;
export interface SocketOpts { url?: string; ctor?: WsCtor; pingMs?: number; staleMs?: number; backoff?: (attempt: number) => number }

export class HlSocket {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, { sub: Sub; fns: Set<(data: unknown) => void> }>();
  private statusFns = new Set<(s: WsStatus) => void>();
  status: WsStatus = "idle";
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ping: ReturnType<typeof setInterval> | null = null;
  private lastMsg = 0;
  private closedByUs = false;
  /** quantas conexões já foram abertas (teste/diagnóstico) */ opens = 0;

  constructor(private o: SocketOpts = {}) {}

  private setStatus(s: WsStatus) { if (this.status !== s) { this.status = s; this.statusFns.forEach((f) => f(s)); } }
  onStatus(f: (s: WsStatus) => void) { this.statusFns.add(f); f(this.status); return () => { this.statusFns.delete(f); }; }

  /** Assina; devolve a função que cancela. Assinaturas iguais compartilham uma só assinatura na exchange. */
  subscribe(sub: Sub, fn: (data: unknown) => void): () => void {
    const key = subKey(sub);
    let h = this.handlers.get(key);
    if (!h) { h = { sub, fns: new Set() }; this.handlers.set(key, h); this.send({ method: "subscribe", subscription: sub }); }
    h.fns.add(fn);
    this.ensure();
    return () => {
      const cur = this.handlers.get(key);
      if (!cur) return;
      cur.fns.delete(fn);
      if (cur.fns.size === 0) { this.handlers.delete(key); this.send({ method: "unsubscribe", subscription: sub }); if (this.handlers.size === 0) this.shutdown(); }
    };
  }

  private send(o: unknown) { if (this.ws && this.ws.readyState === 1) { try { this.ws.send(JSON.stringify(o)); } catch { /* cai e reconecta */ } } }

  private ensure() { if (!this.ws && !this.timer && !this.closedByUs) this.connect(); }

  private connect() {
    const Ctor = this.o.ctor ?? (typeof WebSocket !== "undefined" ? (WebSocket as unknown as WsCtor) : null);
    if (!Ctor) { this.setStatus("unavailable"); return; }
    this.closedByUs = false;
    this.setStatus(this.attempt > 0 ? "reconnecting" : "connecting");
    let ws: WebSocket;
    try { ws = new Ctor(this.o.url ?? HL_WS); } catch { this.setStatus("unavailable"); this.scheduleReconnect(); return; }
    this.ws = ws; this.opens++;
    ws.onopen = () => {
      this.attempt = 0; this.lastMsg = Date.now(); this.setStatus("open");
      for (const h of this.handlers.values()) this.send({ method: "subscribe", subscription: h.sub }); // reassina tudo
      this.ping = setInterval(() => {
        this.send({ method: "ping" });
        if (Date.now() - this.lastMsg > (this.o.staleMs ?? 70_000)) { try { ws.close(); } catch { /* */ } }
      }, this.o.pingMs ?? 30_000);
    };
    ws.onmessage = (ev) => {
      this.lastMsg = Date.now();
      let m: Msg;
      try { m = JSON.parse(String(ev.data)) as Msg; } catch { return; }
      const k = routeKey(m);
      if (!k) return;
      if (k === "orderUpdates|*") { for (const [key, h] of this.handlers) if (key.startsWith("orderUpdates|")) h.fns.forEach((f) => f(m.data)); return; }
      this.handlers.get(k)?.fns.forEach((f) => f(m.data));
    };
    const drop = () => {
      if (this.ws !== ws) return;
      this.ws = null; if (this.ping) { clearInterval(this.ping); this.ping = null; }
      if (!this.closedByUs && this.handlers.size) this.scheduleReconnect(); else this.setStatus("idle");
    };
    ws.onclose = drop;
    ws.onerror = () => { try { ws.close(); } catch { /* */ } };
  }

  private scheduleReconnect() {
    if (this.timer) return;
    this.attempt++;
    this.setStatus("reconnecting");
    const wait = this.o.backoff ? this.o.backoff(this.attempt) : Math.min(30_000, 1000 * 2 ** (this.attempt - 1)) * (0.8 + Math.random() * 0.4);
    this.timer = setTimeout(() => { this.timer = null; if (this.handlers.size) this.connect(); }, wait);
  }

  /** Reconecta já (ex.: o aparelho voltou a ficar online). */
  retryNow() { if (!this.handlers.size) return; if (this.timer) { clearTimeout(this.timer); this.timer = null; } if (!this.ws) this.connect(); }

  private shutdown() {
    this.closedByUs = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.ping) { clearInterval(this.ping); this.ping = null; }
    const w = this.ws; this.ws = null;
    try { w?.close(); } catch { /* */ }
    this.attempt = 0; this.setStatus("idle");
  }
  get subscriptions() { return [...this.handlers.keys()]; }
}

let shared: HlSocket | null = null;
export function hlSocket(): HlSocket {
  if (!shared) {
    shared = new HlSocket();
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => shared?.retryNow());
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") shared?.retryNow(); });
    }
  }
  return shared;
}
