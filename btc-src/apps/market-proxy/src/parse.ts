/** Parsers sem dependências (rodam em Cloudflare Workers): RSS/Atom e iCalendar. Nunca lançam exceção. */
export interface NewsItem { id: string; title: string; url: string; source: string; publishedAt: number; summary: string }
export interface CalEvent { id: string; title: string; start: number; source: string; kind: string; country: string; importance: "alta" | "media" | "baixa" }

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") { const n = e[1]!.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(n); } catch { return ""; } }
    return ENT[e.toLowerCase()] ?? m;
  });
}
const unCdata = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, c: string) => c.replace(/&/g, "&amp;").replace(/</g, "&lt;"));
export const plain = (s: string) => decode(decode(unCdata(s)).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const trunc = (s: string, n = 280) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
export function hash(s: string): string { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); }

function tag(block: string, names: string[]): string | null {
  for (const n of names) {
    const m = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, "i").exec(block);
    if (m && m[1] != null && m[1].trim()) return m[1];
  }
  return null;
}

export function parseFeed(xml: string, source: string): NewsItem[] {
  try {
    const out: NewsItem[] = [];
    const blocks = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map((m) => m[2] ?? "");
    for (const b of blocks) {
      const title = plain(tag(b, ["title"]) ?? "");
      let url = plain(tag(b, ["link"]) ?? "");
      if (!url) url = decode(/<link\b[^>]*\bhref="([^"]+)"/i.exec(b)?.[1] ?? "");
      const when = Date.parse(plain(tag(b, ["pubDate", "published", "updated", "dc:date"]) ?? ""));
      if (!title || !/^https?:\/\//i.test(url) || !Number.isFinite(when)) continue;
      const summary = trunc(plain(tag(b, ["description", "summary", "content:encoded", "content"]) ?? ""));
      out.push({ id: hash(url), title, url, source, publishedAt: when, summary });
    }
    return out;
  } catch { return []; }
}

const normUrl = (u: string) => { try { const x = new URL(u); return `${x.hostname.toLowerCase()}${x.pathname.replace(/\/+$/, "")}`; } catch { return u.toLowerCase(); } };
const normTitle = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
/** Remove duplicatas (mesma URL ou mesmo título normalizado), mantém a mais recente e ordena do mais novo ao mais antigo. */
export function dedupe(items: NewsItem[]): NewsItem[] {
  const sorted = [...items].sort((a, b) => b.publishedAt - a.publishedAt);
  const seenU = new Set<string>(), seenT = new Set<string>(), out: NewsItem[] = [];
  for (const it of sorted) {
    const u = normUrl(it.url), t = normTitle(it.title);
    if (seenU.has(u) || (t && seenT.has(t))) continue;
    seenU.add(u); if (t) seenT.add(t); out.push(it);
  }
  return out;
}

/* ---------------- iCalendar ---------------- */
const nthSunday = (y: number, m0: number, n: number) => { const first = new Date(Date.UTC(y, m0, 1)).getUTCDay(); return 1 + ((7 - first) % 7) + (n - 1) * 7; };
/** Horário de verão dos EUA: 2º domingo de março 2h → 1º domingo de novembro 2h (horário local). */
export function nyOffsetHours(y: number, mo: number, d: number, h: number): number {
  const start = nthSunday(y, 2, 2), end = nthSunday(y, 10, 1);
  const v = (mo - 1) * 1e4 + d * 100 + h;
  return v >= 2 * 1e4 + start * 100 + 2 && v < 10 * 1e4 + end * 100 + 2 ? 4 : 5;
}
function icsTime(v: string, params: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v.trim());
  if (!m) return null;
  const [y, mo, d] = [+m[1]!, +m[2]!, +m[3]!], h = +(m[4] ?? 0), mi = +(m[5] ?? 0), s = +(m[6] ?? 0);
  if (m[7] || !m[4]) return Date.UTC(y, mo - 1, d, h, mi, s);
  if (/TZID=America\/New_York/i.test(params)) return Date.UTC(y, mo - 1, d, h + nyOffsetHours(y, mo, d, h), mi, s);
  return Date.UTC(y, mo - 1, d, h, mi, s);
}
const KINDS: [RegExp, string, CalEvent["importance"]][] = [
  [/consumer price index/i, "CPI", "alta"], [/employment situation/i, "EMPREGO", "alta"], [/producer price index/i, "PPI", "media"],
  [/fomc|federal open market/i, "FOMC", "alta"], [/gross domestic product/i, "PIB", "alta"], [/personal income and outlays|pce/i, "PCE", "alta"],
  [/jobless claims|unemployment insurance/i, "SEGURO-DESEMPREGO", "media"], [/retail sales/i, "VAREJO", "media"],
];
export const classifyEvent = (title: string): { kind: string; importance: CalEvent["importance"] } => { for (const [re, kind, importance] of KINDS) if (re.test(title)) return { kind, importance }; return { kind: "OUTRO", importance: "baixa" }; };

export function parseIcs(text: string, source: string, country: string): CalEvent[] {
  try {
    const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
    const out: CalEvent[] = [];
    let cur: Record<string, { v: string; p: string }> | null = null;
    for (const ln of lines) {
      if (ln.startsWith("BEGIN:VEVENT")) { cur = {}; continue; }
      if (ln.startsWith("END:VEVENT")) {
        const s = cur?.["SUMMARY"], d = cur?.["DTSTART"];
        const start = d ? icsTime(d.v, d.p) : null;
        if (cur && s && start != null) {
          const title = s.v.replace(/\\([,;])/g, "$1").replace(/\\n/gi, " ").trim();
          out.push({ id: `${source}:${cur["UID"]?.v ?? hash(title + start)}`, title, start, source, country, ...classifyEvent(title) });
        }
        cur = null; continue;
      }
      if (!cur) continue;
      const i = ln.indexOf(":"); if (i < 0) continue;
      const [name, ...ps] = ln.slice(0, i).split(";");
      cur[name!.toUpperCase()] = { v: ln.slice(i + 1), p: ps.join(";") };
    }
    return out.sort((a, b) => a.start - b.start);
  } catch { return []; }
}
