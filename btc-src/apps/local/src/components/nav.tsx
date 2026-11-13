"use client";
/**
 * Navegação do Terminal 5.0: barra lateral recolhível no computador, barra inferior com 5 acessos
 * no celular (Início, Estratégia BTC, Portfólio, Mercado, Mais) e cabeçalho com o estado das integrações.
 */
import { NexusTerrain } from "./nexus-art";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Activity, ArrowLeftRight, Bell, Bitcoin, ChartCandlestick, ChartLine, Ellipsis, Eye, EyeOff, Gauge, Newspaper, LayoutDashboard,
  Moon, NotebookPen, PanelLeftClose, PanelLeftOpen, Settings, Sun, Wallet, X,
} from "lucide-react";
import { fmtRelative } from "@bst/domain";
import { useDataVersion } from "@/lib/api";
import { useAppState, useFmt } from "@/lib/state";
import { getStore } from "@/lib/local/store";
import { hlState } from "@/lib/local/hl";
import { prices } from "@/lib/local/prices";
import { portfolio } from "@/lib/portfolio/db";
import { priceBook, refreshPortfolioPrices, subscribePortfolioPrices } from "@/lib/portfolio/engine";
import { CoinLogo } from "./coin-logo";
import { gatewayInfo } from "@/lib/connectors/okx";
import { alerts } from "@/lib/alerts";
import { cn, Segmented, toneCls, toneOf } from "./ui";
import { useFlash } from "./motion";

type Icon = ComponentType<{ className?: string; strokeWidth?: number }>;
export interface Module { href: string; label: string; short?: string; icon: Icon; match?: string[]; strategy?: boolean }

export const MODULES: Module[] = [
  {href:"/simulador",label:"Simulador de posições",short:"Simulador",icon:ChartCandlestick},
  { href: "/", label: "Visão Geral", short: "Início", icon: LayoutDashboard },
  { href: "/perpetuos", label: "Posições Perpétuas", short: "Perpétuos", icon: Activity },
  { href: "/portfolio", label: "Portfólio Consolidado", short: "Portfólio", icon: Wallet },
  { href: "/trading", label: "Trading", icon: ArrowLeftRight },
  { href: "/mercado", label: "Mercado", icon: ChartCandlestick, match: ["/mercado", "/mercado"] },
  { href: "/risco", label: "Risk Center", short: "Risco", icon: Gauge },
  { href: "/inteligencia", label: "Performance Analytics", short: "Performance", icon: ChartLine },
  { href: "/mercado-intel", label: "Market Intelligence", short: "Mercado", icon: Newspaper },
  { href: "/diario", label: "Trading Journal", short: "Diário", icon: NotebookPen },
  { href: "/ajustes", label: "Configurações e Integrações", short: "Ajustes", icon: Settings, match: ["/ajustes", "/ajustes"] },
];
const moduleOrder = ["/", "/perpetuos", "/portfolio", "/inteligencia", "/diario", "/mercado-intel", "/estrategia", "/risco", "/trading", "/mercado", "/simulador", "/ajustes"];
MODULES.sort((a,b) => moduleOrder.indexOf(a.href) - moduleOrder.indexOf(b.href));
const BOTTOM = ["/", "/perpetuos", "/portfolio", "/inteligencia"];

export function useActive() {
  const path = usePathname();
  return (m: Module) => (m.href === "/" ? path === "/" : (m.match ?? [m.href]).some((p) => path === p || path.startsWith(p + "/")));
}

