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
export interface HlState { address: string | null; live: HlLive | null; history: HlHistory | null; error: string | null; syncing: boolean; storageError?: string | null }

let state: HlState = load();
const subs = new Set<() => void>();
export const hlState = () => state;
/** Histórico por endereço: mudar a conta principal não muda ciclos antigos. */
export function readHlAccount(address: string): HlState | null {
  const addr = address.toLowerCase();
  if (state.address === addr) return state;
  try {
    const saved = JSON.parse(localStorage.getItem(`${KEY}.account.${addr}`) ?? "null") as HlState | null;
    if (saved?.address === addr) return saved;
    const extras = JSON.parse(localStorage.getItem("bst.hl.extra.v1") ?? "null") as { accounts?: (HlState & { address: string })[] } | null;
    return extras?.accounts?.find((a) => a.address === addr) ?? null;
  } catch { return null; }
}
export const subscribeHl = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
function set(p: Partial<HlState>) {
  if (p.address && state.address && p.address !== state.address) {
    try { localStorage.setItem(`${KEY}.account.${state.address}`, JSON.stringify(state)); } catch { /* histórico atual continua intacto */ }
    state = { address: p.address, live: null, history: null, error: null, syncing: false };
  }
  state = { ...state, ...p };
  try { localStorage.setItem(KEY, JSON.stringify({ ...state, syncing: false, storageError: null })); state.storageError = null; }
  catch { state.storageError = "O armazenamento do navegador está cheio: o histórico da Hyperliquid não pôde ser salvo neste aparelho (os números de agora continuam certos)."; }
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
    r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  } catch {
    throw new Error("Sem conexão com a Hyperliquid.");
  }
  if (r.status === 429) throw new Error("A Hyperliquid limitou as consultas. Tente de novo em um minuto.");
  if (!r.ok) throw new Error(`A Hyperliquid respondeu com erro ${r.status}.`);
  return r.json() as Promise<T>;
}

/**
 * Busca paginada por tempo. Segundo a documentação oficial, userFillsByTime devolve no máximo 2000 itens por
 * resposta e só as 10.000 execuções mais recentes. A próxima página recomeça NO último instante recebido
 * (inclusivo), para não perder execuções do mesmo milissegundo; as repetidas saem na deduplicação por chave.
 */
