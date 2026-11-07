/** Formatação pt-BR única para toda a aplicação (corrige a mistura de "." e "," das referências). */
import { d, Decimal, DecimalInput } from "./decimal";

export type Currency = "BRL" | "USD" | "BTC";

const nf = (opts: Intl.NumberFormatOptions) => new Intl.NumberFormat("pt-BR", opts);
const BRL = nf({ style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const USD = nf({ style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PCT = nf({ style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function fmtMoney(v: DecimalInput | null | undefined, cur: Currency, opts: { signed?: boolean; compact?: boolean } = {}): string {
  if (v === null || v === undefined) return "—";
  const x = d(v);
  const sign = opts.signed && x.gt(0) ? "+" : "";
  if (cur === "BTC") return `${sign}${fmtBtc(x)} BTC`;
  const n = x.toNumber();
  if (opts.compact && Math.abs(n) >= 10_000) {
    const c = nf({ style: "currency", currency: cur, notation: "compact", maximumFractionDigits: 1 });
    return sign + c.format(n);
  }
  return sign + (cur === "BRL" ? BRL : USD).format(n);
}

/** BTC sempre com 8 casas e separadores pt-BR: 0,27681572. */
export function fmtBtc(v: DecimalInput | null | undefined, dp = 8): string {
  if (v === null || v === undefined) return "—";
  return nf({ minimumFractionDigits: dp, maximumFractionDigits: dp }).format(d(v).toDecimalPlaces(dp).toNumber());
}

export function fmtSats(v: DecimalInput): string {
  return `${nf({ maximumFractionDigits: 0 }).format(d(v).mul(1e8).toDecimalPlaces(0).toNumber())} sats`;
}

export function fmtPct(v: DecimalInput | null | undefined, opts: { signed?: boolean } = {}): string {
  if (v === null || v === undefined) return "—";
  const x = d(v);
  return (opts.signed && x.gt(0) ? "+" : "") + PCT.format(x.toNumber());
}

export function fmtNum(v: DecimalInput | null | undefined, dp = 2): string {
  if (v === null || v === undefined) return "—";
  return nf({ minimumFractionDigits: dp, maximumFractionDigits: dp }).format(d(v).toNumber());
}

/** Converte um valor em USD para a moeda de exibição. */
export function convertUsd(usd: Decimal | null | undefined, cur: Currency, rates: { usdBrl: DecimalInput | null; btcUsd: DecimalInput | null }): Decimal | null {
  if (usd === null || usd === undefined) return null;
  if (cur === "USD") return usd;
  if (cur === "BRL") return rates.usdBrl ? usd.mul(d(rates.usdBrl)) : null;
  return rates.btcUsd ? usd.div(d(rates.btcUsd)) : null;
}

export function shortAddr(a: string | null | undefined): string {
  if (!a) return "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function fmtDateTime(ts: number): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(ts * 1000);
}

export function fmtRelative(ts: number, now = Date.now() / 1000): string {
  const s = Math.max(0, Math.round(now - ts));
  if (s < 60) return `há ${s}s`;
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86400)} d`;
}
