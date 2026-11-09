"use client";
/** Posições Perpétuas: todas as posições abertas da Hyperliquid, de qualquer ativo. Separado da Estratégia BTC/USDC. */
import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, RefreshCw } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { usePerps } from "@/lib/api";
import { useFmt } from "@/lib/state";
import { coinCandles, hlState } from "@/lib/local/hl";
import { getStore } from "@/lib/local/store";
import type { PerpPosition } from "@/lib/perps/positions";
import { riskLevel } from "@/lib/perps/positions";
import { filterTrades, tradeStats, type Trade } from "@/lib/perps/trades";
import { syncHlNow } from "@/app/providers";
import { CoinLogo } from "@/components/coin-logo";
import { C } from "@/components/charts";
import { Sheet } from "@/components/sheet";
import { Button, Kpi, KpiGrid, Metric, Notice, Panel, PanelHead, Pill, Row, Segmented, Skeleton, cn, toneCls, toneOf } from "@/components/ui";
import { RECON_LABEL } from "@/lib/perps/reconcile";
import type { PerpsView } from "@/lib/perps/view";
import { navigate } from "@/lib/router";

const NA = "Não disponível";
const RISK_TXT = { ok: "Risco baixo", warn: "Atenção", high: "Risco alto", none: "Sem risco" } as const;
const RISK_TONE = { ok: "gain", warn: "gold", high: "loss", none: "neutral" } as const;

export function DirBadge({ dir }: { dir: "LONG" | "SHORT" }) {
  const Up = dir === "LONG";
  return <Pill tone={Up ? "gain" : "loss"}>{Up ? <ArrowUpRight className="mr-0.5 inline size-3" aria-hidden /> : <ArrowDownRight className="mr-0.5 inline size-3" aria-hidden />}{Up ? "LONG" : "SHORT"}</Pill>;
}

export default function PerpsPage() {
  const q = usePerps();
  const f = useFmt();
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const v = q.data;
  if (!v && q.loading) return <div className="space-y-4 pt-5"><Skeleton className="h-28" /><Skeleton className="h-64" /></div>;
  if (!v) return <div className="pt-5"><Notice tone="loss">{q.error?.message ?? "Posições indisponíveis."}</Notice></div>;
  const s = v.summary;
  const minLiq = Number(getStore().settings.minLiqDistance) || 0.1;
  const sel = v.positions.find((p) => p.id === open) ?? null;
  const refresh = async () => { setBusy(true); try { await syncHlNow(false); } finally { setBusy(false); } };

  return (
    <div className="pt-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight">Posições Perpétuas</h1>
          <p className="mt-1 text-[13px] text-muted">Hyperliquid · todos os ativos, descobertos automaticamente · somente leitura. Resultados separados da Estratégia BTC/USDC.</p>
        </div>
        <Button size="sm" onClick={refresh} loading={busy}><RefreshCw className="size-3.5" />Atualizar</Button>
      </div>

      {!v.connected && <Notice tone="info">Conecte a Hyperliquid em Ajustes para ver suas posições.</Notice>}
      {v.connected && v.stale && <Notice>Dados desatualizados{v.at ? ` (última sincronização às ${new Date(v.at).toLocaleTimeString("pt-BR")})` : ""}. {v.error ?? ""}</Notice>}

      <KpiGrid className="mb-4 grid-cols-2 lg:grid-cols-5">
        <Kpi label="Posições abertas" value={String(s.count)} sub={v.at ? `sincronizado ${new Date(v.at).toLocaleTimeString("pt-BR")}` : NA} />
        <Kpi label="P&L não realizado" tone={toneOf(s.upnl)} value={f.money(s.upnl, { signed: true })} sub="soma das posições" />
        <Kpi label="Equity da conta" value={s.equity != null ? f.money(s.equity) : NA} sub="margem + P&L aberto" />
        <Kpi label="Exposição bruta" value={f.money(s.gross, { compact: true })} sub={`líquida ${f.money(s.net, { compact: true, signed: true })} · não é patrimônio`} />
        <Kpi label="Alavancagem efetiva" value={s.effLeverage != null ? `${s.effLeverage.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×` : NA} sub="bruta ÷ equity" />
        <Kpi label="Margem utilizada" value={f.money(s.margin)} sub="já incluída na equity" />
        <Kpi label="Funding da posição" tone={toneOf(s.funding)} value={f.money(s.funding, { signed: true })} sub="desde a abertura de cada posição" />
        <Kpi label="Risco agregado" tone={s.riskLevel === "high" ? "loss" : s.riskLevel === "warn" ? "warn" : null} value={RISK_TXT[s.riskLevel]} sub={s.worstLiqDistance != null ? `pior distância ${f.pct(s.worstLiqDistance, false)}` : NA} />
      </KpiGrid>

      {s.count === 0 && v.connected && <Panel className="px-4 py-6 text-[14px] text-muted">Nenhuma posição perpétua aberta agora.</Panel>}
      <div className="grid gap-3 lg:grid-cols-2">
        {v.positions.map((p) => <PositionCard key={p.id} p={p} minLiq={minLiq} onOpen={() => setOpen(p.id)} />)}
      </div>

      {v.recon && <ReconPanel v={v} onRun={refresh} busy={busy} />}
      <PerfPanel trades={v.trades} historyComplete={v.historyComplete} />
      <p className="mt-4 text-[11px] leading-relaxed text-muted">Estimativas de liquidação e de cenários dependem das regras de margem da corretora e podem diferir. A conta é lida pelo endereço público; nada é negociado por este app.</p>
      {sel && <PositionSheet p={sel} trades={v.trades.filter((t) => t.coin === sel.coin)} onClose={() => setOpen(null)} />}
    </div>
  );
}

