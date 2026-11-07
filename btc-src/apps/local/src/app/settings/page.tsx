"use client";
import { useRef, useState } from "react";
import { Copy, Download, Trash2, Upload } from "lucide-react";
import { DEFAULT_SCENARIO_RULES, type ScenarioRules } from "@bst/domain";
import { useDataVersion } from "@/lib/api";
import { backupNow, exportBackup, getStore, importBackup, listAutoBackups, resetStore, restoreAutoBackup, storageAvailable, updateStore } from "@/lib/local/store";
import { prices } from "@/lib/local/prices";
import { Button, Field, Notice, Panel, SectionTitle } from "@/components/ui";
import { num } from "@/components/forms";
import { StrategySheet } from "@/components/strategy";
import { hlState } from "@/lib/local/hl";
import { fmtZoned, type StrategyCycle } from "@/lib/local/strategy";
import { compute } from "@/lib/local/engine";
import { fmtMoney } from "@bst/domain";
import { HlConnect } from "@/components/hl-connect";
import { toast } from "@/components/toaster";

const RULE_LABEL: Partial<Record<keyof ScenarioRules, string>> = {
  rsiOversold: "RSI sobrevendido", rsiOverbought: "RSI sobrecomprado", mayerLow: "Preço ÷ MM200 baixo", mayerHigh: "Preço ÷ MM200 alto",
  drawdownDeep: "Queda profunda (fração)", fearExtreme: "Medo extremo", greedExtreme: "Ganância extrema", volHigh: "Volatilidade alta (fração)",
  leverageMax: "Alavancagem máxima", liqDistanceMin: "Distância mínima da liquidação", threshold: "Pontos para sair do neutro",
};

function Prefs() {
  useDataVersion();
  const st = getStore().settings;
  const [lev, setLev] = useState(st.defaultLeverage.replace(".", ","));
  const [mm, setMm] = useState(String(Number(st.maintenanceRate) * 100).replace(".", ","));
  const [minLiq, setMinLiq] = useState(String(Math.round(Number(st.minLiqDistance) * 100)));
  const [btc, setBtc] = useState(st.manualBtcUsd ?? "");
  const [fx, setFx] = useState(st.manualUsdBrl ?? "");
  const save = () => {
    const l = Number(num(lev)), m = Number(num(mm)), q = Number(num(minLiq));
    if (!(l >= 1 && l <= 10)) return toast("Alavancagem padrão entre 1x e 10x.", "loss");
    if (!(m > 0 && m < 10)) return toast("Margem de manutenção entre 0 e 10%.", "loss");
    if (!(q > 0 && q < 100)) return toast("Distância mínima entre 0 e 100%.", "loss");
    updateStore((s) => {
      s.settings.defaultLeverage = String(l);
      s.settings.maintenanceRate = String(m / 100);
      s.settings.minLiqDistance = String(q / 100);
      s.settings.manualBtcUsd = num(btc) && Number(num(btc)) > 0 ? num(btc) : undefined;
      s.settings.manualUsdBrl = num(fx) && Number(num(fx)) > 0 ? num(fx) : undefined;
    });
    toast("Preferências salvas.", "gain");
  };
  return (
    <Panel className="space-y-4 p-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Alavancagem padrão" suffix="x" inputMode="decimal" value={lev} onChange={(e) => setLev(e.target.value)} />
        <Field label="Margem de manutenção" suffix="%" inputMode="decimal" value={mm} onChange={(e) => setMm(e.target.value)} hint="Hyperliquid BTC: 1,25%" />
        <Field label="Liquidação mínima" suffix="%" inputMode="decimal" value={minLiq} onChange={(e) => setMinLiq(e.target.value)} hint="Alerta abaixo dessa distância" />
      </div>
      <div className="border-t border-line/70 pt-4">
        <p className="mb-3 text-[13px] leading-relaxed text-muted">Cotação manual, usada só quando não há internet. {prices().spot?.btcUsd ? "Agora o app está usando a cotação ao vivo." : ""}</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="BTC" suffix="US$" inputMode="decimal" placeholder="opcional" value={btc} onChange={(e) => setBtc(e.target.value)} />
          <Field label="Dólar" suffix="R$" inputMode="decimal" placeholder="opcional" value={fx} onChange={(e) => setFx(e.target.value)} />
        </div>
      </div>
      <Button variant="primary" size="lg" className="w-full" onClick={save}>Salvar preferências</Button>
    </Panel>
  );
}

