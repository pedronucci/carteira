"use client";
/**
 * Dashboard do Terminal 5.0: visão geral com a Estratégia BTC/USDC em destaque permanente.
 * Só mostra dados reais. Fontes ainda não conectadas aparecem como estado vazio, nunca com valores de exemplo.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpRight, Bitcoin, SlidersHorizontal } from "lucide-react";
import { DEFAULT_SCENARIO_RULES, SCENARIO_LABEL, returnSince } from "@bst/domain";
import { NeedsSetup, useMarket, usePortfolio, useSnapshot } from "@/lib/api";
import { useFmt } from "@/lib/state";
import { drawdownPoints, inCcy, periodReturn } from "@/lib/local/engine";
import { fmtDuration } from "@/lib/local/strategy";
import { EquityChart, C } from "@/components/charts";
import { Sheet } from "@/components/sheet";
import { useIntegrations } from "@/components/nav";
import { portfolio } from "@/lib/portfolio/db";
import { Button, Kpi, KpiGrid, Notice, Panel, PanelHead, Pill, RiskMeter, Segmented, Skeleton, cn, toneCls, toneOf } from "@/components/ui";

type WidgetId = "risk" | "hodl" | "market" | "moves" | "alerts" | "sources";
const WIDGETS: { id: WidgetId; label: string }[] = [
  { id: "risk", label: "Risco da estratégia" },
  { id: "hodl", label: "Estratégia vs. Buy & Hold" },
  { id: "market", label: "Mercado" },
  { id: "moves", label: "Últimas movimentações" },
  { id: "alerts", label: "Alertas" },
  { id: "sources", label: "Conexões" },
];
const DKEY = "bst.dash.v1";
type Layout = { order: WidgetId[]; hidden: WidgetId[] };
const loadLayout = (): Layout => {
  try {
    const l = JSON.parse(localStorage.getItem(DKEY) ?? "null") as Layout | null;
    if (l?.order) return { order: [...l.order.filter((x) => WIDGETS.some((w) => w.id === x)), ...WIDGETS.map((w) => w.id).filter((x) => !l.order.includes(x))], hidden: l.hidden ?? [] };
  } catch { /* padrão */ }
  return { order: WIDGETS.map((w) => w.id), hidden: [] };
};

const PERIODS = [{ value: "1", label: "24h" }, { value: "7", label: "7d" }, { value: "30", label: "30d" }, { value: "90", label: "90d" }, { value: "365", label: "1a" }, { value: "all", label: "Tudo" }] as const;
type Period = (typeof PERIODS)[number]["value"];

