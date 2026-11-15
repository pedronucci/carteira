import { d } from "@bst/domain";
/** Exact token units until presentation; prices are token1 per token0. */
export function amounts(liquidity: string, sqrtPrice: string, lowerTick: number, upperTick: number, dec0: number, dec1: number) {
    if (!Number.isInteger(lowerTick) || !Number.isInteger(upperTick) || lowerTick >= upperTick || lowerTick < -887272 || upperTick > 887272 || ![dec0, dec1].every(x => Number.isInteger(x) && x >= 0 && x <= 255))
        throw Error("Faixa ou decimais inválidos");
    const l = d(liquidity), s = d(sqrtPrice).div(d(2).pow(96)), a = d("1.0001").pow(lowerTick).sqrt(), b = d("1.0001").pow(upperTick).sqrt();
    if (l.lt(0) || s.lte(0))
        throw Error("Liquidez/preço inválido");
    const p = s.lt(a) ? a : s.gt(b) ? b : s;
    return [l.mul(b.minus(p)).div(p.mul(b)).div(d(10).pow(dec0)).toString(), l.mul(p.minus(a)).div(d(10).pow(dec1)).toString()];
}
export function pnl(value: number, deposits: number, withdrawals: number, collected: number, gas: number, complete: boolean) {
    if (!complete)
        return null;
    if (![value, deposits, withdrawals, collected, gas].every(x => Number.isFinite(x) && x >= 0))
        throw Error("Valores inválidos");
    return d(value).plus(withdrawals).plus(collected).minus(deposits).minus(gas).toNumber();
}
export function simulateLP(capital: number, entry: number, exit: number, lower: number, upper: number, model: "v2" | "cl", fees: number, gas: number) {
    if (![capital, entry, exit, lower, upper, fees, gas].every(Number.isFinite) || capital <= 0 || entry <= 0 || exit <= 0 || fees < 0 || gas < 0 || lower <= 0 || upper <= lower)
        throw Error("Informe capital e preços positivos e custos não negativos.");
    const c = d(capital), e = d(entry), p = d(exit);
    let hold, lp;
    if (model === "v2") {
        hold = c.div(2).mul(p.div(e).plus(1));
        lp = c.mul(p.div(e).sqrt());
    }
    else {
        if (entry < lower || entry > upper)
            throw Error("Entrada deve estar dentro da faixa concentrada.");
        const a = d(lower).sqrt(), b = d(upper).sqrt(), s = e.sqrt();
        const x = b.minus(s).div(s.mul(b)), y = s.minus(a), l = c.div(x.mul(e).plus(y));
        const z = p.sqrt(), clamped = z.lt(a) ? a : z.gt(b) ? b : z;
        hold = l.mul(x.mul(p).plus(y));
        lp = l.mul(b.minus(clamped).div(clamped.mul(b)).mul(p).plus(clamped.minus(a)));
    }
    const il = lp.minus(hold), net = lp.plus(fees).minus(gas), result = net.minus(c);
    const out={ lp: lp.toNumber(), hold: hold.toNumber(), il: il.toNumber(), ilPct: il.div(hold).toNumber(), net: net.toNumber(), pnl: result.toNumber(), roe: result.div(c).toNumber() };
    if(Object.values(out).some(v=>!Number.isFinite(v)))throw Error("Valores excedem a capacidade numérica");
    return out;
}
export function uniquePositions(rows: import("./types").LPPosition[]) { return [...new Map(rows.map(p => [p.id, p])).values()]; }