async function paged<T extends { time: number }>(body: Record<string, unknown>, startTime: number, max = 15, pageSize = 500): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  let from = startTime;
  for (let i = 0; i < max; i++) {
    const page = await info<T[]>({ ...body, startTime: from });
    if (!Array.isArray(page) || page.length === 0) return { rows, truncated: false };
    rows.push(...page);
    const lastT = Math.max(...page.map((x) => x.time));
    if (page.length < pageSize) return { rows, truncated: false };
    from = lastT > from ? lastT : lastT + 1;
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

export const isUnifiedMode = (mode: string) => mode === "unifiedAccount" || mode === "portfolioMargin";
/**
 * Patrimônio oficial de uma conta Hyperliquid.
 * Conta unificada / portfolio margin: o saldo spot (spotClearinghouseState) JÁ é o patrimônio inteiro — o USDC spot
 * sobe e desce com o P&L aberto das posições. Somar o P&L de novo conta duas vezes (auditado contra o endpoint
 * `portfolio`, que é o valor que a Hyperliquid e as carteiras mostram). Conta padrão: perp (accountValue) + spot.
 */
export function hlEquity(mode: string, perpValue: number, spotUsd: number): number {
  return isUnifiedMode(mode) ? spotUsd : perpValue + spotUsd;
}

/** Lê o estado ao vivo de UMA conta (sem tocar no estado global). Usada pela conta principal e pelas adicionais. */
export async function fetchLive(address: string, opts: { includeArb?: boolean; btcUsd?: number | null } = {}): Promise<HlLive> {
  const user = address.trim().toLowerCase();
  const [ch, spot, mode, arb, mids] = await Promise.all([
    info<Ch>({ type: "clearinghouseState", user }),
    info<Spot>({ type: "spotClearinghouseState", user }),
    info<string>({ type: "userAbstraction", user }).catch(() => "default"),
    opts.includeArb ? arbBalance(user) : Promise.resolve(null),
    info<Record<string, string>>({ type: "allMids" }).catch(() => ({} as Record<string, string>)),
  ]);
  const positions: HlPosition[] = (ch.assetPositions ?? []).map(({ position: p }) => ({
    coin: p.coin, szi: Number(p.szi), entryPx: Number(p.entryPx ?? 0), leverage: p.leverage?.value ?? 1, levType: p.leverage?.type ?? "cross",
    liqPx: p.liquidationPx ? Number(p.liquidationPx) : null, upnl: Number(p.unrealizedPnl), marginUsed: Number(p.marginUsed),
    posValue: Number(p.positionValue), fundingSinceOpen: -Number(p.cumFunding?.sinceOpen ?? 0),
  })).filter((p) => p.szi !== 0);
  const unified = isUnifiedMode(mode);
  const perpValue = Number(ch.marginSummary?.accountValue ?? 0);
  const balances: HlBalance[] = [];
  if (!unified && perpValue) balances.push({ coin: "USDC", total: perpValue, usd: perpValue, where: "perp" });
  for (const b of spot.balances ?? []) {
    const t = Number(b.total);
    if (!t) continue;
    // outras moedas (HYPE, ETH…): preço médio da própria Hyperliquid; sem preço, fica de fora do total
    const mid = Number(mids?.[b.coin] ?? mids?.[b.coin.replace(/^U(?=[A-Z]{2,})/, "")] ?? NaN);
    const usd = STABLE.has(b.coin) ? t : (b.coin === "UBTC" || b.coin === "BTC") && opts.btcUsd ? t * opts.btcUsd : Number.isFinite(mid) && mid > 0 ? t * mid : null;
    balances.push({ coin: b.coin, total: t, usd, where: "spot" });
  }
  const spotUsd = balances.filter((b) => b.where === "spot").reduce((a, b) => a + (b.usd ?? 0), 0);
  const total = hlEquity(mode, perpValue, spotUsd);
  if (arb != null && arb > 0.005) balances.push({ coin: "USDC", total: arb, usd: arb, where: "arb" });
  return { at: Date.now(), mode, perpValue, withdrawable: Number(ch.withdrawable ?? 0), balances, positions, total, arbTotal: arb };
}

export async function refreshLive(address: string, opts: { includeArb?: boolean; btcUsd?: number | null } = {}) {
  const user = address.trim().toLowerCase();
  set({ address: user });
  try {
    const live = await fetchLive(user, opts);
    if (state.address !== user) return;
    set({ live, error: null });
  } catch (e) {
    if (state.address === user) set({ error: (e as Error).message });
  }
}

// ───────── histórico bruto (auditoria) ─────────

/** Execução (todas as moedas), compacta. */
export interface HlFill { key: string; time: number; coin: string; px: number; sz: number; side: "B" | "A"; dir: string; fee: number; closedPnl: number; startPosition: number;
  /** id da ordem que gerou a execução (permite saber se foi stop, take profit ou ordem comum) */ oid?: number; /** execução de liquidação */ liq?: boolean;
  /** moeda em que a taxa foi cobrada (spot: pode ser a moeda comprada) */ feeToken?: string }
/** Tipo de ordem (da lista de ordens históricas): stop, take profit, limite ou a mercado */
export type HlOrderKind = "SL" | "TP" | "LIM" | "MKT";
/** IN/OUT: fluxo externo · INTERNAL: entre spot e perp da mesma conta · INCOME: recompensa (resultado, não aporte) */
export interface HlLedger { key: string; time: number; kind: "IN" | "OUT" | "INTERNAL" | "INCOME"; amount: number; label: string; type: string;
  /** endereço da outra ponta em transferências (para reconhecer transferência entre contas próprias) */ peer?: string;
  /** taxa paga por esta conta na movimentação (saque: 1 USDC; envio). É custo, não fluxo de capital. */ fee?: number }
export interface HlFunding { key: string; time: number; coin: string; usd: number }
export interface HlHistory {
  at: number; fills: HlFill[]; ledger: HlLedger[]; funding: HlFunding[];
  /** Valor oficial da conta ao longo do tempo (endpoint portfolio): [ms, usd] */
  accountValue: [number, number][]; pnl: [number, number][];
  truncated: boolean; syncs: number;
  /** oid → tipo da ordem (para marcar execuções de stop / take profit). Mesclado de forma incremental. */
  orders?: Record<string, HlOrderKind>;
  /** 1 = as execuções guardadas já trazem o oid (as antigas são completadas uma vez, sem apagar nada) */
  oidV?: number;
  /** 2 = execuções individuais com chave pelo id do negócio (tid). Versões anteriores são re-sincronizadas. */
  v?: number;
}

type RawFill = { coin: string; px: string; sz: string; side: "B" | "A"; time: number; startPosition: string; dir: string; closedPnl: string; fee: string; hash?: string; oid?: number; tid?: number; liquidation?: unknown; feeToken?: string };
type RawLedger = { time: number; hash?: string; delta: { type: string; usdc?: string; amount?: string; usdcValue?: string; token?: string; user?: string; destination?: string; toPerp?: boolean; fee?: string } };
type RawFunding = { time: number; hash?: string; delta: { coin: string; usdc: string } };
type Portfolio = [string, { accountValueHistory: [number, string][]; pnlHistory: [number, string][] }][];

export const localIso = (ms: number) => { const t = new Date(ms); const p2 = (n: number) => String(n).padStart(2, "0"); return `${t.getFullYear()}-${p2(t.getMonth() + 1)}-${p2(t.getDate())}T${p2(t.getHours())}:${p2(t.getMinutes())}`; };

function ledgerRow(r: RawLedger, me: string): HlLedger | null {
  const x = r.delta;
  if (x.type === "rewardsClaim") {
    const v = Number(x.amount ?? 0);
    return v ? { key: `l|${r.time}|${r.hash ?? ""}|${x.type}|${v}`, time: r.time, kind: "INCOME", amount: v, label: "recompensa resgatada", type: x.type } : null;
  }
  const amt = Number(x.usdc ?? x.usdcValue ?? (x.token && STABLE.has(x.token) ? x.amount : 0) ?? 0);
  if (!amt) return null;
  const key = `l|${r.time}|${r.hash ?? ""}|${x.type}|${amt}`;
  const dirIn = (x.destination ?? "").toLowerCase() === me;
  const other = (dirIn ? x.user : x.destination)?.toLowerCase();
  // taxa: só quando esta conta paga (saque, ou envio em que ela é a origem). Recebido não tem taxa para quem recebe.
  const fee = Number(x.fee ?? 0);
  const paysFee = Number.isFinite(fee) && fee > 0 && (x.type === "withdraw" || (x.type !== "deposit" && !dirIn));
  const row = (kind: HlLedger["kind"], label: string): HlLedger => ({ key, time: r.time, kind, amount: amt, label, type: x.type, ...(other && /^0x[0-9a-f]{40}$/.test(other) ? { peer: other } : {}), ...(paysFee ? { fee } : {}) });
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

/** Versão do histórico guardado. 3 = movimentações trazem a taxa paga (histórico anterior é baixado de novo). */
export const HL_HISTORY_V = 3;

const mergeBy = <T extends { key: string; time: number }>(old: T[], add: T[]) => {
  const m = new Map(old.map((x) => [x.key, x]));
  for (const x of add) m.set(x.key, x);
  return [...m.values()].sort((a, b) => a.time - b.time);
};

/** Baixa (de forma incremental) o histórico de UMA conta e devolve o resultado já mesclado com `prev`. */
export async function fetchHistory(address: string, prev: HlHistory | null): Promise<HlHistory> {
  const user = address.trim().toLowerCase();
  const from = (rows: { time: number }[] | undefined) => (rows?.length ? Math.max(0, rows[rows.length - 1]!.time - 3600e3) : 0);
  // histórico guardado antes do campo oid: baixa as execuções de novo UMA vez e mescla por chave (nada é apagado)
  const backfill = Boolean(prev?.fills.length) && !prev?.oidV;
  const [f, l, fu, pf, ho] = await Promise.all([
    paged<RawFill>({ type: "userFillsByTime", user }, backfill ? 0 : from(prev?.fills), 15, 2000),
    paged<RawLedger>({ type: "userNonFundingLedgerUpdates", user }, from(prev?.ledger)),
    paged<RawFunding>({ type: "userFunding", user }, from(prev?.funding), 40),
    info<Portfolio>({ type: "portfolio", user }).catch(() => null),
    info<RawHistOrder[]>({ type: "historicalOrders", user }).catch(() => null),
  ]);
  const fills = f.rows.map((x): HlFill => ({ key: x.tid != null ? `f|${x.tid}` : `f|${x.time}|${x.oid ?? ""}|${x.px}|${x.sz}|${x.side}`, time: x.time, coin: x.coin, px: Number(x.px), sz: Number(x.sz), side: x.side, dir: x.dir, fee: Number(x.fee), closedPnl: Number(x.closedPnl), startPosition: Number(x.startPosition),
    ...(x.oid != null ? { oid: x.oid } : {}), ...(x.liquidation ? { liq: true } : {}), ...(x.feeToken && x.feeToken !== "USDC" ? { feeToken: x.feeToken } : {}) }));
  const orders: Record<string, HlOrderKind> = { ...(prev?.orders ?? {}) };
  for (const r of Array.isArray(ho) ? ho : []) { const k = orderKind(r.order); if (r.order?.oid != null && k) orders[String(r.order.oid)] = k; }
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
  return {
    at: Date.now(), fills: mergeBy(prev?.fills ?? [], fills), ledger: mergeBy(prev?.ledger ?? [], ledger), funding: mergeBy(prev?.funding ?? [], funding),
    accountValue: av, pnl, orders, oidV: 1, truncated: Boolean(prev?.truncated) || f.truncated || l.truncated || fu.truncated || (!prev && new Set(f.rows.map((x) => x.tid ?? `${x.time}${x.px}${x.sz}`)).size >= 10000), syncs: (prev?.syncs ?? 0) + 1, v: HL_HISTORY_V,
  };
}

/** Sincronização incremental: busca a partir do último registro (com 1 h de folga) e junta sem duplicar. */
export async function refreshHistory(address: string, _opts: { includeArb?: boolean } = {}) {
  const user = address.trim().toLowerCase();
  set({ address: user, syncing: true });
  try {
    // histórico de versões anteriores (execuções agregadas) é buscado de novo do zero: a Hyperliquid guarda tudo
    const prev = state.address === user && state.history?.v === HL_HISTORY_V ? state.history : null;
    const history = await fetchHistory(user, prev);
    if (state.address !== user) return;
    set({ error: null, syncing: false, history });
  } catch (e) {
    if (state.address === user) set({ error: (e as Error).message, syncing: false });
  }
}

// ───────── ordens, velas e universo de contratos (somente leitura) ─────────

type RawHistOrder = { order: { oid: number; orderType?: string; isTrigger?: boolean; reduceOnly?: boolean; isPositionTpsl?: boolean } };
/** Classifica o tipo de uma ordem pelo texto da Hyperliquid ("Stop Market", "Take Profit Limit", "Limit"…). */
export function orderKind(o: { orderType?: string; isTrigger?: boolean } | undefined): HlOrderKind | null {
  const t = (o?.orderType ?? "").toLowerCase();
  if (t.includes("take profit")) return "TP";
  if (t.includes("stop")) return "SL";
  if (t.includes("market")) return "MKT";
  if (t.includes("limit")) return "LIM";
  return null;
}

/** Ordem aberta na Hyperliquid (lida de frontendOpenOrders). Nunca é criada, alterada ou cancelada por este app. */
export interface HlOrder {
  oid: number; coin: string; side: "B" | "A"; sz: number; origSz: number | null; limitPx: number | null; triggerPx: number | null;
  isTrigger: boolean; orderType: string; reduceOnly: boolean; isPositionTpsl: boolean; triggerCondition: string; tif: string | null; at: number;
}
type RawOpenOrder = { coin: string; side: "B" | "A"; limitPx: string; sz: string; oid: number; timestamp: number; triggerCondition?: string; isTrigger?: boolean; triggerPx?: string; isPositionTpsl?: boolean; reduceOnly?: boolean; orderType?: string; origSz?: string; tif?: string | null };
export async function fetchOpenOrders(address: string): Promise<HlOrder[]> {
  const rows = await info<RawOpenOrder[]>({ type: "frontendOpenOrders", user: address.trim().toLowerCase() });
  const pos = (v: string | undefined) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    oid: r.oid, coin: r.coin, side: r.side, sz: Number(r.sz), origSz: pos(r.origSz), limitPx: pos(r.limitPx), triggerPx: pos(r.triggerPx), isTrigger: Boolean(r.isTrigger),
    orderType: r.orderType ?? "", reduceOnly: Boolean(r.reduceOnly), isPositionTpsl: Boolean(r.isPositionTpsl), triggerCondition: r.triggerCondition ?? "", tif: r.tif ?? null, at: r.timestamp,
  }));
}

