"use client";
import { useState } from "react";
import { navigate } from "@/lib/router";
import { NeedsSetup, useSnapshot } from "@/lib/api";
import { useFmt } from "@/lib/state";
import { getStore } from "@/lib/local/store";
import { fmtDuration, fmtZoned } from "@/lib/local/strategy";
import { BarRow, Button, CoinIcon, Kpi, Notice, Panel, PanelHead, Pill, RiskMeter, Skeleton, cn, toneCls, toneOf } from "@/components/ui";
import { DEFAULT_SCENARIO_RULES } from "@bst/domain";
import { Hero } from "@/components/shell";
import { Notices, PriceRail } from "@/components/terminal";
import { C } from "@/components/charts";
import { AddSheet, EntrySheet, ExitSheet } from "@/components/forms";
import { HlConnect } from "@/components/hl-connect";
import { StrategyForm, StrategySetup } from "@/components/strategy";

const fmtDay = (ms: number) => new Date(ms).toLocaleDateString("pt-BR", { day: "numeric", month: "short" }).replace(" de ", " ").replace(".", "");
const SRC: Record<string, string> = { live: "oficial ao vivo", reconstructed: "reconstruído", manual: "referência manual", conta: "conta inteira" };

function Onboarding() {
  const [manual, setManual] = useState(false);
  return (
    <div className="space-y-6 pt-4">
      <div>
        <h1 className="text-[28px] font-bold tracking-tight">Como acompanhar?</h1>
        <p className="mt-1.5 text-[15px] leading-relaxed text-muted">Conecte a conta da Hyperliquid para o app ler posição, saldo e operações sozinho. Ou lance tudo à mão.</p>
      </div>
      <Panel className="p-5"><h2 className="mb-4 text-[18px] font-semibold">Hyperliquid (automático)</h2><HlConnect /></Panel>
      {!manual ? <Button variant="ghost" className="w-full" onClick={() => setManual(true)}>Prefiro lançar manualmente</Button>
        : <Panel className="p-5"><h2 className="mb-4 text-[18px] font-semibold">Início da estratégia (manual)</h2><StrategyForm mode="new" onDone={() => undefined} /></Panel>}
    </div>
  );
}

