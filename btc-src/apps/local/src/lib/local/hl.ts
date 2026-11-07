/**
 * Hyperliquid — leitura pública pelo endereço da carteira (a mesma da Rabby).
 * Nenhuma chave, assinatura ou permissão de negociação: só a API /info, que é aberta.
 *
 * O que vem daqui:
 *  - ao vivo: saldo da conta (perp + spot), posição em BTC, entrada, alavancagem, liquidação, PnL;
 *  - histórico: execuções de BTC → ciclos; depósitos/saques → aportes/retiradas; funding por ciclo;
 *  - opcional: USDC/USDT parados na carteira na Arbitrum (RPC público).
 */

const API = "https://api.hyperliquid.xyz/info";
const KEY = "bst.hl.v2"; // cache; o histórico bruto é baixado de novo se a versão mudar
const ARB_RPC = ["https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com"];
const ARB_STABLES = [
  { sym: "USDC", addr: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" },
  { sym: "USDC.e", addr: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8" },
  { sym: "USDT", addr: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9" },
];
const STABLE = new Set(["USDC", "USDT", "USDT0", "USDE", "USDH", "USDHL"]);

export const isAddress = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a.trim());

export interface HlPosition { coin: string; szi: number; entryPx: number; leverage: number; levType: string; liqPx: number | null; upnl: number; marginUsed: number; posValue: number; fundingSinceOpen: number }
export interface HlBalance { coin: string; total: number; usd: number | null; where: "perp" | "spot" | "arb" }
export interface HlLive { at: number; mode: string; perpValue: number; withdrawable: number; balances: HlBalance[]; positions: HlPosition[]; total: number; arbTotal: number | null }
export interface HlState { address: string | null; live: HlLive | null; history: HlHistory | null; error: string | null; syncing: boolean }

let state: HlState = load();
const subs = new Set<() => void>();
export const hlState = () => state;
export const subscribeHl = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
function set(p: Partial<HlState>) {
  state = { ...state, ...p };
  try { localStorage.setItem(KEY, JSON.stringify({ ...state, syncing: false })); } catch { /* sem armazenamento */ }
  subs.forEach((f) => f());
}
function load(): HlState {
  try { const s = JSON.parse(localStorage.getItem(KEY) ?? "null"); if (s) return { ...s, syncing: false }; } catch { /* vazio */ }
  return { address: null, live: null, history: null, error: null, syncing: false };
}
export function clearHl() { set({ address: null, live: null, history: null, error: null }); }

async function info<T>(body: Record<string, unknown>): Promise<T> {
  let r: Response;
  try {
    r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new Error("Sem conexão com a Hyperliquid.");
  }
  if (r.status === 429) throw new Error("A Hyperliquid limitou as consultas. Tente de novo em um minuto.");
  if (!r.ok) throw new Error(`A Hyperliquid respondeu com erro ${r.status}.`);
  return r.json() as Promise<T>;
}

/** Busca paginada por tempo (a API devolve no máximo ~2000 itens por chamada). */
async function paged<T extends { time: number }>(body: Record<string, unknown>, startTime: number, max = 15): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  let from = startTime;
  for (let i = 0; i < max; i++) {
    const page = await info<T[]>({ ...body, startTime: from });
    if (!Array.isArray(page) || page.length === 0) return { rows, truncated: false };
    rows.push(...page);
    const lastT = Math.max(...page.map((x) => x.time));
    if (page.length < 500 || lastT <= from) return { rows, truncated: false };
    from = lastT + 1;
  }
  return { rows, truncated: true };
}

// ───────── ao vivo ─────────

type Ch = {
  marginSummary: { accountValue: string }; withdrawable: string;
  assetPositions: { position: { coin: string; szi: string; entryPx: string | null; leverage: { type: string; value: number }; liquidationPx: string | null; unrealizedPnl: string; marginUsed: string; positionValue: string; cumFunding?: { sinceOpen: string } } }[];
};
type Spot = { balances: { coin: string; total: string; hold: string }[] };

async function arbBalance(addr: string): Promise<number | null> {
  const data = (token: string) => ({ to: token, data: "0x70a08231" + addr.slice(2).toLowerCase().padStart(64, "0") });
  for (const rpc of ARB_RPC) {
    try {
      const r = await fetch(rpc, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ARB_STABLES.map((t, i) => ({ jsonrpc: "2.0", id: i, method: "eth_call", params: [data(t.addr), "latest"] }))),
      });
      if (!r.ok) continue;
      const out = (await r.json()) as { id: number; result?: string }[];
      if (!Array.isArray(out)) continue;
      return out.reduce((a, x) => a + (x.result && x.result !== "0x" ? Number(BigInt(x.result)) / 1e6 : 0), 0);
    } catch { /* tenta o próximo RPC */ }
  }
  return null;
}

