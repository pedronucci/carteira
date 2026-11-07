"use client";
/** OKX (API v5, somente leitura) pelo gateway seguro. As credenciais nunca ficam no navegador. */
import { useEffect, useState } from "react";
import { RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { fmtRelative } from "@bst/domain";
import { useDataVersion } from "@/lib/api";
import { portfolio } from "@/lib/portfolio/db";
import { gatewayInfo, okxConnect, okxRevoke, okxStatus, syncOkx, type OkxMeta } from "@/lib/connectors/okx";
import { Button, Field, Notice, Panel, cn } from "./ui";
import { toast } from "./toaster";

export function OkxConnect() {
  useDataVersion();
  const gw = gatewayInfo();
  const [st, setSt] = useState<{ connected: boolean; meta: OkxMeta | null } | null>(null);
  const [form, setForm] = useState({ apiKey: "", secret: "", passphrase: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (gw.ok) okxStatus().then(setSt).catch((e: Error) => setErr(e.message)); }, [gw.ok]);
  const sync = portfolio().sync["okx-trading"];

  if (!gw.checked) return <Panel className="px-4 py-3 text-[13px] text-muted">Verificando o gateway…</Panel>;
  if (!gw.ok) return (
    <Panel className="space-y-2 px-4 py-3 text-[13px] leading-relaxed text-ink-2">
      <p className="flex items-center gap-2"><span className="size-2 rounded-full bg-muted/50" aria-hidden />Não conectada.</p>
      <p className="text-muted">A OKX exige credenciais privadas, que não podem ficar numa página pública nem neste aparelho. Ela funciona quando o terminal é aberto pelo <b className="font-semibold text-ink-2">seu gateway na Cloudflare</b> (endereço próprio, com login), que guarda as chaves cifradas e só faz consultas de leitura. Passo a passo: docs/GATEWAY.md no repositório.</p>
    </Panel>
  );

  const connect = async () => {
    setBusy(true); setErr(null);
    try { const meta = await okxConnect(form.apiKey, form.secret, form.passphrase); setForm({ apiKey: "", secret: "", passphrase: "" }); setSt({ connected: true, meta }); toast("OKX conectada (somente leitura).", "gain"); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const revoke = async () => {
    if (!window.confirm("Desconectar a OKX? As credenciais são apagadas do gateway e os saldos da OKX saem do portfólio. Apague também a API Key no site da OKX.")) return;
    try { await okxRevoke(); setSt({ connected: false, meta: null }); toast("Credenciais da OKX apagadas do gateway.", "gain"); } catch (e) { toast((e as Error).message, "loss"); }
  };
  const stale = sync?.state === "ok" && Date.now() - sync.at > 30 * 60e3;
  const state = !st ? "…" : !st.connected ? "Não conectada" : sync?.state === "sync" ? "Sincronizando" : sync?.state === "error" ? "Erro" : stale ? "Dados desatualizados" : sync?.state === "ok" ? "Conectada" : "Conectada (aguardando a 1ª leitura)";
  const dot = !st?.connected ? "bg-muted/50" : sync?.state === "error" ? "bg-loss" : sync?.state === "sync" ? "bg-accent animate-pulse" : stale ? "bg-warn" : "bg-gain";

  return (
    <Panel className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className={cn("size-2 rounded-full", dot)} aria-hidden />
        <span className="flex-1 text-[14px]">{state}{st?.meta ? <span className="num ml-2 text-[12px] text-muted">chave {st.meta.keyHint} · {st.meta.perms.join(", ")}{st.meta.label ? ` · ${st.meta.label}` : ""}</span> : null}</span>
        {st?.connected && <>
          <Button size="sm" variant="ghost" onClick={() => syncOkx()} disabled={sync?.state === "sync"} aria-label="Sincronizar agora"><RefreshCw className={cn("size-4", sync?.state === "sync" && "animate-spin")} />Sincronizar</Button>
          <Button size="sm" variant="danger" onClick={revoke}><Trash2 className="size-4" />Desconectar e revogar</Button>
        </>}
      </div>
      {sync?.at ? <p className="text-[12px] text-muted">Última sincronização {fmtRelative(sync.at / 1000)} · categorias: conta de trading, conta de funding, Simple Earn, posições, depósitos e saques{sync.info && sync.info !== "somente leitura" ? ` · ${sync.info}` : ""}{sync.error ? ` · ${sync.error}` : ""}</p> : null}
      {err && <Notice tone="loss">{err}</Notice>}
      {st && !st.connected && (
        <div className="space-y-3">
          <Notice tone="info">Crie no site da OKX uma API Key só com a permissão <b>Read</b> (sem Trade e sem Withdraw). O gateway confere as permissões e recusa qualquer chave que possa operar ou sacar. A Passphrase aqui é a senha que você definiu ao criar a API Key, <b>não</b> a frase de recuperação de uma carteira.</Notice>
          <Field label="API Key" autoComplete="off" spellCheck={false} value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
          <Field label="Secret Key" type="password" autoComplete="off" value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} />
          <Field label="Passphrase da API" type="password" autoComplete="off" value={form.passphrase} onChange={(e) => setForm({ ...form, passphrase: e.target.value })} />
          <Button variant="primary" className="w-full" loading={busy} disabled={!form.apiKey || !form.secret || !form.passphrase} onClick={connect}><ShieldCheck className="size-4" />Testar e conectar (somente leitura)</Button>
          <p className="text-[11px] text-muted">As chaves vão uma única vez, por HTTPS, para o seu gateway, que as guarda cifradas. Elas nunca ficam neste aparelho, no GitHub nem em logs, e nunca são exibidas de novo.</p>
        </div>
      )}
    </Panel>
  );
}
