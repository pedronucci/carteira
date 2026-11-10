import { describe, expect, it } from "vitest";
import { calendarDays, dayKey, equityCurve, filterJournal, findPatterns, journalMetrics } from "./analytics";
import { account, D, fill, fund, H, ledgerFor, monthFixture, T0 } from "../test-fixtures";
import { tradeUid } from "./trades";
import { attribute } from "../attribution/engine";
import { emptyNote } from "./types";

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe("Trading Journal: operações a partir de fills reais", () => {
  const { acc } = monthFixture();
  const { trades, ledger } = ledgerFor([acc], { strategyStart: T0 });
  const by = (coin: string) => trades.find((t) => t.coin === coin)!;

  it("agrupa vários fills na mesma operação e registra direção, preços, quantidades, P&L, funding e taxas", () => {
    const b = by("BTC");
    expect(b).toMatchObject({ dir: "LONG", entries: 2, exits: 2, open: false, maxSize: 1 });
    near(b.avgEntry!, 71000); near(b.avgExit!, (0.4 * 74000 + 0.6 * 73000) / 1);
    near(b.realizedPnl, 2400); near(b.fees, 38); near(b.funding, -6); near(b.netPnl, 2400 - 38 - 6);
    expect(b.execs.map((e) => e.kind)).toEqual(["ENTRY", "ADD", "REDUCE", "CLOSE"]);
    expect(by("SOL")).toMatchObject({ dir: "SHORT", open: false });
    expect(by("ETH").open).toBe(true);
  });
  it("posições BTC, HYPE e SOL, LONG e SHORT, com id estável compartilhado", () => {
    expect(trades.map((t) => t.coin).sort()).toEqual(["BTC", "ETH", "HYPE", "SOL"]);
    for (const t of trades) expect(t.uid).toBe(tradeUid(t.accountId, t));
    expect(new Set(trades.map((t) => t.uid)).size).toBe(trades.length);
  });
  it("estratégia padrão por regra e sobrescrita pela anotação do usuário", () => {
    expect(by("BTC").strategy).toBe("BTC/USDC");
    expect(by("HYPE").strategy).toBe("Outros perpétuos");
    const uid = by("HYPE").uid;
    const { trades: t2 } = ledgerFor([acc], { strategyStart: T0, notes: { [uid]: { ...emptyNote(uid), strategy: "Momentum", thesis: "rompimento", plannedStop: 36, plannedTps: [48, 52], rating: 4 } } });
    const h = t2.find((t) => t.uid === uid)!;
    expect(h.strategy).toBe("Momentum"); expect(h.note?.plannedTps).toEqual([48, 52]);
  });
  it("sincronização: repetir os mesmos fills não duplica operações nem resultado", () => {
    const again = account([...monthFixture().fills, ...monthFixture().fills.map((f) => ({ ...f }))].filter((f, i, a) => a.findIndex((x) => x.key === f.key) === i), monthFixture().funding);
    expect(ledgerFor([again]).trades.length).toBe(trades.length);
  });
  it("filtros: ativo, estratégia, período, resultado, direção e texto", () => {
    expect(filterJournal(trades, { coin: "HYPE" })).toHaveLength(1);
    expect(filterJournal(trades, { strategy: "BTC/USDC" }).map((t) => t.coin)).toEqual(["BTC"]);
    expect(filterJournal(trades, { result: "win" }).map((t) => t.coin).sort()).toEqual(["BTC", "HYPE"]);
    expect(filterJournal(trades, { result: "loss" }).map((t) => t.coin)).toEqual(["SOL"]);
    expect(filterJournal(trades, { result: "open" }).map((t) => t.coin)).toEqual(["ETH"]);
    expect(filterJournal(trades, { dir: "SHORT" }).map((t) => t.coin)).toEqual(["SOL"]);
    expect(filterJournal(trades, { coin: "HYPE", from: T0 + 5 * D, to: T0 + 6.5 * D })).toHaveLength(1);
    expect(filterJournal(trades, { coin: "HYPE", from: T0 + 8 * D, to: T0 + 9 * D })).toHaveLength(0);
  });
  it("métricas: win rate, profit factor, ganho/perda médios, expectância, drawdown", () => {
    const m = journalMetrics(trades);
    expect(m).toMatchObject({ total: 4, closed: 3, open: 1, wins: 2, losses: 1 });
    near(m.winRate!, 2 / 3);
    const w1 = 2400 - 38 - 6, w2 = 850 - 3.1 + 3, l1 = -100 - 2.4 + 0; // SOL: funding fora da janela da operação
    near(m.avgWin!, (w1 + w2) / 2); near(m.avgLoss!, -l1);
    near(m.profitFactor!, (w1 + w2) / -l1);
    near(m.expectancy!, (w1 + w2 + l1) / 3);
    near(m.maxDrawdown, -l1); // única perda, depois de dois ganhos
    expect(m.payoff).toBeGreaterThan(1);
  });
  it("curva de resultado acumulado e queda desde o pico", () => {
    const c = equityCurve(trades);
    expect(c).toHaveLength(3);
    expect(c.map((x) => x.t)).toEqual([...c.map((x) => x.t)].sort((a, b) => a - b));
    expect(c.at(-1)!.dd).toBeGreaterThan(0);
  });
  it("calendário: dias positivos e negativos a partir do MESMO registro da atribuição", () => {
    const cal = calendarDays(ledger.recs, trades);
    const hypeDay = cal.get(dayKey(T0 + 6 * D))!;
    expect(hypeDay.net).toBeGreaterThan(800);
    expect(cal.get(dayKey(T0 + 8 * D))!.net).toBeLessThan(0);
    expect(cal.get(dayKey(T0 + 6 * D))!.closedTrades).toBe(1);
    // soma do calendário (perpétuos) = resultado atribuído de perpétuos
    near([...cal.values()].reduce((a, c) => a + c.net, 0), attribute(ledger, { range: { from: null, to: T0 + 400 * D }, market: "perp" }).total.net);
  });
});