/** Marca do terminal. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={cn("size-10 shrink-0 nexus-mark", className)} aria-hidden>
      <defs><linearGradient id="nexus-mark"><stop stopColor="#efffff"/><stop offset=".45" stopColor="#00e5df"/><stop offset="1" stopColor="#066576"/></linearGradient></defs>
      <path d="M50 4L96 88H60L50 69 40 88H4Z" fill="url(#nexus-mark)"/>
      <path d="M50 25L30 66H44L50 54 57 66H70Z" fill="#06171e"/><path d="M50 4V25L30 66 4 88Z" fill="#c9ffff" opacity=".4"/>
    </svg>
  );
}

/** Estado das fontes de dados, para o cabeçalho e os ajustes. */
export function useIntegrations() {
  useDataVersion();
  const s = getStore();
  const hl = hlState();
  const sp = prices().spot;
  const hlOn = Boolean(s.settings.hl?.address);
  const hlFresh = Boolean(hl.live && Date.now() - hl.live.at < 10 * 60e3);
  const conn = portfolio().accounts.filter((a) => a.kind === "bitcoin" || a.kind === "evm" || a.kind === "solana");
  const st = conn.map((a) => portfolio().sync[a.id]?.state);
  const wallets = { key: "wallets", label: "Carteiras", state: (!conn.length ? "none" : st.includes("error") ? "error" : st.includes("sync") ? "sync" : "ok") as "ok" | "error" | "sync" | "none", at: Math.max(0, ...conn.map((a) => portfolio().sync[a.id]?.at ?? 0)) || null, detail: conn.length ? `${conn.length} conectada(s)` : "nenhuma" };
  return [
    { key: "prices", label: "Cotações", state: !sp?.btcUsd ? "off" : sp.stale ? "stale" : "ok", at: sp?.at ?? null, detail: sp?.source || "—" },
    { key: "hl", label: "Hyperliquid", state: !hlOn ? "none" : hl.error ? "error" : hl.syncing ? "sync" : hlFresh ? "ok" : "stale", at: hl.live?.at ?? null, detail: hl.error ?? (hlOn ? "somente leitura" : "não conectada") },
    wallets,
    ...(gatewayInfo().ok ? [(() => { const o = portfolio().sync["okx-trading"]; const conn = portfolio().accounts.some((x) => x.kind === "okx");
      return { key: "okx", label: "OKX", state: (!conn ? "none" : !o ? "stale" : o.state === "ok" && Date.now() - o.at > 30 * 60e3 ? "stale" : o.state) as "ok" | "stale" | "sync" | "error" | "none", at: o?.at ?? null, detail: conn ? o?.error ?? "somente leitura" : "não conectada" }; })()] : []),
  ] as { key: string; label: string; state: "ok" | "stale" | "sync" | "error" | "off" | "none"; at: number | null; detail: string }[];
}
const DOT: Record<string, string> = { ok: "bg-gain", sync: "bg-accent animate-pulse", stale: "bg-warn", error: "bg-loss", off: "bg-loss", none: "bg-muted/60" };
const STATE_TXT: Record<string, string> = { ok: "ao vivo", sync: "sincronizando", stale: "desatualizado", error: "erro", off: "sem dados", none: "não conectada" };

function IntegrationChips() {
  const list = useIntegrations();
  return (
    <div className="flex items-center gap-3 overflow-hidden">
      {list.map((i) => (
        <span key={i.key} className="num flex shrink-0 items-center gap-1.5 text-[11px] text-muted" title={`${i.label}: ${STATE_TXT[i.state]} · ${i.detail}`}>
          <span className={cn("size-1.5 rounded-full", DOT[i.state])} aria-hidden />
          <span className="text-ink-2">{i.label}</span>
          <span className="hidden sm:inline">{i.state === "ok" && i.at ? fmtRelative(i.at / 1000) : STATE_TXT[i.state]}</span>
        </span>
      ))}
    </div>
  );
}

function BtcTicker() {
  useDataVersion();
  const f = useFmt();
  const cd = prices().usd;
  const px = prices().spot?.btcUsd ?? null;
  const prev = cd.length >= 2 ? cd[cd.length - 2]!.c : null;
  const chg = px && prev ? px / prev - 1 : null;
  const flash = useFlash(px);
  return (
    <span className="num flex shrink-0 items-center gap-1.5 text-[12px]">
      <span className="font-semibold text-btc">BTC</span><span className={cn("px-0.5 text-ink", flash && `flash-${flash}`)}>{px ? f.px(px) : "—"}</span>
      {chg != null && <span className={toneCls(toneOf(chg))}>{f.pct(chg)}</span>}
    </span>
  );
}

