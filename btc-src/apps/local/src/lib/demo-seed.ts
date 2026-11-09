/**
 * Dados de exemplo SÓ para a prévia visual (compilada com BST_DEMO=1). Na versão publicada o bloco abaixo é
 * removido na compilação. Não lê nem grava nada da conta real.
 */
declare const process: { env: Record<string, string | undefined> };

if (process.env.BST_DEMO === "1") {
  const DAY = 86400, now = Date.now();
  const today = Math.floor(now / 1000 / DAY) * DAY;
  const usd: { t: number; o: number; h: number; l: number; c: number; v: number }[] = [];
  let px = 63000;
  for (let i = 220; i >= 0; i--) {
    const t = today - i * DAY;
    const drift = i > 12 ? 55 : i > 3 ? 120 : -40;
    const wave = Math.sin(i / 5) * 900 + Math.cos(i / 11) * 700;
    const c = i === 0 ? 75855 : Math.round(px + drift + wave * 0.12);
    usd.push({ t, o: px, h: Math.max(px, c) + 380, l: Math.min(px, c) - 380, c, v: 1000 });
    px = c;
  }
  const brl = usd.map((k) => ({ t: k.t, c: k.c * 5.4 }));
  const tz = "America/Sao_Paulo";
  const startAt = Date.UTC(2026, 10, 5, 3, 0);
  const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v));
  set("bst.prices.v1", { usd, brl, source: "Binance (exemplo)", fetchedAt: now, fng: { value: 52, label: "Neutral", at: now },
    spot: { btcUsd: 75855, btcBrl: 75855 * 5.4, usdBrl: 5.4, at: now, source: "Binance (exemplo)", fxSource: "exemplo", stale: false } });
  set("bst.local.v2", {
    v: 3, initial: null, view: "active", updatedAt: new Date().toISOString(),
    settings: { hl: { address: "0x000000000000000000000000000000000000dEaD", includeArb: false }, defaultLeverage: "1.5", maintenanceRate: "0.0125", minLiqDistance: "0.2", manualBtcUsd: "75855", manualUsdBrl: "5.4" },
    strategies: [{ id: "demo", name: "Estratégia BTC ↔ USDC", startAt, tz, status: "active", accounts: [{ kind: "manual" }], createdAt: now,
      snapshot: { at: startAt, source: "manual", equityUsd: "3980", btcUsd: "76300", balances: [], positions: [] } }],
    flows: [
      { id: "f1", date: "2026-11-05", kind: "IN", amount: "3937.53", note: "Aporte" },
      { id: "f2", date: "2026-11-06", kind: "IN", amount: "5103.58", note: "Aporte" },
    ],
    cycles: [{ id: "c1", openedAt: "2026-11-05T21:13", entryPx: "75930", leverage: "4.6", capital: "12800", sizeBtc: "0.77547", liqPx: "59840", feesOpen: "38.59", funding: "-33.10" }],
  });
  let prev: { theme?: string } = {};
  try { prev = JSON.parse(localStorage.getItem("bst.prefs.v1") ?? "{}"); } catch { /* */ }
  set("bst.prefs.v1", { ...prev, ccy: "USD" });
  if (!location.hash || location.hash === "#") location.hash = "#/estrategia";
  addEventListener("DOMContentLoaded", () => {
    const b = document.createElement("div");
    b.textContent = "PRÉVIA · dados de exemplo";
    b.setAttribute("style", "position:fixed;top:calc(env(safe-area-inset-top) + 2px);right:6px;z-index:99;font:600 9px/1 system-ui;letter-spacing:.08em;color:#e8b04b;background:#090e16cc;border:1px solid #e8b04b55;border-radius:99px;padding:3px 7px;pointer-events:none");
    document.body.appendChild(b);
  });
  const H = 3600e3, fl = (t: number, coin: string, side: "B" | "A", sz: number, px: number, sp: number, pnl = 0, fee = 0) => ({ key: `d${t}${coin}`, time: t, coin, px, sz, side, dir: "", fee, closedPnl: pnl, startPosition: sp });
  try {
    localStorage.setItem("bst.hl.v2", JSON.stringify({ address: "0x000000000000000000000000000000000000dead", error: null, syncing: false,
      live: { at: now, mode: "unifiedAccount", perpValue: 0, withdrawable: 900, total: 12690, arbTotal: null,
        balances: [{ coin: "USDC", total: 11700, usd: 11700, where: "spot" }],
        positions: [
          { coin: "BTC", szi: 0.77547, entryPx: 76021.6, leverage: 6, levType: "cross", liqPx: 59840, upnl: -83, marginUsed: 9800, posValue: 58800, fundingSinceOpen: -33.1 },
          { coin: "HYPE", szi: 120, entryPx: 41.2, leverage: 3, levType: "cross", liqPx: 22.4, upnl: 38.4, marginUsed: 1710, posValue: 5263, fundingSinceOpen: 2.1 },
          { coin: "SOL", szi: -15, entryPx: 168, leverage: 3, levType: "cross", liqPx: 231, upnl: -42, marginUsed: 860, posValue: -2562, fundingSinceOpen: -0.8 }] },
      history: { at: now, v: 2, truncated: false, syncs: 1, ledger: [], accountValue: [], pnl: [],
        funding: [{ key: "u1", time: now - 30 * H, coin: "HYPE", usd: 2.1 }, { key: "u2", time: now - 20 * H, coin: "BTC", usd: -33.1 }],
        fills: [fl(now - 60 * H, "BTC", "B", 0.5, 76021.6, 0, 0, 19), fl(now - 50 * H, "BTC", "B", 0.27547, 76021.6, 0.5, 0, 12), fl(now - 40 * H, "HYPE", "B", 80, 40.1, 0, 0, 1.4), fl(now - 30 * H, "HYPE", "B", 40, 43.4, 80, 0, 0.8),
          fl(now - 90 * H, "ETH", "B", 2, 3100, 0, 0, 3), fl(now - 80 * H, "ETH", "A", 2, 3180, 2, 160, 3), fl(now - 20 * H, "SOL", "A", 15, 168, 0, 0, 1.1)] } }));
  } catch { /* */ }
  // responde as cotações com os mesmos números, para a prévia não mostrar "sem conexão"
  const json = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } }));
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input);
    if (u.includes("hyperliquid") && String(init?.body ?? "").includes("candleSnapshot")) return json(Array.from({ length: 168 }, (_, i) => ({ t: now - (168 - i) * 3600e3, c: String(40 + Math.sin(i / 9) * 3 + i * 0.02) })));
    if (u.includes("ticker/price")) return json({ price: u.includes("BTCBRL") ? String(75855 * 5.4) : "75855.00" });
    if (u.includes("/klines")) { const brl = u.includes("BTCBRL"); return json(usd.map((k) => { const c = brl ? k.c * 5.4 : k.c; return [k.t * 1000, c, c, c, c, 1000, (k.t + DAY) * 1000 - 1]; })); }
    if (u.includes("fng")) return json({ data: [{ value: "52", value_classification: "Neutral", timestamp: String(Math.floor(now / 1000)) }] });
    if (u.includes("awesomeapi")) return json({ USDBRL: { ask: "5.4" } });
    return Promise.reject(new Error("prévia sem rede"));
  }) as typeof fetch;
}
export {};
