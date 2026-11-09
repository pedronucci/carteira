import { describe, expect, it } from "vitest";
import { allocation, longShort, marginUse, roiOnMargin } from "./hub";

describe("longShort", () => {
  it("separa lados, bruto e líquido", () => {
    const r = longShort([{ dir: "LONG", notional: 1000, upnl: 50 }, { dir: "SHORT", notional: 400, upnl: -20 }, { dir: "LONG", notional: 200, upnl: 5 }]);
    expect(r.long).toEqual({ n: 2, notional: 1200, upnl: 55 }); expect(r.short.n).toBe(1);
    expect(r.grossNotional).toBe(1600); expect(r.netNotional).toBe(800);
  });
  it("vazio", () => expect(longShort([]).grossNotional).toBe(0));
});
describe("allocation", () => {
  it("soma 100%, agrupa a cauda em Outros e ignora sem preço/zerado", () => {
    const a = allocation([{ symbol: "BTC", valueUsd: 600 }, { symbol: "USDC", valueUsd: 300 }, { symbol: "HYPE", valueUsd: 100 }, { symbol: "X", valueUsd: null }, { symbol: "Y", valueUsd: 0 }], 2);
    expect(a.map((x) => x.symbol)).toEqual(["BTC", "USDC", "Outros"]);
    expect(a.reduce((x, p) => x + p.share, 0)).toBeCloseTo(1);
  });
  it("sem valor → vazio", () => expect(allocation([{ symbol: "A", valueUsd: null }])).toEqual([]));
  it("equity de derivativos entra como ativo próprio, notional não existe na entrada", () => {
    const a = allocation([{ symbol: "USDC", valueUsd: 5000 }, { symbol: "BTC", valueUsd: 1000 }]);
    expect(a[0]!.share).toBeCloseTo(5000 / 6000);
  });
});
describe("margem e ROI", () => {
  it("uso de margem", () => { expect(marginUse(250, 1000)).toBe(0.25); expect(marginUse(10, null)).toBeNull(); expect(marginUse(10, 0)).toBeNull(); });
  it("ROI s/ margem", () => { expect(roiOnMargin([{ upnl: 30, margin: 100 }, { upnl: -10, margin: 100 }])).toBeCloseTo(0.1); expect(roiOnMargin([{ upnl: 5, margin: null }])).toBeNull(); });
});
