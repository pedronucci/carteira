/**
 * Aritmética decimal para todo valor monetário e quantidade de token.
 * Nunca use `number` para dinheiro: 0.1 + 0.2 !== 0.3.
 */
import DecimalJs from "decimal.js";

export const Decimal = DecimalJs.clone({ precision: 50, rounding: DecimalJs.ROUND_HALF_EVEN });
export type Decimal = InstanceType<typeof Decimal>;
export type DecimalInput = Decimal | string | number | bigint;

export const ZERO = new Decimal(0);
export const ONE = new Decimal(1);

export function d(v: DecimalInput | null | undefined): Decimal {
  if (v === null || v === undefined) return ZERO;
  if (typeof v === "bigint") return new Decimal(v.toString());
  if (v instanceof Decimal) return v;
  return new Decimal(v);
}

/** Converte unidades inteiras on-chain (ex.: 150000000 sats de WBTC) em decimal humano. */
export function fromUnits(raw: string | bigint, decimals: number): Decimal {
  return d(typeof raw === "bigint" ? raw.toString() : raw).div(new Decimal(10).pow(decimals));
}

export function sum(values: Decimal[]): Decimal {
  return values.reduce((acc, v) => acc.plus(v), ZERO);
}

export function maxD(a: Decimal, b: Decimal): Decimal {
  return a.gte(b) ? a : b;
}

export function minD(a: Decimal, b: Decimal): Decimal {
  return a.lte(b) ? a : b;
}

/** Divisão segura: retorna null quando o divisor é zero (ex.: preço médio sem posição). */
export function safeDiv(a: Decimal, b: Decimal): Decimal | null {
  return b.isZero() ? null : a.div(b);
}

/** Serializa para string fixa (API/DB). BTC com 8 casas, USD com 2..8 conforme o uso. */
export function toFixed(v: Decimal | null | undefined, dp = 8): string | null {
  return v ? v.toDecimalPlaces(dp, Decimal.ROUND_HALF_EVEN).toFixed(dp) : null;
}

/** Para gráficos e indicadores (não-monetários) apenas. */
export function toNumber(v: Decimal | null | undefined): number | null {
  return v ? v.toNumber() : null;
}
