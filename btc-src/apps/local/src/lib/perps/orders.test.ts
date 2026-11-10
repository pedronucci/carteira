import { describe, expect, it } from "vitest";
import type { HlOrder } from "../local/hl";
import { classifyOrders } from "./orders";
import { buildLines, buildMarkers, candleTimeFor, scaleExtras, type PlannedLevel } from "./chart-lines";
import { classifyExecs } from "./exec";
import { mergeLevelHistory } from "./levels";
import { fill } from "../test-fixtures";
import { groupTrades } from "./trades";

const o = (p: Partial<HlOrder>): HlOrder => ({ oid: 1, coin: "HYPE", side: "A", sz: 10, origSz: 10, limitPx: null, triggerPx: null, isTrigger: true, orderType: "Take Profit Market", reduceOnly: true, isPositionTpsl: false, triggerCondition: "", tif: null, at: 0, ...p });
const long = { coin: "HYPE", dir: "LONG" as const, size: 100, entry: 40 };
const short = { coin: "SOL", dir: "SHORT" as const, size: 20, entry: 170 };

describe("ordens reais TP/SL", () => {
  it("LONG: múltiplos take profits viram TP1, TP2, TP3 por proximidade, com preço e quantidade", () => {
    const c = classifyOrders([o({ oid: 3, triggerPx: 55, sz: 20 }), o({ oid: 1, triggerPx: 45, sz: 30 }), o({ oid: 2, triggerPx: 50, sz: 50 })], long);
    expect(c.tps.map((x) => [x.label, x.price, x.qty])).toEqual([["TP1", 45, 30], ["TP2", 50, 50], ["TP3", 55, 20]]);
    expect(c.sls).toEqual([]);
  });
  it("LONG: stop loss real com preço de disparo e quantidade", () => {
    const c = classifyOrders([o({ oid: 9, orderType: "Stop Market", triggerPx: 36, sz: 100 })], long);
    expect(c.sls).toHaveLength(1);
    expect(c.sls[0]).toMatchObject({ kind: "SL", price: 36, qty: 100, label: "SL" });
  });
  it("SHORT: TP abaixo da entrada e SL acima; ordens do lado errado não são proteção", () => {
    const c = classifyOrders([
      o({ coin: "SOL", oid: 1, side: "B", triggerPx: 150, sz: 20 }),
      o({ coin: "SOL", oid: 2, side: "B", orderType: "Stop Market", triggerPx: 185, sz: 20 }),
      o({ coin: "SOL", oid: 3, side: "A", orderType: "Stop Market", triggerPx: 190, sz: 20, reduceOnly: false }), // aumenta o short: não é proteção
    ], short);
    expect(c.tps.map((x) => x.price)).toEqual([150]);
    expect(c.sls.map((x) => x.price)).toEqual([185]);
    expect(c.pending).toHaveLength(1);
  });
  it("posição sem ordens TP/SL: nada é inventado", () => {
    const c = classifyOrders([], long);
    expect(c).toEqual({ tps: [], sls: [], pending: [] });
    expect(buildLines({ coin: "HYPE", dir: "LONG", entry: 40, liq: 22, mark: 43, last: 43, orders: c, planned: [] }).map((l) => l.id)).toEqual(["entry", "liq", "mark"]);
  });
  it("TP/SL da posição inteira usa o tamanho atual da posição e vem marcado", () => {
    const c = classifyOrders([o({ isPositionTpsl: true, sz: 0, triggerPx: 60 })], long);
    expect(c.tps[0]).toMatchObject({ qty: 100, wholePosition: true });
  });
  it("limite reduce-only no lado do lucro funciona como alvo; no lado do prejuízo fica pendente", () => {
    const c = classifyOrders([o({ oid: 1, isTrigger: false, orderType: "Limit", limitPx: 52, sz: 10 }), o({ oid: 2, isTrigger: false, orderType: "Limit", limitPx: 30, sz: 10 })], long);
    expect(c.tps).toHaveLength(1); expect(c.tps[0]).toMatchObject({ price: 52, limit: true });
    expect(c.pending.map((p) => p.price)).toEqual([30]);
  });
  it("ignora ordens de outro ativo", () => {
    expect(classifyOrders([o({ coin: "BTC", triggerPx: 80000 })], long).tps).toEqual([]);
  });
});