export async function refreshLive(address: string, opts: { includeArb?: boolean; btcUsd?: number | null } = {}) {
  const user = address.trim().toLowerCase();
  try {
    const [ch, spot, mode, arb] = await Promise.all([
      info<Ch>({ type: "clearinghouseState", user }),
      info<Spot>({ type: "spotClearinghouseState", user }),
      info<string>({ type: "userAbstraction", user }).catch(() => "default"),
      opts.includeArb ? arbBalance(user) : Promise.resolve(null),
    ]);
    const positions: HlPosition[] = (ch.assetPositions ?? []).map(({ position: p }) => ({
      coin: p.coin, szi: Number(p.szi), entryPx: Number(p.entryPx ?? 0), leverage: p.leverage?.value ?? 1, levType: p.leverage?.type ?? "cross",
      liqPx: p.liquidationPx ? Number(p.liquidationPx) : null, upnl: Number(p.unrealizedPnl), marginUsed: Number(p.marginUsed),
      posValue: Number(p.positionValue), fundingSinceOpen: -Number(p.cumFunding?.sinceOpen ?? 0),
    })).filter((p) => p.szi !== 0);
    const unified = mode === "unifiedAccount" || mode === "portfolioMargin";
    const perpValue = Number(ch.marginSummary?.accountValue ?? 0);
    const balances: HlBalance[] = [];
    if (!unified && perpValue) balances.push({ coin: "USDC", total: perpValue, usd: perpValue, where: "perp" });
    for (const b of spot.balances ?? []) {
      const t = Number(b.total);
      if (!t) continue;
      const usd = STABLE.has(b.coin) ? t : (b.coin === "UBTC" || b.coin === "BTC") && opts.btcUsd ? t * opts.btcUsd : null;
      balances.push({ coin: b.coin, total: t, usd, where: "spot" });
    }
    const spotUsd = balances.filter((b) => b.where === "spot").reduce((a, b) => a + (b.usd ?? 0), 0);
    const upnl = positions.reduce((a, p) => a + p.upnl, 0);
    // Conta unificada: todo o colateral aparece no spot; o PnL aberto vem das posições.
    const total = unified ? spotUsd + upnl : perpValue + spotUsd;
    if (arb != null && arb > 0.005) balances.push({ coin: "USDC", total: arb, usd: arb, where: "arb" });
    set({ address: user, live: { at: Date.now(), mode, perpValue, withdrawable: Number(ch.withdrawable ?? 0), balances, positions, total, arbTotal: arb }, error: null });
  } catch (e) {
    set({ error: (e as Error).message });
  }
}

// ───────── histórico bruto (auditoria) ─────────

/** Execução (todas as moedas), compacta. */
export interface HlFill { key: string; time: number; coin: string; px: number; sz: number; side: "B" | "A"; dir: string; fee: number; closedPnl: number; startPosition: number }
export interface HlLedger { key: string; time: number; kind: "IN" | "OUT" | "INTERNAL"; amount: number; label: string; type: string }
export interface HlFunding { key: string; time: number; coin: string; usd: number }
export interface HlHistory {
  at: number; fills: HlFill[]; ledger: HlLedger[]; funding: HlFunding[];
  /** Valor oficial da conta ao longo do tempo (endpoint portfolio): [ms, usd] */
  accountValue: [number, number][]; pnl: [number, number][];
  truncated: boolean; syncs: number;
}

