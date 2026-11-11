/** Adaptadores do gráfico: as fórmulas pertencem ao domínio compartilhado. */
import { macd as domainMacd } from "@bst/domain";
export { sma, ema, rsi, bollinger } from "@bst/domain";
export type Series = (number | null)[];
export interface Macd { macd: Series; signal: Series; hist: Series }
export interface Boll { mid: Series; upper: Series; lower: Series }
export function macd(v: number[], fast = 12, slow = 26, sig = 9): Macd {
  const result = domainMacd(v, fast, slow, sig);
  return { macd: result.line, signal: result.signal, hist: result.hist };
}