/** Vela completa (com volume). t = abertura, T = fechamento, em ms. */
export interface HlCandle { t: number; T: number; o: number; h: number; l: number; c: number; v: number; n: number }
type RawCandle = { t: number; T: number; o: string; h: string; l: string; c: string; v: string; n: number };
export const HL_INTERVALS = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"] as const;
export type HlInterval = (typeof HL_INTERVALS)[number];
/** Velas de um contrato no intervalo [start, end]. A API devolve no máximo 5.000 velas por consulta. */
export async function fetchCandles(coin: string, interval: HlInterval, startTime: number, endTime: number): Promise<HlCandle[]> {
  const rows = await info<RawCandle[]>({ type: "candleSnapshot", req: { coin, interval, startTime, endTime } });
  return (Array.isArray(rows) ? rows : []).map((r) => ({ t: r.t, T: r.T, o: Number(r.o), h: Number(r.h), l: Number(r.l), c: Number(r.c), v: Number(r.v), n: r.n })).filter((c) => Number.isFinite(c.o) && Number.isFinite(c.c));
}

/** Contratos perpétuos listados agora na Hyperliquid (consulta dinâmica; nenhuma lista fixa de ativos). */
export interface HlPerpMeta { name: string; szDecimals: number; maxLeverage: number; delisted: boolean }
export async function fetchPerpUniverse(): Promise<HlPerpMeta[]> {
  const m = await info<{ universe: { name: string; szDecimals: number; maxLeverage: number; isDelisted?: boolean }[] }>({ type: "meta" });
  return (m?.universe ?? []).map((u) => ({ name: u.name, szDecimals: u.szDecimals, maxLeverage: u.maxLeverage, delisted: Boolean(u.isDelisted) }));
}
/** "@107" → "HYPE": nomes dos pares spot cotados em USDC (as execuções spot usam o índice do par). Outras cotações ficam de fora. */
export async function fetchSpotNames(): Promise<Record<string, string>> {
  const m = await info<{ tokens: { name: string; index: number }[]; universe: { name: string; tokens: [number, number] }[] }>({ type: "spotMeta" });
  const tok = new Map((m?.tokens ?? []).map((t) => [t.index, t.name]));
  const out: Record<string, string> = {};
  for (const u of m?.universe ?? []) { const base = tok.get(u.tokens[0]), quote = tok.get(u.tokens[1]); if (base && quote === "USDC") out[u.name] = base; }
  return out;
}
export const HL_WS = "wss://api.hyperliquid.xyz/ws";