type RawFill = { coin: string; px: string; sz: string; side: "B" | "A"; time: number; startPosition: string; dir: string; closedPnl: string; fee: string; hash?: string; oid?: number; tid?: number };
type RawLedger = { time: number; hash?: string; delta: { type: string; usdc?: string; amount?: string; usdcValue?: string; token?: string; user?: string; destination?: string; toPerp?: boolean } };
type RawFunding = { time: number; hash?: string; delta: { coin: string; usdc: string } };
type Portfolio = [string, { accountValueHistory: [number, string][]; pnlHistory: [number, string][] }][];

export const localIso = (ms: number) => { const t = new Date(ms); const p2 = (n: number) => String(n).padStart(2, "0"); return `${t.getFullYear()}-${p2(t.getMonth() + 1)}-${p2(t.getDate())}T${p2(t.getHours())}:${p2(t.getMinutes())}`; };

function ledgerRow(r: RawLedger, me: string): HlLedger | null {
  const x = r.delta;
  const amt = Number(x.usdc ?? x.usdcValue ?? (x.token && STABLE.has(x.token) ? x.amount : 0) ?? 0);
  if (!amt) return null;
  const key = `l|${r.time}|${r.hash ?? ""}|${x.type}|${amt}`;
  const dirIn = (x.destination ?? "").toLowerCase() === me;
  const row = (kind: HlLedger["kind"], label: string): HlLedger => ({ key, time: r.time, kind, amount: amt, label, type: x.type });
  switch (x.type) {
    case "deposit": return row("IN", "via Arbitrum");
    case "withdraw": return row("OUT", "para Arbitrum");
    case "internalTransfer": case "send": case "spotTransfer": case "subAccountTransfer": return row(dirIn ? "IN" : "OUT", dirIn ? "recebido de outra conta" : "enviado para outra conta");
    case "vaultDeposit": return row("OUT", "para vault");
    case "vaultWithdraw": return row("IN", "resgate de vault");
    case "accountClassTransfer": return row("INTERNAL", x.toPerp ? "Spot → Perp" : "Perp → Spot");
    default: return null;
  }
}

const mergeBy = <T extends { key: string; time: number }>(old: T[], add: T[]) => {
  const m = new Map(old.map((x) => [x.key, x]));
  for (const x of add) m.set(x.key, x);
  return [...m.values()].sort((a, b) => a.time - b.time);
};

/** Sincronização incremental: busca a partir do último registro (com 1 h de folga) e junta sem duplicar. */
export async function refreshHistory(address: string, _opts: { includeArb?: boolean } = {}) {
  const user = address.trim().toLowerCase();
  set({ syncing: true });
  try {
    const prev = state.address === user ? state.history : null;
    const from = (rows: { time: number }[] | undefined) => (rows?.length ? Math.max(0, rows[rows.length - 1]!.time - 3600e3) : 0);
    const [f, l, fu, pf] = await Promise.all([
      paged<RawFill>({ type: "userFillsByTime", user, aggregateByTime: true }, from(prev?.fills)),
      paged<RawLedger>({ type: "userNonFundingLedgerUpdates", user }, from(prev?.ledger)),
      paged<RawFunding>({ type: "userFunding", user }, from(prev?.funding), 40),
      info<Portfolio>({ type: "portfolio", user }).catch(() => null),
    ]);
    const fills = f.rows.map((x): HlFill => ({ key: `f|${x.time}|${x.oid ?? ""}|${x.tid ?? ""}|${x.px}|${x.sz}|${x.side}`, time: x.time, coin: x.coin, px: Number(x.px), sz: Number(x.sz), side: x.side, dir: x.dir, fee: Number(x.fee), closedPnl: Number(x.closedPnl), startPosition: Number(x.startPosition) }));
    const ledger = l.rows.map((r) => ledgerRow(r, user)).filter((x): x is HlLedger => Boolean(x));
    const funding = fu.rows.map((x): HlFunding => ({ key: `u|${x.time}|${x.delta.coin}`, time: x.time, coin: x.delta.coin, usd: Number(x.delta.usdc) }));
    // valor oficial da conta: junta os períodos (dia, semana, mês, tudo) — os curtos têm mais pontos
    let av: [number, number][] = prev?.accountValue ?? [], pnl: [number, number][] = prev?.pnl ?? [];
    if (pf) {
      const avm = new Map(av), pm = new Map(pnl);
      for (const [period, v] of pf) {
        if (period.startsWith("perp")) continue;
        for (const [t, x] of v.accountValueHistory ?? []) avm.set(t, Number(x));
        for (const [t, x] of v.pnlHistory ?? []) pm.set(t, Number(x));
      }
      av = [...avm.entries()].sort((a, b) => a[0] - b[0]);
      pnl = [...pm.entries()].sort((a, b) => a[0] - b[0]);
    }
    set({
      address: user, error: null, syncing: false,
      history: {
        at: Date.now(), fills: mergeBy(prev?.fills ?? [], fills), ledger: mergeBy(prev?.ledger ?? [], ledger), funding: mergeBy(prev?.funding ?? [], funding),
        accountValue: av, pnl, truncated: Boolean(prev?.truncated) || f.truncated || l.truncated, syncs: (prev?.syncs ?? 0) + 1,
      },
    });
  } catch (e) {
    set({ error: (e as Error).message, syncing: false });
  }
}

