"use client";
/**
 * Detalhe de uma posição perpétua: gráfico profissional (somente leitura) com entrada, liquidação, TP/SL reais,
 * níveis planejados e execuções históricas. Rota: /posicao?coin=HYPE&acc=hl-principal[&trade=<uid>]
 * Nada nesta tela cria, move ou cancela ordens na exchange.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BookOpen, ChevronDown, ChevronUp, Maximize2, Minimize2, PieChart, Plus, Trash2 } from "lucide-react";
import { useDataVersion } from "@/lib/api";
import { useFmt } from "@/lib/state";
import { navigate, splitUrl, useUrl } from "@/lib/router";
import { portfolio, uidP, updatePortfolio } from "@/lib/portfolio/db";
import { useAttrData } from "@/lib/journal/use";
import { tradeUid, type JTrade } from "@/lib/journal/trades";
import { attributionHref, journalHref, tradeContribution } from "@/lib/attribution/engine";
import { resolveRange } from "@/lib/analytics/analytics";
import { classifyOrders } from "@/lib/perps/orders";
import { buildLines, fmtQty, type HistoricLevel, type PlannedLevel } from "@/lib/perps/chart-lines";
import { ordersFor, refreshOrders, useOrdersVersion } from "@/lib/perps/orders-store";
import { hlSocket, type WsStatus } from "@/lib/perps/ws";
import { HL_INTERVALS, TF_LABEL, TF_MS, type HlCandle, type HlInterval } from "@/lib/perps/market-data";
import { classifyExecs, type Exec } from "@/lib/perps/exec";
import { PositionChart, DEFAULT_IND, type Indicators } from "@/components/position-chart";
import { CoinLogo } from "@/components/coin-logo";
import { Button, Notice, Panel, PanelHead, Pill, Row, Skeleton, cn, toneCls, toneOf } from "@/components/ui";
import { DirBadge } from "@/app/perps/page";

const IND_KEY = "bst.chart.ind.v1", TF_KEY = "bst.chart.tf.v1";
const WS_TXT: Record<WsStatus, string> = { idle: "Ao vivo: inativo", connecting: "Conectando…", open: "Ao vivo", reconnecting: "Reconectando…", unavailable: "Atualização periódica" };
const nf = (n: number, d = 2) => n.toLocaleString("pt-BR", { maximumFractionDigits: d });
const dt = (t: number) => new Date(t).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

function useMedia(q: string) {
  const [m, setM] = useState(() => (typeof matchMedia === "function" ? matchMedia(q).matches : false));
  useEffect(() => { if (typeof matchMedia !== "function") return; const mq = matchMedia(q); const f = () => setM(mq.matches); f(); mq.addEventListener("change", f); return () => mq.removeEventListener("change", f); }, [q]);
  return m;
}
const read = <T,>(k: string, d: T): T => { try { const v = JSON.parse(localStorage.getItem(k) ?? "null") as T | null; return v ?? d; } catch { return d; } };
/** Intervalo inicial adequado à duração da operação (histórico). */
const autoTf = (ms: number): HlInterval => (ms <= 6 * 3600e3 ? "5m" : ms <= 2 * 86400e3 ? "15m" : ms <= 14 * 86400e3 ? "1h" : ms <= 60 * 86400e3 ? "4h" : "1d");

