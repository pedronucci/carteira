/**
 * Avaliação de alertas com deduplicação e controle de frequência.
 * Um alerta dispara na TRANSIÇÃO (condição passa de falsa a verdadeira), respeitando cooldown.
 */
export type AlertType =
  | "PRICE_ABOVE" | "PRICE_BELOW" | "RSI_ABOVE" | "RSI_BELOW"
  | "CROSS_SMA_UP" | "CROSS_SMA_DOWN" | "EQUITY_ABOVE" | "DRAWDOWN_ABOVE"
  | "LEVERAGE_ABOVE" | "LIQ_DISTANCE_BELOW" | "NEW_TRANSACTION" | "SYNC_FAILURE";

export interface AlertRule {
  id: string;
  type: AlertType;
  threshold?: number;
  smaPeriod?: number;
  cooldownSec: number;
  enabled: boolean;
}

export interface AlertState {
  lastConditionTrue: boolean;
  lastFiredAt: number | null;
}

export interface MarketContext {
  now: number;
  price?: number | null;
  prevPrice?: number | null;
  rsi?: number | null;
  sma?: Record<number, { cur: number | null; prev: number | null }>;
  equityUsd?: number | null;
  drawdown?: number | null;
  leverage?: number | null;
  minLiqDistance?: number | null;
  newTransactions?: number;
  syncFailures?: number;
}

export function evaluateCondition(rule: AlertRule, ctx: MarketContext): { ok: boolean | null; message: string } {
  const t = rule.threshold ?? 0;
  const p = ctx.price ?? null;
  switch (rule.type) {
    case "PRICE_ABOVE": return { ok: p == null ? null : p >= t, message: `BTC acima de US$ ${t.toLocaleString("pt-BR")}` };
    case "PRICE_BELOW": return { ok: p == null ? null : p <= t, message: `BTC abaixo de US$ ${t.toLocaleString("pt-BR")}` };
    case "RSI_ABOVE": return { ok: ctx.rsi == null ? null : ctx.rsi >= t, message: `RSI(14) acima de ${t} (sobrecompra)` };
    case "RSI_BELOW": return { ok: ctx.rsi == null ? null : ctx.rsi <= t, message: `RSI(14) abaixo de ${t} (sobrevenda)` };
    case "CROSS_SMA_UP":
    case "CROSS_SMA_DOWN": {
      const m = ctx.sma?.[rule.smaPeriod ?? 200];
      if (!m || m.cur == null || m.prev == null || p == null || ctx.prevPrice == null) return { ok: null, message: "" };
      const up = ctx.prevPrice < m.prev && p >= m.cur;
      const down = ctx.prevPrice > m.prev && p <= m.cur;
      return { ok: rule.type === "CROSS_SMA_UP" ? up : down, message: `Preço cruzou a MM${rule.smaPeriod ?? 200} para ${rule.type === "CROSS_SMA_UP" ? "cima" : "baixo"}` };
    }
    case "EQUITY_ABOVE": return { ok: ctx.equityUsd == null ? null : ctx.equityUsd >= t, message: `Patrimônio atingiu US$ ${t.toLocaleString("pt-BR")}` };
    case "DRAWDOWN_ABOVE": return { ok: ctx.drawdown == null ? null : ctx.drawdown >= t, message: `Drawdown acima de ${(t * 100).toFixed(1)}%` };
    case "LEVERAGE_ABOVE": return { ok: ctx.leverage == null ? null : ctx.leverage >= t, message: `Alavancagem acima de ${t}x` };
    case "LIQ_DISTANCE_BELOW": return { ok: ctx.minLiqDistance == null ? null : ctx.minLiqDistance <= t, message: `Posição a menos de ${(t * 100).toFixed(1)}% da liquidação` };
    case "NEW_TRANSACTION": return { ok: (ctx.newTransactions ?? 0) > 0, message: `${ctx.newTransactions ?? 0} nova(s) transação(ões) identificada(s)` };
    case "SYNC_FAILURE": return { ok: (ctx.syncFailures ?? 0) > 0, message: "Falha na sincronização de carteira" };
  }
}

/** Retorna se deve disparar e o novo estado. Condição desconhecida (null) não muda o estado. */
export function step(rule: AlertRule, state: AlertState, ctx: MarketContext): { fire: boolean; state: AlertState; message: string } {
  const { ok, message } = evaluateCondition(rule, ctx);
  if (!rule.enabled || ok === null) return { fire: false, state, message };
  // eventos pontuais (cruzamento, nova tx, falha) não exigem transição
  const pulse = ["CROSS_SMA_UP", "CROSS_SMA_DOWN", "NEW_TRANSACTION", "SYNC_FAILURE"].includes(rule.type);
  const rising = ok && (pulse || !state.lastConditionTrue);
  const cooled = state.lastFiredAt == null || ctx.now - state.lastFiredAt >= rule.cooldownSec;
  const fire = rising && cooled;
  return { fire, state: { lastConditionTrue: ok, lastFiredAt: fire ? ctx.now : state.lastFiredAt }, message };
}

/** Chave de deduplicação: mesma regra + mesma janela de cooldown = um único evento. */
export function dedupKey(rule: AlertRule, now: number): string {
  const bucket = Math.floor(now / Math.max(60, rule.cooldownSec));
  return `${rule.id}:${bucket}`;
}
