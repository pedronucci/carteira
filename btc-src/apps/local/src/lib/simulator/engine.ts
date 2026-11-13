import { d } from "@bst/domain";
export interface Tier {
    lower: number;
    maxLeverage: number;
}
export interface Input {
    entry: number;
    margin: number;
    leverage: number;
    side: "LONG" | "SHORT";
    entryFee: number;
    exitFee: number;
    funding: number;
    fundingPrice: number;
    stop: number;
    exit: number;
    hours: number;
    tps: {
        price: number;
        pct: number;
        hours: number;
    }[];
    tiers: Tier[];
}
const num = (x: ReturnType<typeof d>) => { const n = x.toNumber(); if (!Number.isFinite(n))
    throw Error("Valores excedem a capacidade numérica da simulação."); return n; };
export function liquidation(entry: number, qty: number, collateral: number, side: Input["side"], tiers: Tier[]): number | null {
    if (!tiers.length || qty <= 0)
        return null;
    let deduction = d(0), prev = d(0);
    const sign = side === "LONG" ? 1 : -1;
    for (let i = 0; i < tiers.length; i++) {
        const t = tiers[i]!, rate = d(1).div(2 * t.maxLeverage);
        deduction = deduction.plus(d(t.lower).mul(rate.minus(prev)));
        prev = rate;
        const p = d(qty).mul(entry).mul(sign).minus(collateral).minus(deduction).div(d(qty).mul(d(sign).minus(rate)));
        if (p.gt(0) && p.mul(qty).gte(t.lower) && (i === tiers.length - 1 || p.mul(qty).lt(tiers[i + 1]!.lower)))
            return num(p);
    }
    return null;
}
/** Initial cash required to move liquidation, preserving the original position quantity. */
export function marginAtLiquidation(entry:number,qty:number,price:number,side:Input["side"],tiers:Tier[],openingFee:number):number|null {
    if(!tiers.length||qty<=0||price<=0)return null;
    let rate=d(0),deduction=d(0);
    for(const t of [...tiers].sort((a,b)=>a.lower-b.lower)){
        if(d(qty).mul(price).lt(t.lower))break;
        const next=d(1).div(d(2).mul(t.maxLeverage));
        deduction=deduction.plus(d(t.lower).mul(next.minus(rate)));rate=next;
    }
    return num(d(qty).mul(price).mul(rate).minus(deduction).minus(d(qty).mul(d(price).minus(entry)).mul(side==="LONG"?1:-1)).plus(openingFee));
}
export function simulate(i: Input) {
    const values = [i.entry, i.margin, i.leverage, i.entryFee, i.exitFee, i.funding, i.fundingPrice, i.stop, i.exit, i.hours, ...i.tps.flatMap(t => [t.price, t.pct, t.hours])];
    if (values.some(v => !Number.isFinite(v)) || i.entry <= 0 || i.margin <= 0 || i.leverage < 1 || i.leverage > 20 || i.stop <= 0 || i.exit <= 0 || i.fundingPrice <= 0 || i.hours < 0 || i.entryFee < 0 || i.entryFee >= .1 || i.exitFee < 0 || i.exitFee >= .1)
        throw Error("Preencha valores finitos e positivos; taxas de 0 a menos de 10% e alavancagem de 1 a 20x.");
    const sign = i.side === "LONG" ? 1 : -1;
    if (sign * (i.stop - i.entry) >= 0)
        throw Error("Stop deve estar abaixo da entrada no LONG e acima no SHORT.");
    const total = num(i.tps.reduce((s, t) => s.plus(t.pct), d(0)));
    if (total > 100 || i.tps.some(t => t.pct <= 0 || t.price <= 0 || t.hours < 0 || t.hours > i.hours || sign * (t.price - i.entry) <= 0))
        throw Error("TPs devem favorecer a direção, somar até 100% e ocorrer dentro do prazo total.");
    if (i.tps.some((t, n) => n > 0 && (t.hours < i.tps[n - 1]!.hours || sign * (t.price - i.tps[n - 1]!.price) < 0)))
        throw Error("Ordene os TPs por preço favorável e horário crescente.");
    const tiers = [...i.tiers].sort((a, b) => a.lower - b.lower);
    if (tiers.some((t, n) => !Number.isFinite(t.lower) || !Number.isFinite(t.maxLeverage) || t.lower < 0 || t.maxLeverage < 1 || n > 0 && t.lower <= tiers[n - 1]!.lower) || tiers.length && tiers[0]!.lower !== 0)
        throw Error("Faixas de margem inválidas.");
    const notional = d(i.margin).mul(i.leverage), qty = notional.div(i.entry), opening = notional.mul(i.entryFee);
    const limit = [...tiers].reverse().find(t => notional.gte(t.lower))?.maxLeverage;
    const warnings: string[] = [];
    if (limit && i.leverage > limit)
        warnings.push(`Alavancagem superior ao limite desta faixa (${limit}x). Cenário não executável na exchange.`);
    if (limit && d(i.margin).minus(opening).lt(notional.div(limit)))
        warnings.push("Margem após taxa insuficiente para a exigência inicial da exchange.");
    const liq = liquidation(i.entry, num(qty), num(d(i.margin).minus(opening)), i.side, tiers);
    let remaining = qty, collateral = d(i.margin).minus(opening), fund = d(0), fees = opening, gross = d(0), time = 0, previousPrice = i.entry, invalid = !!limit && (i.leverage > limit || d(i.margin).minus(opening).lt(notional.div(limit)));
    const stopped = sign * (i.exit - i.stop) <= 0 && total < 100;
    if (stopped)
        warnings.push("A saída cruza o Stop Loss: o restante é encerrado no stop, supondo execução sem gap ou slippage.");
    const rows = [];
    for (const t of [...i.tps.map((t, n) => ({ ...t, label: `TP ${n + 1}` })), { price: stopped ? i.stop : i.exit, pct: 100 - total, hours: i.hours, label: stopped ? "Stop Loss restante" : "Saída restante" }]) {
        if (remaining.lte(0))
            break;
        // Open immediately after a settlement; at coincident times funding precedes closure.
        const boundaryBefore = liquidation(i.entry, num(remaining), num(collateral), i.side, tiers);
        const charge = remaining.mul(i.fundingPrice).mul(i.funding).mul(sign).mul(Math.floor(t.hours) - Math.floor(time));
        time = t.hours;
        fund = fund.plus(charge);
        collateral = collateral.minus(charge);
        const boundary = liquidation(i.entry, num(remaining), num(collateral), i.side, tiers);
        const adversePrice = Math.min(sign * previousPrice, sign * t.price);
        if ([boundaryBefore, boundary].some(b => b != null && adversePrice <= sign * b))
            invalid = true;
        const q = qty.mul(t.pct).div(100), pnl = q.mul(d(t.price).minus(i.entry)).mul(sign), fee = q.mul(t.price).mul(i.exitFee);
        gross = gross.plus(pnl);
        fees = fees.plus(fee);
        collateral = collateral.plus(pnl).minus(fee);
        remaining = remaining.minus(q);
        previousPrice = t.price;
        rows.push({ label: t.label, price: t.price, pct: t.pct, qty: num(q), gross: num(pnl), fee: num(fee), funding: num(charge), remaining: num(remaining), liquidationAfter: liquidation(i.entry, num(remaining), num(collateral), i.side, tiers) });
    }
    const net = gross.minus(fees).minus(fund);
    const stopGross = qty.mul(d(i.stop).minus(i.entry)).mul(sign), stopNet = stopGross.minus(opening).minus(qty.mul(i.stop).mul(i.exitFee)).minus(qty.mul(i.fundingPrice).mul(i.funding).mul(sign).mul(Math.floor(i.hours)));
    if (invalid)
        warnings.push("Cenário incompatível com margem inicial ou cruza a faixa de liquidação estimada. PnL apenas algébrico; execução real e custos de liquidação são desconhecidos. A checagem de trajetória é conservadora entre os níveis informados.");
    if (liq != null && sign * (i.stop - liq) <= 0)
        warnings.push("Stop está além da liquidação estimada e pode não proteger a posição.");
    return { qty: num(qty), notional: num(notional), opening: num(opening), gross: num(gross), fees: num(fees), funding: num(fund), net: num(net), roe: num(net.div(i.margin)), stopNet: num(stopNet), rr: stopNet.lt(0) ? num(net.div(stopNet.neg())) : null, liq, rows, warnings, invalid };
}