export default function PositionPage() {
  const url = useUrl();
  const sp = useMemo(() => new URLSearchParams(splitUrl(url).search), [url]);
  const coin = sp.get("coin") ?? "";
  const accParam = sp.get("acc");
  const tradeParam = sp.get("trade");
  const f = useFmt();
  const { data, loading, error } = useAttrData();
  useDataVersion(); useOrdersVersion();

  const [tf, setTf] = useState<HlInterval>(() => read<HlInterval>(TF_KEY, "15m"));
  const [ind, setInd] = useState<Indicators>(() => ({ ...DEFAULT_IND, ...read<Partial<Indicators>>(IND_KEY, {}) }));
  const [fit, setFit] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [sel, setSel] = useState<string | null>(null);
  const [mark, setMark] = useState<number | null>(null);
  const [last, setLast] = useState<number | null>(null);
  const [cstat, setCstat] = useState<{ ws: WsStatus; loading: boolean; error: string | null; polling: boolean }>({ ws: "idle", loading: true, error: null, polling: false });
  const landscape = useMedia("(orientation: landscape) and (max-height: 520px)");
  const full = expanded || landscape;

  // conta, operação e posição
  const perps = data?.perps;
  const trade: JTrade | null = useMemo(() => {
    if (!data) return null;
    if (tradeParam) return data.trades.find((t) => t.uid === tradeParam) ?? null;
    return data.trades.find((t) => t.open && t.coin === coin && (!accParam || t.accountId === accParam)) ?? null;
  }, [data, tradeParam, coin, accParam]);
  const acc = perps?.accounts.find((a) => a.id === (trade?.accountId ?? accParam)) ?? perps?.accounts.find((a) => a.positions.some((p) => p.coin === coin)) ?? null;
  const pos = acc?.positions.find((p) => p.coin === coin) ?? null;
  const coinName = trade?.coin ?? coin;
  const historical = Boolean(trade && !trade.open) || (!pos && Boolean(trade));
  const dir = pos?.dir ?? trade?.dir ?? null;
  const uid = trade?.uid ?? (acc && trade ? tradeUid(acc.id, trade) : null);

  // intervalo automático (uma vez) para operação histórica; escolha do usuário é guardada
  const autoDone = useRef(false);
  useEffect(() => { if (historical && trade && !autoDone.current && !localStorage.getItem(TF_KEY)) { autoDone.current = true; setTf(autoTf((trade.closedAt ?? Date.now()) - trade.openedAt)); } }, [historical, trade]);
  const pickTf = (x: HlInterval) => { setTf(x); try { localStorage.setItem(TF_KEY, JSON.stringify(x)); } catch { /* ignore */ } };
  const toggle = (k: keyof Indicators) => setInd((c) => { const n = { ...c, [k]: !c[k] }; try { localStorage.setItem(IND_KEY, JSON.stringify(n)); } catch { /* ignore */ } return n; });

  // mark price ao vivo + ordens reais (somente leitura)
  useEffect(() => {
    if (!coinName || historical) return;
    const off = hlSocket().subscribe({ type: "activeAssetCtx", coin: coinName }, (d) => {
      const c = (d as { ctx?: { markPx?: string } }).ctx; const m = Number(c?.markPx);
      if (Number.isFinite(m) && m > 0) setMark(m);
    });
    return off;
  }, [coinName, historical]);
  useEffect(() => {
    if (!acc || !acc.address || historical) return;
    void refreshOrders(acc.id, acc.address, true);
    const id = setInterval(() => { if (document.visibilityState === "visible") void refreshOrders(acc.id, acc.address); }, 15000);
    const off = hlSocket().subscribe({ type: "orderUpdates", user: acc.address }, () => void refreshOrders(acc.id, acc.address, true));
    const off2 = hlSocket().subscribe({ type: "userFills", user: acc.address }, () => void refreshOrders(acc.id, acc.address, true));
    return () => { clearInterval(id); off(); off2(); };
  }, [acc?.id, acc?.address, historical]); // eslint-disable-line react-hooks/exhaustive-deps

  const os = acc ? ordersFor(acc.id) : null;
  const classified = useMemo(() => (os && pos && !historical ? classifyOrders(os.orders, { coin: pos.coin, dir: pos.dir, size: pos.size, entry: pos.entry }) : null), [os, pos, historical]);
  const pd = portfolio();
  const planned: PlannedLevel[] = useMemo(() => {
    const own = (pd.plans ?? []).filter((p) => p.coin === coinName && (!acc || p.accountId === acc.id) && (!historical || !p.tradeUid || p.tradeUid === uid));
    const note = uid ? pd.tradeNotes?.[uid] : null;
    const fromNote: PlannedLevel[] = [];
    if (historical && note) {
      if (note.plannedStop != null) fromNote.push({ id: `note-sl-${uid}`, accountId: acc?.id ?? "", coin: coinName, kind: "SL", price: note.plannedStop, qty: null, createdAt: note.updatedAt });
      note.plannedTps.forEach((p, i) => fromNote.push({ id: `note-tp-${uid}-${i}`, accountId: acc?.id ?? "", coin: coinName, kind: "TP", price: p, qty: null, createdAt: note.updatedAt }));
    }
    return [...own, ...fromNote];
  }, [pd, coinName, acc, historical, uid]);
  const hist: HistoricLevel[] = useMemo(() => (uid ? (pd.levelHistory?.[uid] ?? []).map((h) => (historical ? { ...h, active: false } : h)) : []), [pd, uid, historical]);

  const markNow = mark ?? pos?.mark ?? null;
  const lines = useMemo(() => buildLines({
    coin: coinName, dir, entry: historical ? trade?.avgEntry ?? null : pos?.entry ?? null, liq: historical ? null : pos?.liq ?? null,
    mark: historical ? null : markNow, last: historical ? null : last, orders: classified, planned, history: hist,
  }).concat(historical && trade?.avgExit != null ? [{ id: "exit", price: trade.avgExit, tone: "last" as const, title: "saída média", dash: "dotted" as const, width: 1 as const, source: "history" as const, label: true }] : []),
  [coinName, dir, pos, historical, trade, markNow, last, classified, planned, hist]);
  const execs: Exec[] = useMemo(() => trade?.execs ?? (trade && acc ? classifyExecs(trade, acc.orderKinds) : []), [trade, acc]);
  const focus = useMemo(() => (historical && trade ? { from: trade.openedAt, to: trade.closedAt ?? Date.now() } : null), [historical, trade]);
  const selExec = execs.find((e) => e.fill.key === sel) ?? null;
  const contrib = useMemo(() => (data && trade ? tradeContribution(data.ledger, trade.uid, trade.coin, { range: resolveRange("all", Date.now()) }) : null), [data, trade]);

  if (!coin && !tradeParam) return <div className="pt-5"><Notice tone="info">Escolha uma posição no Dashboard ou em Perpétuos.</Notice></div>;
  if (!data && loading) return <div className="space-y-4 pt-5"><Skeleton className="h-12" /><Skeleton className="h-[420px]" /></div>;
  if (!data) return <div className="pt-5"><Notice tone="loss">{error ?? "Dados indisponíveis."}</Notice></div>;

  const stale = acc?.stale;
  const chartH: string | number = full ? "100%" : "clamp(320px, 58dvh, 560px)";
  const back = () => (history.length > 1 ? history.back() : navigate("/perpetuos"));

  const toolbar = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div role="group" aria-label="Intervalo" className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1">
        {HL_INTERVALS.map((x) => <button key={x} onClick={() => pickTf(x)} aria-pressed={tf === x} className={cn("num min-h-9 min-w-10 shrink-0 rounded-md px-2.5 text-[12.5px] font-medium", tf === x ? "bg-accent/20 text-ink" : "text-muted [@media(hover:hover)]:hover:text-ink")}>{TF_LABEL[x]}</button>)}
      </div>
      <div role="group" aria-label="Indicadores" className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1">
        {([["volume", "Vol"], ["sma", "MA"], ["ema", "EMA"], ["bb", "Bollinger"], ["rsi", "RSI"], ["macd", "MACD"]] as const).map(([k, l]) => <button key={k} onClick={() => toggle(k)} aria-pressed={ind[k]} className={cn("min-h-9 shrink-0 rounded-md border px-2.5 text-[12px]", ind[k] ? "border-accent/60 bg-accent/15 text-ink" : "border-line text-muted")}>{l}</button>)}
        <button onClick={() => setFit((x) => !x)} aria-pressed={fit} title="Ajusta a escala para mostrar entrada, TP e SL" className={cn("min-h-9 shrink-0 rounded-md border px-2.5 text-[12px]", fit ? "border-accent/60 bg-accent/15 text-ink" : "border-line text-muted")}>Ajustar às linhas</button>
      </div>
    </div>
  );

  const chart = (
    <PositionChart coin={coinName} interval={tf} lines={lines} execs={execs} indicators={ind} fitLines={fit} height={chartH} focus={focus} live={!historical}
      onMarkerClick={(k) => setSel(k)} highlightKey={sel} onTick={(t) => setLast(t.last)} onStatus={setCstat} />
  );

  const status = (
    <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
      {historical ? <Pill tone="gold">Operação encerrada · histórico</Pill> : <Pill tone={cstat.ws === "open" ? "gain" : cstat.ws === "reconnecting" ? "loss" : "neutral"}>{WS_TXT[cstat.ws]}{cstat.polling && cstat.ws !== "unavailable" ? " · consulta periódica" : ""}</Pill>}
      {!historical && stale && <Pill tone="loss">Dados da conta desatualizados</Pill>}
      {!historical && os?.error && <Pill tone="loss">Ordens indisponíveis</Pill>}
      <Pill>Somente leitura</Pill>
    </div>
  );

  if (full) {
    return (
      <div className="fixed inset-0 z-40 flex flex-col bg-bg px-2 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center gap-2 py-1.5">
          <button onClick={() => setExpanded(false)} aria-label="Sair do modo expandido" className="grid size-10 place-items-center rounded-md text-muted"><Minimize2 className="size-5" /></button>
          <CoinLogo symbol={coinName} size={20} /><b className="text-[14px]">{coinName}</b>{dir && <DirBadge dir={dir} />}
          {pos && <span className={cn("num ml-auto text-[13px] font-semibold", toneCls(toneOf(pos.upnl)))}>{f.money(pos.upnl, { signed: true })}</span>}
        </div>
        <div className="pb-1">{toolbar}</div>
        <div className="min-h-0 flex-1">{chart}</div>
      </div>
    );
  }

  const fundingPaid = pos?.funding ?? null;
  const planKey = `${acc?.id ?? ""}|${coinName}`;
  return (
    <div className="space-y-3 pt-4 pb-24">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={back} aria-label="Voltar" className="-ml-2 grid size-11 place-items-center rounded-full text-muted"><ArrowLeft className="size-5" /></button>
        <CoinLogo symbol={coinName} size={28} />
        <div className="min-w-0">
          <div className="flex items-center gap-2"><h1 className="text-[18px] font-semibold leading-tight">{coinName}-PERP</h1>{dir && <DirBadge dir={dir} />}{pos && <span className="num text-[12px] text-muted">{pos.leverage}× {pos.levType === "cross" ? "cross" : pos.levType === "isolated" ? "isolada" : pos.levType}</span>}</div>
          <div className="text-[11.5px] text-muted">{acc?.name ?? "Conta não encontrada"}{markNow != null && !historical && <span className="num"> · mark {f.px(markNow)}</span>}</div>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" onClick={() => navigate(journalHref({ coin: coinName, acc: acc?.id ?? null, trade: trade?.uid ?? null }))}><BookOpen className="mr-1 size-4" />Ver no Trading Journal</Button>
          <Button size="sm" onClick={() => navigate(attributionHref({ coin: coinName, acc: acc?.id ?? null, from: trade?.openedAt ?? null, to: trade?.closedAt ?? null }))}><PieChart className="mr-1 size-4" />Ver contribuição</Button>
          <Button size="sm" onClick={() => setExpanded(true)} aria-label="Modo expandido"><Maximize2 className="size-4" /></Button>
        </div>
      </div>
      {status}
      {!pos && !trade && <Notice tone="info">Não há posição aberta em {coinName} nesta conta{acc ? "" : " (conta não encontrada)"}. O gráfico mostra o mercado sem linhas de posição.</Notice>}
      {trade?.inherited && <Notice tone="warn">O histórico começa com esta posição já aberta: o preço de entrada vem da exchange e as execuções anteriores não estão disponíveis.</Notice>}

      <Panel className="overflow-hidden p-0">
        <div className="border-b border-line px-3 py-2">{toolbar}</div>
        {chart}
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-3 py-2 text-[11px] text-muted">
          <span><i className="mr-1 inline-block h-0.5 w-4 bg-gold align-middle" />Entrada</span>
          <span><i className="mr-1 inline-block h-0.5 w-4 bg-loss align-middle" />Liquidação</span>
          <span><i className="mr-1 inline-block h-0.5 w-4 bg-gain align-middle" />TP real</span>
          <span><i className="mr-1 inline-block h-0.5 w-4 bg-warn align-middle" />SL real</span>
          <span><i className="mr-1 inline-block h-0 w-4 border-t border-dashed border-ink-2 align-middle" />Planejado (não é ordem)</span>
          <span><i className="mr-1 inline-block h-0 w-4 border-t border-dotted border-accent align-middle" />Mark price</span>
          {last != null && !historical && <span className="num">último negociado {f.px(last)}</span>}
        </div>
      </Panel>

      <Panel>
        <button className="flex w-full items-center justify-between px-4 py-3 text-left" onClick={() => setPanelOpen((x) => !x)} aria-expanded={panelOpen}>
          <span className="text-[14px] font-semibold">{historical ? "Resumo da operação" : "Posição"}</span>{panelOpen ? <ChevronUp className="size-4 text-muted" /> : <ChevronDown className="size-4 text-muted" />}
        </button>
        {panelOpen && (
          <div className="border-t border-line px-4 pb-4">
            {pos && !historical ? (
              <div className="grid gap-x-8 sm:grid-cols-2">
                <div>
                  <Row label="Direção">{pos.dir}</Row>
                  <Row label="Quantidade"><span className="num">{f.hidden ? "•••" : nf(pos.size, 4)} {coinName}</span></Row>
                  <Row label="Entrada média"><span className="num">{pos.entry != null ? f.px(pos.entry) : "Dados insuficientes"}</span></Row>
                  <Row label="Mark price"><span className="num">{markNow != null ? f.px(markNow) : "—"}</span></Row>
                  <Row label="Valor da posição"><span className="num">{f.money(pos.notional)}</span></Row>
                  <Row label="Alavancagem"><span className="num">{pos.leverage}×</span></Row>
                </div>
                <div>
                  <Row label="Margem usada"><span className="num">{pos.margin != null ? f.money(pos.margin) : "—"}</span></Row>
                  <Row label="P&L não realizado" tone={toneOf(pos.upnl)}><span className="num">{f.money(pos.upnl, { signed: true })}</span></Row>
                  <Row label="ROI sobre a margem" tone={toneOf(pos.roiOnMargin)}><span className="num">{pos.roiOnMargin != null ? f.pct(pos.roiOnMargin) : "—"}</span></Row>
                  <Row label="Funding desde a abertura" tone={toneOf(fundingPaid != null ? -fundingPaid : null)}><span className="num">{fundingPaid != null ? f.money(-fundingPaid, { signed: true }) : "—"}</span></Row>
                  <Row label="Taxas pagas (operação)"><span className="num">{trade ? f.money(-trade.fees, { signed: true }) : "—"}</span></Row>
                  <Row label="Liquidação estimada (exchange)"><span className={cn("num", pos.liqDistance != null && pos.liqDistance < 0.1 && "text-loss")}>{pos.liq != null ? `${f.px(pos.liq)}${pos.liqDistance != null ? ` · ${nf(pos.liqDistance * 100, 1)}% de distância` : ""}` : pos.levType === "cross" ? "Sem liquidação próxima (cross)" : "—"}</span></Row>
                </div>
              </div>
            ) : trade ? (
              <div className="grid gap-x-8 sm:grid-cols-2">
                <div>
                  <Row label="Direção">{trade.dir}</Row>
                  <Row label="Abertura">{dt(trade.openedAt)}</Row>
                  <Row label="Encerramento">{trade.closedAt ? dt(trade.closedAt) : "Em aberto"}</Row>
                  <Row label="Entrada média"><span className="num">{trade.avgEntry != null ? f.px(trade.avgEntry) : "—"}</span></Row>
                  <Row label="Saída média"><span className="num">{trade.avgExit != null ? f.px(trade.avgExit) : "—"}</span></Row>
                </div>
                <div>
                  <Row label="Realizado" tone={toneOf(trade.realizedPnl)}><span className="num">{f.money(trade.realizedPnl, { signed: true })}</span></Row>
                  <Row label="Taxas"><span className="num">{f.money(-trade.fees, { signed: true })}</span></Row>
                  <Row label="Funding" tone={toneOf(trade.funding)}><span className="num">{f.money(trade.funding, { signed: true })}</span></Row>
                  <Row label="Resultado líquido" tone={toneOf(trade.netPnl)}><span className="num font-semibold">{f.money(trade.netPnl, { signed: true })}</span></Row>
                </div>
              </div>
            ) : <p className="pt-3 text-[13px] text-muted">Sem posição aberta neste contrato.</p>}
            {!historical && pos && <p className="mt-2 text-[11px] text-muted">Valores informados pela Hyperliquid. Em margem cross a liquidação depende do patrimônio da conta inteira.</p>}
          </div>
        )}
      </Panel>

      {!historical && pos && (
        <Panel>
          <PanelHead title="Ordens reais (Hyperliquid)" sub="Take profit e stop loss ativos na exchange. Esta tela não envia nem altera ordens." />
          <div className="px-4 pb-4">
            {os?.error && <Notice tone="loss">Não foi possível ler as ordens agora: {os.error}</Notice>}
            {!os?.at && !os?.error && <p className="text-[13px] text-muted">Carregando ordens…</p>}
            {os?.at && classified && !classified.tps.length && !classified.sls.length && <p className="text-[13px] text-muted">Nenhum TP ou SL ativo nesta posição.</p>}
            <ul className="divide-y divide-line">
              {[...classified?.tps ?? [], ...classified?.sls ?? []].map((o) => (
                <li key={o.oid} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                  <span className="flex items-center gap-2"><Pill tone={o.kind === "TP" ? "gain" : "loss"}>{o.label}</Pill><span className="text-muted">{o.orderType || (o.limit ? "Limite" : "Gatilho")}</span></span>
                  <span className="num text-right">{f.px(o.price)}<span className="block text-[11px] text-muted">{o.wholePosition ? "posição inteira" : `${fmtQty(o.qty)} ${coinName}`}</span></span>
                </li>
              ))}
              {classified?.pending.map((o) => (
                <li key={o.oid} className="flex items-center justify-between gap-3 py-2 text-[13px] text-muted">
                  <span>Ordem {o.side === "B" ? "de compra" : "de venda"} · {o.orderType}{o.reduceOnly ? " · reduce-only" : ""}</span><span className="num">{o.price != null ? f.px(o.price) : "mercado"} · {fmtQty(o.qty)}</span>
                </li>
              ))}
            </ul>
          </div>
        </Panel>
      )}

      <PlannedPanel key={planKey} accountId={acc?.id ?? ""} coin={coinName} tradeUid={uid} planned={pd.plans?.filter((p) => p.coin === coinName && (!acc || p.accountId === acc.id)) ?? []} disabled={!acc} px={f.px} />

      <Panel>
        <PanelHead title="Execuções" sub={execs.length ? `${execs.length} execuções reais conciliadas · toque em um marcador no gráfico ou numa linha` : "Execuções indisponíveis para esta posição"} />
        <div className="px-4 pb-4">
          {selExec && <ExecDetail e={selExec} f={f} onClose={() => setSel(null)} />}
          <ul className="divide-y divide-line">
            {[...execs].reverse().map((e) => (
              <li key={e.fill.key}><button onClick={() => setSel(e.fill.key === sel ? null : e.fill.key)} className={cn("flex w-full items-center justify-between gap-3 py-2.5 text-left text-[13px]", sel === e.fill.key && "text-accent")}>
                <span><b className="font-medium">{e.label}</b><span className="block text-[11px] text-muted">{dt(e.fill.time)}</span></span>
                <span className="num text-right">{f.px(e.fill.px)}<span className="block text-[11px] text-muted">{fmtQty(e.fill.sz)} {coinName}</span></span>
              </button></li>
            ))}
          </ul>
        </div>
      </Panel>

      {contrib && trade && (
        <Panel>
          <PanelHead title="Contribuição desta operação" sub="Mesmo registro financeiro do Trading Journal e do Attribution" />
          <div className="px-4 pb-4">
            <Row label="Resultado líquido" tone={toneOf(contrib.net)}><span className="num font-semibold">{f.money(contrib.net, { signed: true })}</span></Row>
            <Row label={`Parcela do resultado de ${coinName}`}><span className="num">{contrib.shareOfAsset != null ? `${nf(contrib.shareOfAsset * 100, 0)}%` : "—"}</span></Row>
            <Row label="Parcela do resultado total"><span className="num">{contrib.shareOfTotal != null ? `${nf(contrib.shareOfTotal * 100, 0)}%` : "—"}</span></Row>
            {!trade.open ? <p className="mt-2 text-[11px] text-muted">Operação encerrada: resultado realizado.</p> : <p className="mt-2 text-[11px] text-muted">Operação aberta: o P&L não realizado ({pos ? f.money(pos.upnl, { signed: true }) : "—"}) não entra no resultado realizado.</p>}
          </div>
        </Panel>
      )}
    </div>
  );
}

