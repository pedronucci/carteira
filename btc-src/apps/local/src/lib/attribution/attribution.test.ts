import { describe, expect, it } from "vitest";
import { attribute, attributionHref, bridge, byPeriod, journalHref, tradeContribution, waterfallBars, waterfallSteps } from "./engine";
import { account, D, fill, fund, H, ledgerFor, monthFixture, T0 } from "../test-fixtures";
import { resolveRange } from "../analytics/analytics";
import { spotEngine, spotUnrealized } from "./spot";
import { STRAT_BTC, STRAT_OTHER } from "../journal/trades";

const ALL = { from: null, to: T0 + 400 * D };
const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe("Portfolio Attribution Engine", () => {
  const { acc } = monthFixture();
  const { ledger, trades } = ledgerFor([acc], { spotNames: { "@107": "HYPE" }, strategyStart: T0, own: ["0x" + "b".repeat(40)] });
  const all = attribute(ledger, { range: ALL });
  const row = (a: ReturnType<typeof attribute>, coin: string) => a.rows.find((r) => r.asset === coin)!;

  it("BTC: realizado, taxas e funding de cada ativo (aumento + redução parcial + fechamento)", () => {
    const b = row(all, "BTC");
    near(b.perp.realized, 2400); near(b.perp.fees, -(10 + 11 + 8 + 9)); near(b.perp.funding, -6);
    near(b.perp.net, 2400 - 38 - 6);
  });
  it("HYPE gerou ~US$ 850 de lucro realizado (perp) e o spot fica separado", () => {
    const h = row(all, "HYPE");
    near(h.perp.realized, 850); near(h.perp.fees, -(1.4 + 1.7)); near(h.perp.funding, 3);
    near(h.perp.net, 850 - 3.1 + 3);
    // spot: compra de 10 a 38 com taxa de 0,01 HYPE (9,99 un. recebidas); venda de 4 a 45
    expect(h.spot.realized).toBeGreaterThan(0);
    near(h.spot.fees, -(0.01 * 38 + 0.18));
    near(h.total.net, h.perp.net + h.spot.net);
  });
  it("SOL short perdedor e ETH aberto: o P&L aberto NÃO entra no resultado do período", () => {
    near(row(all, "SOL").perp.realized, -100);
    const e = row(all, "ETH");
    near(e.perp.realized, 0); near(e.unrealizedPerp!, 50);
    near(e.total.net, -1 - 0.5); // só taxa e funding
    near(all.unrealized.perp, 50);
  });
  it("SEM DUPLA CONTAGEM: soma das linhas = total; total = perp + spot + outros; ids de eventos únicos", () => {
    near(all.rows.reduce((a, r) => a + r.total.net, 0), all.total.net);
    near(all.total.net, all.perp.net + all.spot.net + all.other.net);
    expect(new Set(ledger.recs.map((r) => r.id)).size).toBe(ledger.recs.length);
    // total conferido à mão: realizado perp + spot, taxas, funding, recompensa
    const expected = (2400 + 850 - 100) + all.spot.realized - (38 + 3.1 + 2.4 + 1) + (-6 + 3 - 0.5 + 0.25) + 5 - (0.01 * 38 + 0.18);
    near(all.total.net, expected);
  });
  it("duplicatas do histórico (mesma chave de execução/funding) não são somadas duas vezes", () => {
    const f1 = fill(T0 + H, "BTC", "B", 1, 100, 0, { fee: 1 });
    const dupFund = [fund(T0 + 2 * H, "BTC", 2, "dup"), fund(T0 + 2 * H, "BTC", 2, "dup")];
    const a = account([f1, { ...f1 }], dupFund);
    const { ledger: l } = ledgerFor([a]);
    const r = attribute(l, { range: ALL });
    near(r.total.fees, -1); near(r.total.funding, 2);
  });
  it("aportes, retiradas e transferências internas ficam fora do resultado e aparecem à parte", () => {
    expect(all.flows).not.toBeNull();
    near(all.flows!.deposits, 1000); near(all.flows!.withdrawals, 300);
    near(all.flows!.internal, 700); // INTERNAL spot↔perp 500 + envio a outra conta própria 200
    near(all.flows!.net, 700);
    near(all.total.rewards, 5); // recompensa é resultado, não aporte
  });
  it("sem fluxos quando o recorte é por ativo/estratégia/mercado", () => {
    expect(attribute(ledger, { range: ALL, coin: "BTC" }).flows).toBeNull();
  });
  it("filtro por período: só eventos dentro da janela", () => {
    const a = attribute(ledger, { range: { from: T0 + 5 * D, to: T0 + 6.5 * D }, coin: "HYPE", market: "perp" });
    near(a.total.net, 850 - 3.1 + 3);
    expect(a.rows).toHaveLength(1);
    expect(attribute(ledger, { range: { from: T0 + 7 * D, to: T0 + 8.5 * D }, coin: "HYPE", market: "perp" }).total.net).toBe(0);
  });
  it("filtros por estratégia, conta, exchange e mercado", () => {
    const s = attribute(ledger, { range: ALL, strategy: STRAT_BTC });
    expect(s.rows.map((r) => r.asset)).toEqual(["BTC"]);
    near(s.total.net, 2400 - 38 - 6);
    const o = attribute(ledger, { range: ALL, strategy: STRAT_OTHER, market: "perp" });
    expect(o.rows.some((r) => r.asset === "BTC")).toBe(false);
    expect(attribute(ledger, { range: ALL, accountId: "nao-existe" }).rows).toEqual([]);
    expect(attribute(ledger, { range: ALL, exchange: "OKX" }).total.net).toBe(0); // OKX: sem histórico de operações
    expect(attribute(ledger, { range: ALL, market: "spot" }).perp.net).toBe(0);
  });
  it("INTEGRAÇÃO Journal × Attribution: operações do ativo somam exatamente o resultado atribuído", () => {
    for (const coin of ["BTC", "HYPE", "SOL", "ETH"]) {
      const a = attribute(ledger, { range: ALL, coin, market: "perp" });
      const r = a.rows[0]!;
      const fromTrades = r.trades.reduce((x, t) => x + t.net, 0);
      const unassigned = ledger.recs.filter((x) => x.asset === coin && x.market === "perp" && x.tradeUid == null).reduce((x, y) => x + y.usd, 0);
      near(fromTrades + unassigned, r.perp.net);
      for (const t of r.trades) expect(trades.some((j) => j.uid === t.uid)).toBe(true); // mesmo id nos dois módulos
    }
    // funding fora de qualquer operação (SOL aos 20 dias) fica sem operação associada, mas conta no total
    near(attribute(ledger, { range: ALL, coin: "SOL", market: "perp" }).total.funding, 0.25);
  });
  it("caminho inverso: contribuição de uma operação ao portfólio", () => {
    const hype = trades.find((t) => t.coin === "HYPE")!;
    const c = tradeContribution(ledger, hype.uid, "HYPE", { range: ALL });
    near(c.net, 850 - 3.1 + 3);
    expect(c.shareOfTotal).toBeGreaterThan(0); expect(c.shareOfAsset).toBeGreaterThan(0.9); expect(c.rank).toBe(1);
    near(c.totalNet, all.total.net);
  });
  it("links: Attribution abre o Journal filtrado por ativo e pelo mesmo período", () => {
    const href = journalHref({ coin: "HYPE", from: 1000, to: 2000, acc: "hl-principal", market: "perp" });
    expect(href.startsWith("/diario?")).toBe(true);
    const q = new URLSearchParams(href.split("?")[1]);
    expect(q.get("coin")).toBe("HYPE"); expect(q.get("from")).toBe("1000"); expect(q.get("to")).toBe("2000"); expect(q.get("market")).toBe("perp");
    expect(attributionHref({ coin: "HYPE", from: 1, to: 2 })).toContain("/inteligencia?coin=HYPE");
    expect(journalHref({})).toBe("/diario");
  });
  it("períodos: 24h/7d/30d/90d/ano/tudo no mesmo registro", () => {
    const p = byPeriod(ledger, {}, T0 + 15 * D);
    expect(p.map((x) => x.kind)).toEqual(["1", "7", "30", "90", "ytd", "all"]);
    near(p.find((x) => x.kind === "all")!.net, attribute(ledger, { range: resolveRange("all", T0 + 15 * D) }).total.net);
  });
  it("ponte com o patrimônio: resíduo explícito; sem retratos suficientes → indisponível", () => {
    const b = bridge(10000, 11900, all.flows!.net, all.total.net);
    expect(b.available).toBe(true); near(b.residual!, 1900 - 700 - all.total.net);
    const none = bridge(null, 11900, 0, 0);
    expect(none.available).toBe(false); expect(none.reason).toMatch(/insuficiente/i); expect(none.residual).toBeNull();
  });
  it("waterfall: degraus encadeados e totais coerentes", () => {
    const b = bridge(10000, 11900, all.flows!.net, all.total.net);
    const steps = waterfallSteps(all, b);
    const bars = waterfallBars(steps);
    const net = bars.find((x) => x.key === "net")!;
    near(net.end, all.total.net);
    const deltas = steps.filter((s) => s.kind === "delta" && !["resid"].includes(s.key)).reduce((a, s) => a + s.value, 0);
    near(deltas, all.total.net);
    expect(bars.find((x) => x.key === "eq")!.end).toBeCloseTo(1900 - 700, 6);
    expect(bars.every((x) => x.up >= 0 && x.down >= 0)).toBe(true);
    expect(waterfallSteps(all, null).some((s) => s.key === "eq")).toBe(false);
  });
});

