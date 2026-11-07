/**
 * Classificador de cenário de mercado: ACUMULAÇÃO | NEUTRO | REALIZAÇÃO | RISCO ELEVADO.
 *
 * Regras documentadas e configuráveis (DEFAULT_SCENARIO_RULES). Cada regra soma pontos
 * para "acumulação" (negativos) ou "realização" (positivos). Regras de risco podem
 * forçar RISCO ELEVADO. A incerteza cresce quando faltam dados ou as regras discordam.
 *
 * Não identifica fundos ou topos; resume o contexto para apoio à decisão.
 */
import { atr, bollinger, Candle, last, realizedVol, rsi, sma, trendStructure } from "./indicators";

export type Scenario = "ACUMULACAO" | "NEUTRO" | "REALIZACAO" | "RISCO_ELEVADO";

export interface ScenarioInputs {
  dailyCandles: Candle[];
  fundingRate8h?: number | null; // ex.: 0.0001 = 0,01% a cada 8h
  fearGreed?: number | null; // 0–100
  /** Alavancagem efetiva da carteira (nocional / patrimônio). */
  portfolioLeverage?: number | null;
  /** Menor distância até a liquidação entre as posições abertas (fração). */
  minLiquidationDistance?: number | null;
}

export interface ScenarioRules {
  rsiOversold: number;
  rsiOverbought: number;
  mayerLow: number; // preço / MM200
  mayerHigh: number;
  drawdownDeep: number; // queda desde a máxima de 365 dias
  fundingHot: number; // por 8h
  fundingCold: number;
  fearExtreme: number;
  greedExtreme: number;
  volHigh: number; // volatilidade anualizada
  leverageMax: number;
  liqDistanceMin: number;
  threshold: number; // pontos para sair do NEUTRO
}

export const DEFAULT_SCENARIO_RULES: ScenarioRules = {
  rsiOversold: 30,
  rsiOverbought: 70,
  mayerLow: 0.9,
  mayerHigh: 2.0,
  drawdownDeep: 0.3,
  fundingHot: 0.0003,
  fundingCold: -0.0001,
  fearExtreme: 20,
  greedExtreme: 80,
  volHigh: 0.8,
  leverageMax: 2,
  liqDistanceMin: 0.15,
  threshold: 3,
};

export interface RuleHit {
  rule: string;
  points: number; // <0 acumulação, >0 realização, 0 informativo
  detail: string;
  risk?: boolean;
}

export interface ScenarioResult {
  scenario: Scenario;
  score: number;
  hits: RuleHit[];
  dataUsed: Record<string, number | string | null>;
  uncertainty: "BAIXA" | "MEDIA" | "ALTA";
  uncertaintyReasons: string[];
  disclaimer: string;
}