function Rules() {
  useDataVersion();
  const cur = { ...DEFAULT_SCENARIO_RULES, ...(getStore().settings.scenarioRules ?? {}) };
  const keys = Object.keys(RULE_LABEL) as (keyof ScenarioRules)[];
  const [v, setV] = useState<Record<string, string>>(Object.fromEntries(keys.map((k) => [k, String(cur[k]).replace(".", ",")])));
  const save = () => {
    const out: Partial<ScenarioRules> = {};
    for (const k of keys) { const n = Number(num(v[k] ?? "")); if (!Number.isFinite(n)) return toast(`Valor inválido: ${RULE_LABEL[k]}`, "loss"); if (n !== DEFAULT_SCENARIO_RULES[k]) out[k] = n; }
    updateStore((s) => { s.settings.scenarioRules = out; });
    toast("Regras salvas.", "gain");
  };
  return (
    <details className="group rounded-lg border border-line bg-surface">
      <summary className="flex h-12 cursor-pointer list-none items-center justify-between px-4 text-[15px] font-medium">Regras da leitura de mercado<span className="text-muted transition-transform group-open:rotate-90">›</span></summary>
      <div className="space-y-3 border-t border-line/70 p-4">
        <div className="grid grid-cols-2 gap-3">{keys.map((k) => <Field key={k} label={RULE_LABEL[k]!} inputMode="decimal" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />)}</div>
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => { updateStore((s) => { s.settings.scenarioRules = {}; }); setV(Object.fromEntries(keys.map((k) => [k, String(DEFAULT_SCENARIO_RULES[k]).replace(".", ",")]))); toast("Regras padrão restauradas.", "gain"); }}>Restaurar padrão</Button>
          <Button variant="primary" onClick={save}>Salvar regras</Button>
        </div>
      </div>
    </details>
  );
}

/** Cópias feitas sozinhas antes de editar, apagar, restaurar ou migrar dados. */
function AutoBackups() {
  useDataVersion();
  const [open, setOpen] = useState(false);
  const list = listAutoBackups();
  const fmt = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const restore = (at: string) => {
    if (!window.confirm(`Voltar os dados para a cópia de ${fmt(at)}? O estado atual também fica guardado como cópia.`)) return;
    try { restoreAutoBackup(at); toast("Cópia restaurada.", "gain"); } catch (e) { toast((e as Error).message, "loss"); }
  };
  return (
    <div className="border-t border-line/70 pt-4">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between text-left text-[14px]">
        <span><span className="font-semibold text-ink">Cópias automáticas</span><span className="block text-[12px] text-muted">Feitas antes de editar, apagar ou restaurar. Ficam neste aparelho.</span></span>
        <span className="num shrink-0 text-muted">{list.length}</span>
      </button>
      {open && (list.length ? (
        <ul className="mt-3 divide-y divide-line rounded-md border border-line">
          {list.map((b) => (
            <li key={b.at} className="flex items-center gap-3 px-3 py-2 text-[13px]">
              <span className="num w-[92px] shrink-0 text-ink-2">{fmt(b.at)}</span>
              <span className="min-w-0 flex-1 truncate text-muted">{b.reason}</span>
              <Button size="sm" variant="ghost" onClick={() => restore(b.at)}>Restaurar</Button>
            </li>
          ))}
        </ul>
      ) : <p className="mt-3 text-[13px] text-muted">Nenhuma cópia ainda. A primeira é feita na próxima alteração.</p>)}
    </div>
  );
}