export default function DashboardPage() {
  const q = useSnapshot();
  const pq = usePortfolio();
  const f = useFmt();
  const [layout, setLayout] = useState<Layout>(loadLayout);
  const [edit, setEdit] = useState(false);
  const [period, setPeriod] = useState<Period>("all");
  const s = q.data;
  const pts = useMemo(() => (s ? inCcy(s.points, f.ccy, f.fx) : []), [s, f.ccy, f.fx]);
  const save = (l: Layout) => { setLayout(l); try { localStorage.setItem(DKEY, JSON.stringify(l)); } catch { /* */ } };

  if (q.loading) return <div className="space-y-4 pt-5"><Skeleton className="h-56" /><Skeleton className="h-40" /></div>;
  const setup = q.error instanceof NeedsSetup;
  if (q.error && !setup) return <div className="pt-5"><Notice tone="loss">{q.error.message}</Notice></div>;

  const pv = pq.data;
  const pr = pv ? returnSince(pv.series, period === "all" ? null : Number(period) * 86400e3) : null;
  const shown = WIDGETS.length ? layout.order.filter((id) => !layout.hidden.includes(id)) : [];

  return (
    <div className="pt-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight">Dashboard</h1>
          <p className="text-[12px] text-muted">Bitcoin Strategy Terminal 5.0 · somente leitura</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setEdit(true)}><SlidersHorizontal className="size-4" />Personalizar</Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-12 lg:items-start">
        {setup || !s ? (
          <Panel className="border-gold/40 lg:col-span-7">
            <PanelHead title={<span className="flex items-center gap-2 text-gold"><Bitcoin className="size-4" />Estratégia BTC/USDC</span>} />
            <div className="px-4 py-6">
              <p className="text-[14px] text-ink-2">Nenhum ciclo configurado ainda.</p>
              <Link href="/estrategia" className="mt-3 inline-flex text-[13px] font-medium text-accent">Configurar a estratégia ›</Link>
            </div>
          </Panel>
        ) : <StrategyCard s={s} />}

        <Panel className="overflow-hidden lg:col-span-5">
          <PanelHead title="Patrimônio consolidado" right={<Link href="/portfolio" className="text-[12px] font-medium text-accent">Portfólio ›</Link>} />
          {pv ? (
            <>
              <div className="px-4 pt-4">
                <p className="lbl">Total · {pv.accounts.length} conta{pv.accounts.length === 1 ? "" : "s"}</p>
                <p className="num mt-1 text-[26px] font-semibold leading-none tracking-[-0.03em]">{f.money(pv.c.totalUsd)}</p>
                <p className="num mt-1.5 text-[12px] text-muted">{f.ccy === "BRL" ? f.usd(pv.c.totalUsd) : (s && f.brl(pv.c.totalUsd, s.now.usdBrl)) ?? "—"} · ≈ {pv.c.btcEquivalent != null ? f.btc(pv.c.btcEquivalent, 6) : "—"} BTC</p>
              </div>
              <div className="flex items-center justify-between gap-2 px-4 pt-3"><Segmented size="sm" label="Período" value={period} onChange={setPeriod} options={[...PERIODS]} /></div>
              <div className="mt-3 grid grid-cols-2 border-t border-line">
                <Kpi className="border-r border-line" label="Resultado no período" tone={toneOf(pr?.resultUsd)} value={pr ? f.money(pr.resultUsd, { signed: true }) : "—"} sub={pr ? "sem aportes, retiradas e ajustes" : "histórico ainda curto"} />
                <Kpi label="Rentabilidade (TWR)" tone={toneOf(pr?.pct)} value={pr ? f.pct(pr.pct) : "—"} sub={pr ? `desde ${new Date(pr.fromT).toLocaleDateString("pt-BR")}` : "a partir do 2º retrato"} />
              </div>
              <ul className="border-t border-line px-4 py-2.5 text-[11px] text-muted">
                {pv.c.byAccount.slice(0, 4).map((x) => <li key={x.accountId} className="flex justify-between gap-2 py-0.5"><span className={cn("truncate", x.accountId === "strategy" && "text-gold")}>{x.name}</span><span className="num">{f.pct(x.share, false)}</span></li>)}
              </ul>
            </>
          ) : <p className="px-4 py-6 text-[14px] text-muted">Sem dados ainda.</p>}
        </Panel>

        {s && shown.map((id) => <Widget key={id} id={id} s={s} />)}
      </div>

      {edit && (
        <Sheet title="Personalizar Dashboard" onClose={() => setEdit(false)}>
          <p className="mb-3 text-[12px] text-muted">A Estratégia BTC/USDC e o patrimônio consolidado ficam sempre no topo.</p>
          <ul className="divide-y divide-line rounded-md border border-line">
            {layout.order.map((id, i) => {
              const w = WIDGETS.find((x) => x.id === id)!;
              const off = layout.hidden.includes(id);
              const move = (d: -1 | 1) => { const o = [...layout.order]; const j = i + d; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j]!, o[i]!]; save({ ...layout, order: o }); };
              return (
                <li key={id} className="flex items-center gap-2 px-3 py-2">
                  <label className="flex flex-1 items-center gap-3 text-[14px]"><input type="checkbox" checked={!off} onChange={() => save({ ...layout, hidden: off ? layout.hidden.filter((x) => x !== id) : [...layout.hidden, id] })} className="size-4 accent-[#42d9d0]" />{w.label}</label>
                  <button onClick={() => move(-1)} disabled={i === 0} aria-label="Subir" className="grid size-8 place-items-center rounded-md text-muted disabled:opacity-30"><ArrowUp className="size-4" /></button>
                  <button onClick={() => move(1)} disabled={i === layout.order.length - 1} aria-label="Descer" className="grid size-8 place-items-center rounded-md text-muted disabled:opacity-30"><ArrowDown className="size-4" /></button>
                </li>
              );
            })}
          </ul>
          <Button variant="ghost" className="mt-3 w-full" onClick={() => save({ order: WIDGETS.map((w) => w.id), hidden: [] })}>Restaurar padrão</Button>
        </Sheet>
      )}
    </div>
  );
}

