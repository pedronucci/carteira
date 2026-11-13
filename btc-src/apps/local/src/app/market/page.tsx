"use client";
import { useMemo, useState } from "react";
import { d, sma, SCENARIO_LABEL } from "@bst/domain";
import { marketIntel } from "@/lib/market/intel";
import { useDataVersion } from "@/lib/api";
import { useMarket, usePerps } from "@/lib/api";
import { useFmt } from "@/lib/state";
import { getStore } from "@/lib/local/store";
import { simulateEntry } from "@/lib/local/engine";
import { prices } from "@/lib/local/prices";
import { Field, Notice, Panel, Row, Segmented, SectionTitle, Skeleton, cn, toneCls } from "@/components/ui";
import { PriceChart, type TradeMarker } from "@/components/charts";
import { num } from "@/components/forms";

const SC_TONE = { ACUMULACAO: "text-gain", NEUTRO: "text-ink", REALIZACAO: "text-btc", RISCO_ELEVADO: "text-loss" } as const;
const SC_TEXT = {
  ACUMULACAO: "Os indicadores apontam preço descontado. Historicamente, momento mais favorável para estar em BTC.",
  NEUTRO: "Sem sinal forte em nenhuma direção.",
  REALIZACAO: "Os indicadores apontam preço esticado. Historicamente, momento mais favorável para realizar e voltar a USDC.",
  RISCO_ELEVADO: "Volatilidade ou alavancagem acima dos seus limites. Cuidado redobrado com a liquidação.",
} as const;