const TICK_COINS = ["ETH", "HYPE", "SOL"] as const;
/** Faixa de cotações (ETH, HYPE, SOL) que corre pela barra do topo; atualiza a cada minuto e pausa ao passar o mouse. */
function CoinMarquee({ className }: { className?: string }) {
  const f = useFmt();
  const [, bump] = useState(0);
  useEffect(() => {
    const un = subscribePortfolioPrices(() => bump((n) => n + 1));
    const id = setInterval(() => { if (document.visibilityState === "visible") void refreshPortfolioPrices(); }, 60e3);
    return () => { un(); clearInterval(id); };
  }, []);
  const book = priceBook();
  const items = TICK_COINS.map((c) => ({ c, px: book[c]?.usd ?? null, chg: book[c]?.change24h ?? null }));
  const row = (dup: boolean) => (
    <div className="flex shrink-0 items-center gap-6 pr-6" aria-hidden={dup || undefined}>
      {items.map((i) => (
        <span key={i.c} className="num flex shrink-0 items-center gap-1.5 text-[12px]">
          <CoinLogo symbol={i.c} size={14} /><span className="font-semibold text-ink-2">{i.c}</span>
          <span className="text-ink">{i.px != null ? f.px(i.px) : "—"}</span>
          {i.chg != null && <span className={toneCls(toneOf(i.chg))}>{f.pct(i.chg)}</span>}
        </span>
      ))}
    </div>
  );
  return (
    <div className={cn("ticker-mask group min-w-0 flex-1 overflow-hidden", className)} role="marquee" aria-label="Cotações de ETH, HYPE e SOL">
      <div className="ticker-track flex w-max">{row(false)}{row(true)}{row(true)}</div>
    </div>
  );
}

function AlertBell() {
  useDataVersion();
  const n = alerts().log.filter((l) => !l.seen).length;
  return (
    <Link href="/alertas" aria-label={n ? `Alertas: ${n} não vistos` : "Alertas"} className="relative grid size-9 place-items-center rounded-xl border border-line bg-surface/60 text-muted [@media(hover:hover)]:hover:border-line-hover [@media(hover:hover)]:hover:text-ink">
      <Bell className="size-[18px]" />{n > 0 && <span className="num absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-gold px-1 text-[9px] font-bold text-on-gold">{n > 9 ? "9+" : n}</span>}
    </Link>
  );
}

