import { describe, it, expect } from "vitest";
import { amounts, pnl, simulateLP, uniquePositions } from "./math";
import type { LPPosition } from "./types";
describe("Liquidity math", () => {
    it("flat market has zero IL for both models", () => { for (const m of ["v2", "cl"] as const) {
        const r = simulateLP(1000, 100, 100, 80, 140, m, 0, 0);
        expect(r.lp).toBeCloseTo(1000, 10);
        expect(r.hold).toBeCloseTo(1000, 10);
        expect(r.il).toBeCloseTo(0, 10);
    } });
    it("50/50 doubling matches analytic IL", () => { const r = simulateLP(1000, 100, 200, 80, 140, "v2", 0, 0); expect(r.hold).toBe(1500); expect(r.lp).toBeCloseTo(1000 * Math.sqrt(2), 10); expect(r.ilPct).toBeCloseTo(2 * Math.sqrt(2) / 3 - 1, 12); });
    it("fees and gas affect net, not IL", () => { const a = simulateLP(1000, 100, 120, 80, 140, "cl", 0, 0), b = simulateLP(1000, 100, 120, 80, 140, "cl", 30, 8); expect(b.pnl - a.pnl).toBeCloseTo(22, 10); expect(b.il).toBe(a.il); });
    it("concentrated model differs from full range and remains all token1 above upper", () => { const r = simulateLP(1000, 100, 160, 80, 140, "cl", 0, 0), r2 = simulateLP(1000, 100, 200, 80, 140, "cl", 0, 0); expect(r.lp).toBe(r2.lp); expect(r.il).not.toBe(simulateLP(1000, 100, 160, 80, 140, "v2", 0, 0).il); });
    it("concentrated position is all token0 below lower", () => { const a = simulateLP(1000, 100, 40, 80, 140, "cl", 0, 0), b = simulateLP(1000, 100, 60, 80, 140, "cl", 0, 0); expect(b.lp / a.lp).toBeCloseTo(1.5, 12); });
    it.each([NaN, Infinity, 0, -1])("rejects invalid capital %s", capital => expect(() => simulateLP(capital, 100, 120, 80, 140, "cl", 0, 0)).toThrow());
    it("invalid concentrated entry and reversed range rejected", () => { expect(() => simulateLP(1000, 50, 120, 80, 140, "cl", 0, 0)).toThrow(); expect(() => simulateLP(1000, 100, 120, 140, 80, "cl", 0, 0)).toThrow(); });
    it("unconfirmed history cannot produce PnL; deposits do not become profit", () => { expect(pnl(1000, 1000, 0, 0, 0, false)).toBeNull(); expect(pnl(1500, 1500, 0, 0, 0, true)).toBe(0); expect(pnl(1100, 1000, 100, 20, 5, true)).toBe(215); });
    it("Q96 and decimals remain exact until valuation", () => { const q = (2n ** 96n).toString(); const [a, b] = amounts("1000000000000000000", q, -100, 100, 18, 18); expect(Number(a)).toBeCloseTo(Number(b), 14); expect(Number(a)).toBeGreaterThan(0); });
    it("different token decimals do not change raw balances", () => { const q = (2n ** 96n).toString(), a = amounts("1000000000000000000", q, -100, 100, 18, 6); expect(Number(a[1]) / Number(a[0])).toBeCloseTo(1e12, 1); });
    it("extreme price outside range holds only one token", () => { const a = amounts("1000000000000", (2n ** 96n / 10n).toString(), -100, 100, 6, 6); expect(Number(a[0])).toBeGreaterThan(0); expect(a[1]).toBe("0"); });
    it("deduplicates canonical positions across pages", () => { const a = { id: "eip155:1:uni:manager:1" } as LPPosition; expect(uniquePositions([a, a])).toHaveLength(1); });
});
