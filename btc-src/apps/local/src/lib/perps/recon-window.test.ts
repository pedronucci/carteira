import { describe, expect, it } from "vitest";
import { reconInputs } from "./view";
import type { HlHistory, HlLive } from "../local/hl";

const T0 = Date.UTC(2026, 1, 25), H = 3600e3;
// Caso real (D2): a Hyperliquid informa o 1º ponto "allTime" como 0,00 DEPOIS de a conta já ter recebido dinheiro e operado.
const history: HlHistory = {
  at: T0 + 100 * H, truncated: false, syncs: 1, v: 3, pnl: [],
  accountValue: [[T0 + 12 * H, 0], [T0 + 90 * H, 700]],
  ledger: [
    { key: "l1", time: T0, kind: "IN", amount: 650, label: "", type: "send" },
    { key: "l2", time: T0 + 50 * H, kind: "OUT", amount: 100, label: "", type: "withdraw", fee: 1 },
    { key: "l3", time: T0 + 60 * H, kind: "INCOME", amount: 5, label: "", type: "rewardsClaim" },
  ],
  fills: [
    { key: "f|1", time: T0 + H, coin: "SOL", px: 100, sz: 1, side: "B", dir: "Open Long", fee: 1, closedPnl: 0, startPosition: 0 },
    { key: "f|2", time: T0 + 2 * H, coin: "SOL", px: 162, sz: 1, side: "A", dir: "Close Long", fee: 1, closedPnl: 62, startPosition: 1 },
  ],
  funding: [{ key: "u1", time: T0 + 1.5 * H, coin: "SOL", usd: 0.05 }],
};
const truth = 650 - 100 - 1 + 5 + 62 - 2 + 0.05; // 613,05
const live = { at: T0 + 100 * H, mode: "unifiedAccount", perpValue: truth, withdrawable: 0, balances: [], positions: [], total: truth, arbTotal: null } as HlLive;

describe("janela da reconciliação da conta (D2) e itens fora dos fluxos (R2/R3)", () => {
  it("histórico completo: parte de zero antes do 1º evento e fecha com o saldo oficial", () => {
    const i = reconInputs(history, live);
    expect(i.startEquity).toBe(0);
    expect(i.since).toBeLessThanOrEqual(T0);
    expect(i.netExternalFlows).toBeCloseTo(550, 9);
    expect(i.otherIncome).toBeCloseTo(5 - 1, 9);
  });

  it("histórico truncado: não afirma patrimônio inicial zero", () => {
    const i = reconInputs({ ...history, truncated: true }, live);
    expect(i.startEquity).toBe(0); // 1º ponto allTime, como antes
    expect(i.since).toBe(T0 + 12 * H);
    expect(i.historyTruncated).toBe(true);
  });
});