function TopBar() {
  const { hidden, toggleHidden, ccy, setCcy, theme, toggleTheme } = useAppState();
  return (
    <header className="pt-safe sticky top-0 z-30 border-b border-line bg-bg/80 backdrop-blur-xl">
      <div className="flex h-12 items-center gap-3 px-4 lg:px-5">
        <Link href="/" className="flex shrink-0 items-center gap-2 lg:hidden" aria-label="Dashboard"><Mark className="size-6" />
          <span className="text-[12px] font-semibold tracking-[0.08em] whitespace-nowrap">BST <span className="text-accent">5.1</span></span></Link>
        <div className="hidden min-w-0 flex-1 items-center gap-4 lg:flex"><BtcTicker /><span className="h-4 w-px bg-line-strong" aria-hidden /><CoinMarquee /><span className="hidden h-4 w-px bg-line-strong 2xl:block" aria-hidden /><div className="hidden 2xl:block"><IntegrationChips /></div></div>
        <div className="ml-auto flex items-center gap-1.5">
          <Segmented size="sm" label="Moeda" value={ccy} onChange={setCcy} options={[{ value: "BRL", label: "BRL" }, { value: "USD", label: "USD" }]} />
          <button onClick={toggleHidden} aria-label={hidden ? "Mostrar valores" : "Ocultar valores (modo privacidade)"} aria-pressed={hidden}
            className={cn("grid size-9 place-items-center rounded-xl border border-line bg-surface/60 [@media(hover:hover)]:hover:border-line-hover", hidden ? "text-accent" : "text-muted")}>
            {hidden ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
          </button>
          <button onClick={toggleTheme} aria-label={theme === "light" ? "Trocar para o tema escuro" : "Trocar para o tema claro"} title={theme === "light" ? "Tema escuro" : "Tema claro"}
            className="grid size-9 place-items-center rounded-xl border border-line bg-surface/60 text-muted transition-colors duration-150 [@media(hover:hover)]:hover:border-line-hover [@media(hover:hover)]:hover:text-ink">
            {theme === "light" ? <Moon className="size-[18px]" /> : <Sun className="size-[18px]" />}
          </button>
          <AlertBell />
          <Link href="/ajustes" aria-label="Configurações" className="hidden size-9 place-items-center rounded-md text-muted lg:grid [@media(hover:hover)]:hover:bg-surface-2 [@media(hover:hover)]:hover:text-ink"><Settings className="size-[18px]" /></Link>
        </div>
      </div>
      <div className="flex items-center gap-3 border-t border-line px-4 py-1.5 lg:hidden"><BtcTicker /><span className="h-3 w-px bg-line-strong" aria-hidden /><CoinMarquee /></div>
    </header>
  );
}

function Sidebar() {
  const active = useActive();
  const [open, setOpen] = useState(() => { try { return localStorage.getItem("bst.nav.open") !== "0"; } catch { return true; } });
  const toggle = () => setOpen((o) => { try { localStorage.setItem("bst.nav.open", o ? "0" : "1"); } catch { /* */ } return !o; });
  return (
    <aside className={cn("nexus-sidebar sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-sidebar/85 backdrop-blur-xl transition-[width] duration-200 lg:flex", open ? "w-[242px]" : "w-[60px]")}>
      <div className="flex h-[112px] items-center gap-3 border-b border-line px-[14px]">
        <Mark className="size-12" />
        {open && <span className="min-w-0 leading-tight"><span className="block truncate text-[12px] font-semibold tracking-[0.06em]">BITCOIN<br />STRATEGY</span><span className="block text-[11px] tracking-[0.06em] text-muted"><span className="text-accent">TERMINAL</span></span></span>}
      </div>
      <nav className="relative z-10 flex-1 space-y-1.5 overflow-y-auto p-2" aria-label="Módulos">
        {MODULES.map((m) => {
          const on = active(m);
          return (
            <Link key={m.href} href={m.href} title={open ? undefined : m.label} aria-current={on ? "page" : undefined}
              className={cn("group relative flex h-11 items-center gap-3 rounded-xl border px-2.5 text-[13px] font-medium transition-colors duration-150",
                on ? "border-accent/70 bg-accent-soft text-ink shadow-[inset_0_0_20px_#00e5df20,0_0_14px_#00e5df18]" : "border-transparent text-ink-2 [@media(hover:hover)]:hover:bg-surface-2/70 [@media(hover:hover)]:hover:text-ink")}>
              <m.icon className={cn("size-[18px] shrink-0", !on && m.strategy && "text-gold/80")} strokeWidth={1.75} />
              {open && <span className="truncate">{m.label}</span>}
            </Link>
          );
        })}
      </nav>
      <NexusTerrain />
      <button onClick={toggle} className="flex h-10 items-center gap-3 border-t border-line px-[19px] text-[12px] text-muted [@media(hover:hover)]:hover:text-ink" aria-label={open ? "Recolher menu" : "Expandir menu"}>
        {open ? <PanelLeftClose className="size-[18px]" /> : <PanelLeftOpen className="size-[18px]" />}{open && "Recolher"}
      </button>
    </aside>
  );
}

function MoreSheet({ onClose }: { onClose: () => void }) {
  const active = useActive();
  const rest = MODULES.filter((m) => !BOTTOM.includes(m.href));
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fade-in fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content aria-describedby={undefined} className="sheet-in fixed inset-x-0 bottom-0 z-50 rounded-t-xl border-t border-line bg-surface pb-[calc(env(safe-area-inset-bottom)+12px)]">
          <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <Dialog.Title className="text-[15px] font-semibold">Mais módulos</Dialog.Title>
            <Dialog.Close aria-label="Fechar" className="-mr-2 grid size-10 place-items-center rounded-md text-muted"><X className="size-5" /></Dialog.Close>
          </div>
          <nav className="grid grid-cols-2 gap-2 px-4 pb-2">
            {rest.map((m) => (
              <Link key={m.href} href={m.href} onClick={onClose} className={cn("flex h-14 items-center gap-3 rounded-md border px-3 text-[13px]", active(m) ? "border-accent/50 bg-accent-soft text-ink" : "border-line bg-surface-2 text-ink-2")}>
                <m.icon className="size-5 shrink-0 text-accent" strokeWidth={1.75} /><span className="leading-tight">{m.label}</span>
              </Link>
            ))}
          </nav>
          <p className="px-5 pt-2 text-[11px] leading-relaxed text-muted">Somente acompanhamento: o terminal não pede chave privada nem frase de recuperação e não envia ordens.</p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function BottomNav() {
  const active = useActive();
  const [more, setMore] = useState(false);
  const items = MODULES.filter((m) => BOTTOM.includes(m.href));
  const moreOn = MODULES.some((m) => !BOTTOM.includes(m.href) && active(m));
  const cls = (on: boolean) => cn("flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl text-[10.5px] font-semibold transition-colors", on ? "bg-accent-soft text-accent ring-1 ring-accent/45" : "text-ink-2");
  return (
    <>
      <nav className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+8px)] z-40 flex gap-0.5 rounded-3xl border border-line-strong bg-bg/85 p-1.5 shadow-[0_20px_40px_-14px_var(--shadow-pop)] backdrop-blur-2xl lg:hidden" aria-label="Principal">
        {items.map((m) => (
          <Link key={m.href} href={m.href} aria-current={active(m) ? "page" : undefined} className={cls(active(m))}>
            <m.icon className="size-[22px]" strokeWidth={active(m) ? 2.1 : 1.75} />{m.short ?? m.label}
          </Link>
        ))}
        <button onClick={() => setMore(true)} className={cls(moreOn)} aria-label="Mais módulos"><Ellipsis className="size-[22px]" strokeWidth={1.75} />Mais</button>
      </nav>
      {more && <MoreSheet onClose={() => setMore(false)} />}
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  return (
    <div className={cn("flex min-h-dvh", path === "/" && "nexus-home")}>
      <Sidebar />
      <div className="min-w-0 flex-1">
        <TopBar />
        <main className="mx-auto max-w-[1760px] px-4 pb-[calc(env(safe-area-inset-bottom)+104px)] lg:px-6 lg:pb-12">{children}</main>
      </div>
      <BottomNav />
    </div>
  );
}

/** Abas internas de um módulo (ex.: Estratégia → Monitor · Performance · Transações). */
export function SubNav({ items }: { items: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav className="no-scrollbar -mx-4 mb-1 flex overflow-x-auto border-b border-line px-2 lg:mx-0 lg:px-0" aria-label="Seções">
      {items.map((i) => {
        const on = path === i.href;
        return (
          <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined}
            className={cn("relative flex h-10 shrink-0 items-center px-3 text-[13px] font-medium whitespace-nowrap", on ? "text-ink" : "text-muted [@media(hover:hover)]:hover:text-ink-2")}>
            {i.label}{on && <span className="absolute inset-x-3 bottom-0 h-[2px] bg-gold" aria-hidden />}
          </Link>
        );
      })}
    </nav>
  );
}
export const STRATEGY_TABS = [
  { href: "/estrategia/performance", label: "Performance" },
  { href: "/estrategia/transacoes", label: "Transações" },
  { href: "/estrategia/ciclos", label: "Ciclos" },
];
