"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { quotes, type Quote } from "@/lib/simulator/market";
import { simulate, marginAtLiquidation, type Input } from "@/lib/simulator/engine";
import { loadCandles } from "@/lib/perps/market-data";
import { Button, Panel, PanelHead, Notice, Kpi, KpiGrid, Segmented } from "@/components/ui";
import { NumberField } from "./number-field";
const money = (v: number | null) => v == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(v);
const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const field = (label: string, value: number, set: (n: number) => void) => <NumberField label={label} value={value} onChange={set}/>;
export default function Simulator() {
    const [coin, setCoin] = useState("BTC"), [side, setSide] = useState<Input["side"]>("LONG"), [entry, setEntry] = useState(0), [margin, setMargin] = useState(1000), [leverage, setLev] = useState(5), [stop, setStop] = useState(0), [exit, setExit] = useState(0), [hours, setHours] = useState(24), [feeIn, setFeeIn] = useState(.045), [feeOut, setFeeOut] = useState(.045), [funding, setFunding] = useState<number | null>(null), [tps, setTps] = useState<Input["tps"]>([]), [book, setBook] = useState<Record<string, Quote>>({}), [error, setError] = useState(""), [last, setLast] = useState<number | null>(null), [candles, setCandles] = useState<number[]>([]), [zoom, setZoom] = useState(1), [now, setNow] = useState(Date.now()), [lastAt, setLastAt] = useState(0);
    const initialized=useRef(false);
    const q = book[coin], stale = !q || now - q.at > 45000;
    useEffect(() => { let alive = true; let controller: AbortController | null = null; const run = async () => { controller?.abort(); controller = new AbortController(); const timeout = setTimeout(() => controller?.abort(), 12000); try {
        const b = await quotes(controller.signal);
        if (alive) {
            setBook(b);
            setError("");
        }
    }
    catch (e) {
        if (alive)
            setError((e as Error).message);
    }
    finally {
        clearTimeout(timeout);
    } }; void run(); const id = setInterval(() => void run(), 15000); return () => { alive = false; clearInterval(id); controller?.abort(); }; }, []);
    useEffect(() => { const id = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(id); }, []);
    useEffect(() => { let alive = true; setLast(null); setCandles([]); void loadCandles(coin, "1h", Date.now(), 120).then(c => { if (alive)
        setCandles(c.map(x => x.c)); }).catch(() => { }); let ws: WebSocket | null = null, retry: ReturnType<typeof setTimeout> | undefined, delay = 1000; const connect = () => { if (!alive)
        return; ws = new WebSocket("wss://api.hyperliquid.xyz/ws"); const socket = ws; socket.onopen = () => { delay = 1000; socket.send(JSON.stringify({ method: "subscribe", subscription: { type: "allMids" } })); }; socket.onmessage = e => { try {
        const m = JSON.parse(e.data);
        const p = Number(m.data?.mids?.[coin]);
        if (alive && Number.isFinite(p) && p > 0) {
            setLast(p);
            setLastAt(Date.now());
        }
    }
    catch { } }; socket.onclose = () => { if (alive) {
        retry = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 15000);
    } }; socket.onerror = () => socket.close(); }; connect(); const ping = setInterval(() => { if (ws?.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ method: "ping" })); }, 25000); return () => { alive = false; clearTimeout(retry); clearInterval(ping); ws?.close(); }; }, [coin]);
    const initialize = (p: number, dir = side) => { setEntry(p); setStop(p * (dir === "LONG" ? .95 : 1.05)); setExit(p * (dir === "LONG" ? 1.05 : .95)); setTps([]); };
    useEffect(() => { if (!initialized.current && q){initialized.current=true;initialize(q.mark);} }, [q]);
    const input: Input = { entry, margin, leverage, side, entryFee: feeIn / 100, exitFee: feeOut / 100, funding: (funding ?? (q?.funding ?? 0) * 100) / 100, fundingPrice: q?.oracle ?? entry, stop, exit, hours, tps, tiers: stale ? [] : q?.tiers ?? [] };
    const computed = useMemo(() => { try {
        return { result: simulate(input), error: "" };
    }
    catch (e) {
        return { result: null, error: (e as Error).message };
    } }, [entry, margin, leverage, side, feeIn, feeOut, funding, q, stop, exit, hours, tps, stale]);
    const r = computed.result;
    const lines = [{ id: "entry", label: "Entrada", price: entry, color: "#43d9d0" }, { id: "stop", label: "Stop Loss", price: stop, color: "#ff526a" }, { id: "exit", label: "Saída restante", price: exit, color: "#8658e8" }, ...tps.map((t, n) => ({ id: `tp${n}`, label: `TP ${n + 1}`, price: t.price, color: "#00e6a0" })), ...(r?.liq ? [{ id: "liq", label: "Liquidação estimada", price: r.liq, color: "#f4b942" }] : [])].filter(l => l.price > 0);
    const drag = (id: string, p: number) => { if (id === "entry")
        setEntry(p);
    else if (id === "stop")
        setStop(p);
    else if (id === "exit")
        setExit(p);
    else if (id.startsWith("tp"))
        setTps(v => v.map((t, n) => n === Number(id.slice(2)) ? { ...t, price: p } : t));
    else if (id === "liq" && r) {
        const collateral=marginAtLiquidation(entry,r.qty,p,side,input.tiers,r.opening);if(collateral===null)return;
        const lev = r.notional / collateral;
        if (collateral > 0 && lev >= 1 && lev <= 20) {
            setMargin(collateral);
            setLev(lev);
        }
    } };
    return <div className="space-y-4 pt-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[11px] tracking-[.2em] text-accent">LAB • PERPETUAL FUTURES</p><h1 className="mt-1 text-[26px] font-semibold">Simulador de posições</h1><p className="text-[12px] text-muted">Capital fictício • margem isolada • nenhuma ordem é enviada</p></div><Segmented label="Ativo" value={coin} onChange={v => { initialized.current=false;setCoin(v); setEntry(0); setStop(0); setExit(0); setTps([]); setFunding(null); }} options={["BTC", "SOL", "HYPE"].map(v => ({ value: v, label: v }))}/></div>
 <div className="flex flex-wrap gap-4 rounded-xl border border-line bg-surface p-3 text-[12px]"><span>{coin}/USDC · Hyperliquid</span><span>Mid ao vivo: {money(now - lastAt < 30000 ? last : null)}</span><span>Mark: {money(q?.mark ?? null)}</span><span>Oracle: {money(q?.oracle ?? null)}</span><span className={stale ? "text-warn" : "text-gain"}>{stale ? "Dados ausentes/desatualizados" : `Referências atualizadas ${new Date(q.at).toLocaleTimeString("pt-BR")}`}</span></div>
 {error && <Notice>{error}. Você pode simular preços manuais; liquidação fica indisponível sem parâmetros recentes.</Notice>}
 <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]"><Panel className="space-y-4 p-4"><Segmented full label="Direção" value={side} onChange={s => { setSide(s); if (entry > 0)
        initialize(entry, s); }} options={[{ value: "LONG", label: "LONG ↗" }, { value: "SHORT", label: "SHORT ↘" }]}/>
 {field("Preço de entrada (USDC)", entry, setEntry)}<Button size="sm" onClick={() => q && initialize(q.mark)} disabled={!q || stale}>Usar marcação atual</Button>
 <div className="grid grid-cols-2 gap-3">{field("Margem (USD)", margin, setMargin)}{field("Tamanho nocional (USD)", margin * leverage, v => setMargin(v / leverage))}</div><p className="text-[11px] text-muted">Quantidade teórica (sem arredondamento de lote): {r?.qty.toLocaleString("pt-BR", { maximumFractionDigits: 8 }) ?? "—"} {coin}</p>
 {field("Alavancagem (1x–20x)", leverage, setLev)}<input className="w-full accent-accent" aria-label="Ajustar alavancagem" type="range" min="1" max="20" step=".1" value={Number.isFinite(leverage)?leverage:1} onChange={e => setLev(Number(e.target.value))}/>
 <div className="grid grid-cols-2 gap-3">{field("Stop Loss", stop, setStop)}{field("Preço de saída", exit, setExit)}{field("Duração total (horas)", hours, setHours)}{field("Funding por hora (%)", funding ?? (q?.funding ?? 0) * 100, setFunding)}{field("Taxa entrada (%)", feeIn, setFeeIn)}{field("Taxa saída (%)", feeOut, setFeeOut)}</div><Button variant="ghost" size="sm" onClick={() => setFunding(null)}>Usar funding público atual</Button><p className="text-[11px] text-muted">Taxas editáveis: informe seu tier maker/taker. Funding é projeção constante sobre o oracle atual; positivo é pago por LONG e recebido por SHORT. Abertura logo após um pagamento; cobranças a cada hora completa, antes de saídas no mesmo horário.</p></Panel>
 <div className="min-w-0 space-y-4"><Panel className="overflow-hidden"><PanelHead title={`${coin} • níveis da simulação`} right={<div className="flex gap-2"><Button aria-label="Ampliar histórico" size="sm" onClick={() => setZoom(v => Math.max(1, v - 1))}>−</Button><Button aria-label="Aproximar histórico" size="sm" onClick={() => setZoom(v => Math.min(4, v + 1))}>+</Button></div>}/><p className="px-4 pt-2 text-[11px] text-muted">Arraste os níveis ou use seus campos. Arrastar liquidação ajusta margem/alavancagem mantendo o nocional, dentro de 1x–20x.</p><LevelChart values={candles.slice(-Math.ceil(120 / zoom))} lines={lines} onChange={drag}/>{!candles.length && <p className="px-4 pb-3 text-[11px] text-muted">Histórico indisponível: o gráfico mostra apenas os níveis manuais.</p>}</Panel>
 {(stale && funding === null) && <Notice>Funding sem referência recente: hipótese de 0% quando ausente; informe uma taxa manual. A referência antiga, quando disponível, permanece visível.</Notice>}{q && !q.tiers.length && <Notice>Faixas de margem indisponíveis: a liquidação não será estimada.</Notice>}
 {computed.error && <Notice tone="loss">{computed.error}</Notice>}
 <KpiGrid className="grid-cols-2 lg:grid-cols-4"><Kpi label={r?.invalid ? "PnL algébrico (inviável)" : "PnL líquido projetado"} value={money(r?.net ?? null)} tone={r ? (r.net >= 0 ? "gain" : "loss") : null}/><Kpi label="ROE líquido / margem" value={r ? pct(r.roe) : "—"}/><Kpi label="Liquidação estimada inicial" value={r&&input.tiers.length&&r.liq===null?"Sem nível > 0":money(r?.liq ?? null)}/><Kpi label="Retorno / risco no stop" value={r?.rr != null && r.rr > 0 ? `${r.rr.toFixed(2)} R` : "—"}/></KpiGrid>
 <Panel><PanelHead title="Take Profits • percentual da quantidade original" right={<Button size="sm" onClick={() => setTps(v => [...v, { price: entry * (1 + (side === "LONG" ? 1 : -1) * .03 * (v.length + 1)), pct: 25, hours: hours }])}>+ Adicionar TP</Button>}/><div className="space-y-3 p-4">{tps.length === 0 && <p className="text-[12px] text-muted">Sem parciais: 100% é encerrado no preço de saída informado.</p>}{tps.map((t, n) => <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2" key={n}>{field(`TP ${n + 1} preço`, t.price, p => setTps(v => v.map((x, k) => k === n ? { ...x, price: p } : x)))}{field(`TP ${n + 1} quantidade (%)`, t.pct, p => setTps(v => v.map((x, k) => k === n ? { ...x, pct: p } : x)))}{field(`TP ${n + 1} hora`, t.hours, p => setTps(v => v.map((x, k) => k === n ? { ...x, hours: p } : x)))}<Button aria-label={`Remover TP ${n + 1}`} onClick={() => setTps(v => v.filter((_, k) => k !== n))}>×</Button></div>)}</div></Panel>
 <Panel><PanelHead title="Decomposição e encerramentos"/><div className="flex flex-wrap gap-5 p-4 text-[13px]"><span>Bruto {money(r?.gross ?? null)}</span><span>Taxas {money(r?.fees ?? null)}</span><span>Funding pago (+) / recebido (−) {money(r?.funding ?? null)}</span><span>No stop, sem TPs: {money(r?.stopNet ?? null)}</span></div><div className="overflow-auto"><table className="w-full text-[12px]"><thead><tr>{["Etapa", "Preço", "% inicial", "PnL bruto", "Taxa", "Funding no intervalo", "Liquidação restante"].map(t => <th className="px-3 py-2 text-left" key={t}>{t}</th>)}</tr></thead><tbody>{r?.rows.map((t, n) => <tr key={n} className="border-t border-line">{[t.label, money(t.price), t.pct.toFixed(2), money(t.gross), money(t.fee), money(t.funding), money(t.liquidationAfter)].map((x, k) => <td key={k} className="whitespace-nowrap px-3 py-3">{x}</td>)}</tr>)}</tbody></table></div></Panel>
 {r?.warnings.map(w => <Notice key={w}>{w}</Notice>)}<Notice>Liquidação por mark price, modelo isolado com faixas públicas; não é cotação executável nem garantia de execução. Funding futuro, slippage, gaps, liquidação parcial/backstop e mudanças de regras podem alterar o resultado. O caminho supõe preços entre os níveis planejados; oscilações intermediárias não são previstas. Colateral e PnL realizado permanecem alocados nas parciais. Valores em USDC são apresentados como dólares, sem conversão cambial. Quantidades teóricas não respeitam lotes ou ticks de ordens reais. Sem parâmetros de margem, não há preço de liquidação.</Notice>
 </div></div></div>;
}
function LevelChart({ values, lines, onChange }: {
    values: number[];
    lines: {
        id: string;
        label: string;
        price: number;
        color: string;
    }[];
    onChange: (id: string, p: number) => void;
}) {
    const [width, setWidth] = useState(900);
    const svg = useRef<SVGSVGElement>(null), drag = useRef<{
        id: string;
        lo: number;
        hi: number;
    } | null>(null), [bounds, setBounds] = useState<{
        lo: number;
        hi: number;
    } | null>(null);
    useEffect(() => {
        const node=svg.current;if(!node)return;
        const observer=new ResizeObserver(entries=>{const w=entries[0]?.contentRect.width;if(w&&w>0)setWidth(w);});
        observer.observe(node);return()=>observer.disconnect();
    },[]);
    const all = [...values, ...lines.map(l => l.price)].filter(v => Number.isFinite(v) && v > 0);
    const min = Math.min(...all), max = Math.max(...all), pad = Math.max((max - min) * .12, max * .01, 1);
    const lo = bounds?.lo ?? (Number.isFinite(min) ? Math.max(0, min - pad) : 0), hi = bounds?.hi ?? (Number.isFinite(max) ? max + pad : 1);
    const y = (p: number) => 300 - (p - lo) / (hi - lo) * 270;
    const move = (e: React.PointerEvent<SVGSVGElement>) => { if (!drag.current || !svg.current)
        return; const rect = svg.current.getBoundingClientRect(), v = (e.clientY - rect.top) / rect.height * 340; onChange(drag.current.id, Math.max(.000001, drag.current.lo + (300 - v) / 270 * (drag.current.hi - drag.current.lo))); };
    return <svg ref={svg} viewBox={`0 0 ${width} 340`} preserveAspectRatio="none" className="h-[340px] w-full touch-none select-none" role="group" aria-label="Histórico de preço e níveis arrastáveis" onPointerMove={move} onPointerUp={() => { drag.current = null; setBounds(null); }} onPointerCancel={() => { drag.current = null; setBounds(null); }}><defs><linearGradient id="sim-fill" x2="0" y2="1"><stop stopColor="#00e5df" stopOpacity=".25"/><stop offset="1" stopColor="#00e5df" stopOpacity="0"/></linearGradient></defs>{[0, 1, 2, 3, 4].map(n => <g key={n}><line x1="15" x2={width-15} y1={30 + n * 67.5} y2={30 + n * 67.5} stroke="#15313b"/><text x="18" y={25 + n * 67.5} fill="#718c9e" fontSize="11">{money(hi - n * (hi - lo) / 4)}</text></g>)}{values.length > 1 && <polyline points={values.map((p, n) => `${20 + n / (values.length - 1) * (width-225)},${y(p)}`).join(" ")} fill="none" stroke="#43d9d0" strokeWidth="2"/>}{lines.map(l => <g key={l.id} role="slider" tabIndex={0} aria-label={`${l.label} no gráfico`} aria-valuenow={l.price} aria-valuemin={0} aria-valuemax={Math.max(hi,l.price)} aria-orientation="vertical" onKeyDown={e=>{if(e.key==="ArrowUp"||e.key==="ArrowDown"){e.preventDefault();onChange(l.id,Math.max(.000001,l.price+(e.key==="ArrowUp"?1:-1)*(hi-lo)/270));}}} style={{ cursor: "ns-resize" }} onPointerDown={e => { drag.current = { id: l.id, lo, hi }; setBounds({ lo, hi }); svg.current?.setPointerCapture(e.pointerId); }}><line x1="15" x2={width-15} y1={y(l.price)} y2={y(l.price)} stroke={l.color} strokeDasharray="5 4"/><line x1="15" x2={width-15} y1={y(l.price)} y2={y(l.price)} stroke="transparent" strokeWidth="18"/><rect x={width-195} y={y(l.price) - 11} width="180" height="22" rx="4" fill="#071923" stroke={l.color}/><text x={width-188} y={y(l.price) + 4} fill={l.color} fontSize="11">{l.label} • {l.price.toFixed(coinPrecision(l.price))}</text></g>)}<text x="20" y="330" fill="#718c9e" fontSize="11">Fechamentos de 1h • simulação hipotética de níveis</text></svg>;
}
const coinPrecision = (p: number) => p >= 1000 ? 1 : 3;