export function classifyScenario(inp: ScenarioInputs, rules: ScenarioRules = DEFAULT_SCENARIO_RULES): ScenarioResult {
  const c = inp.dailyCandles;
  const closes = c.map((k) => k.c);
  const price = closes[closes.length - 1] ?? null;
  const hits: RuleHit[] = [];
  const missing: string[] = [];

  const r = last(rsi(closes, 14));
  const m200 = last(sma(closes, 200));
  const vol = last(realizedVol(closes, 30));
  const a = last(atr(c, 14));
  const bb = bollinger(closes, 20, 2);
  const bbU = last(bb.upper), bbL = last(bb.lower);
  const high365 = c.length ? Math.max(...c.slice(-365).map((k) => k.h)) : null;
  const dd = price && high365 ? 1 - price / high365 : null;
  const mayer = price && m200 ? price / m200 : null;
  const trend = closes.length >= 50 ? trendStructure(closes) : null;

  if (r == null) missing.push("RSI");
  else if (r <= rules.rsiOversold) hits.push({ rule: "RSI sobrevendido", points: -2, detail: `RSI(14) diário ${r.toFixed(1)} ≤ ${rules.rsiOversold}.` });
  else if (r >= rules.rsiOverbought) hits.push({ rule: "RSI sobrecomprado", points: 2, detail: `RSI(14) diário ${r.toFixed(1)} ≥ ${rules.rsiOverbought}.` });
  else hits.push({ rule: "RSI neutro", points: 0, detail: `RSI(14) diário ${r.toFixed(1)}.` });

  if (mayer == null) missing.push("MM200 (Mayer Multiple)");
  else if (mayer <= rules.mayerLow) hits.push({ rule: "Preço muito abaixo da MM200", points: -2, detail: `Preço/MM200 = ${mayer.toFixed(2)} ≤ ${rules.mayerLow}.` });
  else if (mayer >= rules.mayerHigh) hits.push({ rule: "Preço muito acima da MM200", points: 2, detail: `Preço/MM200 = ${mayer.toFixed(2)} ≥ ${rules.mayerHigh}.` });
  else hits.push({ rule: "Preço/MM200", points: 0, detail: `Preço/MM200 = ${mayer.toFixed(2)}.` });

  if (dd == null) missing.push("Drawdown 365d");
  else if (dd >= rules.drawdownDeep) hits.push({ rule: "Queda profunda desde a máxima", points: -1, detail: `${(dd * 100).toFixed(1)}% abaixo da máxima de 365 dias.` });

  if (price != null && bbL != null && bbU != null) {
    if (price < bbL) hits.push({ rule: "Abaixo da banda inferior", points: -1, detail: "Fechamento abaixo da Bollinger inferior (20, 2)." });
    else if (price > bbU) hits.push({ rule: "Acima da banda superior", points: 1, detail: "Fechamento acima da Bollinger superior (20, 2)." });
  }

  if (inp.fundingRate8h == null) missing.push("Funding");
  else if (inp.fundingRate8h >= rules.fundingHot) hits.push({ rule: "Funding aquecido", points: 1, detail: `Funding ${(inp.fundingRate8h * 100).toFixed(4)}%/8h: longs alavancados pagando caro.` });
  else if (inp.fundingRate8h <= rules.fundingCold) hits.push({ rule: "Funding negativo", points: -1, detail: `Funding ${(inp.fundingRate8h * 100).toFixed(4)}%/8h: shorts pagando.` });

  if (inp.fearGreed == null) missing.push("Fear & Greed");
  else if (inp.fearGreed <= rules.fearExtreme) hits.push({ rule: "Medo extremo", points: -1, detail: `Fear & Greed ${inp.fearGreed}.` });
  else if (inp.fearGreed >= rules.greedExtreme) hits.push({ rule: "Ganância extrema", points: 1, detail: `Fear & Greed ${inp.fearGreed}.` });

  if (trend) hits.push({ rule: `Tendência ${trend.state.toLowerCase()}`, points: 0, detail: trend.reasons.join(" ") });

  // Regras de risco (independentes da direção)
  if (vol != null && vol >= rules.volHigh) hits.push({ rule: "Volatilidade alta", points: 0, risk: true, detail: `Volatilidade realizada 30d anualizada ${(vol * 100).toFixed(0)}%.` });
  if (inp.portfolioLeverage != null && inp.portfolioLeverage > rules.leverageMax) hits.push({ rule: "Alavancagem acima do limite", points: 0, risk: true, detail: `Alavancagem efetiva ${inp.portfolioLeverage.toFixed(2)}x > ${rules.leverageMax}x.` });
  if (inp.minLiquidationDistance != null && inp.minLiquidationDistance < rules.liqDistanceMin) hits.push({ rule: "Liquidação próxima", points: 0, risk: true, detail: `Posição a ${(inp.minLiquidationDistance * 100).toFixed(1)}% da liquidação.` });

  const score = hits.reduce((s, h) => s + h.points, 0);
  const riskHits = hits.filter((h) => h.risk);
  const scenario: Scenario = riskHits.length > 0 ? "RISCO_ELEVADO" : score <= -rules.threshold ? "ACUMULACAO" : score >= rules.threshold ? "REALIZACAO" : "NEUTRO";

  const pos = hits.filter((h) => h.points > 0).length, neg = hits.filter((h) => h.points < 0).length;
  const uncertaintyReasons: string[] = [];
  if (missing.length) uncertaintyReasons.push(`Dados ausentes: ${missing.join(", ")}.`);
  if (pos && neg) uncertaintyReasons.push(`Sinais conflitantes (${neg} de acumulação, ${pos} de realização).`);
  if (c.length < 200) uncertaintyReasons.push(`Histórico curto (${c.length} dias).`);
  const uncertainty = missing.length >= 2 || (pos && neg) ? "ALTA" : missing.length === 1 || c.length < 200 ? "MEDIA" : "BAIXA";

  return {
    scenario, score, hits,
    dataUsed: { price, rsi14: r, sma200: m200, mayer, drawdown365: dd, vol30: vol, atr14: a, fundingRate8h: inp.fundingRate8h ?? null, fearGreed: inp.fearGreed ?? null },
    uncertainty, uncertaintyReasons,
    disclaimer: "Classificação por regras fixas sobre dados históricos. Não prevê topos ou fundos e não é recomendação de investimento.",
  };
}

export const SCENARIO_LABEL: Record<Scenario, string> = {
  ACUMULACAO: "Acumulação",
  NEUTRO: "Neutro",
  REALIZACAO: "Realização",
  RISCO_ELEVADO: "Risco elevado",
};