function Backup() {
  const file = useRef<HTMLInputElement>(null);
  const [paste, setPaste] = useState("");
  const [confirm, setConfirm] = useState(0);
  const doImport = (text: string) => {
    try { importBackup(text); toast("Backup restaurado.", "gain"); setPaste(""); } catch (e) { toast((e as Error).message, "loss"); }
  };
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([exportBackup()], { type: "application/json" }));
    a.download = `btc-terminal-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(exportBackup()); toast("Backup copiado. Cole em uma nota segura.", "gain"); }
    catch { toast("Não foi possível copiar. Use o download.", "loss"); }
  };
  return (
    <Panel className="space-y-4 p-4">
      <p className="text-[14px] leading-relaxed text-ink-2">Seus dados ficam só neste aparelho. No iPhone, o app da tela de início guarda dados separados do Safari: use o backup para levar tudo de um para o outro.</p>
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={download}><Download className="size-4" />Baixar</Button>
        <Button onClick={copy}><Copy className="size-4" />Copiar</Button>
      </div>
      <div className="border-t border-line/70 pt-4">
        <input ref={file} type="file" accept="application/json,.json,text/plain" className="hidden" onChange={async (e) => { const fl = e.target.files?.[0]; if (fl) doImport(await fl.text()); e.target.value = ""; }} />
        <Button className="w-full" onClick={() => file.current?.click()}><Upload className="size-4" />Restaurar de arquivo</Button>
        <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="…ou cole aqui o texto do backup" rows={3} className="mt-3 w-full rounded-md border border-line bg-surface-2 px-3 py-2.5 text-[16px] text-ink placeholder:text-muted focus:border-accent focus:outline-none" />
        {paste.trim() && <Button variant="primary" className="mt-2 w-full" onClick={() => doImport(paste)}>Restaurar texto colado</Button>}
      </div>
      <AutoBackups />
      <div className="border-t border-line/70 pt-4">
        {confirm === 0 && <Button variant="ghost" className="w-full text-loss" onClick={() => setConfirm(1)}><Trash2 className="size-4" />Apagar todos os dados</Button>}
        {confirm === 1 && (
          <div className="space-y-2">
            <p className="text-[14px] text-loss">Isso apaga posição inicial, ciclos e aportes deste aparelho. Baixe um backup antes.</p>
            <div className="grid grid-cols-2 gap-2"><Button onClick={() => setConfirm(0)}>Cancelar</Button><Button variant="danger" onClick={() => { resetStore(); setConfirm(0); toast("Dados apagados.", "gain"); }}>Apagar tudo</Button></div>
          </div>
        )}
      </div>
    </Panel>
  );
}

const SRC: Record<string, string> = { live: "oficial ao vivo", reconstructed: "reconstruído", manual: "referência manual" };

function Cycles() {
  useDataVersion();
  const s = getStore();
  const [sheet, setSheet] = useState<null | { mode: "new" | "edit"; edit?: StrategyCycle }>(null);
  const list = [...s.strategies].sort((a, b) => b.startAt - a.startAt);
  const res = (id: string) => { try { return compute(id).result; } catch { return null; } };
  const remove = (c: StrategyCycle) => {
    if (c.status === "active") return toast("Encerre o ciclo atual criando um novo antes de apagá-lo.", "loss");
    if (!confirm(`Apagar o ciclo “${c.name}”? Os lançamentos e o histórico da conta não são apagados.`)) return;
    backupNow("antes de apagar um ciclo");
    updateStore((x) => { x.strategies = x.strategies.filter((y) => y.id !== c.id); if (x.view === c.id) x.view = "active"; });
  };
  return (
    <Panel className="p-4">
      {list.length === 0 && <p className="pb-3 text-[14px] text-muted">Nenhum ciclo ainda.</p>}
      <ul className="divide-y divide-line">
        {list.map((c) => {
          const r = res(c.id);
          return (
            <li key={c.id} className="py-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold">{c.name} {c.status === "active" && <span className="ml-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">atual</span>}</p>
                  <p className="text-[13px] text-muted">{fmtZoned(c.startAt, c.tz)}{c.endAt ? ` → ${fmtZoned(c.endAt, c.tz)}` : " → hoje"} · {c.tz.replace("_", " ")}</p>
                  <p className="num text-[13px] text-muted">Início: {c.snapshot ? `${fmtMoney(c.snapshot.equityUsd, "USD")} (${SRC[c.snapshot.source]})` : "sem patrimônio inicial"}{r != null ? ` · resultado ${fmtMoney(r, "USD", { signed: true })}` : ""}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {c.status === "active" && <Button size="sm" onClick={() => setSheet({ mode: "edit", edit: c })}>Editar</Button>}
                  {c.status === "closed" && <Button size="sm" variant="ghost" className="text-loss" onClick={() => remove(c)}>Apagar</Button>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <Button variant="primary" className="mt-3 w-full" onClick={() => setSheet({ mode: "new" })}>Novo ciclo</Button>
      {sheet && <StrategySheet mode={sheet.mode} edit={sheet.edit} onClose={() => setSheet(null)} />}
    </Panel>
  );
}

function RawHistory() {
  useDataVersion();
  const h = hlState().history;
  const s = getStore();
  const csvRaw = () => {
    if (!h) return;
    const rows = [["tipo", "data_utc", "moeda", "lado", "preco", "quantidade", "taxa", "pnl_fechado", "valor_usd", "descricao", "chave"],
      ...h.fills.map((x) => ["execucao", new Date(x.time).toISOString(), x.coin, x.side, x.px, x.sz, x.fee, x.closedPnl, "", x.dir, x.key]),
      ...h.ledger.map((x) => ["movimentacao", new Date(x.time).toISOString(), "USDC", x.kind, "", "", "", "", x.amount, x.label, x.key]),
      ...h.funding.map((x) => ["funding", new Date(x.time).toISOString(), x.coin, "", "", "", "", "", x.usd, "", x.key])];
    const text = "\uFEFF" + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    a.download = `hyperliquid-historico-bruto-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  };
  return (
    <Panel className="space-y-2 p-4 text-[14px] text-ink-2">
      {h ? (
        <>
          <p className="num">{h.fills.length} execuções · {h.ledger.length} movimentações · {h.funding.length} pagamentos de funding · {h.accountValue.length} pontos de valor da conta</p>
          <p className="text-[13px] text-muted">Última sincronização {new Date(h.at).toLocaleString("pt-BR")}. Sincronizações repetidas não duplicam registros (cada um tem uma chave única).{h.truncated ? " A API limitou o histórico mais antigo." : ""}</p>
          <Button className="w-full" onClick={csvRaw}><Download className="size-4" />Baixar histórico bruto (CSV)</Button>
        </>
      ) : <p className="text-muted">{s.cycles.length} ciclos de operação e {s.flows.length} aportes/retiradas lançados à mão. Nada é apagado ao criar ciclos.</p>}
    </Panel>
  );
}