function Simulator() {
  const f = useFmt();
  const st = getStore().settings;
  const spot = prices().spot?.btcUsd;
  const [capital, setCapital] = useState("1000");
  const [lev, setLev] = useState(st.defaultLeverage);
  const [entry, setEntry] = useState(spot ? spot.toFixed(0) : "");
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const sim = useMemo(() => {
    const c = num(capital), e = num(entry), l = num(lev);
    if (!c || !e || !l || Number(c) <= 0 || Number(e) <= 0 || Number(l) < 1) return null;
    return simulateEntry({ capital: c, leverage: l, entryPx: e, stopPx: num(stop) || undefined, targetPx: num(target) || undefined }, st.maintenanceRate);
  }, [capital, entry, lev, stop, target, st.maintenanceRate]);
  const minDist = Number(st.minLiqDistance);
  return (
    <section aria-label="Simulador de entrada">
      <SectionTitle sub="Long em perpétuo com margem em USDC">Simulador de entrada</SectionTitle>
      <Panel className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Capital" suffix="US$" inputMode="decimal" value={capital} onChange={(e) => setCapital(e.target.value)} />
          <Field label="Preço de entrada" suffix="US$" inputMode="decimal" value={entry} onChange={(e) => setEntry(e.target.value)} />
          <Field label="Stop" suffix="US$" inputMode="decimal" placeholder="opcional" value={stop} onChange={(e) => setStop(e.target.value)} />
          <Field label="Alvo" suffix="US$" inputMode="decimal" placeholder="opcional" value={target} onChange={(e) => setTarget(e.target.value)} />
        </div>
        <Segmented full label="Alavancagem" value={lev} onChange={setLev} options={["1", "1.5", "2", "3"].map((v) => ({ value: v, label: `${v.replace(".", ",")}x` }))} />
        {sim && (
          <div className="divide-y divide-line/70 border-t border-line/70">
            <Row label="Exposição">{f.usd(sim.notional.toFixed(), { compact: true })} · {f.btc(sim.sizeBtc)} BTC</Row>
            <Row label="Liquidação estimada" tone={sim.liqDist && sim.liqDist.lt(minDist) ? "loss" : null}>{sim.liq ? `${f.px(sim.liq)} (${f.pct(sim.liqDist!.neg())})` : "sem risco de liquidação"}</Row>
            {sim.lossAtStop && <Row label="No stop" tone="loss">{f.usd(sim.lossAtStop.toFixed(), { signed: true })}</Row>}
            {sim.gainAtTarget && <Row label="No alvo" tone="gain">{f.usd(sim.gainAtTarget.toFixed(), { signed: true })}{sim.rr ? ` · ${sim.rr.toFixed(1).replace(".", ",")} : 1` : ""}</Row>}
            <div className="grid grid-cols-4 gap-2 pt-3">
              {sim.shocks.map((x) => (
                <div key={x.shock} className="text-center">
                  <div className="num text-[12px] text-muted">BTC {Math.round(x.shock * 100)}%</div>
                  <div className={cn("num text-[14px] font-medium", x.liquidated ? "text-loss" : toneCls(x.value.lt(num(capital) || 0) ? "loss" : null))}>{x.liquidated ? "liquida" : f.pct(x.value.div(num(capital)).minus(1))}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {sim?.liqDist && sim.liqDist.lt(minDist) && <Notice tone="loss">Liquidação a menos de {Math.round(minDist * 100)}% do preço de entrada. Reduza a alavancagem.</Notice>}
      </Panel>
    </section>
  );
}

export default function MarketPage() {
  const q = useMarket();
  const f = useFmt();
  const [view, setView] = useState<"180" | "400">("180");
  const perps = usePerps().data;
  const markers = useMemo<TradeMarker[]>(() => (perps?.trades ?? []).filter(t=>t.coin === "BTC").flatMap(t=>[
    ...(t.avgEntry != null ? [{id:t.id+"-in",ts:Math.floor(t.openedAt/1000),kind:"ENTRY" as const,price:t.avgEntry}] : []),
    ...(t.closedAt && t.avgExit != null ? [{id:t.id+"-out",ts:Math.floor(t.closedAt/1000),kind:"EXIT" as const,price:t.avgExit}] : []),
  ]),[perps]);
  if (q.loading) return <div className="space-y-3 pt-4"><Skeleton className="h-12" /><Skeleton className="h-80" /></div>;
  if (q.error || !q.data) return <div className="space-y-6 pt-3"><h1 className="text-[28px] font-semibold tracking-tight">Mercado</h1><Notice tone="warn">{q.error?.message ?? "Sem dados."}</Notice><Simulator /></div>;
  const m = q.data;
  const all = prices().usd;
  const closes = all.map((k) => k.c);
  const n = Number(view);
  const candles = m.candles.slice(-n);
  const off = all.length - candles.length;
  const s50 = sma(closes, 50).slice(off), s200 = sma(closes, 200).slice(off);
  const openBasis = perps?.positions.find(p=>p.coin === "BTC")?.entry ?? null;
  const price = candles[candles.length - 1]!.c;
  const prev = candles[candles.length - 2]?.c;
  const spot = prices().spot?.btcUsd ?? price;
  const sc = m.scenario;
  const fmtInd = (i: (typeof m.indicators)[number]) => {
    if (i.fmt === "range") return i.range && i.range[0] && i.range[1] ? `${f.px(i.range[0])} – ${f.px(i.range[1])}` : "—";
    if (i.value == null) return "—";
    if (i.fmt === "usd") return f.px(i.value);
    if (i.fmt === "pct") return f.pct(d(i.value), i.key === "dd");
    if (i.fmt === "x") return i.value.toFixed(2).replace(".", ",");
    return Math.round(i.value).toString();
  };
  return (
    <div className="space-y-4 pt-3">
      <div>
        <p className="lbl">Bitcoin · BTCUSDT</p>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="num text-[30px] font-semibold tracking-[-0.03em] lg:text-[38px]">{f.px(spot)}</span>
          {prev && <span className={cn("num text-[14px]", toneCls(spot >= prev ? "gain" : "loss"))}>{f.pct(d(spot).div(prev).minus(1))} hoje</span>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-12 lg:items-start">
      <div className="min-w-0 space-y-4 lg:col-span-8">
      <section aria-label="Gráfico">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-[13px] text-muted"><span className="text-btc">—</span> MM50 · <span className="text-muted">—</span> MM200{markers.length ? " · setas: suas entradas e saídas" : ""}</p>
          <Segmented label="Janela" value={view} onChange={setView} options={[{ value: "180", label: "6m" }, { value: "400", label: "13m" }]} />
        </div>
        <Panel className="overflow-hidden p-1"><PriceChart candles={candles} markers={markers} avgCost={openBasis} height={340} overlays={{ sma: [s50, s200] }} /></Panel>
      </section>

      <section aria-label="Leitura do cenário">
        <SectionTitle sub="Regras objetivas, não é recomendação">Leitura dos indicadores</SectionTitle>
        <Panel className="p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className={cn("text-[18px] font-semibold", SC_TONE[sc.scenario])}>{SCENARIO_LABEL[sc.scenario]}</span>
            <span className="num text-[13px] text-muted">pontuação {sc.score > 0 ? "+" : ""}{sc.score}{m.trend ? ` · tendência ${m.trend.state.toLowerCase()}` : ""}</span>
          </div>
          <p className="mt-1 text-[14px] leading-relaxed text-ink-2">{SC_TEXT[sc.scenario]}</p>
          {sc.hits.filter((h) => h.points !== 0 || h.risk).length > 0 && (
            <ul className="mt-3 space-y-1.5 border-t border-line/70 pt-3 text-[14px] text-ink-2">
              {sc.hits.filter((h) => h.points !== 0 || h.risk).map((h) => (
                <li key={h.rule} className="flex gap-2"><span className={cn("num w-7 shrink-0 text-right", h.risk ? "text-loss" : h.points < 0 ? "text-gain" : "text-btc")}>{h.points > 0 ? "+" : ""}{h.points}</span><span>{h.detail}</span></li>
              ))}
            </ul>
          )}
        </Panel>
      </section>

      <Simulator />
      </div>

      <div className="min-w-0 space-y-4 lg:col-span-4">
      <DerivativesIntel />
      <section aria-label="Indicadores">
        <SectionTitle>Indicadores</SectionTitle>
        <Panel className="divide-y divide-line/70 px-4">
          {m.indicators.map((i) => (
            <div key={i.key} className="py-2.5">
              <div className="flex items-baseline justify-between gap-3"><span className="text-[13.5px] text-ink-2">{i.label}</span><span className="num text-right text-[13.5px] font-medium">{fmtInd(i)}</span></div>
              {i.hint && <p className="mt-0.5 text-[11.5px] text-muted">{i.hint}</p>}
            </div>
          ))}
        </Panel>
      </section>

      {m.zones && (m.zones.buy.length > 0 || m.zones.sell.length > 0) && (
        <section aria-label="Zonas">
          <SectionTitle sub="Suportes e resistências do último ano">Zonas de preço</SectionTitle>
          <Panel className="divide-y divide-line/70 px-4">
            {[...m.zones.sell].reverse().map((z, i) => <Row key={`s${i}`} label={<span className="text-btc">Resistência</span>}>{f.px(z.from)} – {f.px(z.to)}</Row>)}
            <Row label={<span className="text-ink">Preço atual</span>}>{f.px(spot)}</Row>
            {m.zones.buy.map((z, i) => <Row key={`b${i}`} label={<span className="text-gain">Suporte</span>}>{f.px(z.from)} – {f.px(z.to)}</Row>)}
          </Panel>
        </section>
      )}
      </div>
      </div>
      <p className="text-[11px] text-muted">Velas diárias {m.source} · última {new Date(m.updatedAt).toLocaleDateString("pt-BR")}. Funding não incluído (sem integração com a corretora).</p>
    </div>
  );
}

/** Derivativos e dominância, sempre com fonte e horário; o que não tem fonte confiável aparece como indisponível. */
function DerivativesIntel() {
  useDataVersion();
  const f = useFmt();
  const i = marketIntel();
  const t = (x?: { at: number } | null) => (x ? new Date(x.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "");
  const row = (label: string, value: string, sub: string) => <div className="flex items-baseline justify-between gap-3 py-2.5"><span className="text-[13.5px] text-ink-2">{label}<span className="block text-[11px] text-muted">{sub}</span></span><span className="num text-right text-[13.5px] font-medium">{value}</span></div>;
  return (
    <section aria-label="Derivativos">
      <SectionTitle sub="Perpétuo BTC na Hyperliquid e mercado geral">Derivativos e fluxo</SectionTitle>
      <Panel className="divide-y divide-line/70 px-4">
        {!i ? <p className="py-4 text-[13px] text-muted">Carregando…</p> : <>
          {row("Funding (1 h)", i.funding1h ? `${(i.funding1h.value * 100).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%` : "—", i.funding1h ? `${i.fundingAnnual != null ? `≈ ${f.pct(i.fundingAnnual)} ao ano · ` : ""}${i.funding1h.source} · ${t(i.funding1h)}` : "indisponível")}
          {row("Open interest", i.openInterestBtc ? `${f.btc(i.openInterestBtc.value, 0)} BTC` : "—", i.openInterestUsd != null ? `${f.money(i.openInterestUsd, { compact: true })} · ${t(i.openInterestBtc)}` : "indisponível")}
          {row("Volume 24 h (perpétuo)", i.volume24hUsd ? f.money(i.volume24hUsd.value, { compact: true }) : "—", i.volume24hUsd ? `${i.volume24hUsd.source} · ${t(i.volume24hUsd)}` : "indisponível")}
          {row("Prêmio mark × oráculo", i.premium ? `${(i.premium.value * 100).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}%` : "—", i.markPx ? `mark ${f.px(i.markPx)} · oráculo ${f.px(i.oraclePx)}` : "indisponível")}
          {row("Dominância do BTC", i.btcDominance ? f.pct(i.btcDominance.value, false) : "—", i.btcDominance ? `${i.btcDominance.source} · ${t(i.btcDominance)}` : "indisponível agora")}
          {row("Fluxos de ETFs · liquidações · calendário macro", "indisponível", "sem fonte gratuita e confiável integrada; não é estimado")}
        </>}
      </Panel>
      {i?.errors.length ? <p className="mt-2 text-[11px] text-muted">Falhas: {i.errors.join(" · ")}</p> : null}
    </section>
  );
}
