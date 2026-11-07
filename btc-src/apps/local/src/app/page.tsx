"use client";
import { useState } from "react";
import { navigate } from "@/lib/router";
import { NeedsSetup, useSnapshot } from "@/lib/api";
import { useFmt } from "@/lib/state";
import { getStore } from "@/lib/local/store";
import { fmtZoned } from "@/lib/local/strategy";
import { BarRow, Button, CoinIcon, GroupLabel, Notice, Panel, Row, Skeleton, toneCls, toneOf } from "@/components/ui";
import { Hero } from "@/components/shell";
import { SemiDonut, C } from "@/components/charts";
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

  return (
    <div>
      <Hero />
      {s.warnings.length > 0 && <div className="mb-5 space-y-2">{s.warnings.map((w) => <Notice key={w}>{w}</Notice>)}</div>}

      <SemiDonut parts={parts} center={c ? `${levTxt}x` : "100%"} sub={c ? "exposição em BTC" : "em USDC"} />

      <GroupLabel className="mt-8">Estratégia</GroupLabel>
      <Panel className="overflow-hidden">
        <BarRow color={C.accent} icon={<CoinIcon kind="strategy" />} title={s.label} right={<span className="flex items-center gap-1">{pctOf(strategy)}<span className="text-muted">›</span></span>}
          value={f.money(strategy)} sub={c ? `Long ${levTxt}x desde ${fmtDay(c.trip.openT)}${c.inherited ? " (herdado)" : ""}` : s.inUsdcSince ? `100% em USDC desde ${fmtDay(s.inUsdcSince)}` : "100% em USDC"}
          onClick={() => navigate("/performance")} />
        <div className="divide-y divide-line border-t border-line px-5">
          <Row label={s.scope.kind === "account" ? "Início da conta" : "Início do ciclo"}>{strat ? fmtZoned(strat.startAt, strat.tz) : new Date(s.startT).toLocaleDateString("pt-BR")}</Row>
          {strat && <Row label="Patrimônio inicial">{f.money(s.equity0)} <span className="text-[13px] text-muted">({SRC[s.snapSource] ?? s.snapSource})</span></Row>}
          <Row label="Resultado" tone={toneOf(s.result)}>{f.money(s.result, { signed: true })}</Row>
        </div>
      </Panel>

      {c ? (
        <>
          <GroupLabel className="mt-7">{s.closed ? "Posição no encerramento" : "Posição"}</GroupLabel>
          <Panel className="overflow-hidden">
            <BarRow color={C.btc} icon={<CoinIcon kind="btc" />} title={`Bitcoin · long ${levTxt}x`}
              right={c.pnlPct != null ? <span className={toneCls(toneOf(c.pnl))}>{f.pct(c.pnlPct)}</span> : undefined} value={<span className={toneCls(toneOf(c.pnl))}>{f.money(c.pnl, { signed: true })}</span>}
              sub={`${f.btc(c.sizeBtc.toFixed(6))} BTC · exposição ${f.money(c.notional, { compact: true })}${c.inherited ? " · resultado desde o início do ciclo" : ""}`} />
            <div className="divide-y divide-line border-t border-line px-5">
              <Row label={c.inherited ? "Entrada oficial (corretora)" : c.cycle?.adds?.length ? "Preço médio" : "Entrada"}>{f.px(c.officialEntry)}</Row>
              {c.inherited && <Row label="Referência do ciclo">{f.px(c.basis)}</Row>}
              {c.cycle?.adds?.length ? <Row label="Margem">{f.money(c.cycle.capital)} · {c.cycle.adds.length} aumento{c.cycle.adds.length > 1 ? "s" : ""}</Row> : null}
              <Row label={s.closed ? "Preço no encerramento" : "Preço agora"}>{f.px(s.closed ? s.points.at(-1)?.price ?? null : s.now.btcUsd.toFixed())} <span className={toneCls(toneOf(c.btcMove))}>({f.pct(c.btcMove)})</span></Row>
              {!s.closed && <Row label="Liquidação" tone={c.liqDist && c.liqDist.lt(s.s.settings.minLiqDistance) ? "loss" : null}>{c.liq ? `${f.px(c.liq)} (${f.pct(c.liqDist!.neg())})` : "sem risco"}</Row>}
              {c.funding ? <Row label="Funding" tone={toneOf(c.funding)}>{f.money(c.funding, { signed: true })}</Row> : null}
              <Row label="Dias na posição">{c.days}</Row>
            </div>
            {canAct && c.cycle && (
              <div className="space-y-2 border-t border-line p-4">
                <Button variant="primary" size="lg" className="w-full" onClick={() => setSheet("add")}>Aumentar posição</Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button onClick={() => setSheet("exit")}>Sair para USDC</Button>
                  <Button onClick={() => setSheet("edit")}>Editar</Button>
                </div>
              </div>
            )}
          </Panel>
        </>
      ) : (
        <>
          {s.sinceExit && <p className="mt-4 px-1 text-[15px] leading-relaxed text-ink-2">Desde a última saída, a {f.px(s.sinceExit.px)}, o BTC <span className={toneCls(toneOf(s.sinceExit.move))}>{s.sinceExit.move >= 0 ? "subiu" : "caiu"} {f.pct(Math.abs(s.sinceExit.move), false)}</span>.</p>}
          {canAct && <Button variant="primary" size="lg" className="mt-4 w-full" onClick={() => setSheet("enter")}>Entrar em BTC</Button>}
        </>
      )}

      {!s.closed && (
        <>
          <GroupLabel className="mt-7">Saldos agora</GroupLabel>
          <Panel className="overflow-hidden">
            {live ? live.balances.map((b) => (
              <BarRow key={`${b.where}${b.coin}`} color={b.where === "arb" ? C.usdc : b.coin === "UBTC" ? C.btc : C.gain}
                icon={<CoinIcon kind={b.coin === "UBTC" ? "btc" : b.where === "arb" ? "usdc" : "cash"} />}
                title={`${b.coin} · ${b.where === "perp" ? "Hyperliquid perp" : b.where === "spot" ? "Hyperliquid spot" : "carteira Arbitrum"}`}
                right={b.usd != null ? pctOf(b.usd) : undefined} value={b.usd != null ? f.money(b.usd) : `${b.total.toLocaleString("pt-BR")} ${b.coin}`} />
            )) : (
              <BarRow color={C.gain} icon={<CoinIcon kind="cash" />} title="USDC livre" right={pctOf(Math.max(0, s.free ?? 0))} value={f.money(Math.max(0, s.free ?? 0))} />
            )}
            {live && live.balances.length === 0 && <p className="px-5 py-6 text-[15px] text-muted">Nenhum saldo na conta.</p>}
          </Panel>
          {live && <p className="mt-3 px-1 text-[12px] text-muted">Saldos oficiais da conta inteira. {live.mode === "unifiedAccount" || live.mode === "portfolioMargin" ? "Conta unificada: o colateral fica no saldo spot." : "Conta padrão: margem no perp, saldo spot à parte."}</p>}
        </>
      )}

      {sheet === "enter" && <EntrySheet onClose={() => setSheet(null)} />}
      {sheet === "edit" && c?.cycle && <EntrySheet edit={c.cycle} onClose={() => setSheet(null)} />}
      {sheet === "exit" && c?.cycle && <ExitSheet cycle={c.cycle} onClose={() => setSheet(null)} />}
      {sheet === "add" && c?.cycle && <AddSheet cycle={c.cycle} onClose={() => setSheet(null)} />}
    </div>
  );
}
