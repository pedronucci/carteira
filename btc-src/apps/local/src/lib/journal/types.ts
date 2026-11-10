/** Anotações do usuário sobre uma operação detectada na Hyperliquid. Guardadas no aparelho; nunca alteram resultados. */
export interface TradeNote {
  /** id da operação: `${conta}|${chave da primeira execução}` (o mesmo id é usado no Journal, no gráfico e na atribuição) */
  uid: string;
  strategy: string; thesis: string; plannedStop: number | null; plannedTps: number[]; notes: string;
  /** avaliação pessoal de 1 a 5 */ rating: number | null; tags: string[]; updatedAt: number;
}
export const emptyNote = (uid: string): TradeNote => ({ uid, strategy: "", thesis: "", plannedStop: null, plannedTps: [], notes: "", rating: null, tags: [], updatedAt: 0 });
