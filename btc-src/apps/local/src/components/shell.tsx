"use client";
import { useMemo } from "react";
import { Bitcoin } from "lucide-react";
import { useSnapshot } from "@/lib/api";
import { useFmt } from "@/lib/state";
import { inCcy, periodReturn } from "@/lib/local/engine";
import { fmtDuration } from "@/lib/local/strategy";
import { ScopeButton } from "./strategy";
import { STRATEGY_TABS, SubNav } from "./nav";
import { cn, Pill, toneOf } from "./ui";
import { useCountUp } from "./motion";
import { MetricStrip, SourceFooter, Spark, type StripItem } from "./terminal";

/** Topo das telas: seletor do ciclo, patrimônio, gráfico, status da posição e faixa de indicadores. */
export function Hero() {
  const q = useSnapshot();
  const f = useFmt();
  const s = q.data;
  const day = useMemo(() => (s ? periodReturn(inCcy(s.points.slice(-4), f.ccy, f.fx), 1, true) : null), [s, f.ccy, f.fx]);
  const eqAnim = useCountUp(s ? s.equity.toNumber() : null);
  const spark = useMemo(() => (s ? s.points.slice(-90).map((p) => ({ equity: p.equity, price: p.price })) : []), [s]);
  if (!s) return <div className="pt-3 pb-4"><SubNav items={STRATEGY_TABS} /><div className="mt-3"><ScopeButton /></div></div>;
  const c = s.current;
  const lev = c?.effLeverage ?? null;
  const liqD = c?.liqDist ? c.liqDist.toNumber() : null;
  const minLiq = Number(s.s.settings.minLiqDistance);
  const liqTone = liqD != null && liqD < minLiq ? ("loss" as const) : liqD != null && liqD < minLiq * 2 ? ("warn" as const) : ("gain" as const);
  const levMax = Math.max(6, Math.ceil((lev ?? 0) * 1.25));
  const items: StripItem[] = [
    { label: s.scope.kind === "account" ? "Resultado" : "Resultado do ciclo", tone: toneOf(s.result), value: f.money(s.result, { signed: true }), sub: s.roc != null ? `${f.pct(s.roc)} s/ capital` : undefined },
    { label: "TWR", tone: toneOf(s.twr), value: s.twr != null ? f.pct(s.twr) : "—", sub: "ponderado no tempo" },
    s.closed ? { label: "Duração", value: fmtDuration(s.endT - s.startT), sub: `até ${new Date(s.endT).toLocaleDateString("pt-BR")}` }
      : { label: day?.partial ? "Desde o início" : "24 h", tone: toneOf(day?.money), value: day ? f.cash(day.money, { signed: true }) : "—", sub: day ? f.pct(day.pct) : undefined },
    ...(c ? [
      { label: "Exposição", tone: liqTone === "loss" ? ("loss" as const) : null, value: lev != null ? `${lev.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×` : "—", sub: f.money(c.notional, { compact: true }), bar: lev != null ? { pct: lev / levMax, tone: liqTone } : undefined },
      ...(liqD != null && !s.closed ? [{ label: "Distância da liquidação", tone: liqTone, value: f.pct(liqD, false), sub: c.liq ? f.px(c.liq) : undefined, bar: { pct: liqD / 0.6, tone: liqTone } }] : []),
    ] : [{ label: "Estado", value: "100% USDC", sub: s.inUsdcSince ? `desde ${new Date(s.inUsdcSince).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}` : undefined }]),
    { label: "Maior queda", tone: s.maxDD > 0.001 ? ("loss" as const) : null, value: s.maxDD > 0.001 ? f.pct(-s.maxDD) : "0%", sub: "no ciclo" },
  ];
  return (
    <section aria-label="Estratégia BTC/USDC" className="pt-3 pb-5">
      <SubNav items={STRATEGY_TABS} />
      <div className="mt-4" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-[14px] font-semibold text-gold"><Bitcoin className="size-4" strokeWidth={2} />Estratégia BTC/USDC</h1>
        <ScopeButton />
      </div>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <div className="min-w-0">
          <p className="lbl">{s.closed ? "Patrimônio no encerramento" : "Patrimônio da estratégia"}</p>
          <p className="num mt-1.5 text-[34px] font-semibold leading-none tracking-[-0.035em] lg:text-[42px]">{f.money(eqAnim ?? s.equity)}</p>
        </div>
        <p className="num pb-0.5 text-[13px] text-muted">≈ {f.btc(s.equity.toNumber() / (s.points.at(-1)?.price || s.now.btcUsd.toNumber()), 8)} BTC</p>
      </div>
      {c && (
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-ink-2">
          <Pill tone={c.dir === "LONG" ? "btc" : "loss"}>BTC {c.dir === "LONG" ? "long" : "short"} {(lev ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}×</Pill>
          {liqD != null && !s.closed && <span className={cn("num", liqTone === "loss" ? "text-loss" : liqTone === "warn" ? "text-warn" : "")}>liquidação a {f.pct(liqD, false)}</span>}
          <span className="num text-muted">{f.btc(c.sizeBtc.toFixed(5))} BTC</span>
        </p>
      )}
      <div className="mt-4"><Spark points={spark} /></div>
      <div className="mt-4"><MetricStrip items={items} /></div>
      <SourceFooter />
    </section>
  );
}

export { AppShell, Mark } from "./nav";