function ExecDetail({ e, f, onClose }: { e: Exec; f: ReturnType<typeof useFmt>; onClose: () => void }) {
  return (
    <div className="mb-3 rounded-lg border border-accent/40 bg-surface-2/60 p-3 text-[13px]">
      <div className="flex items-center justify-between"><b>{e.label}</b><button onClick={onClose} className="text-[12px] text-muted">fechar</button></div>
      <div className="num mt-1 grid grid-cols-2 gap-x-6 gap-y-0.5">
        <span className="text-muted">Horário</span><span className="text-right">{dt(e.fill.time)}</span>
        <span className="text-muted">Preço de execução</span><span className="text-right">{f.px(e.fill.px)}</span>
        <span className="text-muted">Quantidade</span><span className="text-right">{fmtQty(e.fill.sz)}</span>
        <span className="text-muted">Tipo</span><span className="text-right">{e.trigger ? (e.trigger === "LIQ" ? "Liquidação" : e.trigger === "SL" ? "Stop loss" : "Take profit") : "Ordem comum"}</span>
        <span className="text-muted">Taxa</span><span className="text-right">{f.money(-e.fill.fee, { signed: true })}</span>
        <span className="text-muted">P&L realizado</span><span className={cn("text-right", toneCls(toneOf(e.fill.closedPnl)))}>{e.fill.closedPnl ? f.money(e.fill.closedPnl, { signed: true }) : "—"}</span>
        <span className="text-muted">Posição depois</span><span className="text-right">{fmtQty(e.posAfter)}</span>
      </div>
    </div>
  );
}

