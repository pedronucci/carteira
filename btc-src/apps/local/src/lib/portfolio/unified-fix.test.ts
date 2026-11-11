import { describe, expect, it } from "vitest";
import type { PSnapshot } from "@bst/domain";
import { fixUnifiedSnapshots } from "./unified-fix";
import { hlEquity } from "../local/hl";

describe("patrimônio da conta Hyperliquid", () => {
  it("conta unificada: o saldo spot já é o patrimônio (não soma o P&L aberto de novo)", () => {
    // caso real auditado: USDC spot 22.451,27 com P&L aberto +4.091,95 → valor oficial 22.451,27
    expect(hlEquity("unifiedAccount", 22143.18, 22451.27)).toBeCloseTo(22451.27, 2);
    expect(hlEquity("portfolioMargin", 0, 1000)).toBe(1000);
  });
  it("conta padrão: perp + spot", () => {
    expect(hlEquity("default", 700, 300)).toBe(1000);
    expect(hlEquity("disabled", 700, 0)).toBe(700);
  });
  it("duas contas unificadas com posição perdendo: total = soma dos saldos spot", () => {
    const total = hlEquity("unifiedAccount", 0, 11249.35) + hlEquity("unifiedAccount", 0, 4892.84);
    expect(total).toBeCloseTo(16142.19, 2);
  });
});

describe("correção dos retratos antigos (dupla contagem do P&L aberto)", () => {
  const snap = (): PSnapshot => ({
    t: 1, v: 2, byAccount: { strategy: 9417.96, x1: 4226.92, okx: 100 }, total: 13744.88, byAsset: { USDC: 13644.88, BTC: 100 }, btcUsd: 100000, btcEq: 0.1374488,
    perps: { upnl: -2497.31, notional: 0, margin: 0, count: 2, positions: [{ id: "hl-principal|perp|BTC", coin: "BTC", dir: "LONG", upnl: -1831.39, notional: 1 }, { id: "x1|perp|HYPE", coin: "HYPE", dir: "LONG", upnl: -665.92, notional: 1 }] },
  });
  const accs = [{ portfolioId: "strategy", perpAccountId: "hl-principal", unified: true }, { portfolioId: "x1", perpAccountId: "x1", unified: true }];
  it("devolve o P&L que tinha sido descontado duas vezes, por conta, no total e no USDC", () => {
    const r = fixUnifiedSnapshots([snap()], accs);
    const s = r.snapshots[0]!;
    expect(s.byAccount.strategy).toBeCloseTo(11249.35, 2);
    expect(s.byAccount.x1).toBeCloseTo(4892.84, 2);
    expect(s.byAccount.okx).toBe(100);
    expect(s.total).toBeCloseTo(16242.19, 2);
    expect(s.byAsset!.USDC).toBeCloseTo(16142.19, 2);
    expect(s.btcEq).toBeCloseTo(0.1624219, 6);
    expect(s.uf).toBe(1);
  });
  it("é idempotente e não mexe em conta padrão", () => {
    const once = fixUnifiedSnapshots([snap()], accs).snapshots;
    const twice = fixUnifiedSnapshots(once, accs);
    expect(twice.changed).toBe(0);
    expect(twice.snapshots).toEqual(once);
    const std = fixUnifiedSnapshots([snap()], accs.map((a) => ({ ...a, unified: false }))).snapshots[0]!;
    expect(std.total).toBe(13744.88);
    expect(std.uf).toBe(1);
  });
});
