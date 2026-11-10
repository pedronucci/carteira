"use client";
/**
 * Visão Geral 5.1: perpétuos e evolução patrimonial em primeiro plano.
 * Somente leitura. Cada número vem de uma fonte real; o que falta aparece como "Não disponível".
 */
import { useMemo, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { Activity, Bitcoin, Percent, Wallet } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { assetChanges, btcReturn, evolution, fmtMoney, type EvoCcy, type EvoPeriod } from "@bst/domain";
import { usePerps, usePortfolio } from "@/lib/api";
import { useAppState, useFmt } from "@/lib/state";
import { portfolio } from "@/lib/portfolio/db";
import { prices } from "@/lib/local/prices";
import { riskLevel } from "@/lib/perps/positions";
import { allocation, longShort, marginUse, roiOnMargin } from "@/lib/dashboard/hub";
import { useIntegrations } from "@/components/nav";
import { useMarketIntel } from "@/lib/market/use";
import { useAnalytics } from "@/lib/analytics/use";
import { CoinLogo } from "@/components/coin-logo";
import { DirBadge } from "@/app/perps/page";
import { C } from "@/components/charts";
import { navigate } from "@/lib/router";
import { Notice, Panel, PanelHead, Pill, Segmented, cn, toneCls, toneOf } from "@/components/ui";

export const PERIODS: { value: EvoPeriod; label: string }[] = [{ value: "1", label: "24h" }, { value: "7", label: "7d" }, { value: "30", label: "30d" }, { value: "90", label: "90d" }, { value: "365", label: "1a" }, { value: "all", label: "Tudo" }];
const WIDE = ["Tamanho", "Margem", "Funding"];
const NA = <span className="text-muted">Não disponível</span>;
const dmy = (t: number) => new Date(t).toLocaleDateString("pt-BR");
const hm = (t: number) => new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** Dados compartilhados pelos blocos da Visão Geral. */
export function useHub(period: EvoPeriod, ccy: EvoCcy) {
  const pq = usePortfolio();
  const perps = usePerps().data ?? null;
  const pv = pq.data ?? null;
  const spot = prices().spot;
  const now = Date.now();
  return useMemo(() => {
    const snaps = portfolio().snapshots;
    const fb = { usdBrl: spot?.usdBrl ?? null, btcUsd: spot?.btcUsd ?? null };
    const evo = pv ? evolution(snaps, pv.flows, period, ccy, now, fb) : null;
    const evoUsd = pv ? evolution(snaps, pv.flows, period, "USD", now, fb) : null;
    const evoBtc = pv ? evolution(snaps, pv.flows, period, "BTC", now, fb) : null;
    return { pv, perps, snaps, evo, evoUsd, evoBtc, fb };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pv, perps, period, ccy, spot?.btcUsd, spot?.usdBrl]);
}
export type Hub = ReturnType<typeof useHub>;

function Spark({ values, tone = "accent", h = 34 }: { values: (number | null)[]; tone?: "accent" | "gold" | "gain" | "loss"; h?: number }) {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x));
  if (v.length < 2) return null;
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * 100},${h - 3 - ((x - lo) / span) * (h - 6)}`).join(" ");
  const col = tone === "gold" ? "var(--color-gold)" : tone === "gain" ? "var(--color-gain)" : tone === "loss" ? "var(--color-loss)" : "var(--color-accent)";
  return <svg viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" className="h-[34px] w-full" aria-hidden><polyline points={pts} fill="none" stroke={col} strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinejoin="round" /></svg>;
}

function KpiCard({ icon: Icon, label, value, sub, tone, gold, spark, sparkTone, className }: { icon: ComponentType<{ className?: string; strokeWidth?: number }>; label: string; value: ReactNode; sub?: ReactNode; tone?: "gain" | "loss" | null; gold?: boolean; spark?: (number | null)[]; sparkTone?: "accent" | "gold" | "gain" | "loss"; className?: string }) {
  return (
    <Panel glow={gold} tech={!gold} className={cn("flex min-w-0 flex-col gap-2 p-4", className)}>
      <div className="flex items-center gap-2.5">
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl border", gold ? "border-gold/40 bg-gold-soft text-gold" : "border-accent/30 bg-accent-soft text-accent")}><Icon className="size-[18px]" strokeWidth={1.75} /></span>
        <p className="truncate text-[12.5px] text-ink-2">{label}</p>
      </div>
      <div className="[container-type:inline-size]"><p className={cn("num whitespace-nowrap text-[clamp(18px,10cqi,28px)] leading-tight font-semibold tracking-[-0.03em]", toneCls(tone))}>{value}</p></div>
      {sub && <p className="num min-h-4 text-[11.5px] leading-snug text-muted">{sub}</p>}
      {spark && <Spark values={spark} tone={sparkTone ?? (gold ? "gold" : "accent")} />}
    </Panel>
  );
}

/** Quatro indicadores de topo. */
export function HubKpis({ h, period, ccy }: { h: Hub; period: EvoPeriod; ccy: EvoCcy }) {
  const f = useFmt();
  const { pv, perps, evo, evoUsd, evoBtc, snaps } = h;
  if (!pv) return null;
  const pp = perps?.connected ? perps.positions : [];
  const upnl = perps?.connected ? perps.summary.upnl : null;
  const roi = roiOnMargin(pp);
  const label = PERIODS.find((p) => p.value === period)!.label;
  const perpSpark = snaps.filter((s) => s.perps).slice(-60).map((s) => s.perps!.upnl);
  const reliable = evo && !evo.incomplete;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiCard gold className="col-span-2 lg:col-span-1" icon={Wallet} label="Patrimônio consolidado" value={f.money(pv.c.totalUsd)}
        sub={evoUsd?.rawChangeUsd != null ? <>variação {label}: <span className={toneCls(toneOf(evoUsd.rawChangeUsd))}>{f.money(evoUsd.rawChangeUsd, { signed: true })}</span>{evoUsd.flowsUsd ? <> · fluxos {f.money(evoUsd.flowsUsd, { signed: true })}</> : null}</> : `${pv.accounts.length} conta${pv.accounts.length === 1 ? "" : "s"} · histórico em formação`}
        spark={evoUsd?.points.map((p) => p.usd)} />
      <KpiCard icon={Activity} label="P&L dos perpétuos" tone={toneOf(upnl)} value={upnl != null ? f.money(upnl, { signed: true }) : NA}
        sub={perps?.connected ? `${perps.summary.count} posiç${perps.summary.count === 1 ? "ão" : "ões"} · ROI ${roi != null ? f.pct(roi) : "n/d"} s/ margem` : "Hyperliquid não conectada"} spark={perpSpark} sparkTone={toneOf(upnl) === "loss" ? "loss" : "gain"} />
      <KpiCard icon={Bitcoin} label="Equivalente em BTC" value={pv.c.btcEquivalent != null ? `${f.btc(pv.c.btcEquivalent, 4)} BTC` : NA}
        sub={evoBtc?.rawChangeUsd != null && evoBtc.points.length >= 2 && evoBtc.points[0]!.value ? <>{label}: <span className={toneCls(toneOf(evoBtc.points.at(-1)!.value! - evoBtc.points[0]!.value))}>{f.pct(evoBtc.points.at(-1)!.value! / evoBtc.points[0]!.value - 1)}</span></> : "histórico em formação"}
        spark={evoBtc?.points.map((p) => p.value)} />
      <KpiCard gold className="col-span-2 lg:col-span-1" icon={Percent} label="Rentabilidade (TWR)" tone={reliable ? toneOf(evo!.twr) : null} value={evo?.twr != null ? f.pct(evo.twr) : NA}
        sub={evo?.twr != null ? <>{label} · sem aportes/retiradas{evo.incomplete && evo.availableFrom ? <> · <span className="text-warn">desde {dmy(evo.availableFrom)}</span></> : null}{evo.resultUsd != null ? <> · {f.money(evo.resultUsd, { signed: true })}</> : null}</> : "precisa de ao menos 2 retratos"} />
    </div>
  );
}

const fmtCcy = (v: number, c: EvoCcy, hidden: boolean, compact = false) => (hidden ? "•••" : c === "BTC" ? `${v.toLocaleString("pt-BR", { minimumFractionDigits: compact ? 3 : 6, maximumFractionDigits: compact ? 3 : 6 })} BTC` : fmtMoney(v, c, { compact }));

/** Evolução do patrimônio consolidado com filtros de período e moeda. */
export function EvolutionPanel({ h, period, setPeriod, ccy, setCcy, className }: { h: Hub; period: EvoPeriod; setPeriod: (p: EvoPeriod) => void; ccy: EvoCcy; setCcy: (c: EvoCcy) => void; className?: string }) {
  const { hidden } = useAppState();
  const { evo, snaps } = h;
  const pts = evo?.points.filter((p) => p.value != null) ?? [];
  const up = pts.length >= 2 ? pts.at(-1)!.value! >= pts[0]!.value! : true;
  const col = up ? "var(--color-gain)" : "var(--color-loss)";
  const hodl = evo ? btcReturn(snaps, evo.fromT, evo.toT) : null;
  return (
    <Panel tech className={cn("min-w-0 overflow-hidden", className)}>
      <PanelHead title="Evolução do patrimônio" right={<Link href="/portfolio" className="text-[12px] font-medium text-accent">Portfólio ›</Link>} />
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
        <Segmented size="sm" label="Período" value={period} onChange={setPeriod} options={PERIODS} />
        <Segmented size="sm" label="Moeda" value={ccy} onChange={setCcy} options={[{ value: "USD", label: "USD" }, { value: "BRL", label: "BRL" }, { value: "BTC", label: "BTC" }]} />
      </div>
      {pts.length < 2 ? (
        <p className="px-4 py-10 text-center text-[13px] text-muted">Coletando retratos do patrimônio (um por hora). O gráfico aparece com 2 ou mais pontos{ccy !== "USD" ? " e cotação disponível" : ""}.</p>
      ) : (
        <div className="px-1 pt-3">
          <ResponsiveContainer width="100%" height={230}>
            <AreaChart data={pts} margin={{ top: 8, right: 14, left: 0, bottom: 0 }}>
              <defs><linearGradient id="evo5" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={col} stopOpacity={0.22} /><stop offset="100%" stopColor={col} stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid stroke={C.grid} strokeDasharray="3 4" vertical={false} />
              <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} scale="time" stroke={C.muted} fontSize={11} tickLine={false} axisLine={false} minTickGap={48} tickFormatter={(t: number) => new Date(t).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "")} />
              <YAxis stroke={C.muted} fontSize={11} tickLine={false} axisLine={false} width={64} domain={["auto", "auto"]} tickFormatter={(v: number) => (hidden ? "•••" : ccy === "BTC" ? v.toFixed(3) : fmtMoney(v, ccy, { compact: true }).replace(/^R\$\s?|^US\$\s?/, ""))} />
              <Tooltip content={({ active, payload }) => active && payload?.length ? (
                <div className="rounded-md border border-line-strong bg-surface-3 px-3 py-2 text-[12px] shadow-[0_8px_24px_var(--shadow-pop)]">
                  <div className="mb-1 text-muted">{new Date(payload[0]!.payload.t).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                  <div className="num font-semibold">{fmtCcy(payload[0]!.payload.value, ccy, hidden)}</div>
                </div>) : null} />
              <Area type="monotone" dataKey="value" stroke={col} fill="url(#evo5)" strokeWidth={2} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="space-y-1 border-t border-line px-4 py-2.5 text-[11.5px] text-muted">
        {evo?.incomplete && evo.availableFrom != null && <p className="text-warn">Histórico incompleto: há retratos só desde {dmy(evo.availableFrom)}. O resultado usa apenas o que existe.</p>}
        {evo?.approx && <p>BRL/BTC de retratos antigos usam a cotação atual (aproximado).</p>}
        <p className="num">
          {evo?.rawChangeUsd != null ? <>Variação bruta <span className={toneCls(toneOf(evo.rawChangeUsd))}>{evo.rawChangeUsd >= 0 ? "+" : ""}{fmtMoney(evo.rawChangeUsd, "USD", { compact: true })}</span> · aportes/retiradas {fmtMoney(evo.flowsUsd, "USD", { compact: true })} · resultado <span className={toneCls(toneOf(evo.resultUsd))}>{evo.resultUsd != null ? fmtMoney(evo.resultUsd, "USD", { compact: true }) : "—"}</span>{hodl != null ? <> · só BTC {hodl >= 0 ? "+" : ""}{(hodl * 100).toFixed(1).replace(".", ",")}%</> : null}</> : "Variação, fluxos e resultado aparecem com 2 retratos."}
        </p>
      </div>
    </Panel>
  );
}

/** Tabela (desktop) e cartões (iPhone) das posições perpétuas, todas as contas. */
export function PerpsTable({ className }: { className?: string }) {
  const f = useFmt();
  const v = usePerps().data;
  const minLiq = 0.1;
  const acc = (id: string) => v?.accounts.find((a) => a.id === id)?.name ?? "";
  return (
    <Panel tech className={cn("min-w-0 overflow-hidden", className)}>
      <PanelHead title="Posições perpétuas" right={<Link href="/perpetuos" className="text-[12px] font-medium text-accent">Detalhes ›</Link>}
        sub={v?.connected ? <>{v.summary.count} aberta{v.summary.count === 1 ? "" : "s"} · bruta {f.money(v.summary.gross, { compact: true })} · atualizado {v.at ? hm(v.at) : "—"}{v.stale ? <span className="ml-1 text-warn">· desatualizado</span> : null}</> : undefined} />
      {!v || !v.connected ? <p className="px-4 py-6 text-[13px] text-muted">Conecte um endereço da Hyperliquid em Ajustes para acompanhar suas posições (somente leitura).</p>
        : v.positions.length === 0 ? <p className="px-4 py-6 text-[13px] text-muted">Nenhuma posição perpétua aberta agora.</p> : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[520px] text-[12.5px]">
                <thead><tr className="border-b border-line text-left text-[11px] text-muted">
                  {["Ativo", "Lado", "Tamanho", "Notional", "Entrada → Mark", "Liquidação", "Margem", "P&L", "ROI", "Funding"].map((c, i) => <th key={c} className={cn("px-2.5 py-2 font-medium", i > 1 && "text-right", WIDE.includes(c) && "hidden 2xl:table-cell")}>{c}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-line">
                  {v.positions.map((p) => {
                    const r = riskLevel(p.liqDistance, minLiq);
                    return (
                      <tr key={p.id} onClick={() => navigate("/perpetuos")} className="num cursor-pointer [@media(hover:hover)]:hover:bg-surface-2">
                        <td className="px-2 py-2.5"><span className="flex items-center gap-2" title={acc(p.accountId)}><CoinLogo symbol={p.coin} size={20} /><span className="font-semibold text-ink">{p.coin}</span></span></td>
                        <td className="px-2 py-2.5"><span className="flex items-center gap-1.5"><DirBadge dir={p.dir} /><span className="text-[11px] text-muted">{p.leverage}×</span></span></td>
                        <td className="hidden px-2 py-2.5 text-right 2xl:table-cell">{f.hidden ? "•••" : p.size.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}</td>
                        <td className="px-2 py-2.5 text-right">{f.money(p.notional, { compact: true })}</td>
                        <td className="px-2 py-2.5 text-right">{p.entry != null ? f.px(p.entry) : "—"}<span className="block text-[11px] text-muted">{p.mark != null ? f.px(p.mark) : "—"}</span></td>
                        <td className={cn("px-2 py-2.5 text-right", r === "high" ? "text-loss" : r === "warn" ? "text-warn" : "")}>{p.liq != null ? <>{f.px(p.liq)}<span className="block text-[10px] text-muted">{p.liqDistance != null ? f.pct(p.liqDistance, false) : ""}</span></> : <span className="text-muted">sem liq.</span>}</td>
                        <td className="hidden px-2 py-2.5 text-right 2xl:table-cell">{p.margin != null ? f.money(p.margin, { compact: true }) : "—"}</td>
                        <td className={cn("px-2 py-2.5 text-right font-semibold", toneCls(toneOf(p.upnl)))}>{f.money(p.upnl, { signed: true })}</td>
                        <td className={cn("px-2 py-2.5 text-right", toneCls(toneOf(p.roiOnMargin)))}>{p.roiOnMargin != null ? f.pct(p.roiOnMargin) : "—"}</td>
                        <td className={cn("hidden px-2 py-2.5 text-right 2xl:table-cell", toneCls(toneOf(p.funding)))}>{p.funding != null ? f.money(-p.funding, { signed: true }) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ul className="grid gap-2 p-3 md:hidden">
              {v.positions.map((p) => {
                const edge = p.upnl > 0 ? "border-l-gain" : p.upnl < 0 ? "border-l-loss" : "border-l-gold";
                return (
                  <li key={p.id}>
                    <button onClick={() => navigate("/perpetuos")} aria-label={`Abrir ${p.coin} ${p.dir}`} className={cn("w-full rounded-xl border border-line border-l-[3px] bg-surface-2/60 px-3.5 py-3 text-left active:bg-surface-2", edge)}>
                      <div className="flex items-center gap-2"><CoinLogo symbol={p.coin} size={22} /><span className="text-[15px] font-semibold">{p.coin}</span><DirBadge dir={p.dir} /><span className="num ml-auto text-[12px] text-muted">{p.leverage}×</span></div>
                      <div className="num mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"><span className="text-[12px] text-muted">{p.entry != null ? f.px(p.entry) : "—"} → {p.mark != null ? f.px(p.mark) : "—"}</span><span className={cn("text-[16px] font-semibold", toneCls(toneOf(p.upnl)))}>{f.money(p.upnl, { signed: true })}</span></div>
                      <div className="num mt-1 flex flex-wrap justify-between gap-x-3 text-[11.5px] text-muted"><span className="whitespace-nowrap">notional {f.money(p.notional, { compact: true })}</span><span className="whitespace-nowrap">{p.roiOnMargin != null ? `ROI ${f.pct(p.roiOnMargin)}` : ""} · liq. {p.liqDistance != null ? f.pct(p.liqDistance, false) : "n/d"}</span></div>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="border-t border-line px-4 py-2 text-[11px] text-muted">ROI = P&L aberto ÷ margem usada da posição. Funding mostrado como resultado (positivo = recebido) desde a abertura.</p>
          </>
        )}
    </Panel>
  );
}

function Donut({ parts }: { parts: { color: string; share: number }[] }) {
  const R = 46, r = 30, c = 60;
  let a0 = -Math.PI / 2;
  const arcs = parts.map((p, i) => {
    const sweep = Math.min(p.share, 0.9999) * Math.PI * 2, a1 = a0 + sweep;
    const pt = (rad: number, a: number) => `${c + rad * Math.cos(a)} ${c + rad * Math.sin(a)}`;
    const large = sweep > Math.PI ? 1 : 0;
    const d = `M ${pt(R, a0)} A ${R} ${R} 0 ${large} 1 ${pt(R, a1)} L ${pt(r, a1)} A ${r} ${r} 0 ${large} 0 ${pt(r, a0)} Z`;
    a0 = a1;
    return <path key={i} d={d} fill={p.color} stroke="var(--color-surface)" strokeWidth="1" />;
  });
  return <svg viewBox="0 0 120 120" className="size-[104px] shrink-0" role="img" aria-label="Alocação por ativo">{arcs}</svg>;
}

export function AllocationPanel({ h, className }: { h: Hub; className?: string }) {
  const f = useFmt();
  const parts = h.pv ? allocation(h.pv.c.assets) : [];
  return (
    <Panel tech className={cn("overflow-hidden", className)}>
      <PanelHead title="Alocação por ativo" sub="patrimônio próprio + equity de derivativos (sem notional)" />
      {parts.length === 0 ? <p className="px-4 py-6 text-[13px] text-muted">Sem ativos avaliados ainda.</p> : (
        <div className="flex items-center gap-4 px-4 py-4">
          <Donut parts={parts} />
          <ul className="min-w-0 flex-1 space-y-1.5">
            {parts.map((p) => (
              <li key={p.symbol} className="flex items-center gap-2 text-[12.5px]"><span className="size-2.5 shrink-0 rounded-sm" style={{ background: p.color }} aria-hidden /><span className="min-w-0 flex-1 truncate">{p.symbol}</span><span className="num hidden text-muted 2xl:inline">{f.money(p.value, { compact: true })}</span><span className="num w-11 text-right text-ink-2">{f.pct(p.share, false)}</span></li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

export function AssetPerfPanel({ h, period, className }: { h: Hub; period: EvoPeriod; className?: string }) {
  const f = useFmt();
  const r = useMemo(() => assetChanges(h.snaps, period, Date.now()), [h.snaps, period]);
  const assets = h.pv?.c.assets.filter((a) => a.valueUsd != null && a.valueUsd > 0).slice(0, 6) ?? [];
  const byKey = new Map(r.rows.map((x) => [x.key, x]));
  return (
    <Panel tech className={cn("overflow-hidden", className)}>
      <PanelHead title="Desempenho por ativo" sub="variação de valor no período e do preço em 24h" />
      {assets.length === 0 ? <p className="px-4 py-6 text-[13px] text-muted">Sem ativos avaliados ainda.</p> : (
        <ul className="divide-y divide-line">
          {assets.map((a) => {
            const c = byKey.get(a.symbol);
            return (
              <li key={a.econ} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                <CoinLogo symbol={a.symbol} size={22} />
                <span className="min-w-0 flex-1 truncate font-medium">{a.symbol}</span>
                <span className="num hidden text-[12px] text-muted 2xl:inline">{f.money(a.valueUsd!, { compact: true })}</span>
                <span className={cn("num w-[68px] text-right text-[12px]", toneCls(toneOf(c?.changePct)))}>{c?.changePct != null ? f.pct(c.changePct) : "—"}</span>
                <span className={cn("num w-[56px] text-right text-[11.5px]", toneCls(toneOf(a.change24h)))}>{a.change24h != null ? f.pct(a.change24h) : "—"}</span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="border-t border-line px-4 py-2 text-[11px] text-muted">Colunas: valor · período {r.available ? `(desde ${dmy(r.fromT!)}, inclui compras e vendas)` : "(retratos por ativo começam a ser gravados agora)"} · 24h (preço).</p>
    </Panel>
  );
}

export function HlSummaryPanel({ className }: { className?: string }) {
  const f = useFmt();
  const v = usePerps().data;
  return (
    <Panel tech className={cn("overflow-hidden", className)}>
      <PanelHead title="Resumo da Hyperliquid" right={<Link href="/perpetuos" className="text-[12px] font-medium text-accent">Abrir ›</Link>} />
      {!v?.connected ? <p className="px-4 py-6 text-[13px] text-muted">Hyperliquid não conectada.</p> : (
        <ul className="divide-y divide-line">
          {v.accounts.map((a) => {
            const spot = a.live ? a.live.balances.filter((b) => b.where === "spot").reduce((x, b) => x + (b.usd ?? 0), 0) : null;
            return (
              <li key={a.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2"><span className="truncate text-[13px] font-semibold">{a.name}</span><Pill tone={a.stale ? "gold" : "gain"}>{a.stale ? "desatualizado" : "ao vivo"}</Pill></div>
                <div className="num mt-1.5 grid grid-cols-3 gap-2 text-[12px]">
                  <div><p className="lbl">Equity</p><p className="font-semibold">{a.live ? f.money(a.live.total, { compact: true }) : "—"}</p></div>
                  <div><p className="lbl">Spot</p><p>{spot != null ? f.money(spot, { compact: true }) : "—"}</p></div>
                  <div><p className="lbl">P&L aberto</p><p className={toneCls(toneOf(a.summary.upnl))}>{a.live ? f.money(a.summary.upnl, { signed: true }) : "—"}</p></div>
                </div>
                <p className="num mt-1.5 text-[11px] text-muted">{a.at ? `atualizado ${hm(a.at)}` : "sem dados"}{a.recon ? ` · conciliação: ${a.recon.status === "reconciled" ? "ok" : a.recon.status}` : ""}</p>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function LongShortPanel({ className }: { className?: string }) {
  const f = useFmt();
  const v = usePerps().data;
  const s = longShort(v?.positions ?? []);
  const lp = s.grossNotional ? s.long.notional / s.grossNotional : 0;
  return (
    <Panel tech className={cn("overflow-hidden", className)}>
      <PanelHead title="LONG vs SHORT" sub="exposição nocional (não entra no patrimônio)" />
      {!v?.connected || v.positions.length === 0 ? <p className="px-4 py-6 text-[13px] text-muted">Sem posições abertas.</p> : (
        <div className="space-y-3 px-4 py-4">
          <div className="flex h-2.5 overflow-hidden rounded-full bg-loss/70" role="img" aria-label={`LONG ${Math.round(lp * 100)}%, SHORT ${Math.round((1 - lp) * 100)}%`}><div className="bg-gain" style={{ width: `${lp * 100}%` }} /></div>
          <div className="num grid grid-cols-2 gap-3 text-[12px]">
            <div><p className="lbl text-gain">LONG · {s.long.n}</p><p className="font-semibold">{f.money(s.long.notional, { compact: true })}</p><p className={cn("text-[11px]", toneCls(toneOf(s.long.upnl)))}>{f.money(s.long.upnl, { signed: true })}</p></div>
            <div className="text-right"><p className="lbl text-loss">SHORT · {s.short.n}</p><p className="font-semibold">{f.money(s.short.notional, { compact: true })}</p><p className={cn("text-[11px]", toneCls(toneOf(s.short.upnl)))}>{f.money(s.short.upnl, { signed: true })}</p></div>
          </div>
          <p className="num border-t border-line pt-2 text-[11.5px] text-muted">Exposição líquida {f.money(s.netNotional, { signed: true, compact: true })} · bruta {f.money(s.grossNotional, { compact: true })}</p>
        </div>
      )}
    </Panel>
  );
}

export function FundingFeesPanel({ className }: { className?: string }) {
  const f = useFmt();
  const v = usePerps().data;
  const st = v?.stats;
  return (
    <Panel tech className={cn("overflow-hidden", className)}>
      <PanelHead title="Funding e taxas" />
      {!v?.connected ? <p className="px-4 py-6 text-[13px] text-muted">Hyperliquid não conectada.</p> : (
        <dl className="num divide-y divide-line text-[12.5px]">
          <div className="flex justify-between px-4 py-2.5"><dt className="text-muted">Funding das abertas</dt><dd className={toneCls(toneOf(-v.summary.funding))}>{f.money(-v.summary.funding, { signed: true })}</dd></div>
          <div className="flex justify-between px-4 py-2.5"><dt className="text-muted">Funding líquido (histórico)</dt><dd className={toneCls(toneOf(st?.funding))}>{st ? f.money(st.funding, { signed: true }) : NA}</dd></div>
          <div className="flex justify-between px-4 py-2.5"><dt className="text-muted">Taxas pagas (histórico)</dt><dd>{st ? f.money(-Math.abs(st.fees), { signed: true }) : NA}</dd></div>
        </dl>
      )}
      {v?.connected && !v.historyComplete && <p className="border-t border-line px-4 py-2 text-[11px] text-warn">Histórico parcial: totais podem estar subestimados.</p>}
    </Panel>
  );
}

export function MarginPanel({ className }: { className?: string }) {
  const f = useFmt();
  const v = usePerps().data;
  const s = v?.summary;
  const use = s ? marginUse(s.margin, s.equity) : null;
  const lvl = s?.riskLevel;
  return (
    <Panel tech className={cn("overflow-hidden", className)}>
      <PanelHead title="Margem e alavancagem" right={lvl && lvl !== "none" ? <Pill tone={lvl === "high" ? "loss" : lvl === "warn" ? "gold" : "gain"}>{lvl === "high" ? "risco alto" : lvl === "warn" ? "atenção" : "ok"}</Pill> : undefined} />
      {!v?.connected || !s || s.count === 0 ? <p className="px-4 py-6 text-[13px] text-muted">Sem posições abertas.</p> : (
        <div className="num grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-4 text-[12.5px]">
          <div><p className="lbl">Margem usada</p><p className="font-semibold">{f.money(s.margin, { compact: true })}</p></div>
          <div><p className="lbl">Uso do equity</p><p className="font-semibold">{use != null ? f.pct(use, false) : "—"}</p></div>
          <div><p className="lbl">Alavancagem efetiva</p><p className="font-semibold">{s.effLeverage != null ? `${s.effLeverage.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×` : "—"}</p></div>
          <div><p className="lbl">Pior liquidação</p><p className={cn("font-semibold", lvl === "high" ? "text-loss" : lvl === "warn" ? "text-warn" : "")}>{s.worstLiqDistance != null ? f.pct(s.worstLiqDistance, false) : "n/d"}</p></div>
        </div>
      )}
    </Panel>
  );
}

const DOT: Record<string, string> = { ok: "bg-gain", sync: "bg-accent animate-pulse", stale: "bg-warn", error: "bg-loss", off: "bg-loss", none: "bg-muted/60" };
const TXT: Record<string, string> = { ok: "ao vivo", sync: "sincronizando", stale: "desatualizado", error: "erro", off: "sem dados", none: "não conectada" };

/** Integrações com estado real (último sincronismo, erro). */
export function IntegrationsPanel({ className }: { className?: string }) {
  const list = useIntegrations();
  const p = portfolio();
  const kind = (k: string, label: string) => {
    const accs = p.accounts.filter((a) => a.kind === k);
    if (!accs.length) return { key: k, label, state: "none" as const, at: null as number | null, detail: "" };
    const st = accs.map((a) => p.sync[a.id]);
    const state = st.some((s) => s?.state === "error") ? "error" : st.some((s) => s?.state === "sync") ? "sync" : st.every((s) => s?.state === "ok") ? "ok" : "stale";
    const at = Math.max(0, ...st.map((s) => s?.at ?? 0)) || null;
    const err = st.find((s) => s?.state === "error") as { error?: string } | undefined;
    return { key: k, label, state: state as "ok" | "stale" | "sync" | "error", at, detail: err?.error ?? `${accs.length} endereço${accs.length === 1 ? "" : "s"}` };
  };
  const get = (k: string) => list.find((i) => i.key === k);
  const rows = [
    get("hl") && { ...get("hl")!, label: "Hyperliquid" },
    get("okx") ?? { key: "okx", label: "OKX", state: "none" as const, at: null, detail: "" },
    kind("evm", "Rabby / EVM"), kind("bitcoin", "Bitcoin nativo"), kind("solana", "Solana"),
    get("prices") && { ...get("prices")!, label: "Cotações" },
  ].filter(Boolean) as { key: string; label: string; state: keyof typeof DOT; at: number | null; detail: string }[];
  return (
    <Panel tech className={cn("overflow-hidden", className)}>
      <PanelHead title="Integrações" right={<Link href="/ajustes" className="text-[12px] font-medium text-accent">Gerenciar ›</Link>} />
      <ul className="divide-y divide-line">
        {rows.map((i) => (
          <li key={i.key} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
            <span className={cn("size-2 shrink-0 rounded-full", DOT[i.state])} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{i.label}</span>
            <span className="num truncate text-[11px] text-muted">{i.state === "ok" && i.at ? `${TXT.ok} · ${hm(i.at)}` : i.state === "error" || i.state === "stale" ? `${TXT[i.state]}${i.detail ? ` · ${i.detail}` : ""}` : TXT[i.state]}</span>
          </li>
        ))}
      </ul>
      <p className="border-t border-line px-4 py-2 text-[11px] text-muted">Somente leitura: o terminal nunca envia ordens nem guarda chaves.</p>
    </Panel>
  );
}

/** Cartão compacto do Performance Analytics (30 dias): resultado das operações, maior contribuinte, funding e taxas. */
export function PerfAnalyticsCard({ className }: { className?: string }) {
  const f = useFmt();
  const a = useAnalytics("30", undefined, null);
  const ok = Boolean(a.perps?.connected);
  return (
    <Panel tech className={cn("overflow-hidden", className)}>
      <PanelHead title="Performance Analytics" sub="últimos 30 dias" right={<Link href="/inteligencia" className="text-[12px] font-medium text-accent">Abrir ›</Link>} />
      {!ok ? <p className="px-4 py-6 text-[13px] text-muted">Hyperliquid não conectada: sem resultado de operações.</p> : (
        <div className="num grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-4 text-[12.5px]">
          <div className="col-span-2"><p className="lbl">Resultado líquido das operações</p><p className={cn("text-[20px] font-semibold tracking-tight", toneCls(toneOf(a.wf.net)))}>{f.money(a.wf.net, { signed: true })}</p></div>
          <div><p className="lbl">Principal ativo</p><p className="font-semibold">{a.topCoin ? <>{a.topCoin.coin} <span className={cn("text-[12px]", toneCls(toneOf(a.topCoin.net)))}>{f.money(a.topCoin.net, { signed: true, compact: true })}</span></> : "—"}</p></div>
          <div><p className="lbl">Rentabilidade (TWR)</p><p className={cn("font-semibold", toneCls(toneOf(a.evo?.twr)))}>{a.evo?.twr != null ? f.pct(a.evo.twr) : "Dados insuficientes"}</p></div>
          <div><p className="lbl">Funding líquido</p><p className={toneCls(toneOf(a.wf.funding))}>{f.money(a.wf.funding, { signed: true })}</p></div>
          <div><p className="lbl">Taxas</p><p className="text-loss">{f.money(a.wf.fees, { signed: true })}</p></div>
        </div>
      )}
    </Panel>
  );
}

/** Radar de Mercado: alertas por regras, próximos eventos e manchetes mais relevantes para as suas posições. Só leitura. */
export function RadarCard({ className }: { className?: string }) {
  const mi = useMarketIntel({ poll: true });
  const { st } = mi;
  const next = mi.upcoming.filter((e) => e.importance === "alta" && e.start > mi.now)[0] ?? null;
  const top = mi.news.slice(0, 3);
  const unseen = mi.alerts.length;
  return (
    <Panel tech className={cn("overflow-hidden", className)}>
      <PanelHead title="Radar de Mercado" sub={unseen ? `${unseen} alerta${unseen > 1 ? "s" : ""} ativo${unseen > 1 ? "s" : ""}` : "sem alertas agora"} right={<Link href="/mercado-intel" className="text-[12px] font-medium text-accent">Abrir ›</Link>} />
      {!st.proxyUrl ? <p className="px-4 py-6 text-[13px] text-muted">Proxy de notícias não configurado. <Link href="/mercado-intel" className="text-accent">Configurar</Link></p> : (
        <div className="space-y-3 px-4 py-4 text-[12.5px]">
          {mi.alerts[0] && <div><p className="lbl">Atenção</p><p className="font-semibold leading-snug">{mi.alerts[0].title}</p></div>}
          <div><p className="lbl">Próximo evento de alta importância</p><p className="font-semibold">{next ? <>{next.kind} <span className="num text-[12px] font-normal text-muted">{new Date(next.start).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span></> : "Dados insuficientes"}</p></div>
          <div><p className="lbl">Manchetes relevantes</p>
            {top.length === 0 ? <p className="text-muted">Dados insuficientes</p> : <ul className="space-y-1.5">{top.map((n) => <li key={n.id} className="leading-snug"><a href={n.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{n.title}</a> <span className="text-[11px] text-muted">{n.source}</span></li>)}</ul>}
          </div>
        </div>
      )}
    </Panel>
  );
}

export { Notice };