export default function SettingsPage() {
  const v = useDataVersion();
  const s = getStore();
  return (
    <div className="max-w-3xl space-y-6 pt-5">
      <h1 className="text-[20px] font-semibold tracking-tight">Configurações e Integrações</h1>
      {!storageAvailable() && <Notice tone="loss">O navegador está bloqueando o armazenamento local (modo privado?). Nada será salvo.</Notice>}
      {s.migratedNote && <Notice tone="info">{s.migratedNote}</Notice>}
      <section aria-label="Hyperliquid">
        <SectionTitle sub="Conta da Estratégia BTC/USDC: posição, saldo e operações, somente leitura">Hyperliquid</SectionTitle>
        <Panel className="p-4"><HlConnect /></Panel>
      </section>
      <section aria-label="Outras integrações">
        <SectionTitle sub="Entram no Portfólio Consolidado, nunca no resultado da estratégia">Outras integrações</SectionTitle>
        <Panel className="divide-y divide-line">
          {[["OKX", "API v5 somente leitura, via gateway seguro (Fase 4b)"], ["Carteiras EVM / Rabby", "endereço público, modo observação (Fase 4a)"], ["Bitcoin", "endereços públicos ou xpub (Fase 4a)"], ["Solana", "endereço público (Fase 4a)"], ].map(([n, d]) => (
            <div key={n} className="flex items-center gap-3 px-4 py-3"><span className="size-2 rounded-full bg-muted/40" aria-hidden /><span className="min-w-0 flex-1"><span className="block text-[14px]">{n}</span><span className="block text-[12px] text-muted">{d}</span></span><span className="lbl">não conectada</span></div>
          ))}
        </Panel>
        <p className="mt-2 text-[12px] text-muted">Cadastro manual e importação CSV de saldos: em <a href="#/portfolio" className="text-accent">Portfólio → Adicionar ativo / CSV</a>.</p>
      </section>
      <section aria-label="Ciclos da estratégia">
        <SectionTitle sub="Cada ciclo mede a estratégia a partir do próprio início">Ciclos da estratégia</SectionTitle>
        <Cycles />
      </section>
      <section aria-label="Histórico bruto">
        <SectionTitle sub="Guardado para auditoria; não entra nos ciclos fora do período deles">Histórico bruto</SectionTitle>
        <RawHistory />
      </section>
      <section aria-label="Preferências"><SectionTitle>Preferências</SectionTitle><Prefs key={`p${v}`} /></section>
      <section aria-label="Backup"><SectionTitle>Backup</SectionTitle><Backup /></section>
      <Rules key={`r${v}`} />
      <p className="text-[12px] leading-relaxed text-muted">Somente acompanhamento: o app não conecta à corretora, não pede chave privada nem executa ordens. Cotações: Binance, CoinGecko, AwesomeAPI e alternative.me.</p>
    </div>
  );
}