describe("spot por custo médio", () => {
  const names = { "@107": "HYPE" };
  it("venda maior que o estoque conhecido = histórico insuficiente (sem inventar custo)", () => {
    const r = spotEngine([fill(1, "@107", "B", 5, 40, 0), fill(2, "@107", "A", 8, 50, 0)], names);
    const a = r.assets.get("HYPE")!;
    expect(a.partial).toBe(true); near(a.unknownQty, 3);
    near(r.recs.find((x) => x.realized !== 0)!.realized, 5 * (50 - 40)); // só a parte com custo conhecido
  });
  it("custo médio ponderado e não realizado só quando o estoque bate com o saldo", () => {
    const r = spotEngine([fill(1, "@107", "B", 10, 40, 0), fill(2, "@107", "B", 10, 50, 0), fill(3, "@107", "A", 5, 60, 0)], names);
    const a = r.assets.get("HYPE")!;
    near(a.avgCost!, 45); near(a.qty, 15);
    near(r.recs.at(-1)!.realized, 5 * 15);
    near(spotUnrealized(a, { total: 15, usd: 15 * 55 }).usd!, 15 * 10);
    expect(spotUnrealized(a, { total: 40, usd: 2000 }).usd).toBeNull();
    expect(spotUnrealized(undefined, { total: 3, usd: 150 }).reason).toMatch(/custo desconhecido/);
  });
  it("pares sem nome conhecido ficam de fora e são avisados", () => {
    const r = spotEngine([fill(1, "@999", "B", 1, 1, 0)], names);
    expect(r.unmapped).toEqual(["@999"]); expect(r.recs).toEqual([]);
  });
});

describe("histórico insuficiente é indicado", () => {
  it("posição herdada e histórico truncado geram avisos", () => {
    const a = account([fill(T0, "BTC", "A", 1, 70000, 2, { pnl: 100 })], [], [], { complete: false });
    const { ledger } = ledgerFor([a]);
    expect(ledger.notes.join(" ")).toMatch(/truncado/);
    expect(ledger.notes.join(" ")).toMatch(/antes do histórico/);
  });
  it("sem histórico sincronizado", () => {
    const a = account([], []); (a as unknown as { historyAt: null }).historyAt = null;
    expect(ledgerFor([a]).ledger.notes.join(" ")).toMatch(/não sincronizado/);
  });
});
