import { describe, expect, it } from "vitest";
import { liquidation, marginAtLiquidation, simulate, type Input } from "./engine";
const base: Input = { entry: 100, margin: 1000, leverage: 5, side: "LONG", entryFee: .001, exitFee: .002, funding: .0001, fundingPrice: 100, stop: 95, exit: 110, hours: 24, tps: [], tiers: [{ lower: 0, maxLeverage: 20 }] };
describe("perpetual simulator accounting", () => {
    it("LONG: fees on each execution notional, funding on oracle, ROE on initial cash", () => {
        const r = simulate(base);
        expect(r.qty).toBe(50);
        expect(r.gross).toBe(500);
        expect(r.fees).toBe(16);
        expect(r.funding).toBe(12);
        expect(r.net).toBe(472);
        expect(r.roe).toBe(.472);
        expect(r.stopNet).toBe(-276.5);
        expect(r.rr).toBeCloseTo(472 / 276.5, 12);
    });
    it("SHORT reverses PnL and positive funding, but never reverses trading fees", () => {
        const r = simulate({ ...base, side: "SHORT", stop: 105, exit: 90 });
        expect(r.gross).toBe(500);
        expect(r.fees).toBe(14);
        expect(r.funding).toBe(-12);
        expect(r.net).toBe(498);
    });
    it("negative funding pays SHORT and credits LONG", () => {
        expect(simulate({ ...base, funding: -.0001 }).funding).toBe(-12);
        expect(simulate({ ...base, side: "SHORT", stop: 105, exit: 90, funding: -.0001 }).funding).toBe(12);
    });
    it("partial TPs use ORIGINAL quantity and only remaining quantity accrues funding", () => {
        const r = simulate({ ...base, tps: [{ price: 105, pct: 25, hours: 6 }, { price: 110, pct: 25, hours: 12 }], exit: 120 });
        expect(r.rows.map(x => x.qty)).toEqual([12.5, 12.5, 25]);
        expect(r.gross).toBe(687.5);
        expect(r.fees).toBe(16.375);
        expect(r.funding).toBe(8.25);
        expect(r.net).toBe(662.875);
    });
    it("does not accrue after 100% has closed", () => {
        const r = simulate({ ...base, tps: [{ price: 110, pct: 100, hours: 2 }] });
        expect(r.rows).toHaveLength(1);
        expect(r.funding).toBe(1);
        expect(r.rows[0]!.liquidationAfter).toBeNull();
    });
    it("settles hourly before coincident closes, without prorating fractional hours", () => {
        const r = simulate({ ...base, hours: 1.9, tps: [{ price: 105, pct: 50, hours: .5 }] });
        expect(r.rows[0]!.funding).toBe(0);
        expect(r.rows[1]!.funding).toBe(.25);
    });
    it.each(["LONG", "SHORT"] as const)("executes protective stop on remaining quantity: %s", side => {
        const r = simulate({ ...base, side, stop: side === "LONG" ? 95 : 105, exit: side === "LONG" ? 80 : 120 });
        expect(r.rows[0]!.price).toBe(side === "LONG" ? 95 : 105);
        expect(r.rows[0]!.label).toMatch(/Stop/);
        expect(r.gross).toBe(-250);
    });
    it("keeps realized profit and collateral after partial close", () => {
        const r = simulate({ ...base, entryFee: 0, exitFee: 0, funding: 0, tps: [{ price: 110, pct: 50, hours: 1 }] });
        expect(r.rows[0]!.liquidationAfter).toBeCloseTo((25 * 100 - 1250) / (25 * .975), 10);
    });
    it("marks a path through liquidation as infeasible", () => {
        const r = simulate({ ...base, stop: 50, exit: 60 });
        expect(r.invalid).toBe(true);
    });
    it("warns when asset tier prohibits requested leverage", () => {
        const r = simulate({ ...base, leverage: 20, tiers: [{ lower: 0, maxLeverage: 10 }] });
        expect(r.invalid).toBe(true);
        expect(r.warnings.join(" ")).toMatch(/limite/);
    });
    it.each([{ margin: 0 }, { entry: NaN }, { leverage: 21 }, { entryFee: -.01 }, { stop: 101 }, { hours: -1 }, { tps: [{ price: 105, pct: 101, hours: 1 }] }, { tps: [{ price: 105, pct: 25, hours: 25 }] }, { tps: [{ price: 110, pct: 25, hours: 2 }, { price: 105, pct: 25, hours: 1 }] }])("rejects invalid input %j", change => expect(() => simulate({ ...base, ...change })).toThrow());
    it("no tiers never fabricates liquidation", () => expect(simulate({ ...base, tiers: [] }).liq).toBeNull());
    it("finite overflow fails safely", () => expect(() => simulate({ ...base, margin: 1e308 })).toThrow());
});
describe("tiered liquidation", () => {
    const tiers = [{ lower: 0, maxLeverage: 20 }, { lower: 10000, maxLeverage: 10 }];
    it.each(["LONG","SHORT"] as const)("dragging liquidation preserves quantity and inverts the tier equation (%s)",side=>{
        const p=side==="LONG"?88:115,margin=marginAtLiquidation(100,110,p,side,tiers,5)!;
        expect(liquidation(100,110,margin-5,side,tiers)).toBeCloseTo(p,10);
    });
    it.each(["LONG", "SHORT"] as const)("satisfies equity = maintenance at the correct liquidation tier (%s)", side => {
        const entry = 100, qty = 110, collateral = 1500, p = liquidation(entry, qty, collateral, side, tiers)!;
        const equity = collateral + (side === "LONG" ? 1 : -1) * qty * (p - entry);
        const mm = p * qty < 10000 ? p * qty * .025 : p * qty * .05 - 250;
        expect(equity).toBeCloseTo(mm, 8);
    });
    it("re-evaluates tier at liquidation rather than fixing entry tier", () => {
        const p = liquidation(100, 110, 1500, "LONG", tiers)!;
        expect(p * 110).toBeLessThan(10000);
        expect(p).toBeCloseTo(9500 / (110 * .975), 10);
    });
    it("LONG fully collateralized with no fees has no positive liquidation price", () => expect(liquidation(100, 10, 1000, "LONG", tiers)).toBeNull());
    it("maintenance deductions are continuous at threshold", () => {
        expect(liquidation(100, 100, 250, "LONG", tiers)).toBeCloseTo(100, 10);
    });
});