describe("linhas do gráfico: ordens reais × níveis planejados × preços", () => {
  const orders = classifyOrders([o({ oid: 1, triggerPx: 45, sz: 30 }), o({ oid: 2, orderType: "Stop Market", triggerPx: 36, sz: 100 })], long);
  const plan: PlannedLevel = { id: "p1", accountId: "a", coin: "HYPE", kind: "TP", price: 60, qty: 50, createdAt: 0 };
  it("TP planejado é rotulado como planejado, tracejado e de origem 'plan' (não é ordem ativa)", () => {
    const ls = buildLines({ coin: "HYPE", dir: "LONG", entry: 40, liq: 22, mark: 43, last: 43.1, orders, planned: [plan] });
    const p = ls.find((l) => l.id === "plan|p1")!;
    expect(p).toMatchObject({ source: "plan", dash: "dashed", tone: "plan-tp", price: 60 });
    expect(p.title).toContain("planejado");
    const real = ls.find((l) => l.id === "tp|1")!;
    expect(real).toMatchObject({ source: "exchange", dash: "solid", tone: "tp" });
    expect(real.title).toBe("TP1 · 30");
    expect(ls.find((l) => l.id === "sl|2")).toMatchObject({ tone: "sl", source: "exchange" });
  });
  it("liquidação mostra a distância % até o mark; mark é uma linha própria e distinta", () => {
    const ls = buildLines({ coin: "HYPE", dir: "LONG", entry: 40, liq: 25, mark: 50, last: 50.2, orders: null, planned: [] });
    expect(ls.find((l) => l.id === "liq")!.title).toBe("LIQ −50%");
    const m = ls.find((l) => l.id === "mark")!;
    expect(m).toMatchObject({ tone: "mark", source: "live", dash: "dotted" });
    const sh = buildLines({ coin: "SOL", dir: "SHORT", entry: 170, liq: 231, mark: 165, last: 165, orders: null, planned: [] });
    expect(sh.find((l) => l.id === "liq")!.title).toBe("LIQ −40%");
  });
  it("mudança no preço médio (aumento de posição) atualiza a linha de entrada", () => {
    const a = buildLines({ coin: "HYPE", dir: "LONG", entry: 40, liq: null, mark: 43, last: 43, orders: null, planned: [] });
    const b = buildLines({ coin: "HYPE", dir: "LONG", entry: 41.6, liq: null, mark: 43, last: 43, orders: null, planned: [] });
    expect(a[0]!.price).toBe(40); expect(b[0]!.price).toBe(41.6); expect(b[0]!.title).toContain("LONG");
  });
  it("escala: liquidação muito distante não achata os candles", () => {
    const ls = buildLines({ coin: "HYPE", dir: "LONG", entry: 40, liq: 10, mark: 43, last: 43, orders, planned: [] });
    expect(scaleExtras(ls, 43)).not.toContain(10);
    expect(scaleExtras(ls, 43)).toContain(45);
    expect(scaleExtras(buildLines({ coin: "HYPE", dir: "LONG", entry: 40, liq: 35, mark: 43, last: 43, orders: null, planned: [] }), 43)).toContain(35);
  });
  it("níveis históricos só aparecem quando já não estão ativos", () => {
    const hist = [{ oid: 1, kind: "TP" as const, price: 70, qty: 5, firstSeen: 1, lastSeen: 2, active: false }, { oid: 2, kind: "SL" as const, price: 30, qty: 5, firstSeen: 1, lastSeen: 2, active: true }];
    const ls = buildLines({ coin: "HYPE", dir: null, entry: null, liq: null, mark: null, last: null, orders: null, planned: [], history: hist });
    expect(ls.map((l) => l.id)).toEqual(["hist|1"]);
  });
});

