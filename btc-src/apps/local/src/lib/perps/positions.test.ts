import { describe, expect, it } from "vitest";
import { buildPositions, summarize, type RawPos } from "./positions";

const raw = (o: Partial<RawPos>): RawPos => ({ coin: "BTC", szi: 0.1, entryPx: 70000, leverage: 6, levType: "cross", liqPx: 60000, upnl: 100, marginUsed: 1200, posValue: 7200, fundingSinceOpen: -2, ...o });

describe("buildPositions", () => {
  it("descobre vários ativos, long e short, e ignora tamanho zero", () => {
    const p = buildPositions("a1", [raw({}), raw({ coin: "HYPE", szi: -50, entryPx: 40, posValue: -1900, liqPx: 48, marginUsed: 300, upnl: 5 }), raw({ coin: "SOL", szi: 0 })]);
    expect(p.map((x) => x.coin)).toEqual(["BTC", "HYPE"]);
    expect(p[1]!.dir).toBe("SHORT"); expect(p[1]!.mark).toBeCloseTo(38); expect(p[1]!.liqDistance).toBeCloseTo((48 - 38) / 38);
    expect(p[0]!.mark).toBeCloseTo(72000); expect(p[0]!.liqDistance).toBeCloseTo(12000 / 72000); expect(p[0]!.linkedStrategy).toBe(false);
    expect(p[0]!.id).toBe("a1|perp|BTC");
  });
  it("campos indisponíveis ficam nulos, nunca inventados", () => {
    const [p] = buildPositions("a1", [raw({ liqPx: null, marginUsed: 0, entryPx: 0 })]);
    expect(p!.liq).toBeNull(); expect(p!.liqDistance).toBeNull(); expect(p!.roiOnMargin).toBeNull(); expect(p!.entry).toBeNull();
  });
});
describe("summarize", () => {
  it("nocional não entra no patrimônio; líquida = long − short", () => {
    const p = buildPositions("a1", [raw({}), raw({ coin: "HYPE", szi: -50, posValue: -1900, liqPx: 60, entryPx: 40, upnl: 5, marginUsed: 300 })]);
    const s = summarize(p, 5000);
    expect(s.gross).toBeCloseTo(9100); expect(s.net).toBeCloseTo(5300); expect(s.effLeverage).toBeCloseTo(9100 / 5000); expect(s.margin).toBe(1500); expect(s.upnl).toBe(105); expect(s.equity).toBe(5000);
  });
  it("sem posições", () => expect(summarize([], 100).riskLevel).toBe("none"));
});
