/** Distingue execuções de contratos perpétuos das de pares spot (a Hyperliquid mistura as duas no mesmo histórico). */
export const isSpotCoin = (coin: string) => coin.startsWith("@") || coin.includes("/");
/** Nome legível de um instrumento spot ("@107" → "HYPE") quando o mapa de nomes estiver disponível. */
export function spotLabel(coin: string, names?: Record<string, string> | null): string {
  if (!isSpotCoin(coin)) return coin;
  return names?.[coin] ?? (coin.includes("/") ? coin.split("/")[0]! : coin);
}