function PositionCard({ p, minLiq, onOpen }: { p: PerpPosition; minLiq: number; onOpen: () => void }) {
  const f = useFmt();
  const risk = riskLevel(p.liqDistance, minLiq);
  return (
    <Panel tech className="p-4">
      <button onClick={onOpen} className="block w-full text-left" aria-label={`Abrir detalhes de ${p.coin}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <CoinLogo symbol={p.coin} size={28} />
            <div><p className="text-[15px] font-semibold">{p.coin} / USD <span className="text-[11px] font-normal text-muted">PERPÉTUO · Hyperliquid</span></p>
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5"><DirBadge dir={p.dir} /><Pill>{p.leverage}× {p.levType === "isolated" ? "isolada" : "cruzada"}</Pill>{p.linkedStrategy && <Pill tone="gold">Vinculada à Estratégia BTC/USDC</Pill>}</p></div>
          </div>
          <Pill tone={RISK_TONE[risk]}>{RISK_TXT[risk]}</Pill>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-[13px] sm:grid-cols-3">
          <Metric label="Contratos" value={<>{f.btc(p.size, 4)} {p.coin}</>} />
          <Metric label="Entrada" value={<>{p.entry != null ? f.px(p.entry) : NA}</>} />
          <Metric label="Mark" value={<>{p.mark != null ? f.px(p.mark) : NA}</>} />
          <Metric label="Nocional" value={<>{f.money(p.notional)}</>} />
          <Metric label="Margem" value={<>{p.margin != null ? f.money(p.margin) : NA}</>} />
          <Metric label="P&L aberto" tone={toneOf(p.upnl)} value={<>{f.money(p.upnl, { signed: true })}</>} />
          <Metric label="ROI s/ margem" value={<>{p.roiOnMargin != null ? <span className={toneCls(toneOf(p.roiOnMargin))}>{f.pct(p.roiOnMargin)}</span> : NA}</>} />
          <Metric label="Liquidação" value={<>{p.liq != null ? `${f.px(p.liq)} (${f.pct(p.liqDistance, false)})` : NA}</>} />
          <Metric label="Funding" value={<>{p.funding != null ? f.money(p.funding, { signed: true }) : NA}</>} />
        </div>
        <p className="mt-2 text-[10px] text-muted">ROI = P&L não realizado ÷ margem usada na posição.</p>
      </button>
    </Panel>
  );
}

function PerfPanel({ trades, historyComplete }: { trades: Trade[]; historyComplete: boolean }) {
  const f = useFmt();
  const [coin, setCoin] = useState("all"), [dir, setDir] = useState<"all" | "LONG" | "SHORT">("all"), [days, setDays] = useState<"all" | "7" | "30">("all");
  const coins = useMemo(() => [...new Set(trades.map((t) => t.coin))], [trades]);
  const list = filterTrades(trades, { coin: coin === "all" ? undefined : coin, dir: dir === "all" ? undefined : dir, from: days === "all" ? undefined : Date.now() - Number(days) * 86400e3 });
  const st = tradeStats(list);
  return (
    <Panel className="mt-4">
      <PanelHead title="Performance dos perpétuos" right={<span className="text-[11px]">operações, não fills · contabilidade própria</span>} />
      <div className="flex flex-wrap gap-2 px-4 pt-3">
        <Segmented size="sm" label="Ativo" value={coin} onChange={setCoin} options={[{ value: "all", label: "Todos" }, ...coins.map((c) => ({ value: c, label: c }))]} />
        <Segmented size="sm" label="Direção" value={dir} onChange={(x) => setDir(x as typeof dir)} options={[{ value: "all", label: "L+S" }, { value: "LONG", label: "Long" }, { value: "SHORT", label: "Short" }]} />
        <Segmented size="sm" label="Período" value={days} onChange={(x) => setDays(x as typeof days)} options={[{ value: "all", label: "Tudo" }, { value: "30", label: "30 d" }, { value: "7", label: "7 d" }]} />
      </div>
      {!historyComplete && <p className="px-4 pt-3 text-[12px] text-warn">Histórico possivelmente incompleto: operações antigas podem estar faltando e posições herdadas não têm preço médio.</p>}
      {list.length === 0 ? <p className="px-4 py-5 text-[13px] text-muted">Sem operações neste filtro.</p> : (
        <KpiGrid className="m-4 grid-cols-2 lg:grid-cols-4">
          <Kpi label="Resultado líquido" tone={toneOf(st.netPnl)} value={f.money(st.netPnl, { signed: true })} sub="realizado − taxas + funding" />
          <Kpi label="P&L realizado" tone={toneOf(st.realizedPnl)} value={f.money(st.realizedPnl, { signed: true })} sub={`taxas ${f.money(-st.fees, { signed: true })} · funding ${f.money(st.funding, { signed: true })}`} />
          <Kpi label="Operações" value={`${st.closedCount} fechadas · ${st.openCount} abertas`} sub={st.winRate != null ? `acerto ${f.pct(st.winRate, false)} (${st.wins}G/${st.losses}P)` : "acerto: —"} />
          <Kpi label="Profit factor" value={st.profitFactor != null ? st.profitFactor.toFixed(2) : "—"} sub={`queda máx. ${f.money(st.maxDrawdown)}`} />
        </KpiGrid>
      )}
      {Object.entries(st.byCoin).map(([c, x]) => (
        <div key={c} className="flex items-center gap-2 border-t border-line px-4 py-2.5 text-[13px]"><CoinLogo symbol={c} size={18} /><span className="flex-1 font-medium">{c}</span><span className="text-muted">{x.trades} op.</span><span className={cn("num w-28 text-right", toneCls(toneOf(x.netPnl)))}>{f.money(x.netPnl, { signed: true })}</span></div>
      ))}
    </Panel>
  );
}

function PositionSheet({ p, trades, onClose }: { p: PerpPosition; trades: Trade[]; onClose: () => void }) {
  const f = useFmt();
  const [series, setSeries] = useState<{ t: number; c: number }[] | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => { coinCandles(p.coin).then(setSeries).catch(() => setErr(true)); }, [p.coin]);
  const cur = trades.find((t) => t.open) ?? null;
  const fills = (cur?.fills ?? []).slice(-12).reverse();
  return (
    <Sheet title={`${p.coin} / USD — ${p.dir}`} onClose={onClose}>
      <div className="h-44">
        {series && series.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%"><AreaChart data={series}><CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="t" hide /><YAxis domain={["auto", "auto"]} width={56} tick={{ fontSize: 10, fill: "var(--color-muted)" }} tickLine={false} axisLine={false} />
            <Tooltip formatter={(x) => f.px(Number(x))} labelFormatter={(t) => new Date(Number(t)).toLocaleString("pt-BR")} contentStyle={{ background: "var(--color-surface-3)", border: "1px solid var(--color-line-strong)", fontSize: 12 }} />
            <Area dataKey="c" stroke={C.accent} fill={C.accent} fillOpacity={0.12} strokeWidth={1.6} dot={false} isAnimationActive={false} />
            {p.entry != null && <ReferenceLine y={p.entry} stroke={C.gold} strokeDasharray="4 3" label={{ value: "entrada", fontSize: 10, fill: "var(--color-gold)" }} />}
            {p.liq != null && <ReferenceLine y={p.liq} stroke={C.loss} strokeDasharray="4 3" label={{ value: "liq.", fontSize: 10, fill: "var(--color-loss)" }} />}
          </AreaChart></ResponsiveContainer>
        ) : <p className="grid h-full place-items-center text-[13px] text-muted">{err ? "Gráfico indisponível agora." : "Carregando preços…"}</p>}
      </div>
      <p className="mt-1 text-[10px] text-muted">Preço de fechamento por hora, últimos 7 dias · fonte Hyperliquid.</p>
      <div className="mt-3 space-y-1.5 text-[13px]">
        <Row label="Entrada média">{p.entry != null ? f.px(p.entry) : NA}</Row>
        <Row label="Mark atual">{p.mark != null ? f.px(p.mark) : NA}</Row>
        <Row label="P&L não realizado" tone={toneOf(p.upnl)}>{f.money(p.upnl, { signed: true })}</Row>
        <Row label="Nocional · margem">{f.money(p.notional)} · {p.margin != null ? f.money(p.margin) : NA}</Row>
        <Row label="Liquidação">{p.liq != null ? `${f.px(p.liq)} (${f.pct(p.liqDistance, false)})` : NA}</Row>
        {cur && <Row label="P&L realizado na operação" tone={toneOf(cur.realizedPnl)}>{f.money(cur.realizedPnl, { signed: true })}</Row>}
        {cur && <Row label="Taxas · funding da operação">{f.money(-cur.fees, { signed: true })} · {f.money(cur.funding, { signed: true })}</Row>}
        {cur?.inherited && <p className="text-[12px] text-warn">Posição aberta antes do histórico carregado: entrada e taxas iniciais podem estar incompletas.</p>}
      </div>
      <p className="mb-1 mt-4 text-[12px] font-medium text-ink-2">Entradas, aumentos e reduções</p>
      {fills.length === 0 ? <p className="text-[12px] text-muted">Sem execuções carregadas para esta operação.</p> : fills.map((x) => (
        <div key={x.key} className="num flex items-center justify-between border-t border-line py-1.5 text-[12px]">
          <span className="text-muted">{new Date(x.time).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
          <span>{x.side === "B" ? "compra" : "venda"} {x.sz} @ {f.px(x.px)}</span>
          <span className={toneCls(toneOf(x.closedPnl))}>{x.closedPnl ? f.money(x.closedPnl, { signed: true }) : "—"}</span>
        </div>
      ))}
      <div className="mt-4"><Button size="sm" variant="ghost" onClick={() => { onClose(); navigate("/mercado"); }}>Ver mercado</Button></div>
    </Sheet>
  );
}

function ReconPanel({ v, onRun, busy }: { v: PerpsView; onRun: () => void; busy: boolean }) {
  const f = useFmt();
  const r = v.recon!;
  const tone = r.status === "reconciled" ? "gain" : r.status === "divergence" ? "loss" : "gold";
  const full = async () => { await syncHlNow(true); };
  return (
    <Panel className="mt-4">
      <PanelHead title="Reconciliação dos perpétuos" right={<Pill tone={tone}>{RECON_LABEL[r.status]}</Pill>} />
      <div className="px-4 py-3 text-[13px]">
        {r.equityDiff != null && <p className="num">Equity oficial {f.money(r.officialEquity)} · modelo {f.money(r.expectedEquity)} · diferença <b className={toneCls(toneOf(r.equityDiff))}>{f.money(r.equityDiff, { signed: true })}</b></p>}
        {r.reasons.map((x) => <p key={x} className="mt-1 text-[12px] text-warn">{x}</p>)}
        <p className="mt-2 text-[11px] text-muted">“Conciliado” exige histórico completo, tamanhos das posições batendo com as execuções e equity dentro da tolerância; saldo igual hoje não basta. O histórico original é preservado e execuções repetidas não são duplicadas.</p>
        <div className="mt-3"><Button size="sm" onClick={() => { void full(); }} loading={busy}><RefreshCw className="size-3.5" />Reconciliar agora</Button></div>
      </div>
      {r.byCoin.length > 0 && (
        <div className="border-t border-line">
          {r.byCoin.map((c) => (
            <div key={c.coin} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2 text-[12px]"><CoinLogo symbol={c.coin} size={16} /><span className="w-12 font-medium">{c.coin}</span>
              <span className="text-muted">posição: execuções {c.positionFromFills.toLocaleString("pt-BR", { maximumFractionDigits: 6 })} × ao vivo {c.positionLive.toLocaleString("pt-BR", { maximumFractionDigits: 6 })}</span>
              <Pill tone={c.positionOk ? "gain" : "loss"}>{c.positionOk ? "confere" : "diverge"}</Pill></div>
          ))}
        </div>
      )}
      {r.divergences.length > 0 && (
        <div className="overflow-x-auto border-t border-line">
          <p className="px-4 pt-3 text-[12px] font-medium text-ink-2">Relatório de divergências</p>
          <table className="w-full min-w-[560px] text-left text-[12px]"><thead className="text-muted"><tr>{["Data", "Ativo", "Tipo", "Esperado", "Encontrado", "Diferença", "Origem", "Status"].map((h) => <th key={h} className="px-3 py-1.5 font-normal">{h}</th>)}</tr></thead>
            <tbody>{r.divergences.map((d, i) => (
              <tr key={i} className="border-t border-line"><td className="px-3 py-1.5">{d.at ? new Date(d.at).toLocaleDateString("pt-BR") : "—"}</td><td className="px-3 py-1.5">{d.coin}</td><td className="px-3 py-1.5">{d.type}</td>
                <td className="num px-3 py-1.5">{d.expected != null ? d.expected.toLocaleString("pt-BR", { maximumFractionDigits: 4 }) : "—"}</td><td className="num px-3 py-1.5">{d.found != null ? d.found.toLocaleString("pt-BR", { maximumFractionDigits: 4 }) : "—"}</td>
                <td className="num px-3 py-1.5">{d.diff ? d.diff.toLocaleString("pt-BR", { maximumFractionDigits: 4 }) : "—"}</td><td className="px-3 py-1.5 text-muted">{d.source}</td><td className="px-3 py-1.5">{d.status}</td></tr>
            ))}</tbody></table>
        </div>
      )}
    </Panel>
  );
}
