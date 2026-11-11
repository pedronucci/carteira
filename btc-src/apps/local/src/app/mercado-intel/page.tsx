"use client";
/**
 * Market Intelligence: notícias em português, calendário macro oficial, impacto no portfólio (por regras, sem IA),
 * alertas dentro do app e correlação com a performance. Somente leitura; só dados públicos via proxy; nada do portfólio sai do navegador.
 */
import { useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { dismissAlert, markRead, refreshMi, setAlertsOn, setProxy, type MiState } from "@/lib/market/feed";
import { useMarketIntel, type Scored } from "@/lib/market/use";
import { ASSETS, correlate, THEMES, type CalEvent, type ImpactCard, type Theme } from "@/lib/market/radar";
import { usePortfolio } from "@/lib/api";
import { portfolio } from "@/lib/portfolio/db";
import { Button, Notice, Panel, PanelHead, Pill, Segmented, cn } from "@/components/ui";

const NA = "Dados insuficientes";
const when = (t: number) => new Date(t).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const ago = (t: number, now: number) => { const m = Math.round((now - t) / 60e3); return m < 60 ? `${Math.max(m, 1)} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`; };
const pct = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2).replace(".", ",")}%`);
const sevTone = { alta: "loss", media: "gold", info: "neutral" } as const;
const sevLabel = { alta: "Atenção", media: "Observar", info: "Info" } as const;
const lvlTone = { alta: "accent", media: "gold", baixa: "neutral" } as const;

export function ProxySetup({ st }: { st: MiState }) {
  const [v, setV] = useState(st.proxyUrl);
  const [bad, setBad] = useState(false);
  return (
    <Panel>
      <PanelHead title="Proxy de notícias" sub="Cloudflare Worker público e somente leitura (nenhum dado seu é enviado)" />
      <div className="space-y-2.5 p-4 text-[13px]">
        {!st.proxyUrl && <Notice tone="info">Proxy não configurado. Depois do deploy do Worker (passo a passo em MARKET-INTELLIGENCE.md), cole o endereço abaixo. Sem ele não há notícias nem calendário, e nada é inventado.</Notice>}
        <div className="flex flex-wrap gap-2">
          <input aria-label="Endereço do proxy" inputMode="url" placeholder="https://bst-market-proxy.seu-usuario.workers.dev" value={v} onChange={(e) => { setV(e.target.value); setBad(false); }}
            className="num h-10 min-w-0 flex-1 rounded-md border border-line bg-surface-2 px-3 text-[13px] text-ink" />
          <Button variant="primary" size="sm" className="h-10" onClick={() => { const ok = setProxy(v); setBad(!ok); if (ok) void refreshMi(true); }}>Salvar</Button>
        </div>
        {bad && <p className="text-[12px] text-loss">Endereço inválido: use https://… (ou http://localhost para testes).</p>}
      </div>
    </Panel>
  );
}

function Cards({ cards }: { cards: ImpactCard[] }) {
  return (
    <Panel>
      <PanelHead title="Impacto no seu portfólio" sub="Regras fixas sobre suas posições, notícias e calendário" right={<Pill tone={cards.some((c) => c.severity === "alta") ? "loss" : "neutral"}>{cards.length}</Pill>} />
      {cards.length === 0 ? <p className="p-4 text-[13px] text-muted">Nenhuma regra disparada agora. Sem posições abertas ou sem eventos próximos, nada é destacado.</p> : (
        <ul className="divide-y divide-line">
          {cards.map((c) => (
            <li key={c.id} className="space-y-1.5 px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5"><Pill tone={sevTone[c.severity]}>{sevLabel[c.severity]}</Pill>{c.assets.slice(0, 4).map((a) => <Pill key={a}>{a}</Pill>)}</div>
                <button className="text-[11.5px] text-muted underline-offset-2 hover:underline" onClick={() => dismissAlert(c.id)} aria-label={`Dispensar: ${c.title}`}>Dispensar</button>
              </div>
              <p className="text-[13.5px] font-semibold leading-snug">{c.title}</p>
              <p className="text-[12.5px] leading-relaxed text-ink-2">{c.body}</p>
              <p className="text-[11px] text-muted">Regra: {c.rule}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Calendar({ events, now, sources }: { events: CalEvent[]; now: number; sources: MiState["calSources"] }) {
  return (
    <Panel>
      <PanelHead title="Calendário econômico" sub="Fontes oficiais · consenso: indisponível" />
      {events.length === 0 ? <p className="p-4 text-[13px] text-muted">{NA}: sem eventos carregados.</p> : (
        <ul className="divide-y divide-line">
          {events.slice(0, 12).map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
              <div className="min-w-0"><p className="truncate font-medium">{e.title}</p><p className="num text-[11.5px] text-muted">{when(e.start)} · {e.source}</p></div>
              <div className="flex shrink-0 flex-col items-end gap-1"><Pill tone={e.importance === "alta" ? "loss" : e.importance === "media" ? "gold" : "neutral"}>{e.importance}</Pill><span className="num text-[11px] text-muted">{e.start > now ? `em ${ago(now - (e.start - now), now)}` : "passou"}</span></div>
            </li>
          ))}
        </ul>
      )}
      <SourceLine sources={sources} />
    </Panel>
  );
}
function SourceLine({ sources }: { sources: MiState["calSources"] }) {
  if (!sources.length) return null;
  return <p className="border-t border-line px-4 py-2 text-[11.5px] text-muted">{sources.map((s) => `${s.name}${s.mode === "static" ? " (lista estática)" : ""}${s.coverageUntil ? ` · cobertura até ${new Date(s.coverageUntil).toLocaleDateString("pt-BR")}${s.coverageUntil < Date.now() ? " · EXPIRADA" : ""}` : ""}: ${s.ok ? "ok" : `falhou${s.error ? ` (${s.error})` : ""}`}`).join(" · ")}</p>;
}

function News({ news, now, read }: { news: Scored[]; now: number; read: string[] }) {
  const [asset, setAsset] = useState<string>("todos");
  const [theme, setTheme] = useState<Theme | "todos">("todos");
  const [lvl, setLvl] = useState<"todas" | "alta" | "media">("todas");
  const [q, setQ] = useState("");
  const list = news.filter((n) => (asset === "todos" || n.assets.includes(asset)) && (theme === "todos" || n.themes.includes(theme)) && (lvl === "todas" || n.level === lvl || (lvl === "media" && n.level === "alta")) && (!q.trim() || `${n.title} ${n.source}`.toLowerCase().includes(q.trim().toLowerCase())));
  const chip = (on: boolean) => cn("rounded-full border px-2.5 py-1 text-[12px] transition-colors", on ? "border-accent/50 bg-accent-soft text-ink" : "border-line text-muted hover:text-ink");
  return (
    <Panel>
      <PanelHead title="Notícias" sub="Em português · ordenadas por relevância para você" right={`${list.length} de ${news.length}`} />
      <div className="space-y-2 border-b border-line px-4 py-3">
        <input aria-label="Buscar notícias" placeholder="Buscar por título ou fonte" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 w-full rounded-md border border-line bg-surface-2 px-3 text-[13px] text-ink" />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Ativo">{["todos", ...ASSETS].map((a) => <button key={a} className={chip(asset === a)} onClick={() => setAsset(a)}>{a === "todos" ? "Todos os ativos" : a}</button>)}</div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tema">{[{ value: "todos", label: "Todos os temas" }, ...THEMES].map((t) => <button key={t.value} className={chip(theme === t.value)} onClick={() => setTheme(t.value as Theme | "todos")}>{t.label}</button>)}</div>
        <Segmented size="sm" label="Relevância" value={lvl} onChange={setLvl} options={[{ value: "todas", label: "Todas" }, { value: "media", label: "Média+" }, { value: "alta", label: "Alta" }]} />
      </div>
      {list.length === 0 ? <p className="p-4 text-[13px] text-muted">Nenhuma notícia com esses filtros.</p> : (
        <ul className="divide-y divide-line">
          {list.slice(0, 60).map((n) => (
            <li key={n.id} className={cn("px-4 py-3", read.includes(n.id) && "opacity-60")}>
              <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
                <Pill tone={lvlTone[n.level]}>{n.level} · {n.score}</Pill>{n.assets.map((a) => <Pill key={a}>{a}</Pill>)}<span>{n.source} · há {ago(n.publishedAt, now)}</span>
              </div>
              <a href={n.url} target="_blank" rel="noopener noreferrer" onClick={() => markRead(n.id)} className="inline-flex items-start gap-1.5 text-[14px] font-semibold leading-snug hover:underline">{n.title}<ExternalLink className="mt-1 size-3 shrink-0 text-muted" aria-hidden /></a>
              {n.summary && <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{n.summary}</p>}
              {n.themes.length > 0 && <p className="mt-1 text-[11px] text-muted">{n.themes.map((t) => THEMES.find((x) => x.value === t)?.label).join(" · ")}</p>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Correlation({ events, now }: { events: CalEvent[]; now: number }) {
  const pv = usePortfolio().data ?? null;
  const past = events.filter((e) => e.importance === "alta" && e.start < now && now - e.start <= 45 * 86400e3).sort((a, b) => b.start - a.start).slice(0, 6);
  const snaps = portfolio().snapshots;
  return (
    <Panel>
      <PanelHead title="Eventos × performance" sub="Após cada evento: variação da carteira (sem aportes/retiradas) / variação do BTC" />
      {past.length === 0 ? <p className="p-4 text-[13px] text-muted">{NA}: sem eventos de alta importância nos últimos 45 dias.</p> : (
        <div className="overflow-x-auto">
          <table className="num w-full min-w-[520px] whitespace-nowrap text-[12.5px]">
            <thead><tr className="text-[11px] uppercase text-muted"><th className="px-4 py-2 text-left font-medium">Evento</th>{["1h", "4h", "24h", "7d"].map((k) => <th key={k} className="px-2.5 py-2 text-right font-medium">{k}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              {past.map((e) => {
                const r = correlate(e.start, snaps, pv?.flows ?? [], now);
                return <tr key={e.id}><td className="px-4 py-2"><span className="font-medium">{e.kind}</span> <span className="text-muted">{when(e.start)}</span></td>{r.map((w) => <td key={w.k} className="px-2.5 py-2 text-right">{w.portfolioPct == null && w.btcPct == null ? <span className="text-muted">—</span> : <>{pct(w.portfolioPct)} <span className="text-muted">/ {pct(w.btcPct)}</span></>}</td>)}</tr>;
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-line px-4 py-2 text-[11.5px] text-muted">"—" = {NA} (sem retrato do portfólio perto do evento). Correlação não prova causa: outras coisas acontecem no mesmo período.</p>
    </Panel>
  );
}

export default function MercadoIntelPage() {
  const mi = useMarketIntel({ poll: true });
  const { st } = mi;
  return (
    <div className="pt-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight">Market Intelligence</h1>
          <p className="text-[12px] text-muted">Notícias em português e calendário oficial, cruzados com as suas posições por regras fixas. Sem IA e sem recomendação de compra ou venda.</p>
        </div>
        <div className="flex items-center gap-3 text-[12px] text-muted">
          <label className="flex cursor-pointer items-center gap-1.5"><input type="checkbox" checked={st.alertsOn} onChange={(e) => setAlertsOn(e.target.checked)} />Alertas no app</label>
          {st.proxyUrl && <Button size="sm" variant="secondary" loading={st.loading} onClick={() => void refreshMi(true)}><RefreshCw className="size-3.5" aria-hidden />Atualizar</Button>}
        </div>
      </div>
      {st.error && <div className="mb-3"><Notice tone="loss">Falha ao atualizar — {st.error}. Mostrando a última resposta guardada{st.newsAt ? ` (${when(st.newsAt)})` : ""}.</Notice></div>}
      {!st.proxyUrl ? <ProxySetup st={st} /> : (
        <div className="grid gap-4 lg:grid-cols-12">
          <div className="space-y-4 lg:order-2 lg:col-span-4 min-w-0"><Cards cards={mi.cards} /><Calendar events={mi.upcoming} now={mi.now} sources={st.calSources} /></div>
          <div className="space-y-4 lg:order-1 lg:col-span-8 min-w-0">
            <News news={mi.news} now={mi.now} read={st.read} />
            <Correlation events={st.events} now={mi.now} />
            <SourcesPanel st={st} />
          </div>
        </div>
      )}
    </div>
  );
}

function SourcesPanel({ st }: { st: MiState }) {
  return (
    <Panel>
      <PanelHead title="Fontes e privacidade" />
      <div className="space-y-2 p-4 text-[12.5px] leading-relaxed text-ink-2">
        <p>Notícias: {st.newsSources.length ? st.newsSources.map((s) => `${s.name} (${s.ok ? `${s.count ?? 0} itens` : "indisponível"})`).join(" · ") : "ainda não carregadas"}. Cada item abre na fonte original; o app guarda só título e um resumo curto.</p>
        <p>Calendário: Fed (lista fixa publicada pelo próprio Fed) e BLS (CPI, emprego, PPI). BEA e Tesouro dos EUA ainda não estão incluídos; consenso de mercado: indisponível (sem fonte pública gratuita confiável).</p>
        <p>O proxy só recebe pedidos GET sem parâmetros; nenhum dado do seu portfólio, carteira ou conta sai do navegador. A relevância e os cartões são calculados aqui, com as suas posições locais.</p>
        <details><summary className="cursor-pointer text-muted">Endereço do proxy</summary><div className="mt-2"><ProxySetup st={st} /></div></details>
      </div>
    </Panel>
  );
}