type Snap = NonNullable<ReturnType<typeof useSnapshot>["data"]>;

/** Cartão prioritário da estratégia (dourado). */
function StrategyCard({ s }: { s: Snap }) {
  const f = useFmt();
  const pts = useMemo(() => inCcy(s.points, f.ccy, f.fx), [s, f.ccy, f.fx]);
  const c = s.current;
  const btc0 = s.btc.start;
  const btcNow = s.btc.equivalent ?? 0;
  // BTC que a estratégia tem a mais (ou a menos) do que teria só segurando BTC com os mesmos aportes
  const hodlBtc = s.btc.hodl;
  const btcChg = hodlBtc && hodlBtc > 0 ? btcNow / hodlBtc - 1 : null;
  const integ = useIntegrations().find((i) => i.key === "hl")!;
  const pos = c ? c.dir : "FLAT";
  return (
    <Panel className="overflow-hidden border-gold/40 lg:col-span-7">
      <PanelHead title={<span className="flex items-center gap-2 text-gold"><Bitcoin className="size-4" />Estratégia BTC/USDC</span>}
        right={<span className="flex items-center gap-2"><Pill tone={!c ? "accent" : c.dir === "LONG" ? "btc" : "loss"}>{pos}{c?.effLeverage ? ` ${c.effLeverage.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×` : ""}</Pill>
          <span className="num hidden text-[11px] sm:inline">{s.acc.kind === "hl" ? `Hyperliquid · ${integ.state === "ok" ? "ao vivo" : integ.state === "none" ? "—" : integ.state}` : "lançamento manual"}</span></span>} />
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 px-4 pt-4">
        <div>
          <p className="lbl">{s.label} · {fmtDuration(Date.now() - s.startT)}</p>
          <p className="num mt-1 text-[28px] font-semibold leading-none tracking-[-0.03em]">{f.money(s.equity)}</p>
        </div>
        <div className="text-right">
          <p className="lbl">BTC equivalente</p>
          <p className="num mt-1 text-[15px] font-semibold">{f.btc(btcNow, 6)}</p>
          <p className="num text-[11px] text-muted">vs. só BTC <span className={toneCls(toneOf(btcChg))}>{hodlBtc != null ? `${btcNow - hodlBtc >= 0 ? "+" : ""}${f.btc(btcNow - hodlBtc, 6)} (${f.pct(btcChg)})` : "—"}</span> · início {btc0 != null ? f.btc(btc0, 6) : "—"}</p>
        </div>
      </div>
      <div className="px-1 pt-3">{pts.length >= 2 ? <EquityChart ccy={f.ccy} height={150} points={pts.map((p) => ({ ts: p.ts, equity: p.equity, contrib: p.contrib, hodl: p.hodl, inBtc: p.inBtc }))} /> : null}</div>
      <div className="grid grid-cols-2 border-t border-line sm:grid-cols-4">
        <Kpi className="border-r border-b border-line sm:border-b-0" label="Resultado do ciclo" tone={toneOf(s.result)} value={f.money(s.result, { signed: true, compact: true })} sub={s.roc != null ? `${f.pct(s.roc)} s/ capital` : undefined} />
        <Kpi className="border-b border-line sm:border-r sm:border-b-0" label="TWR" tone={toneOf(s.twr)} value={s.twr != null ? f.pct(s.twr) : "—"} sub="ponderado no tempo" />
        <Kpi className="border-r border-line" label="Realizado · aberto" value={<span><span className={toneCls(toneOf(s.realized))}>{f.money(s.realized, { signed: true, compact: true })}</span></span>} sub={<span className={toneCls(toneOf(s.unrealized))}>{f.money(s.unrealized, { signed: true, compact: true })} em aberto</span>} />
        {c ? <Kpi label="Preço médio · liq." value={f.px(c.officialEntry)} sub={c.liqDist ? `liquidação a ${f.pct(c.liqDist, false)}` : "sem liquidação"} tone={c.liqDist && c.liqDist.lt(s.s.settings.minLiqDistance) ? "loss" : null} />
          : <Kpi label="Posição" value="100% USDC" sub="sem exposição" />}
      </div>
      <Link href="/estrategia" className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[13px] font-medium text-gold [@media(hover:hover)]:hover:bg-surface-2">Abrir monitor completo<ArrowUpRight className="size-4" /></Link>
    </Panel>
  );
}

