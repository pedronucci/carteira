/** Fontes oficiais (lista fixa: o Worker NÃO é um proxy aberto). */
import { nyOffsetHours, type CalEvent } from "./parse";

export const FEEDS: { id: string; name: string; url: string }[] = [
  { id: "portaldobitcoin", name: "Portal do Bitcoin", url: "https://portaldobitcoin.uol.com.br/feed/" },
  { id: "livecoins", name: "Livecoins", url: "https://livecoins.com.br/feed/" },
  { id: "cointelegraph-br", name: "Cointelegraph Brasil", url: "https://br.cointelegraph.com/rss" },
  { id: "infomoney", name: "InfoMoney", url: "https://www.infomoney.com.br/feed/" },
];
export const BLS_ICS = "https://www.bls.gov/schedule/news_release/bls.ics";

/** Calendário do FOMC (federalreserve.gov/monetarypolicy/fomccalendars.htm). Decisão às 14:00 de Nova York no 2º dia. Atualizar 1x/ano. */
const FOMC: [number, number, number, string][] = [
  [2026, 1, 28, "FOMC 27–28 jan"], [2026, 3, 18, "FOMC 17–18 mar (com projeções)"], [2026, 4, 29, "FOMC 28–29 abr"], [2026, 6, 17, "FOMC 16–17 jun (com projeções)"],
  [2026, 7, 29, "FOMC 28–29 jul"], [2026, 9, 16, "FOMC 15–16 set (com projeções)"], [2026, 10, 28, "FOMC 27–28 out"], [2026, 12, 9, "FOMC 8–9 dez (com projeções)"],
  [2027, 1, 27, "FOMC 26–27 jan"], [2027, 3, 17, "FOMC 16–17 mar (com projeções)"], [2027, 4, 28, "FOMC 27–28 abr"], [2027, 6, 9, "FOMC 8–9 jun (com projeções)"], [2027, 7, 28, "FOMC 27–28 jul"],
];
const OTHER: [number, number, number, string, string][] = [
  [2026, 11, 25, "Beige Book (Fed)", "OUTRO"], [2026, 12, 30, "Ata do FOMC (reunião de 8–9 dez)", "ATA-FOMC"], [2027, 1, 13, "Beige Book (Fed)", "OUTRO"],
];
const at14 = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 14 + nyOffsetHours(y, m, d, 14));
export function fedEvents(): CalEvent[] {
  return [
    ...FOMC.map(([y, m, d, t]): CalEvent => ({ id: `fed:fomc:${y}-${m}-${d}`, title: t, start: at14(y, m, d), source: "federalreserve.gov", kind: "FOMC", country: "US", importance: "alta" })),
    ...OTHER.map(([y, m, d, t, k]): CalEvent => ({ id: `fed:${k}:${y}-${m}-${d}`, title: t, start: at14(y, m, d), source: "federalreserve.gov", kind: k, country: "US", importance: k === "ATA-FOMC" ? "media" : "baixa" })),
  ];
}
