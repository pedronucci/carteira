"use client";
/** Alertas locais (com o app aberto). Com o app fechado: gateway + Web Push (ver docs/ALERTAS.md). */
import { useState } from "react";
import { Bell, Trash2 } from "lucide-react";
import { useDataVersion } from "@/lib/api";
import { addRule, ALERT_TYPES, alerts, markSeen, removeRule, toggleRule } from "@/lib/alerts";
import { alertContext } from "@/lib/intel/views";
import { Button, Field, Notice, Panel, PanelHead, cn } from "@/components/ui";
import { toast } from "@/components/toaster";

const fmtTh = (unit: string, v: number | undefined) => v == null ? "" : unit === "usd" ? `US$ ${v.toLocaleString("pt-BR")}` : unit === "pct" ? `${(v * 100).toLocaleString("pt-BR")}%` : unit === "rate" ? `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%/h` : unit === "x" ? `${v}×` : unit === "btc" ? `${v} BTC` : "";

export default function AlertsPage() {
  useDataVersion();
  const a = alerts();
  const [type, setType] = useState(ALERT_TYPES[0]!.type);
  const [val, setVal] = useState("");
  const [cool, setCool] = useState("60");
  const def = ALERT_TYPES.find((t) => t.type === type)!;
  const perm = typeof Notification !== "undefined" ? Notification.permission : "unsupported";
  const add = () => {
    const raw = Number(val.replace(/\s/g, "").replace(",", "."));
    if (def.unit !== "none" && !(raw > 0)) return toast("Informe um valor maior que zero.", "loss");
    const th = def.unit === "pct" || def.unit === "rate" ? raw / 100 : raw;
    let ref: number | null = null;
    try { const c = alertContext(); ref = type === "FUNDING_CHANGE" ? c.funding : type === "EXPOSURE_CHANGE" ? c.btcNet : null; } catch { /* sem dados */ }
    if ((type === "FUNDING_CHANGE" || type === "EXPOSURE_CHANGE") && ref == null) return toast("Sem dado de referência agora; tente quando o mercado/posições carregarem.", "loss");
    addRule(type, def.unit === "none" ? 0 : th, Number(cool) || 60, ref);
    setVal(""); toast("Alerta criado.", "gain");
  };
  return (
    <div className="max-w-3xl pt-5">
      <h1 className="text-[20px] font-semibold tracking-tight">Alertas</h1>
      <p className="mb-4 text-[12px] text-muted">Avaliados com o app aberto, no máximo a cada 30 s. Disparam quando a condição passa a ser verdadeira, respeitando o intervalo mínimo.</p>
      {perm !== "granted" && perm !== "unsupported" && <div className="mb-3"><Notice tone="info">Para receber notificação do sistema (além do aviso no app), permita notificações. <button className="ml-1 text-accent" onClick={() => Notification.requestPermission().then(() => toast("Preferência de notificação salva.", "neutral"))}>Permitir</button></Notice></div>}
      <Panel className="mb-4 space-y-3 p-4">
        <label className="block"><span className="mb-1.5 block text-[12px] font-medium text-muted">Condição</span>
          <select value={type} onChange={(e) => setType(e.target.value as typeof type)} className="h-11 w-full rounded-md border border-line-strong bg-bg px-3 text-[16px] text-ink focus:border-accent focus:outline-none md:text-[14px]">{ALERT_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}</select></label>
        <div className="grid grid-cols-2 gap-3">
          {def.unit !== "none" && <Field label="Valor" inputMode="decimal" placeholder={def.hint} value={val} onChange={(e) => setVal(e.target.value)} />}
          <Field label="Intervalo mínimo (min)" inputMode="numeric" value={cool} onChange={(e) => setCool(e.target.value)} />
        </div>
        <Button variant="primary" className="w-full" onClick={add}><Bell className="size-4" />Criar alerta</Button>
      </Panel>
      <Panel className="mb-4 overflow-hidden">
        <PanelHead title="Regras" right={`${a.rules.length}`} />
        {a.rules.length ? <ul className="divide-y divide-line">{a.rules.map((r) => {
          const d = ALERT_TYPES.find((t) => t.type === r.type)!;
          return (
            <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
              <input type="checkbox" checked={r.enabled} onChange={() => toggleRule(r.id)} aria-label="Ativo" className="size-4 accent-[#42d9d0]" />
              <span className={cn("flex-1", !r.enabled && "text-muted")}>{d.label} <span className="num">{fmtTh(d.unit, r.threshold)}</span><span className="block text-[11px] text-muted">intervalo {Math.round(r.cooldownSec / 60)} min{a.state[r.id]?.lastFiredAt ? ` · último disparo ${new Date(a.state[r.id]!.lastFiredAt! * 1000).toLocaleString("pt-BR")}` : ""}</span></span>
              <Button size="sm" variant="ghost" onClick={() => removeRule(r.id)} aria-label="Apagar regra"><Trash2 className="size-4" /></Button>
            </li>
          );
        })}</ul> : <p className="px-4 py-5 text-[13px] text-muted">Nenhuma regra. Sugestões: distância da liquidação abaixo de 20%, alavancagem acima de 3×, falha de sincronização.</p>}
      </Panel>
      <Panel className="overflow-hidden">
        <PanelHead title="Histórico" right={a.log.some((l) => !l.seen) ? <button className="text-[12px] text-accent" onClick={markSeen}>marcar como visto</button> : undefined} />
        {a.log.length ? <ul className="divide-y divide-line">{a.log.slice(0, 50).map((l) => <li key={l.id} className="flex gap-3 px-4 py-2 text-[13px]"><span className="num w-[110px] shrink-0 text-[11px] text-muted">{new Date(l.at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span><span className={cn(!l.seen && "font-medium text-ink")}>{l.message}</span></li>)}</ul>
          : <p className="px-4 py-5 text-[13px] text-muted">Nenhum alerta disparado.</p>}
      </Panel>
      <p className="mt-3 text-[11px] leading-relaxed text-muted">Uma página estática não monitora nada com o app fechado. Para isso: o gateway já guarda retratos por hora; o envio de notificação com o app fechado (Web Push) está descrito em docs/ALERTAS.md.</p>
    </div>
  );
}