function Widget({ id, s }: { id: WidgetId; s: Snap }) {
  const f = useFmt();
  const m = useMarket();
  const integ = useIntegrations();
  const span = "lg:col-span-4";
  if (id === "risk") {
    const c = s.current;
    const rules = { ...DEFAULT_SCENARIO_RULES, ...(s.s.settings.scenarioRules ?? {}) };
    const minLiq = Number(s.s.settings.minLiqDistance);
    const lev = c?.effLeverage ?? 0;
    const dd = drawdownPoints(s.points);
    const cur = dd.at(-1)?.dd ?? 0;
    return (
      <Panel className={cn("overflow-hidden", span)}>
        <PanelHead title="Risco da estratégia" right={<Link href="/risco" className="text-[12px] font-medium text-accent">Risk Center ›</Link>} />
        <div className="space-y-4 px-4 py-4">
          <RiskMeter label="Alavancagem efetiva" value={lev} display={`${lev.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×`} max={Math.max(6, Math.ceil(lev * 1.25))} zones={[rules.leverageMax, rules.leverageMax * 2]} limit={rules.leverageMax} />
          {c?.liqDist && <RiskMeter label="Distância da liquidação" value={c.liqDist.toNumber()} display={f.pct(c.liqDist, false)} max={0.6} zones={[minLiq, minLiq * 2]} limit={minLiq} invert />}
          <div className="flex items-baseline justify-between text-[12px]"><span className="lbl">Queda desde o pico</span><span className={cn("num", cur > 0 ? "text-loss" : "text-ink-2")}>{f.pct(-cur)}</span></div>
        </div>
      </Panel>
    );
  }
  if (id === "hodl") {
    const diff = s.vsHodl;
    const btcDiff = s.hodl != null ? (s.equity.toNumber() - s.hodl) / s.now.btcUsd.toNumber() : null;
    return (
      <Panel className={cn("overflow-hidden", span)}>
        <PanelHead title="Estratégia vs. Buy & Hold" right="mesmos aportes" />
        <div className="grid grid-cols-2">
          <Kpi className="border-r border-b border-line" label="Estratégia" value={f.money(s.equity)} />
          <Kpi className="border-b border-line" label="Só BTC" value={s.hodl != null ? f.money(s.hodl) : "—"} sub={s.hodlRet != null ? `BTC ${f.pct(s.hodlRet)}` : undefined} />
          <Kpi className="border-r border-line" label="Diferença" tone={toneOf(diff)} value={diff != null ? f.money(diff, { signed: true }) : "—"} sub={s.vsHodlPct != null ? f.pct(s.vsHodlPct) : undefined} />
          <Kpi label="Em BTC" tone={toneOf(btcDiff)} value={btcDiff != null ? `${btcDiff >= 0 ? "+" : ""}${f.btc(btcDiff, 6)}` : "—"} sub="BTC a mais ou a menos" />
        </div>
      </Panel>
    );
  }
  if (id === "market") {
    const mk = m.data;
    const ind = (k: string) => mk?.indicators.find((i) => i.key === k)?.value ?? null;
    return (
      <Panel className={cn("overflow-hidden", span)}>
        <PanelHead title="Mercado" right={<Link href="/mercado" className="text-[12px] font-medium text-accent">Abrir ›</Link>} />
        {mk ? (
          <>
            <div className="flex items-baseline justify-between gap-3 px-4 pt-3"><span className="text-[15px] font-semibold">{SCENARIO_LABEL[mk.scenario.scenario]}</span><span className="num text-[11px] text-muted">regras objetivas</span></div>
            <div className="mt-2 grid grid-cols-3 border-t border-line">
              <Kpi className="border-r border-line" label="RSI 14" value={ind("rsi") != null ? Math.round(ind("rsi")!) : "—"} />
              <Kpi className="border-r border-line" label="Preço ÷ MM200" value={ind("mayer") != null ? ind("mayer")!.toFixed(2).replace(".", ",") : "—"} />
              <Kpi label="Fear & Greed" value={ind("fng") ?? "—"} />
            </div>
            <p className="border-t border-line px-4 py-2 text-[11px] text-muted">Velas diárias {mk.source} · {new Date(mk.updatedAt).toLocaleDateString("pt-BR")}</p>
          </>
        ) : <p className="px-4 py-5 text-[13px] text-muted">{m.loading ? "Carregando histórico de preços…" : "Histórico de preços indisponível agora."}</p>}
      </Panel>
    );
  }
  if (id === "moves") {
    const rows = [...s.events].filter((e) => e.k === "trade" || e.k === "flow").sort((a, b) => b.t - a.t).slice(0, 6);
    return (
      <Panel className={cn("overflow-hidden", span)}>
        <PanelHead title="Últimas movimentações" right={<Link href="/estrategia/transacoes" className="text-[12px] font-medium text-accent">Todas ›</Link>} />
        {rows.length ? (
          <ul className="divide-y divide-line">
            {rows.map((e) => (
              <li key={e.key} className="flex items-center gap-3 px-4 py-2 text-[13px]">
                <span className="num w-[86px] shrink-0 text-[11px] text-muted">{new Date(e.t).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                <span className="min-w-0 flex-1 truncate">{e.k === "trade" ? (e.side === "B" ? "Compra" : "Venda") : e.usd >= 0 ? "Aporte" : "Retirada"}</span>
                <span className={cn("num shrink-0", e.k === "trade" ? (e.side === "B" ? "text-gain" : "text-loss") : toneCls(toneOf(e.k === "flow" ? e.usd : 0)))}>
                  {f.hidden ? "•••" : e.k === "trade" ? `${e.side === "B" ? "+" : "−"}${e.sz.toLocaleString("pt-BR", { maximumFractionDigits: 6 })} BTC` : e.k === "flow" ? f.money(e.usd, { signed: true }) : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="px-4 py-5 text-[13px] text-muted">Nenhuma movimentação no ciclo.</p>}
      </Panel>
    );
  }
  if (id === "alerts") {
    return (
      <Panel className={cn("overflow-hidden", span)}>
        <PanelHead title="Alertas" right={s.warnings.length ? <span className="num text-warn">{s.warnings.length}</span> : undefined} />
        {s.warnings.length ? <ul className="space-y-2 p-3">{s.warnings.map((w) => <li key={w}><Notice>{w}</Notice></li>)}</ul>
          : <p className="px-4 py-5 text-[13px] text-muted">Nenhum alerta agora.</p>}
      </Panel>
    );
  }
  return (
    <Panel className={cn("overflow-hidden", span)}>
      <PanelHead title="Conexões" right={<Link href="/ajustes" className="text-[12px] font-medium text-accent">Integrações ›</Link>} />
      <ul className="divide-y divide-line">
        {integ.map((i) => (
          <li key={i.key} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
            <span className={cn("size-2 rounded-full", i.state === "ok" ? "bg-gain" : i.state === "none" ? "bg-muted/60" : i.state === "error" || i.state === "off" ? "bg-loss" : "bg-warn")} aria-hidden />
            <span className="flex-1">{i.label}</span>
            <span className="num text-[11px] text-muted">{i.state === "ok" && i.at ? new Date(i.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : i.detail}</span>
          </li>
        ))}
        {(portfolio().accounts.some((a) => a.kind === "okx") ? [] : ["OKX"]).map((n) => (
          <li key={n} className="flex items-center gap-3 px-4 py-2.5 text-[13px] text-muted"><span className="size-2 rounded-full bg-muted/40" aria-hidden /><span className="flex-1">{n}</span><span className="text-[11px]">não conectada</span></li>
        ))}
      </ul>
    </Panel>
  );
}
