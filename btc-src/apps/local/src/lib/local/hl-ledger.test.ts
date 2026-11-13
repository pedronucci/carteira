import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchHistory, HL_HISTORY_V } from "./hl";
import { flatEquityAt } from "./start-equity";

const ME = "0x" + "a".repeat(40), OTHER = "0x" + "b".repeat(40);
const T0 = Date.UTC(2026, 10, 1), H = 3600e3;

function mockApi(data: { fills?: unknown[]; ledger?: unknown[]; funding?: unknown[]; av?: [number, string][] }) {
  vi.stubGlobal("fetch", async (_u: string, init: { body: string }) => {
    const b = JSON.parse(init.body);
    const rows = (r: { time: number }[] = []) => r.filter((x) => x.time >= (b.startTime ?? 0));
    const body = b.type === "userFillsByTime" ? rows(data.fills as never) : b.type === "userNonFundingLedgerUpdates" ? rows(data.ledger as never)
      : b.type === "userFunding" ? rows(data.funding as never) : b.type === "portfolio" ? [["week", { accountValueHistory: data.av ?? [], pnlHistory: [] }]] : [];
    return { ok: true, status: 200, json: async () => body } as Response;
  });
}
afterEach(() => vi.unstubAllGlobals());

describe("taxas de saque e de envio (R3)", () => {
  it("guarda a taxa do saque e do envio pago por esta conta; recebido não tem taxa", async () => {
    mockApi({ ledger: [
      { time: T0, hash: "w", delta: { type: "withdraw", usdc: "500", nonce: 1, fee: "1.0" } },
      { time: T0 + H, hash: "s1", delta: { type: "send", user: ME, destination: OTHER, token: "USDC", amount: "100", usdcValue: "100", fee: "1.0" } },
      { time: T0 + 2 * H, hash: "s2", delta: { type: "send", user: OTHER, destination: ME, token: "USDC", amount: "50", usdcValue: "50", fee: "1.0" } },
      { time: T0 + 3 * H, hash: "d", delta: { type: "deposit", usdc: "10" } },
    ] });
    const h = await fetchHistory(ME, null);
    const by = Object.fromEntries(h.ledger.map((l) => [l.key.split("|")[2], l]));
    expect(by.w).toMatchObject({ kind: "OUT", amount: 500, fee: 1 });
    expect(by.s1).toMatchObject({ kind: "OUT", amount: 100, fee: 1 });
    expect(by.s2?.fee).toBeUndefined();
    expect(by.d?.fee).toBeUndefined();
    expect(h.v).toBe(HL_HISTORY_V);
  });

  it("histórico de versão anterior é baixado de novo (para trazer as taxas antigas)", () => {
    expect(HL_HISTORY_V).toBeGreaterThan(2);
  });
});

describe("patrimônio inicial exato com a conta parada (D1)", () => {
  const fill = (time: number, side: "B" | "A", sz: number, start: number, closedPnl = 0, fee = 1) => ({ key: `f|${time}`, time, coin: "HYPE", px: 40, sz, side, dir: "", fee, closedPnl, startPosition: start });
  const base = { at: T0, ledger: [], funding: [], pnl: [], truncated: false, syncs: 1, v: HL_HISTORY_V };

  it("sem posição e sem eventos entre o ponto anterior e o início: usa o ponto anterior, sem interpolar", () => {
    // caso real: 8.006,03 às 21:48, início 00:10, operação aberta DEPOIS do início puxa o ponto seguinte para 7.946,68
    const h = { ...base, accountValue: [[T0, 8006.03], [T0 + 4 * H + 40 * 60e3, 7946.68]] as [number, number][], fills: [fill(T0 + 3 * H, "B", 10, 0)] };
    expect(flatEquityAt(h, T0 + 2 * H + 22 * 60e3)).toBeCloseTo(8006.03, 6);
  });

  it("operação aberta e fechada entre o ponto e o início: soma o resultado, taxas, funding e fluxos", () => {
    const h = { ...base, accountValue: [[T0, 1000]] as [number, number][],
      fills: [fill(T0 + H, "B", 10, 0, 0, 1), fill(T0 + 2 * H, "A", 10, 10, 50, 1)],
      funding: [{ key: "u1", time: T0 + 1.5 * H, coin: "HYPE", usd: -2 }],
      ledger: [{ key: "l1", time: T0 + 2.5 * H, kind: "OUT" as const, amount: 100, label: "", type: "withdraw", fee: 1 }] };
    expect(flatEquityAt(h, T0 + 3 * H)).toBeCloseTo(1000 + 50 - 2 - 2 - 100 - 1, 6);
  });

  it("com posição aberta no ponto ou no início não afirma valor exato", () => {
    const h = { ...base, accountValue: [[T0, 1000]] as [number, number][], fills: [fill(T0 - H, "B", 10, 0)] };
    expect(flatEquityAt(h, T0 + H)).toBeNull();
  });

  it("ponto anterior mais velho que o limite: sem valor exato", () => {
    const h = { ...base, accountValue: [[T0, 1000]] as [number, number][], fills: [] };
    expect(flatEquityAt(h, T0 + 7 * H)).toBeNull();
  });

  it("com execuções de spot no histórico não afirma valor exato (saldo spot muda de preço sem evento)", () => {
    const h = { ...base, accountValue: [[T0, 1000]] as [number, number][], fills: [{ ...fill(T0 - 10 * H, "B", 1, 0), coin: "@107" }] };
    expect(flatEquityAt(h, T0 + H)).toBeNull();
  });
});