export default function AllocationPage() {
  const q = useSnapshot();
  const f = useFmt();
  const [sheet, setSheet] = useState<null | "enter" | "exit" | "edit" | "add">(null);
  const st = getStore();
  if (q.loading) return <div className="space-y-4 pt-4"><Skeleton className="h-28" /><Skeleton className="h-44" /><Skeleton className="h-24" /></div>;
  if (q.error instanceof NeedsSetup) {
    if (!st.settings.hl && !st.strategies.length && !st.cycles.length && !st.flows.length && !st.initial) return <Onboarding />;
    return <StrategySetup />;
  }
  if (q.error) return <div className="pt-4"><Notice tone="loss">{q.error.message}</Notice></div>;
  const s = q.data!;
  const c = s.current;
  const live = s.live;
  const lp = s.livePos;
  const manual = s.acc.kind === "manual";
  const arb = s.acc.includeArb ? live?.arbTotal ?? 0 : 0;
  const strategy = s.equity.toNumber() - arb;
  const inPos = c ? Math.min(strategy, lp ? lp.marginUsed + Math.max(0, lp.upnl) : c.cycle ? strategy - Math.max(0, s.free ?? 0) : strategy) : 0;
  const parts = [
    { label: "Bitcoin (long)", value: inPos, color: C.btc },
    { label: "USDC livre", value: Math.max(0, strategy - inPos), color: C.accent },
    { label: "USDC na carteira", value: arb, color: C.usdc },
  ];
  const total = Math.max(1e-9, s.equity.toNumber());
  const pctOf = (v: number) => f.pct(v / total, false);
  const lev = c?.effLeverage ?? 0;
  const levTxt = lev.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  const canAct = manual && !s.closed && s.scope.kind === "strategy";
  const strat = s.scope.kind === "strategy" ? s.scope.strategy : null;

  const rules = { ...DEFAULT_SCENARIO_RULES, ...(s.s.settings.scenarioRules ?? {}) };
  const minLiq = Number(s.s.settings.minLiqDistance);
  const liqD = c?.liqDist ? c.liqDist.toNumber() : null;
  const levMax = Math.max(6, Math.ceil((lev || 0) * 1.25));
  const allocBar = parts.filter((p) => p.value > 0);

  return (
    <div>
      <Hero />
      <Notices items={s.warnings} />

      <div className="grid gap-4 lg:grid-cols-12 lg:items-start">
        <div className="min-w-0 space-y-4 lg:col-span-7">
          {c ? (
            <Panel glow className="overflow-hidden">
              <PanelHead title={s.closed ? "Posição no encerramento" : "Posição"} right={<Pill tone={c.dir === "LONG" ? "btc" : "loss"}>BTC {c.dir === "LONG" ? "long" : "short"} {levTxt}×</Pill>} />
              <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 px-4 pt-4 pb-3">
                <div className="flex items-center gap-3">
                  <CoinIcon kind="btc" size={32} />
                  <div>
                    <p className="lbl">{c.inherited ? "Resultado desde o início do ciclo" : "Resultado da posição"}</p>
                    <p className={cn("num mt-1 text-[30px] font-semibold leading-none tracking-[-0.03em]", toneCls(toneOf(c.pnl)))}>{f.money(c.pnl, { signed: true })}</p>
                  </div>
                </div>
                {c.pnlPct != null && <p className={cn("num rounded-full px-2.5 py-1 text-[14px] font-semibold", c.pnl.gt(0) ? "bg-gain-soft" : c.pnl.lt(0) ? "bg-loss-soft" : "bg-surface-3", toneCls(toneOf(c.pnl)))}>{f.pct(c.pnlPct)}</p>}
              </div>
              <p className="num px-4 pb-3 text-[12px] text-muted">{f.btc(c.sizeBtc.toFixed(6))} BTC · exposição {f.money(c.notional, { compact: true })} · aberta {fmtDay(c.trip.openT)}{c.inherited ? " (herdada)" : ""}</p>
              {!s.closed && <PriceRail liq={c.liq ? c.liq.toNumber() : null} entry={c.officialEntry} now={s.now.btcUsd.toNumber()} px={(v) => f.px(v)} />}
              <div className="grid grid-cols-2 border-t border-line sm:grid-cols-3">
                <Kpi className="border-b border-r border-line" label={c.inherited ? "Entrada oficial" : c.cycle?.adds?.length ? "Preço médio" : "Entrada"} value={f.px(c.officialEntry)} />
                <Kpi className="border-b border-line sm:border-r" label={s.closed ? "Preço no fim" : "Preço agora"} value={f.px(s.closed ? s.points.at(-1)?.price ?? null : s.now.btcUsd.toFixed())}
                  sub={<span className={toneCls(toneOf(c.btcMove))}>{f.pct(c.btcMove)} vs. entrada</span>} />
                {!s.closed ? <Kpi className="border-b border-r border-line sm:border-r-0" label="Liquidação" tone={liqD != null && liqD < minLiq ? "loss" : null} value={c.liq ? f.px(c.liq) : "sem risco"} sub={c.liqDist ? `${f.pct(c.liqDist.neg())} do preço` : undefined} />
                  : <Kpi className="border-b border-r border-line sm:border-r-0" label="Base do ciclo" value={f.px(c.basis)} />}
                {c.inherited && <Kpi className="border-b border-line sm:border-r" label="Referência do ciclo" value={f.px(c.basis)} />}
                <Kpi className="border-b border-r border-line" label="Margem" value={c.cycle ? f.money(c.cycle.capital) : lp ? f.money(lp.marginUsed) : "—"} sub={c.cycle?.adds?.length ? `${c.cycle.adds.length} aumento${c.cycle.adds.length > 1 ? "s" : ""}` : undefined} />
                <Kpi className="border-b border-line sm:border-r" label="Funding no ciclo" tone={toneOf(c.funding)} value={c.funding ? f.money(c.funding, { signed: true }) : f.money(0)} />
                <Kpi className="border-b border-r border-line sm:border-r-0" label="Tempo na posição" value={fmtDuration(c.heldMs)} />
              </div>
              {canAct && c.cycle && (
                <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3">
                  <Button variant="primary" className="col-span-2 sm:col-span-1" onClick={() => setSheet("add")}>Aumentar posição</Button>
                  <Button onClick={() => setSheet("exit")}>Sair para USDC</Button>
                  <Button onClick={() => setSheet("edit")}>Editar</Button>
                </div>
              )}
            </Panel>
          ) : (
            <Panel className="overflow-hidden">
              <PanelHead title="Posição" right={<Pill tone="accent">100% USDC</Pill>} />
              <div className="px-4 py-4">
                <p className="text-[14px] leading-relaxed text-ink-2">Sem posição em BTC{s.inUsdcSince ? ` desde ${fmtDay(s.inUsdcSince)}` : ""}.</p>
                {s.sinceExit && <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">Desde a última saída, a <span className="num">{f.px(s.sinceExit.px)}</span>, o BTC <span className={toneCls(toneOf(s.sinceExit.move))}>{s.sinceExit.move >= 0 ? "subiu" : "caiu"} <span className="num">{f.pct(Math.abs(s.sinceExit.move), false)}</span></span>.</p>}
                {canAct && <Button variant="primary" size="lg" className="mt-4 w-full" onClick={() => setSheet("enter")}>Entrar em BTC</Button>}
              </div>
            </Panel>
          )}

          <BtcAccumulation s={s} />

          <Panel className="overflow-hidden">
            <PanelHead title="Ciclo da estratégia" right={<button onClick={() => navigate("/estrategia/performance")} className="text-[12px] font-medium text-accent">Performance ›</button>} />
            <div className="grid grid-cols-2 sm:grid-cols-4">
              <Kpi className="border-r border-b border-line sm:border-b-0" label={s.scope.kind === "account" ? "Início da conta" : "Início"} value={strat ? fmtZoned(strat.startAt, strat.tz).split(",")[0] : new Date(s.startT).toLocaleDateString("pt-BR")}
                sub={strat ? `${fmtZoned(strat.startAt, strat.tz).split(", ")[1] ?? ""} · ${strat.tz.split("/").pop()!.replace("_", " ")}` : undefined} />
              <Kpi className="border-b border-line sm:border-r sm:border-b-0" label="Patrimônio inicial" value={f.money(s.equity0)} sub={SRC[s.snapSource] ?? s.snapSource} />
              <Kpi className="border-r border-line" label="Aportes líquidos" value={f.money(s.flowsIn - s.flowsOut, { signed: true })} />
              <Kpi label="Capital" value={f.money(s.contrib)} sub={s.roc != null ? <span className={toneCls(toneOf(s.result))}>{f.pct(s.roc)} de retorno</span> : undefined} />
            </div>
          </Panel>
        </div>

        <div className="min-w-0 space-y-4 lg:col-span-5">
          <Panel className="overflow-hidden">
            <PanelHead title="Risco" right={!s.closed && c ? <span className="num">limite {rules.leverageMax}× · liq. {f.pct(minLiq, false)}</span> : undefined} />
            <div className="space-y-5 px-4 py-4">
              <RiskMeter label={`Alavancagem efetiva${c?.leverageSetting ? ` (config. ${c.leverageSetting}×)` : ""}`} value={c ? lev : 0} display={c ? `${levTxt}×` : "0×"} max={levMax} zones={[rules.leverageMax, rules.leverageMax * 2]} limit={rules.leverageMax} limitLabel="limite"
                sub={<><span>0×</span><span>{levMax}×</span></>} />
              {c && !s.closed && <RiskMeter label="Distância da liquidação" value={liqD} display={liqD != null ? f.pct(liqD, false) : "sem risco"} max={0.6} zones={[minLiq, minLiq * 2]} limit={minLiq} invert
                sub={<><span>0%</span><span>60%+</span></>} />}
              <div>
                <div className="flex items-baseline justify-between"><span className="lbl">Alocação</span><span className="num text-[12px] text-muted">{c ? `${pctOf(inPos)} em BTC` : "100% USDC"}</span></div>
                <div className="mt-2 flex h-1.5 gap-px overflow-hidden rounded-[2px] bg-surface-3">
                  {allocBar.map((p) => <span key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />)}
                </div>
                <ul className="mt-2.5 space-y-1">
                  {allocBar.map((p) => (
                    <li key={p.label} className="flex items-center gap-2 text-[12px]">
                      <span className="size-2 rounded-[2px]" style={{ background: p.color }} aria-hidden /><span className="flex-1 text-ink-2">{p.label}</span>
                      <span className="num text-ink-2">{f.money(p.value)}</span><span className="num w-14 text-right text-muted">{pctOf(p.value)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Panel>

          {!s.closed && live && (
            <Panel className="overflow-hidden">
              <PanelHead title="Saldos agora" right={live ? (live.mode === "unifiedAccount" || live.mode === "portfolioMargin" ? "conta unificada" : "conta padrão") : undefined} />
              {live ? live.balances.map((b) => (
                <BarRow key={`${b.where}${b.coin}`} color={b.where === "arb" ? C.usdc : b.coin === "UBTC" ? C.btc : C.gain}
                  title={`${b.coin} · ${b.where === "perp" ? "Hyperliquid perp" : b.where === "spot" ? "Hyperliquid spot" : "carteira Arbitrum"}`}
                  right={b.usd != null ? pctOf(b.usd) : undefined} value={b.usd != null ? f.money(b.usd) : `${b.total.toLocaleString("pt-BR")} ${b.coin}`} />
              )) : (
                <BarRow color={C.accent} title="USDC livre" right={pctOf(Math.max(0, s.free ?? 0))} value={f.money(Math.max(0, s.free ?? 0))} />
              )}
              {live && live.balances.length === 0 && <p className="px-4 py-5 text-[14px] text-muted">Nenhum saldo na conta.</p>}
              {live && (
                <div className="border-t border-line px-4 py-3 text-[12px] text-muted">
                  <div className="flex items-center justify-between text-[13px] text-ink-2"><span>Total (= patrimônio da estratégia)</span><span className="num">{f.money(live.total)}</span></div>
                  <p className="mt-1.5">{live.mode === "unifiedAccount" || live.mode === "portfolioMargin" ? `Conta unificada: o saldo spot já inclui o P&L aberto das posições (${f.money(live.positions.reduce((a, p) => a + p.upnl, 0), { signed: true })} agora); ele não é somado de novo.` : "Conta padrão: patrimônio da conta perp mais os saldos spot."}{live.balances.some((b) => b.where === "spot" && b.usd == null) ? " Moedas sem cotação (ex.: HYPE) aparecem em quantidade e ficam fora deste total." : ""}</p>
                </div>
              )}
            </Panel>
          )}
        </div>
      </div>

      {sheet === "enter" && <EntrySheet onClose={() => setSheet(null)} />}
      {sheet === "edit" && c?.cycle && <EntrySheet edit={c.cycle} onClose={() => setSheet(null)} />}
      {sheet === "exit" && c?.cycle && <ExitSheet cycle={c.cycle} onClose={() => setSheet(null)} />}
      {sheet === "add" && c?.cycle && <AddSheet cycle={c.cycle} onClose={() => setSheet(null)} />}
    </div>
  );
}

/** Acumulação de Bitcoin: três medidas que não se misturam. */
function BtcAccumulation({ s }: { s: NonNullable<ReturnType<typeof useSnapshot>["data"]> }) {
  const f = useFmt();
  const b = s.btc;
  const chg = b.start != null && b.equivalent != null ? b.equivalent - b.start : null;
  const vsHodl = b.hodl != null && b.equivalent != null ? b.equivalent - b.hodl : null;
  const sgn = (v: number) => `${v >= 0 ? "+" : "−"}${f.btc(Math.abs(v), 6)}`;
  return (
    <Panel className="overflow-hidden">
      <PanelHead title="Acumulação de Bitcoin" right="patrimônio ÷ preço do BTC" />
      <div className="grid grid-cols-2 sm:grid-cols-4">
        <Kpi className="border-r border-b border-line sm:border-b-0" label="BTC eq. no início" value={b.start != null ? f.btc(b.start, 6) : "—"} />
        <Kpi className="border-b border-line sm:border-r sm:border-b-0" label="BTC eq. agora" value={b.equivalent != null ? f.btc(b.equivalent, 6) : "—"}
          sub={chg != null ? <span className={toneCls(toneOf(chg))}>{sgn(chg)} no ciclo (com aportes)</span> : undefined} />
        <Kpi className="border-r border-line" label="vs. só BTC" tone={toneOf(vsHodl)} value={vsHodl != null ? sgn(vsHodl) : "—"}
          sub={b.hodl != null ? `só BTC teria ${f.btc(b.hodl, 6)}` : undefined} />
        <Kpi label="Spot · sintético" value={`${f.btc(b.spot, 6)}`} sub={`perpétuo ${b.synthetic >= 0 ? "+" : "−"}${f.btc(Math.abs(b.synthetic), 6)} BTC`} />
      </div>
      <p className="border-t border-line px-4 py-2.5 text-[11px] leading-relaxed text-muted"><b className="font-semibold text-ink-2">Equivalente</b>: quanto BTC o patrimônio compraria. <b className="font-semibold text-ink-2">Spot</b>: BTC realmente em custódia. <b className="font-semibold text-ink-2">Sintético</b>: exposição do perpétuo (não é posse de BTC). A estratégia acumula BTC quando o equivalente fica acima do “só BTC”.</p>
    </Panel>
  );
}