describe("padrões recorrentes", () => {
  const mk = (i: number, coin: string, dir: "B" | "A", pnl: number) => {
    const t = T0 + i * D;
    const open = fill(t, coin, dir, 1, 100, 0, { fee: 0.5 });
    const close = fill(t + 2 * H, coin, dir === "B" ? "A" : "B", 1, 100, dir === "B" ? 1 : -1, { pnl, fee: 0.5 });
    return [open, close];
  };
  it("exige amostra mínima: com poucas operações não aponta padrão", () => {
    const a = account([...mk(1, "HYPE", "A", -50), ...mk(2, "HYPE", "A", -40)], []);
    expect(findPatterns(ledgerFor([a]).trades)).toEqual([]);
  });
  it("detecta categoria perdedora recorrente com contagem, acerto e expectância", () => {
    const f = [...[1, 2, 3, 4, 5].flatMap((i) => mk(i, "HYPE", "A", -30)), ...[6, 7, 8, 9, 10].flatMap((i) => mk(i, "BTC", "B", 40))];
    const { trades } = ledgerFor([account(f, [])]);
    const p = findPatterns(trades);
    const hype = p.find((x) => x.dimension === "Ativo" && x.label === "HYPE")!;
    expect(hype).toMatchObject({ n: 5, tone: "loss" }); expect(hype.winRate).toBe(0); expect(hype.expectancy).toBeLessThan(-30);
    expect(p.find((x) => x.dimension === "Ativo" && x.label === "BTC")!.tone).toBe("gain");
    expect(p.find((x) => x.label === "SHORT em HYPE")).toBeTruthy();
  });
  it("sequência de perdas e custos de funding", () => {
    const f = [1, 2, 3, 4, 5].flatMap((i) => mk(i, "SOL", "B", -20)).concat([6, 7, 8, 9].flatMap((i) => mk(i, "ETH", "B", 5)));
    const funding = [fund(T0 + 1 * D + H, "SOL", -40, "k1")];
    const { trades } = ledgerFor([account(f, funding)]);
    const p = findPatterns(trades);
    expect(p.some((x) => x.id === "streak")).toBe(true);
    expect(p.some((x) => x.id === "costs|funding")).toBe(true);
  });
});