/** Níveis que o usuário planeja. NÃO são ordens: ficam só neste app (rotulados "planejado") e nunca são enviados à exchange. */
function PlannedPanel({ accountId, coin, tradeUid: uid, planned, disabled, px }: { accountId: string; coin: string; tradeUid: string | null; planned: PlannedLevel[]; disabled: boolean; px: (v: number) => string }) {
  const [kind, setKind] = useState<"TP" | "SL" | "ENTRY">("TP");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("");
  const p = Number(price.replace(",", ".")), q = qty ? Number(qty.replace(",", ".")) : null;
  const ok = Number.isFinite(p) && p > 0 && (q == null || (Number.isFinite(q) && q > 0));
  const add = () => { if (!ok) return; void updatePortfolio((d) => { d.plans = [...(d.plans ?? []), { id: uidP(), accountId, coin, kind, price: p, qty: q, tradeUid: uid, createdAt: Date.now() }]; }); setPrice(""); setQty(""); };
  const del = (id: string) => void updatePortfolio((d) => { d.plans = (d.plans ?? []).filter((x) => x.id !== id); });
  return (
    <Panel>
      <PanelHead title="Níveis planejados" sub="Anotações suas, mostradas tracejadas como “planejado”. Não são ordens e nunca são enviadas à Hyperliquid." />
      <div className="px-4 pb-4">
        <ul className="divide-y divide-line">
          {planned.map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
              <span><Pill tone={x.kind === "TP" ? "gain" : x.kind === "SL" ? "loss" : "gold"}>{x.kind === "ENTRY" ? "Entrada" : x.kind} planejado</Pill></span>
              <span className="num ml-auto">{px(x.price)}{x.qty != null && <span className="text-muted"> · {fmtQty(x.qty)}</span>}</span>
              <button onClick={() => del(x.id)} aria-label="Remover nível planejado" className="grid size-9 place-items-center text-muted"><Trash2 className="size-4" /></button>
            </li>
          ))}
          {!planned.length && <li className="py-2 text-[13px] text-muted">Nenhum nível planejado.</li>}
        </ul>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <select aria-label="Tipo" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="min-h-10 rounded-md border border-line bg-surface-2 px-2 text-[13px]"><option value="TP">TP</option><option value="SL">SL</option><option value="ENTRY">Entrada</option></select>
          <input aria-label="Preço" inputMode="decimal" placeholder="Preço" value={price} onChange={(e) => setPrice(e.target.value)} className="num min-h-10 w-28 rounded-md border border-line bg-surface-2 px-2 text-[13px]" />
          <input aria-label="Quantidade (opcional)" inputMode="decimal" placeholder="Qtd (opc.)" value={qty} onChange={(e) => setQty(e.target.value)} className="num min-h-10 w-28 rounded-md border border-line bg-surface-2 px-2 text-[13px]" />
          <Button size="sm" disabled={!ok || disabled} onClick={add}><Plus className="mr-1 size-4" />Adicionar</Button>
        </div>
      </div>
    </Panel>
  );
}
