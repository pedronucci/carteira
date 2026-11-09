/** Logos das criptos como marcas desenhadas aqui (funcionam offline). Sem logo conhecido: círculo com a inicial. */
const BG: Record<string, string> = {
  BTC: "#f7931a", WBTC: "#f7931a", UBTC: "#f7931a", CBBTC: "#f7931a", ETH: "#627eea", WETH: "#627eea", UETH: "#627eea", SOL: "#14110f", USOL: "#14110f",
  USDC: "#2775ca", USDT: "#26a17b", USDT0: "#26a17b", DAI: "#f5ac37", HYPE: "#0f2f2a", BNB: "#f3ba2f", ZEC: "#f4b728", XRP: "#23292f",
  AVAX: "#e84142", LINK: "#2a5ada", DOGE: "#c2a633", ARB: "#28a0f0", OP: "#ff0420",
};
const norm = (s: string) => s.toUpperCase().replace(/^U(?=BTC|ETH|SOL)/, "U");

export function CoinLogo({ symbol, size = 20, className = "" }: { symbol: string; size?: number; className?: string }) {
  const k = norm(symbol);
  const bg = BG[k] ?? "#334155";
  const base = k.replace(/^U(?=BTC|ETH|SOL)/, "").replace(/^W(?=BTC|ETH)/, "");
  let mark: React.ReactNode;
  if (base === "BTC" || base === "CBBTC") mark = <text x="12" y="16.8" textAnchor="middle" fontSize="14" fontWeight="700" fill="#fff" fontFamily="system-ui,sans-serif">₿</text>;
  else if (base === "ETH") mark = <g fill="#fff"><path d="M12 4.5 7.2 12.3 12 10.2z" opacity=".7" /><path d="M12 4.5l4.8 7.8L12 10.2z" /><path d="M12 13.2 7.2 13.2 12 19.5z" opacity=".7" /><path d="M12 19.5l4.8-6.3H12z" /><path d="M7.2 12.8 12 15l4.8-2.2L12 10.7z" opacity=".5" /></g>;
  else if (base === "SOL") mark = <g fill="#2ee6c5"><path d="M7 7.5h11l-1.8 2H5.2z" /><path d="M7 11h11l-1.8 2H5.2z" transform="translate(0 0) scale(1 -1) translate(0 -22)" /><path d="M5.2 14.6h11l1.8 2H7z" /></g>;
  else if (base === "USDC" || base === "USDT" || base === "USDT0" || base === "DAI") mark = <text x="12" y="16.5" textAnchor="middle" fontSize="12" fontWeight="700" fill="#fff" fontFamily="system-ui,sans-serif">$</text>;
  else if (base === "HYPE") mark = <path d="M5 13c2-5 4-6 5.5-3.5C11.5 11 12 11 13 9.5c1.5-2.3 4-1 6 3.5-2 3-4 3-5 1.5-.8-1.2-1.4-1.2-2.2 0C10 16 7 17 5 13z" fill="#97fce4" />;
  else mark = <text x="12" y="16.2" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff" fontFamily="system-ui,sans-serif">{symbol.replace(/[^A-Za-z0-9]/g, "").slice(0, 1).toUpperCase() || "?"}</text>;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={`shrink-0 ${className}`} role="img" aria-label={symbol}>
      <circle cx="12" cy="12" r="12" fill={bg} />
      {mark}
    </svg>
  );
}
