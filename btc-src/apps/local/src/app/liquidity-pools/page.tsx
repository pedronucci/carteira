"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Panel, PanelHead, Kpi, KpiGrid, Button, Notice, Segmented, Field, Pill } from "@/components/ui";
import { NumberField } from "../simulador/number-field";
import { Sheet } from "@/components/sheet";
import { useDataVersion } from "@/lib/api";
import { portfolio } from "@/lib/portfolio/db";
import { addConnectedAccount } from "@/lib/connectors";
import { walletMeta } from "@/lib/wallets";
import { NETWORKS, type LPPosition } from "@/lib/liquidity/types";
import { uniswapV3, pricePositions } from "@/lib/liquidity/uniswap-v3";
import { uniquePositions } from "@/lib/liquidity/math";
import { useLPPositions, setLPPositions } from "@/lib/liquidity/state";
import { Explorer, Simulation } from "./tools";
export const usd = (v: number | null) => v == null ? "Dados insuficientes" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" }).format(v);
export const inputClass = "h-11 min-w-0 rounded-lg border border-line bg-bg px-3 text-[13px] text-ink";
export default function LiquidityPools() {
    useDataVersion();
    const all = portfolio().accounts.filter(a => ["evm", "solana"].includes(a.kind) && walletMeta(a).enabled);
    const accounts = all.filter((a, n) => all.findIndex(b => b.kind === a.kind && String(b.config?.address ?? b.addresses?.[0]) === (String(a.config?.address ?? a.addresses?.[0]))) === n);
    const signature = accounts.map(a => `${a.id}:${a.config?.address ?? a.addresses?.[0]}`).join("|");
    const [, clock] = useState(0);
    const positions = useLPPositions(), [tab, setTab] = useState("positions"), [network, setNetwork] = useState("all"), [status, setStatus] = useState("all"), [asset, setAsset] = useState(""), [detail, setDetail] = useState<LPPosition | null>(null), [busy, setBusy] = useState(false), [progress, setProgress] = useState(""), [notes, setNotes] = useState<string[]>([]), [cursor, setCursor] = useState<Record<string, number>>({}), [at, setAt] = useState(0), [address, setAddress] = useState(""), [kind, setKind] = useState<"evm" | "solana">("solana"), [walletError, setWalletError] = useState("");
    const controller = useRef<AbortController | null>(null), running = useRef(false), results = useRef(new Map<string, LPPosition[]>()), pages = useRef<Record<string, number>>({});
    const scan = async (more = false) => {
        if (running.current)
            return;
        running.current = true;
        setBusy(true);
        controller.current = new AbortController();
        const signal = controller.current.signal;
        const warnings: string[] = [], next: Record<string, number> = {};
        try {
            for (const a of accounts) {
                if (a.kind !== "evm")
                    continue;
                const owner = String(a.config?.address ?? a.addresses?.[0] ?? "");
                for (const net of NETWORKS) {
                    if (signal.aborted)
                        throw Error("Sincronização cancelada; resultados anteriores preservados.");
                    const key = `${a.id}:${net.id}`;
                    if (more && pages.current[key] == null)
                        continue;
                    const offset = more ? pages.current[key]! : 0;
                    setProgress(`${a.name} · ${net.name} · página ${Math.floor(offset / 20) + 1}`);
                    try {
                        const result = await uniswapV3.discover(a.id, owner, net.id, offset, signal);
                        let priced = result.positions;
                        try {
                            priced = await pricePositions(priced, signal);
                        }
                        catch (e) {
                            warnings.push(`${net.name}: quantidades lidas, preços indisponíveis (${(e as Error).message}).`);
                        }
                        const previous = results.current.get(key) ?? [];
                        results.current.set(key, uniquePositions(more ? [...previous, ...priced] : result.notes.length ? [...previous, ...priced] : priced));
                        warnings.push(...result.notes.map(n => `${net.name}: ${n}`));
                        if (result.next != null)
                            next[key] = result.next;
                    }
                    catch (e) {
                        warnings.push(`${net.name}: ${(e as Error).message}. Sem confirmação de saldo zero; cache anterior preservado.`);
                    }
                    setLPPositions(uniquePositions([...results.current.values()].flat()).filter(p => accounts.some(a => a.id === p.accountId)));
                }
            }
            pages.current = next;
            setCursor({ ...next });
            setAt(Date.now());
        }
        catch (e) {
            warnings.push((e as Error).message);
        }
        finally {
            setNotes(warnings);
            setBusy(false);
            setProgress("");
            running.current = false;
        }
    };
    useEffect(() => { let cancelled = false; let retry: ReturnType<typeof setTimeout> | undefined; const start = () => { if (cancelled)
        return; if (running.current) {
        retry = setTimeout(start, 100);
        return;
    } void scan(); }; start(); const timer = setInterval(start, 300000); return () => { cancelled = true; clearTimeout(retry); clearInterval(timer); controller.current?.abort(); }; }, [signature]);
    useEffect(() => { const timer = setInterval(() => clock(v => v + 1), 30000); return () => clearInterval(timer); }, []);
    const active = positions.filter(p => accounts.some(a => a.id === p.accountId)), rows = active.filter(p => (network === "all" || String(p.chainId) === network) && (status === "all" || p.status === status) && p.tokens.some(t => t.symbol.toLowerCase().includes(asset.toLowerCase())));
    const priced = active.filter(p => p.valueUsd != null && Date.now() - p.at < 600000), value = priced.reduce((s, p) => s + p.valueUsd!, 0);
    const add = () => { try {
        if (accounts.some(a => String(a.config?.address ?? a.addresses?.[0]) === (kind === "evm" ? address.trim().toLowerCase() : address.trim())))
            throw Error("Endereço já cadastrado");
        addConnectedAccount(kind, "Carteira LP", address);
        setAddress("");
        setWalletError("");
    }
    catch (e) {
        setWalletError((e as Error).message);
    } };
    return <div className="space-y-4 pt-5"><header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[11px] tracking-[.22em] text-accent">NEXUS PRIME • DEFI</p><h1 className="text-[26px] font-semibold">LIQUIDITY POOLS</h1><p className="text-[12px] text-muted">Posições, descoberta e cenários • somente leitura</p></div><div className="flex gap-2"><Button loading={busy} onClick={() => void scan()}>Sincronizar posições</Button>{busy && <Button onClick={() => controller.current?.abort()}>Cancelar</Button>}</div></header>
 <KpiGrid className="grid-cols-2 lg:grid-cols-4"><Kpi label="LPs • valor conhecido" value={priced.length ? usd(value) : "—"} sub={`${priced.length}/${active.length} com preço recente`}/><Kpi label="Posições ativas observadas" value={String(active.filter(p => p.status !== "CLOSED").length)} sub="Somente NFTs consultados"/><Kpi label="Fora do range" value={String(active.filter(p => p.status === "OUT OF RANGE").length)} tone="warn"/><Kpi label="P&L / fees realizadas" value="Dados insuficientes" sub="Histórico completo necessário"/></KpiGrid>
 <Notice>Descoberta por carteira: Uniswap V3 nas seis redes EVM. Explorer: Uniswap V2/V3/V4, Orca e Raydium conforme cobertura das fontes. Descoberta de posições Solana, V2/V4 e histórico de eventos ainda dependem de indexação. Ausência de resultado não confirma ausência de LPs.</Notice>
 <div className="overflow-x-auto"><Segmented label="Seção de liquidez" value={tab} onChange={setTab} options={[{ value: "positions", label: "Minhas posições" }, { value: "explorer", label: "Pool Explorer" }, { value: "analytics", label: "Analytics" }, { value: "simulation", label: "Simular LP" }]}/></div>
 {tab === "positions" && <><Panel><PanelHead title="Carteiras do portfólio" sub="Reutiliza endereços públicos já cadastrados"/><div className="space-y-3 p-4"><p className="text-[12px] text-muted">{accounts.length} carteira(s) elegíveis • {at ? `última tentativa ${new Date(at).toLocaleTimeString("pt-BR")}` : "ainda sem consulta"}. Atualização a cada 5 minutos nesta tela.</p>{accounts.map(a => <p className="break-all text-[12px]" key={a.id}>{a.name} · {a.kind.toUpperCase()} · {String(a.config?.address ?? a.addresses?.[0] ?? "")}</p>)}<div className="flex flex-wrap gap-2"><select aria-label="Tipo de carteira LP" className={inputClass} value={kind} onChange={e => setKind(e.target.value as typeof kind)}><option value="solana">Solana</option><option value="evm">EVM / Rabby</option></select><input aria-label="Endereço público LP" className={inputClass + " flex-1"} placeholder="Somente endereço público" value={address} onChange={e => setAddress(e.target.value)}/><Button onClick={add}>Adicionar carteira</Button></div>{walletError && <Notice tone="loss">{walletError}</Notice>}</div></Panel>
 {busy && <p role="status" className="text-[12px] text-accent">Consultando {progress}…</p>}{active.some(p => Date.now() - p.at >= 600000) && <Notice>Há posições desatualizadas; valores antigos estão excluídos do indicador USD.</Notice>}{notes.length > 0 && <details className="text-[12px] text-warn"><summary>{notes.length} aviso(s) da sincronização</summary>{notes.map((n, k) => <p className="py-1" key={k}>{n}</p>)}</details>}
 <div className="flex flex-wrap gap-2"><select aria-label="Filtrar rede LP" className={inputClass} value={network} onChange={e => setNetwork(e.target.value)}><option value="all">Todas as redes</option>{NETWORKS.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}</select><select aria-label="Status LP" className={inputClass} value={status} onChange={e => setStatus(e.target.value)}>{["all", "IN RANGE", "OUT OF RANGE", "CLOSED"].map(s => <option key={s} value={s}>{s === "all" ? "Todos os status" : s}</option>)}</select><input aria-label="Filtrar ativo LP" className={inputClass} placeholder="Ativo" value={asset} onChange={e => setAsset(e.target.value)}/></div>
 <Panel className="overflow-hidden"><PanelHead title="Posições observadas" sub="Valor conhecido: liquidez + tokensOwed; fees não contabilizadas no contrato ficam de fora"/><div className="overflow-auto"><table className="w-full text-left text-[12px]"><thead><tr>{["Pool / NFT", "Protocolo", "Rede", "Par", "Valor USD", "APR/APY", "Fees / P&L", "Range", "Detalhes"].map(h => <th key={h} className="whitespace-nowrap px-3 py-3">{h}</th>)}</tr></thead><tbody>{rows.map(p => <tr key={p.id} className="border-t border-line"><td className="px-3 py-3">{p.pool.slice(0, 8)}… #{p.positionId}</td><td>{p.protocol}</td><td>{p.network}</td><td>{p.tokens.map(t => t.symbol).join(" / ")}</td><td className="whitespace-nowrap px-3">{usd(p.valueUsd)}{Date.now() - p.at >= 600000 ? " • antigo" : ""}</td><td>—</td><td>Dados insuficientes</td><td><Pill>{p.status}</Pill></td><td><Button size="sm" onClick={() => setDetail(p)}>Abrir</Button></td></tr>)}</tbody></table></div>{!rows.length && <p className="p-5 text-[13px] text-muted">{busy ? "Consultando posições…" : active.length ? "Nenhuma posição corresponde aos filtros." : accounts.length ? "Nenhuma posição confirmada. Confira os avisos e a cobertura." : "Adicione uma carteira pública ou utilize as carteiras já cadastradas no portfólio."}</p>}</Panel>{Object.keys(cursor).length > 0 && <Button disabled={busy} onClick={() => void scan(true)}>Consultar próxima página de NFTs</Button>}
 <Notice>Os valores LP ficam separados do patrimônio consolidado até haver histórico e reconciliação de fluxos/recibos. Isso evita dupla contagem e tratar a descoberta como lucro ou aporte. Hyperliquid e OKX não são alteradas.</Notice></>}
 {tab === "explorer" && <Explorer />}{tab === "simulation" && <Simulation />}{tab === "analytics" && <Analytics rows={active}/>}
 {detail && <Sheet title={`${detail.protocol} • #${detail.positionId}`} onClose={() => setDetail(null)}><div className="space-y-3 text-[12px]"><p className="break-all">Pool: {detail.pool}</p><p className="break-all">Identidade: {detail.id}</p><p>{detail.network} • bloco {detail.block} • {new Date(detail.at).toLocaleString("pt-BR")}</p><p>Fee tier: {detail.feeTier}% • valor conhecido estimado: {usd(detail.valueUsd)}</p>{detail.tokens.map((t, i) => <div key={t.address}><p className="break-all">{t.symbol} · {t.address}</p><p>{t.qty} unidades • {usd(t.priceUsd)} / unidade</p><p>A receber no contrato: {detail.owedRaw[i]} unidades</p></div>)}<Range position={detail}/><Notice>tokensOwed podem incluir principal retirado: não são classificados como fees sem histórico. Fees pendentes totais, depósitos, retiradas, gas, P&L, APR realizado e LP vs HODL: Dados insuficientes. O valor USD inclui liquidez e tokensOwed; fees ainda não contabilizadas pelo contrato ficam de fora.</Notice></div></Sheet>}
 </div>;
}
function Range({ position: p }: {
    position: LPPosition;
}) { const low = Math.log(p.lower), high = Math.log(p.upper), cur = Math.log(p.price), x = Math.max(0, Math.min(100, (cur - low) / (high - low) * 100)); return <div className="space-y-2 rounded-xl border border-line p-4"><Pill>{p.status}</Pill><p>Preço em {p.tokens[1]!.symbol} por {p.tokens[0]!.symbol}</p><div className="relative my-5 h-3 rounded bg-accent/30"><span className="absolute -top-1 h-5 w-1 bg-btc" style={{ left: `${x}%` }}/></div><p className="break-all">{p.lower.toPrecision(7)} ← {p.price.toPrecision(7)} → {p.upper.toPrecision(7)}</p><p>Limite superior exclusivo</p></div>; }
function Analytics({ rows }: {
    rows: LPPosition[];
}) { const groups = new Map<string, number>(); for (const p of rows)
    if (p.valueUsd != null && Date.now() - p.at < 600000)
        groups.set(p.network, (groups.get(p.network) ?? 0) + p.valueUsd); return <Panel><PanelHead title="Exposição observada • valores estimados recentes"/><div className="space-y-3 p-4">{[...groups].map(([key, value]) => <div key={key} className="flex justify-between"><span>{key} / Uniswap V3</span><span>{usd(value)}</span></div>)}{!groups.size && <p className="text-muted">Nenhuma posição avaliada recentemente.</p>}<Notice>Gráficos históricos, fees acumuladas, APR realizado, rentabilidade e LP vs HODL exigem depósitos, retiradas e coletas. Dados insuficientes. Fotografias de saldos não substituem movimentações.</Notice></div></Panel>; }