// ───────── retrato em um instante passado ─────────

const cache = new Map<number, number>();
/** Preço do BTC (fechamento da vela de 1 h da Hyperliquid que contém o instante). */
export async function btcMarkAt(t: number): Promise<number | null> {
  const h = Math.floor(t / 3600e3) * 3600e3;
  if (cache.has(h)) return cache.get(h)!;
  try {
    const rows = await info<{ t: number; c: string; o: string }[]>({ type: "candleSnapshot", req: { coin: "BTC", interval: "1h", startTime: h - 3600e3, endTime: h + 3600e3 } });
    const row = rows.find((x) => x.t === h) ?? rows.filter((x) => x.t <= t).pop();
    if (!row) return null;
    const v = t - h < 60e3 ? Number(row.o) : Number(row.c);
    cache.set(h, v);
    return v;
  } catch { return null; }
}

/**
 * Valor de uma série [ms, valor] no instante t. Entre dois pontos, interpola só a parte que não é fluxo:
 * depósitos e saques (flows: [ms, ±usd]) entram inteiros no momento em que aconteceram.
 */
export function seriesAt(series: [number, number][], t: number, maxGap = 6 * 3600e3, flows: [number, number][] = []): number | null {
  if (!series.length) return null;
  let lo: [number, number] | null = null, hi: [number, number] | null = null;
  for (const p of series) { if (p[0] <= t) lo = p; else { hi = p; break; } }
  const fl = (a: number, b: number) => flows.reduce((sum, [ft, v]) => (ft > a && ft <= b ? sum + v : sum), 0);
  if (lo && t - lo[0] < 60e3) return lo[1] + fl(lo[0], t);
  if (lo && hi && hi[0] - lo[0] <= 2 * maxGap) {
    const drift = hi[1] - lo[1] - fl(lo[0], hi[0]);
    return lo[1] + fl(lo[0], t) + (drift * (t - lo[0])) / (hi[0] - lo[0]);
  }
  if (lo && t - lo[0] <= maxGap) return lo[1] + fl(lo[0], t);
  if (hi && hi[0] - t <= maxGap) return hi[1] - fl(t, hi[0]);
  return null;
}

/** Endereço da extensão da carteira (Rabby, MetaMask…). Só pede para ver o endereço: nenhuma assinatura. */
export async function askWalletAddress(): Promise<string> {
  const eth = (window as unknown as { ethereum?: { request: (a: { method: string }) => Promise<string[]> } }).ethereum;
  if (!eth) throw new Error("Nenhuma carteira encontrada neste navegador. No iPhone, cole o endereço da Rabby.");
  const [a] = await eth.request({ method: "eth_requestAccounts" });
  if (!a || !isAddress(a)) throw new Error("A carteira não devolveu um endereço.");
  return a.toLowerCase();
}
export const hasInjectedWallet = () => typeof window !== "undefined" && Boolean((window as unknown as { ethereum?: unknown }).ethereum);
