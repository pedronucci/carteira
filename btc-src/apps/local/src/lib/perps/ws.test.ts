import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HlSocket, routeKey, subKey } from "./ws";

class FakeWS {
  static all: FakeWS[] = [];
  readyState = 0; sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null; onclose: (() => void) | null = null; onmessage: ((e: { data: string }) => void) | null = null; onerror: (() => void) | null = null;
  constructor(public url: string) { FakeWS.all.push(this); }
  send(s: string) { this.sent.push(JSON.parse(s)); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
  push(o: unknown) { this.onmessage?.({ data: JSON.stringify(o) }); }
}
const mk = (o = {}) => new HlSocket({ ctor: FakeWS as unknown as new (u: string) => WebSocket, backoff: () => 1000, pingMs: 10_000, ...o });

describe("WebSocket da Hyperliquid", () => {
  beforeEach(() => { FakeWS.all = []; vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("a mesma assinatura é enviada uma vez só e a mensagem chega a todos os ouvintes", () => {
    const s = mk(); const a = vi.fn(), b = vi.fn();
    s.subscribe({ type: "candle", coin: "HYPE", interval: "1m" }, a);
    s.subscribe({ type: "candle", coin: "HYPE", interval: "1m" }, b);
    const ws = FakeWS.all[0]!; ws.open();
    expect(ws.sent.filter((m) => m.method === "subscribe")).toHaveLength(1);
    ws.push({ channel: "candle", data: { s: "HYPE", i: "1m", t: 1, c: "43.1" } });
    expect(a).toHaveBeenCalledTimes(1); expect(b).toHaveBeenCalledTimes(1);
    ws.push({ channel: "candle", data: { s: "BTC", i: "1m" } });
    expect(a).toHaveBeenCalledTimes(1);
    expect(FakeWS.all).toHaveLength(1); // uma única conexão
  });
  it("só cancela na exchange quando o último ouvinte sai e fecha a conexão sem assinaturas", () => {
    const s = mk(); const off1 = s.subscribe({ type: "activeAssetCtx", coin: "SOL" }, () => undefined); const off2 = s.subscribe({ type: "activeAssetCtx", coin: "SOL" }, () => undefined);
    const ws = FakeWS.all[0]!; ws.open();
    off1(); expect(ws.sent.some((m) => m.method === "unsubscribe")).toBe(false);
    off2(); expect(ws.sent.some((m) => m.method === "unsubscribe")).toBe(true);
    expect(s.subscriptions).toEqual([]); expect(s.status).toBe("idle");
  });
  it("reconecta sozinho com recuo e reassina tudo", () => {
    const s = mk(); const got = vi.fn();
    s.subscribe({ type: "candle", coin: "HYPE", interval: "5m" }, got);
    s.subscribe({ type: "activeAssetCtx", coin: "HYPE" }, got);
    const ws1 = FakeWS.all[0]!; ws1.open();
    ws1.close(); // queda
    expect(s.status).toBe("reconnecting");
    vi.advanceTimersByTime(1000);
    expect(FakeWS.all).toHaveLength(2);
    const ws2 = FakeWS.all[1]!; ws2.open();
    expect(s.status).toBe("open");
    expect(ws2.sent.filter((m) => m.method === "subscribe")).toHaveLength(2);
    ws2.push({ channel: "activeAssetCtx", data: { coin: "HYPE", ctx: { markPx: "44" } } });
    expect(got).toHaveBeenCalledTimes(1);
  });
  it("insiste em reconectar após falhas seguidas e envia ping periódico", () => {
    const s = mk(); s.subscribe({ type: "userFills", user: "0xABC" }, () => undefined);
    FakeWS.all[0]!.open();
    vi.advanceTimersByTime(10_000);
    expect(FakeWS.all[0]!.sent.some((m) => m.method === "ping")).toBe(true);
    for (let i = 0; i < 3; i++) { FakeWS.all.at(-1)!.close(); vi.advanceTimersByTime(1000); }
    expect(FakeWS.all.length).toBe(4);
  });
  it("conexão muda (sem mensagens) é derrubada e refeita", () => {
    const s = mk({ staleMs: 20_000, pingMs: 10_000 }); s.subscribe({ type: "candle", coin: "BTC", interval: "1m" }, () => undefined);
    FakeWS.all[0]!.open();
    vi.advanceTimersByTime(40_000);
    expect(FakeWS.all.length).toBeGreaterThan(1);
  });
  it("sem WebSocket disponível, sinaliza 'indisponível' (a tela cai para consulta periódica)", () => {
    const s = new HlSocket({ ctor: undefined });
    const orig = (globalThis as { WebSocket?: unknown }).WebSocket; (globalThis as { WebSocket?: unknown }).WebSocket = undefined;
    s.subscribe({ type: "candle", coin: "BTC", interval: "1m" }, () => undefined);
    expect(s.status).toBe("unavailable");
    (globalThis as { WebSocket?: unknown }).WebSocket = orig;
  });
  it("roteamento das mensagens", () => {
    expect(routeKey({ channel: "candle", data: { s: "HYPE", i: "1h" } })).toBe(subKey({ type: "candle", coin: "HYPE", interval: "1h" }));
    expect(routeKey({ channel: "userFills", data: { user: "0xAB", fills: [] } })).toBe(subKey({ type: "userFills", user: "0xab" }));
    expect(routeKey({ channel: "pong" })).toBeNull();
  });
});