describe("histórico de TP/SL guardado", () => {
  it("guarda, atualiza e marca inativo o que sumiu (sem apagar)", () => {
    const c1 = classifyOrders([o({ oid: 1, triggerPx: 45 }), o({ oid: 2, orderType: "Stop Market", triggerPx: 36 })], long);
    const h1 = mergeLevelHistory([], [...c1.tps, ...c1.sls], 1000);
    expect(h1).toHaveLength(2); expect(h1.every((x) => x.active && x.firstSeen === 1000)).toBe(true);
    const c2 = classifyOrders([o({ oid: 1, triggerPx: 46 })], long); // stop foi executado/cancelado; alvo ajustado
    const h2 = mergeLevelHistory(h1, c2.tps, 2000);
    expect(h2.find((x) => x.oid === 1)).toMatchObject({ price: 46, active: true, firstSeen: 1000, lastSeen: 2000 });
    expect(h2.find((x) => x.oid === 2)).toMatchObject({ active: false, lastSeen: 1000, price: 36 });
  });
});

describe("execuções e marcadores", () => {
  const f = [
    fill(1_000_000, "HYPE", "B", 80, 40, 0, { oid: 1 }),
    fill(2_000_000, "HYPE", "B", 40, 43.4, 80, { oid: 2 }),
    fill(3_000_000, "HYPE", "A", 60, 47, 120, { pnl: 400, oid: 3 }),
    fill(4_000_000, "HYPE", "A", 60, 36, 60, { pnl: -300, oid: 4 }),
  ];
  const t = groupTrades(f, [])[0]!;
  it("identifica entrada, aumento, redução parcial e encerramento; stop e take profit pelo tipo da ordem", () => {
    const ex = classifyExecs(t, { "3": "TP", "4": "SL" });
    expect(ex.map((e) => e.kind)).toEqual(["ENTRY", "ADD", "REDUCE", "CLOSE"]);
    expect(ex.map((e) => e.trigger)).toEqual([null, null, "TP", "SL"]);
    expect(ex[2]!.label).toBe("Take profit (parcial)"); expect(ex[3]!.label).toBe("Stop (encerra)");
    expect(ex.map((e) => e.posAfter)).toEqual([80, 120, 60, 0]);
  });
  it("sem o tipo da ordem, não inventa stop/TP", () => {
    const ex = classifyExecs(t, null);
    expect(ex.every((e) => e.trigger == null)).toBe(true);
    expect(ex[2]!.label).toBe("Redução parcial"); expect(ex[3]!.label).toBe("Fechamento");
  });
  it("SHORT: entrada é venda; liquidação marcada", () => {
    const s = groupTrades([fill(1000, "SOL", "A", 10, 170, 0), fill(2000, "SOL", "B", 10, 230, -10, { pnl: -600, liq: true })], [])[0]!;
    const ex = classifyExecs(s, null);
    expect(ex[0]).toMatchObject({ kind: "ENTRY", dir: "SHORT", label: "Entrada SHORT" });
    expect(ex[1]).toMatchObject({ kind: "CLOSE", trigger: "LIQ" });
  });
  it("marcadores caem na vela que contém o instante e usam os preços reais das execuções", () => {
    const secs = [0, 1000, 2000, 3000, 4000, 5000];
    expect(candleTimeFor(secs, 2500)).toBe(2000);
    expect(candleTimeFor(secs, -1)).toBeNull();
    const ms = buildMarkers(classifyExecs(t, { "3": "TP", "4": "SL" }), secs, 1000);
    expect(ms.map((m) => m.text)).toEqual(["L", "+", "TP", "SL"]);
    expect(ms.map((m) => m.time)).toEqual([1000, 2000, 3000, 4000]);
    expect(ms[0]).toMatchObject({ shape: "arrowUp", position: "belowBar", tone: "gain" });
    expect(ms[2]).toMatchObject({ tone: "gain" }); expect(ms[3]).toMatchObject({ tone: "loss" });
    expect(new Set(ms.map((m) => m.id)).size).toBe(4); // ids únicos = chaves das execuções
  });
  it("execução fora da janela de velas carregada não vira marcador", () => {
    expect(buildMarkers(classifyExecs(t, null), [9000, 10000], 1000)).toEqual([]);
  });
});