// ───────── retrato em um instante passado ─────────

const cache = new Map<number, number>();
/** Preço do BTC no instante: vela de 1 minuto da Hyperliquid que contém o instante (abertura; erro de até 1 min). */
export async function btcMarkAt(t: number): Promise<number | null> {
  const m = Math.floor(t / 60e3) * 60e3;
  if (cache.has(m)) return cache.get(m)!;
  try {
    const rows = await info<{ t: number; c: string; o: string }[]>({ type: "candleSnapshot", req: { coin: "BTC", interval: "1m", startTime: m - 3 * 60e3, endTime: m + 2 * 60e3 } });
    const row = rows.find((x) => x.t === m) ?? rows.filter((x) => x.t <= t).pop();
    if (!row) return null;
    const v = row.t === m ? Number(row.o) : Number(row.c);
    cache.set(m, v);
    return v;
  } catch { return null; }
}

/** Ponto mais próximo de uma série [ms, valor], dentro de `maxGap`. */
export function nearestPoint(series: [number, number][], t: number, maxGap = 6 * 3600e3): [number, number] | null {
  let best: [number, number] | null = null;
  for (const p of series) if (Math.abs(p[0] - t) <= maxGap && (!best || Math.abs(p[0] - t) < Math.abs(best[0] - t))) best = p;
  return best;
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

/** Velas de qualquer instrumento (para o gráfico de cada posição). */
export async function coinCandles(coin: string, interval: "15m" | "1h" | "4h" = "1h", days = 7): Promise<{ t: number; c: number }[]> {
  const end = Date.now();
  const rows = await info<{ t: number; c: string }[]>({ type: "candleSnapshot", req: { coin, interval, startTime: end - days * 86400e3, endTime: end } });
  return (Array.isArray(rows) ? rows : []).map((r) => ({ t: r.t, c: Number(r.c) }));
}
