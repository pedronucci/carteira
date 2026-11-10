"use client";
/**
 * Gráfico profissional de um contrato perpétuo (TradingView Lightweight Charts, Apache-2.0 — a marca d'água de atribuição
 * da biblioteca fica visível). Velas, volume, indicadores, tempo real por WebSocket (com consulta periódica de reserva),
 * linhas de preço e marcadores das execuções reais. Somente leitura: nada aqui cria, move ou cancela ordens.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries, ColorType, createChart, createSeriesMarkers, CrosshairMode, HistogramSeries, LineSeries, LineStyle,
  type IChartApi, type IPriceLine, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarker, type Time, type UTCTimestamp,
} from "lightweight-charts";
import { useAppState } from "@/lib/state";
import { cv } from "./charts";
import { applyLive, loadCandles, mergeCandles, PAGE, TF_MS, type HlCandle, type HlInterval } from "@/lib/perps/market-data";
import { fetchCandles } from "@/lib/local/hl";
import { hlSocket, type WsStatus } from "@/lib/perps/ws";
import { bollinger, ema, macd, rsi, sma } from "@/lib/perps/indicators";
import { buildMarkers, scaleExtras, type ChartLine, type ChartMarker, type LineTone } from "@/lib/perps/chart-lines";
import type { Exec } from "@/lib/perps/exec";

declare const process: { env: Record<string, string | undefined> };
export interface Indicators { volume: boolean; sma: boolean; ema: boolean; bb: boolean; rsi: boolean; macd: boolean }
export const DEFAULT_IND: Indicators = { volume: true, sma: false, ema: false, bb: false, rsi: false, macd: false };
const MONO = "JetBrains Mono Variable, ui-monospace, monospace";

const toneColor = (t: LineTone): string => ({
  entry: cv("--color-gold"), liq: cv("--color-loss"), tp: cv("--color-gain"), sl: cv("--color-warn"), mark: cv("--color-accent"), last: cv("--color-ink-2"),
  "plan-tp": cv("--color-gain"), "plan-sl": cv("--color-warn"), "plan-entry": cv("--color-gold"), "history-tp": cv("--color-gain"), "history-sl": cv("--color-warn"), pending: cv("--color-muted"),
}[t]);
const dash = (d: ChartLine["dash"]) => (d === "solid" ? LineStyle.Solid : d === "dashed" ? LineStyle.Dashed : LineStyle.SparseDotted);
const mkTone = (t: ChartMarker["tone"]) => (t === "gain" ? cv("--color-gain") : t === "loss" ? cv("--color-loss") : t === "gold" ? cv("--color-gold") : cv("--color-ink-2"));
const fmtPx = (p: number) => (p >= 1000 ? p.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) : p >= 10 ? p.toLocaleString("pt-BR", { maximumFractionDigits: 3 }) : p.toLocaleString("pt-BR", { maximumFractionDigits: 5 }));
const priceFormat = (p: number) => ({ type: "price" as const, precision: p >= 1000 ? 1 : p >= 10 ? 3 : p >= 1 ? 4 : 6, minMove: p >= 1000 ? 0.1 : p >= 10 ? 0.001 : p >= 1 ? 0.0001 : 0.000001 });

export interface Legend { time: number; o: number; h: number; l: number; c: number; v: number; chg: number; extra: { label: string; value: string }[] }

export function PositionChart({ coin, interval, lines, execs, indicators, fitLines, height, onMarkerClick, onTick, onStatus, highlightKey, focus, live = true }: {
  /** modo histórico: janela [from,to] (ms) a mostrar; sem tempo real quando live=false */ focus?: { from: number; to: number } | null; live?: boolean;
  coin: string; interval: HlInterval; lines: ChartLine[]; execs: Exec[]; indicators: Indicators; fitLines: boolean; height?: number | string;
  onMarkerClick?: (key: string) => void; onTick?: (t: { last: number; candle: HlCandle }) => void; onStatus?: (s: { ws: WsStatus; loading: boolean; error: string | null; polling: boolean }) => void;
  highlightKey?: string | null;
}) {
  const { theme } = useAppState();
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleS = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volS = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markersApi = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const overlay = useRef<Record<string, ISeriesApi<"Line">[]>>({});
  const lower = useRef<ISeriesApi<"Line" | "Histogram">[]>([]);
  const priceLines = useRef(new Map<string, { pl: IPriceLine; sig: string }>());
  const candles = useRef<HlCandle[]>([]);
  const extras = useRef<number[]>([]);
  const fit = useRef(fitLines);
  const loadingMore = useRef(false);
  const exhausted = useRef(false);
  const range = useRef<{ from: number; to: number } | null>(null);
  const [ver, setVer] = useState(0); // sobe quando os dados mudam
  const [state, setState] = useState<{ loading: boolean; error: string | null }>({ loading: true, error: null });
  const [ws, setWs] = useState<WsStatus>("idle");
  const [polling, setPolling] = useState(false);
  const [legend, setLegend] = useState<Legend | null>(null);
  const cbs = useRef({ onMarkerClick, onTick, onStatus });
  cbs.current = { onMarkerClick, onTick, onStatus };
  const execRef = useRef(execs); execRef.current = execs;
  fit.current = fitLines;
  extras.current = useMemo(() => scaleExtras(lines, candles.current.at(-1)?.c ?? null), [lines, ver]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { cbs.current.onStatus?.({ ws, loading: state.loading, error: state.error, polling }); }, [ws, state, polling]);

  // ── cria o gráfico (de novo se o tema ou o número de painéis de baixo mudar) ──
  const panes = (indicators.rsi ? 1 : 0) + (indicators.macd ? 1 : 0);
  useEffect(() => {
    if (!box.current) return;
    const chart = createChart(box.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: cv("--color-muted"), fontFamily: MONO, fontSize: 11, attributionLogo: true, panes: { separatorColor: cv("--chart-line") } },
      grid: { vertLines: { color: cv("--chart-grid") }, horzLines: { color: cv("--chart-grid") } },
      rightPriceScale: { borderColor: cv("--chart-line"), scaleMargins: { top: 0.08, bottom: 0.12 } },
      timeScale: { borderColor: cv("--chart-line"), rightOffset: 6, timeVisible: true, secondsVisible: false, tickMarkFormatter: (t: Time) => { const d = new Date((t as number) * 1000); return interval === "1d" || interval === "1w" ? d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : d.getHours() === 0 && d.getMinutes() === 0 ? d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); } },
      crosshair: { mode: CrosshairMode.Normal },
      handleScroll: { vertTouchDrag: false }, // no celular, arrastar na vertical rola a página
      localization: { locale: "pt-BR", timeFormatter: (t: Time) => new Date((t as number) * 1000).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }), priceFormatter: fmtPx },
    });
    const up = cv("--candle-up"), down = cv("--candle-down");
    const cs = chart.addSeries(CandlestickSeries, {
      upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down, priceLineVisible: true, lastValueVisible: true, priceLineStyle: LineStyle.Solid,
      autoscaleInfoProvider: (orig: () => { priceRange: { minValue: number; maxValue: number }; margins?: { above: number; below: number } } | null) => {
        const r = orig();
        if (!r || !fit.current || !extras.current.length) return r;
        return { ...r, priceRange: { minValue: Math.min(r.priceRange.minValue, ...extras.current), maxValue: Math.max(r.priceRange.maxValue, ...extras.current) } };
      },
    });
    chartRef.current = chart; candleS.current = cs; volS.current = null; overlay.current = {}; lower.current = []; priceLines.current = new Map();
    markersApi.current = createSeriesMarkers(cs, []);
    for (let i = 0; i < panes; i++) chart.addPane();
    if (panes) { chart.panes()[0]!.setStretchFactor(3); for (let i = 1; i <= panes; i++) chart.panes()[i]?.setStretchFactor(1); }

    const onCross = (p: { time?: Time; seriesData: Map<ISeriesApi<never>, unknown> }) => {
      const c = p.time != null ? (p.seriesData.get(cs as unknown as ISeriesApi<never>) as { open: number; high: number; low: number; close: number } | undefined) : undefined;
      if (!c || p.time == null) { setLegend(null); return; }
      const t = p.time as number;
      const row = candles.current.find((x) => x.t / 1000 === t);
      const extra: Legend["extra"] = [];
      for (const [name, arr] of Object.entries(overlay.current)) arr.forEach((s, i) => { const d = p.seriesData.get(s as unknown as ISeriesApi<never>) as { value?: number } | undefined; if (d?.value != null) extra.push({ label: name === "sma" ? (i === 0 ? "SMA20" : "SMA50") : name === "ema" ? (i === 0 ? "EMA9" : "EMA21") : ["BB↑", "BB·", "BB↓"][i]!, value: fmtPx(d.value) }); });
      lower.current.forEach((s) => { const d = p.seriesData.get(s as unknown as ISeriesApi<never>) as { value?: number } | undefined; const nm = (s as unknown as { __n?: string }).__n; if (d?.value != null && nm) extra.push({ label: nm, value: d.value.toFixed(2).replace(".", ",") }); });
      setLegend({ time: t, o: c.open, h: c.high, l: c.low, c: c.close, v: row?.v ?? 0, chg: c.open ? c.close / c.open - 1 : 0, extra });
    };
    chart.subscribeCrosshairMove(onCross as never);
    const onClick = (p: { hoveredObjectId?: unknown; time?: Time }) => {
      const id = p.hoveredObjectId as string | undefined;
      if (id && execRef.current.some((e) => e.fill.key === id)) { cbs.current.onMarkerClick?.(id); return; }
      if (p.time != null) { const ms = markersApi.current?.markers() ?? []; const near = ms.find((m) => m.time === p.time); if (near?.id) cbs.current.onMarkerClick?.(near.id); }
    };
    chart.subscribeClick(onClick as never);
    const onRange = (r: { from: number; to: number } | null) => {
      range.current = r;
      if (r && r.from < 12 && !loadingMore.current && !exhausted.current && candles.current.length) void more();
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    setVer((v) => v + 1); // reaplica dados, linhas e indicadores no gráfico novo
    return () => { chart.remove(); if (chartRef.current === chart) { chartRef.current = null; candleS.current = null; volS.current = null; markersApi.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, panes, interval]);

  // ── dados: carga inicial, tempo real, histórico para trás ──
  async function more() {
    loadingMore.current = true;
    try {
      const first = candles.current[0]?.t;
      if (first == null) return;
      const older = await loadCandles(coin, interval, first - 1, PAGE);
      if (!older.length || older[0]!.t >= first) { exhausted.current = true; return; }
      const before = candles.current.length;
      candles.current = mergeCandles(older, candles.current);
      const added = candles.current.length - before;
      const r = range.current;
      paint();
      if (r && chartRef.current) chartRef.current.timeScale().setVisibleLogicalRange({ from: r.from + added, to: r.to + added });
    } catch { /* tenta de novo ao rolar */ } finally { loadingMore.current = false; }
  }
  /** desenha velas, volume, marcadores e indicadores a partir de candles.current */
  function paint() {
    const cs = candleS.current, chart = chartRef.current;
    if (!cs || !chart) return;
    const rows = candles.current;
    if (rows.length) cs.applyOptions({ priceFormat: priceFormat(rows.at(-1)!.c) });
    cs.setData(rows.map((c) => ({ time: (c.t / 1000) as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c })));
    // marcadores das execuções reais
    const secs = rows.map((c) => c.t / 1000);
    const ms: SeriesMarker<Time>[] = buildMarkers(execRef.current, secs, TF_MS[interval] / 1000).map((m) => ({ id: m.id, time: m.time as UTCTimestamp, position: m.position, shape: m.shape, color: mkTone(m.tone), text: m.text, size: m.id === highlightRef.current ? 2 : 1 }));
    markersApi.current?.setMarkers(ms);
    indicatorsPaint();
  }
  const highlightRef = useRef<string | null>(null); highlightRef.current = highlightKey ?? null;
  const indRef = useRef(indicators); indRef.current = indicators;
  function indicatorsPaint() {
    const chart = chartRef.current;
    if (!chart) return;
    const ind = indRef.current, rows = candles.current, closes = rows.map((c) => c.c), times = rows.map((c) => (c.t / 1000) as UTCTimestamp);
    const line = (vals: (number | null)[]) => vals.flatMap((v, i) => (v != null && Number.isFinite(v) ? [{ time: times[i]!, value: v }] : []));
    // volume
    if (ind.volume && !volS.current) {
      volS.current = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    } else if (!ind.volume && volS.current) { chart.removeSeries(volS.current); volS.current = null; }
    if (volS.current) { const u = cv("--candle-up") + "66", d = cv("--candle-down") + "66"; volS.current.setData(rows.map((c) => ({ time: (c.t / 1000) as UTCTimestamp, value: c.v, color: c.c >= c.o ? u : d }))); }
    // sobreposições
    const want: Record<string, { color: string; vals: (number | null)[]; w?: 1 | 2 }[]> = {};
    if (ind.sma) want.sma = [{ color: cv("--color-btc"), vals: sma(closes, 20) }, { color: cv("--color-usdc"), vals: sma(closes, 50) }];
    if (ind.ema) want.ema = [{ color: cv("--color-accent"), vals: ema(closes, 9) }, { color: cv("--color-warn"), vals: ema(closes, 21) }];
    if (ind.bb) { const b = bollinger(closes, 20, 2); want.bb = [{ color: cv("--color-muted"), vals: b.upper }, { color: cv("--color-gold"), vals: b.mid }, { color: cv("--color-muted"), vals: b.lower }]; }
    for (const k of Object.keys(overlay.current)) if (!want[k]) { overlay.current[k]!.forEach((s) => chart.removeSeries(s)); delete overlay.current[k]; }
    for (const [k, defs] of Object.entries(want)) {
      if (!overlay.current[k]) overlay.current[k] = defs.map((d) => chart.addSeries(LineSeries, { color: d.color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }));
      defs.forEach((d, i) => overlay.current[k]![i]!.setData(line(d.vals)));
    }
    // painéis de baixo (RSI, MACD): refeitos do zero a cada pintura
    lower.current.forEach((s) => { try { chart.removeSeries(s); } catch { /* já removida */ } });
    lower.current = [];
    let pane = 1;
    const tag = <T extends ISeriesApi<"Line" | "Histogram">>(s: T, n: string) => { (s as unknown as { __n: string }).__n = n; lower.current.push(s); return s; };
    if (ind.rsi && chart.panes()[pane]) {
      const s = tag(chart.addSeries(LineSeries, { color: cv("--color-accent"), lineWidth: 1, priceLineVisible: false, lastValueVisible: true, priceFormat: { type: "custom", formatter: (v: number) => v.toFixed(1) } }, pane) as ISeriesApi<"Line">, "RSI14") as ISeriesApi<"Line">;
      s.setData(line(rsi(closes, 14)));
      s.createPriceLine({ price: 70, color: cv("--color-loss") + "99", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: "" });
      s.createPriceLine({ price: 30, color: cv("--color-gain") + "99", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: "" });
      pane++;
    }
    if (ind.macd && chart.panes()[pane]) {
      const m = macd(closes);
      const h = tag(chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, pane), "MACD hist");
      h.setData(m.hist.flatMap((v, i) => (v != null ? [{ time: times[i]!, value: v, color: v >= 0 ? cv("--color-gain") + "99" : cv("--color-loss") + "99" }] : [])));
      const l1 = tag(chart.addSeries(LineSeries, { color: cv("--color-accent"), lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, pane) as ISeriesApi<"Line">, "MACD") as ISeriesApi<"Line">;
      l1.setData(line(m.macd));
      const l2 = tag(chart.addSeries(LineSeries, { color: cv("--color-warn"), lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, pane) as ISeriesApi<"Line">, "Sinal") as ISeriesApi<"Line">;
      l2.setData(line(m.signal));
    }
  }

  // carga inicial quando muda o contrato/intervalo (ou o gráfico é recriado)
  useEffect(() => {
    let alive = true;
    if (!candleS.current) return;
    exhausted.current = false; loadingMore.current = false;
    setState({ loading: true, error: null });
    const pad = 40 * TF_MS[interval];
    loadCandles(coin, interval, focus ? Math.min(Date.now(), focus.to + pad) : Date.now())
      .then((rows) => {
        if (!alive) return;
        // preserva o que já foi carregado para trás se o contrato/intervalo for o mesmo (gráfico recriado por tema/indicadores)
        candles.current = rows;
        paint();
        if (focus && rows.length) {
          const st = TF_MS[interval];
          let i0 = rows.findIndex((c) => c.t >= focus.from - 15 * st); if (i0 < 0) i0 = 0;
          let i1 = rows.findIndex((c) => c.t > focus.to + 15 * st); if (i1 < 0) i1 = rows.length - 1;
          chartRef.current?.timeScale().setVisibleLogicalRange({ from: i0, to: Math.max(i1, i0 + 20) });
        } else chartRef.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, rows.length - 140), to: rows.length + 6 });
        const last = rows.at(-1); if (last) cbs.current.onTick?.({ last: last.c, candle: last });
        setState({ loading: false, error: rows.length ? null : "Sem velas para este contrato e intervalo." });
        setVer((v) => v + 1);
      })
      .catch(() => alive && setState({ loading: false, error: "Gráfico indisponível agora (sem conexão com a Hyperliquid)." }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coin, interval, theme, panes, focus?.from, focus?.to]);

  // execuções, indicadores ou destaque mudaram: repinta sem recarregar
  useEffect(() => { if (candles.current.length) paint(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [execs, indicators, highlightKey]);

  // tempo real: vela e status do socket; consulta periódica se o socket não estiver disponível
  useEffect(() => {
    if (process.env.BST_DEMO === "1" || !live) { setWs("unavailable"); return; }
    const sock = hlSocket();
    const off1 = sock.onStatus(setWs);
    const apply = (c: HlCandle) => {
      candles.current = applyLive(candles.current, c);
      const cs = candleS.current;
      cs?.update({ time: (c.t / 1000) as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c });
      volS.current?.update({ time: (c.t / 1000) as UTCTimestamp, value: c.v, color: (c.c >= c.o ? cv("--candle-up") : cv("--candle-down")) + "66" });
      cbs.current.onTick?.({ last: c.c, candle: c });
      if (indRef.current.rsi || indRef.current.macd || indRef.current.sma || indRef.current.ema || indRef.current.bb) scheduleInd();
    };
    let pend = false;
    const scheduleInd = () => { if (pend) return; pend = true; setTimeout(() => { pend = false; indicatorsPaint(); }, 500); };
    const off2 = sock.subscribe({ type: "candle", coin, interval }, (d) => {
      const r = d as { t: number; T: number; o: string; h: string; l: string; c: string; v: string; n: number };
      apply({ t: r.t, T: r.T, o: Number(r.o), h: Number(r.h), l: Number(r.l), c: Number(r.c), v: Number(r.v), n: r.n });
    });
    return () => { off1(); off2(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coin, interval, live]);
  useEffect(() => {
    if (process.env.BST_DEMO === "1" || !live) return;
    const need = ws === "unavailable" || ws === "reconnecting";
    if (!need) { setPolling(false); return; }
    setPolling(true);
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const step = TF_MS[interval];
      void fetchCandles(coin, interval, Date.now() - 2 * step, Date.now() + step).then((rows) => {
        for (const c of rows) { candles.current = applyLive(candles.current, c); candleS.current?.update({ time: (c.t / 1000) as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c }); }
        const last = rows.at(-1); if (last) cbs.current.onTick?.({ last: last.c, candle: last });
      }).catch(() => undefined);
    }, 5000);
    return () => clearInterval(id);
  }, [ws, coin, interval, live]);

  // ── linhas de preço: criam, atualizam e removem só o que mudou ──
  useEffect(() => {
    const cs = candleS.current;
    if (!cs) return;
    const live = new Set(lines.map((l) => l.id));
    for (const [id, x] of priceLines.current) if (!live.has(id)) { try { cs.removePriceLine(x.pl); } catch { /* já removida */ } priceLines.current.delete(id); }
    for (const l of lines) {
      const sig = `${l.title}|${l.tone}|${l.dash}|${l.width}|${l.label}`;
      const opts = { price: l.price, color: toneColor(l.tone), lineWidth: l.width, lineStyle: dash(l.dash), axisLabelVisible: l.label, title: l.title };
      const cur = priceLines.current.get(l.id);
      if (!cur) priceLines.current.set(l.id, { pl: cs.createPriceLine(opts), sig });
      else if (cur.sig !== sig) { cur.pl.applyOptions(opts); cur.sig = sig; }
      else cur.pl.applyOptions({ price: l.price });
    }
    chartRef.current?.priceScale("right").applyOptions({ autoScale: true });
  }, [lines, ver, theme, panes]);

  return (
    <div className="relative w-full" style={{ height: height ?? 420 }}>
      <div ref={box} className="absolute inset-0" />
      {legend && (
        <div className="num pointer-events-none absolute left-2 top-1.5 z-10 max-w-[92%] rounded-md bg-surface/80 px-2 py-1 text-[10.5px] leading-snug backdrop-blur-sm">
          <span className="text-muted">{new Date(legend.time * 1000).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>{" "}
          A <b>{fmtPx(legend.o)}</b> Máx <b>{fmtPx(legend.h)}</b> Mín <b>{fmtPx(legend.l)}</b> F <b className={legend.chg >= 0 ? "text-gain" : "text-loss"}>{fmtPx(legend.c)}</b>{" "}
          <span className={legend.chg >= 0 ? "text-gain" : "text-loss"}>{(legend.chg >= 0 ? "+" : "") + (legend.chg * 100).toFixed(2).replace(".", ",")}%</span>{" "}
          <span className="text-muted">Vol</span> <b>{legend.v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}</b>
          {legend.extra.length > 0 && <span className="block text-muted">{legend.extra.map((e) => `${e.label} ${e.value}`).join(" · ")}</span>}
        </div>
      )}
      {state.loading && <div className="absolute inset-0 z-10 grid place-items-center text-[13px] text-muted">Carregando velas…</div>}
      {!state.loading && state.error && <div className="absolute inset-0 z-10 grid place-items-center px-6 text-center text-[13px] text-muted">{state.error}</div>}
    </div>
  );
}
