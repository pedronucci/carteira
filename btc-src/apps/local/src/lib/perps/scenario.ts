/** Cenários de preço em margem CRUZADA: a liquidação depende do conjunto da conta, não de cada posição isolada. Estimativa, não garantia. */
export interface SimPos { coin: string; szi: number; mark: number; upnl: number; marginUsed: number; maintRate: number; liqPx: number | null }
export interface SimInput { accountValue: number; positions: SimPos[]; otherEquity?: number }
export interface PosResult { coin: string; newMark: number; pnlDelta: number; newUpnl: number; newNotional: number; maintMargin: number }
export interface SimResult {
  shocks: Record<string, number>; positions: PosResult[]; pnlDelta: number; newAccountValue: number; accountChangePct: number | null;
  maintMarginTotal: number; marginRatio: number | null; liquidated: boolean; bufferUsd: number; newConsolidated: number | null; note: string;
}

export const SIM_NOTE = "Estimativa: taxas, funding e as regras de margem da corretora podem alterar o resultado. Não é valor garantido.";

export function simulate(input: SimInput, shocks: Record<string, number>): SimResult {
  const positions: PosResult[] = input.positions.map((p) => {
    const newMark = p.mark * (1 + (shocks[p.coin] ?? 0));
    const pnlDelta = p.szi * (newMark - p.mark);
    const newNotional = Math.abs(p.szi) * newMark;
    return { coin: p.coin, newMark, pnlDelta, newUpnl: p.upnl + pnlDelta, newNotional, maintMargin: newNotional * p.maintRate };
  });
  const pnlDelta = positions.reduce((a, p) => a + p.pnlDelta, 0);
  const newAccountValue = input.accountValue + pnlDelta;
  const maintMarginTotal = positions.reduce((a, p) => a + p.maintMargin, 0);
  return {
    shocks, positions, pnlDelta, newAccountValue,
    accountChangePct: input.accountValue > 0 ? newAccountValue / input.accountValue - 1 : null,
    maintMarginTotal, marginRatio: newAccountValue > 0 ? maintMarginTotal / newAccountValue : null,
    liquidated: newAccountValue <= maintMarginTotal, bufferUsd: newAccountValue - maintMarginTotal,
    newConsolidated: input.otherEquity != null ? input.otherEquity + newAccountValue : null, note: SIM_NOTE,
  };
}

/** Variação uniforme (fração) nas moedas escolhidas que leva a conta ao limite de liquidação; a conta é linear nesse choque. */
export function breakEvenShock(input: SimInput, coins: string[] | "all"): number | null {
  const sel = input.positions.filter((p) => coins === "all" || coins.includes(p.coin));
  const base = simulate(input, {});
  const slope = sel.reduce((a, p) => a + p.szi * p.mark - Math.abs(p.szi) * p.mark * p.maintRate, 0);
  if (Math.abs(slope) < 1e-12) return null;
  const s = -(input.accountValue - base.maintMarginTotal) / slope;
  if (base.liquidated) return 0;
  return s > -0.99 && s < 3 ? s : null;
}

export function scenarioGrid(input: SimInput, coin: string, steps: number[]) {
  return steps.map((shock) => { const r = simulate(input, { [coin]: shock }); return { shock, newAccountValue: r.newAccountValue, liquidated: r.liquidated }; });
}
