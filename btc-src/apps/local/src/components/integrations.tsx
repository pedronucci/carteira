"use client";
/** Integrações do Portfólio (somente leitura): Bitcoin, EVM/Rabby e Solana. OKX entra pelo gateway (Fase 4b). */
import { useState } from "react";
import { RefreshCw, Trash2, Wallet } from "lucide-react";
import { fmtRelative } from "@bst/domain";
import { useDataVersion } from "@/lib/api";
import { portfolio } from "@/lib/portfolio/db";
import { addConnectedAccount, removeConnectedAccount, syncAccount, type ConnKind } from "@/lib/connectors";
import { askWalletAddress, hasInjectedWallet } from "@/lib/local/hl";
import { Button, Field, Notice, Panel, Pill, Segmented, cn } from "./ui";
import { toast } from "./toaster";

const HELP: Record<ConnKind, { title: string; placeholder: string; hint: string }> = {
  bitcoin: { title: "Bitcoin", placeholder: "bc1q…, 3…, 1… ou xpub/ypub/zpub (um por linha)", hint: "Aceita endereços e chaves públicas estendidas. Com xpub, os endereços são derivados neste aparelho e consultados um a um na mempool.space." },
  evm: { title: "EVM / Rabby", placeholder: "0x… (endereço público)", hint: "Ethereum, Arbitrum, Base, Optimism e BNB Chain: saldo nativo e tokens verificados. Descoberta de outros tokens e histórico: com o gateway." },
  solana: { title: "Solana", placeholder: "endereço Solana (base58)", hint: "Saldo de SOL. Tokens SPL: com o gateway (o RPC público não lista tokens para páginas web)." },
};
const STATE: Record<string, { t: string; dot: string }> = { ok: { t: "sincronizada", dot: "bg-gain" }, sync: { t: "sincronizando", dot: "bg-accent animate-pulse" }, error: { t: "erro", dot: "bg-loss" } };

export function PortfolioIntegrations() {
  useDataVersion();
  const p = portfolio();
  const [kind, setKind] = useState<ConnKind>("bitcoin");
  const [name, setName] = useState("");
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const conn = p.accounts.filter((a) => a.kind === "bitcoin" || a.kind === "evm" || a.kind === "solana");
  const add = async () => {
    try {
      setBusy(true);
      const id = addConnectedAccount(kind, name, raw);
      setRaw(""); setName("");
      toast("Conta adicionada. Sincronizando…", "gain");
      await syncAccount(id);
      const st = portfolio().sync[id];
      toast(st?.state === "error" ? `Não foi possível ler: ${st.error}` : "Conta sincronizada.", st?.state === "error" ? "loss" : "gain");
    } catch (e) { toast((e as Error).message, "loss"); } finally { setBusy(false); }
  };
  const rabby = async () => { try { setRaw(await askWalletAddress()); setKind("evm"); if (!name) setName("Rabby"); } catch (e) { toast((e as Error).message, "loss"); } };
  return (
    <div className="space-y-3">
      <Panel className="divide-y divide-line">
        {conn.length === 0 && <p className="px-4 py-4 text-[13px] text-muted">Nenhuma carteira conectada.</p>}
        {conn.map((a) => {
          const st = p.sync[a.id];
          const s = st ? STATE[st.state]! : { t: "não sincronizada", dot: "bg-muted/50" };
          const addr = (a.config as { address?: string; addresses?: string[]; xkeys?: { key: string }[] } | undefined);
          const label = addr?.address ?? [...(addr?.addresses ?? []), ...(addr?.xkeys ?? []).map((x) => x.key)].map((x) => `${x.slice(0, 8)}…${x.slice(-6)}`).join(", ");
          return (
            <div key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className={cn("size-2 rounded-full", s.dot)} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-[14px]">{a.name}<Pill>{HELP[a.kind as ConnKind].title}</Pill></span>
                <span className="num block truncate text-[11px] text-muted">{label}</span>
                <span className={cn("block text-[11px]", st?.state === "error" ? "text-loss" : "text-muted")}>{s.t}{st?.at ? ` · ${fmtRelative(st.at / 1000)}` : ""}{st?.error ? ` · ${st.error}` : st?.info ? ` · ${st.info}` : ""}</span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => syncAccount(a.id)} disabled={st?.state === "sync"} aria-label="Sincronizar agora"><RefreshCw className={cn("size-4", st?.state === "sync" && "animate-spin")} /></Button>
              <Button size="sm" variant="ghost" onClick={() => { if (window.confirm(`Desconectar “${a.name}”? Os saldos dela saem do portfólio. Nada na carteira é alterado.`)) void removeConnectedAccount(a.id); }} aria-label="Desconectar"><Trash2 className="size-4" /></Button>
            </div>
          );
        })}
      </Panel>
      <Panel className="space-y-3 p-4">
        <Segmented full label="Tipo de carteira" value={kind} onChange={setKind} options={[{ value: "bitcoin", label: "Bitcoin" }, { value: "evm", label: "EVM / Rabby" }, { value: "solana", label: "Solana" }]} />
        <Field label="Nome" placeholder={HELP[kind].title} value={name} onChange={(e) => setName(e.target.value)} />
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-muted">{kind === "bitcoin" ? "Endereços ou chave pública estendida" : "Endereço público"}</span>
          <textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={kind === "bitcoin" ? 3 : 2} placeholder={HELP[kind].placeholder} autoCapitalize="off" autoCorrect="off" spellCheck={false}
            className="num w-full rounded-md border border-line-strong bg-bg px-3 py-2 text-[16px] text-ink placeholder:text-[#6b7d94] focus:border-accent focus:outline-none md:text-[13px]" />
          <span className="mt-1.5 block text-[12px] text-muted">{HELP[kind].hint}</span>
        </label>
        {kind === "bitcoin" && <Notice tone="info">Privacidade: uma xpub revela TODOS os endereços e o saldo dessa carteira para quem a tiver. Ela fica só neste aparelho, mas cada endereço derivado é consultado na mempool.space, que pode relacioná-los. Se preferir, informe só os endereços.</Notice>}
        <div className="flex gap-2">
          {kind === "evm" && hasInjectedWallet() && <Button onClick={rabby}><Wallet className="size-4" />Usar endereço da Rabby</Button>}
          <Button variant="primary" className="flex-1" onClick={add} loading={busy} disabled={!raw.trim()}>Conectar (somente leitura)</Button>
        </div>
        <p className="text-[11px] leading-relaxed text-muted">Nunca informe frase de recuperação (seed), passphrase BIP-39 ou chave privada: o terminal recusa e não precisa delas. No iPhone, a Rabby Mobile não injeta a carteira no Safari: copie o endereço no app e cole aqui.</p>
      </Panel>
    </div>
  );
}
