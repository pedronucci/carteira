import { describe, expect, it } from "vitest";
import { cleanSummary, dedupe, parseFeed, parseIcs, classifyEvent, nyOffsetHours } from "../src/parse";
import { fedEvents } from "../src/sources";
import { corsFor, limited } from "../src/index";

const rss = `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
<item><title><![CDATA[Bitcoin sobe &amp; testa US$ 100 mil]]></title><link>https://ex.com/a?utm=1</link><pubDate>Mon, 09 Nov 2026 12:00:00 GMT</pubDate>
<description><![CDATA[<p>O <b>Bitcoin</b> subiu&nbsp;hoje &#8217;fortemente&#8217; &#x41;.</p>]]></description></item>
<item><title>Sem data</title><link>https://ex.com/b</link></item>
<item><title></title><link>https://ex.com/c</link><pubDate>Mon, 09 Nov 2026 12:00:00 GMT</pubDate></item>
<item><title>Sem link</title><pubDate>Mon, 09 Nov 2026 12:00:00 GMT</pubDate></item>
</channel></rss>`;
const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Ethereum atualiza</title><link rel="alternate" href="https://ex.com/eth?a=1&amp;b=2"/><published>2026-11-09T10:00:00Z</published><summary>Resumo &lt;i&gt;x&lt;/i&gt;</summary></entry></feed>`;

describe("parseFeed", () => {
  it("RSS com CDATA, entidades e HTML", () => {
    const r = parseFeed(rss, "Fonte");
    expect(r).toHaveLength(1);
    expect(r[0]!.title).toBe("Bitcoin sobe & testa US$ 100 mil");
    expect(r[0]!.summary).toBe("O Bitcoin subiu hoje ’fortemente’ A.");
    expect(r[0]!.publishedAt).toBe(Date.UTC(2026, 10, 9, 12));
    expect(r[0]!.source).toBe("Fonte");
  });
  it("descarta itens sem data, título ou link", () => expect(parseFeed(rss, "x").map((i) => i.url)).toEqual(["https://ex.com/a?utm=1"]));
  it("Atom com href e entidades na URL", () => {
    const r = parseFeed(atom, "A");
    expect(r[0]!.url).toBe("https://ex.com/eth?a=1&b=2");
    expect(r[0]!.summary).toBe("Resumo x");
  });
  it("entrada malformada devolve []", () => { expect(parseFeed("<<<nada", "x")).toEqual([]); expect(parseFeed("", "x")).toEqual([]); });
  it("trunca o resumo em 280 caracteres", () => {
    const x = `<rss><channel><item><title>T</title><link>https://a.com/1</link><pubDate>Mon, 09 Nov 2026 12:00:00 GMT</pubDate><description>${"a".repeat(500)}</description></item></channel></rss>`;
    const s = parseFeed(x, "x")[0]!.summary;
    expect(s.length).toBe(280); expect(s.endsWith("…")).toBe(true);
  });
  it("id estável por URL", () => expect(parseFeed(rss, "x")[0]!.id).toBe(parseFeed(rss, "y")[0]!.id));
});

describe("cleanSummary", () => {
  it("remove rodapés de WordPress", () => {
    expect(cleanSummary("Resumo bom. The post Título appeared first on InfoMoney .")).toBe("Resumo bom.");
    expect(cleanSummary("Resumo. O post Título apareceu primeiro em Portal do Bitcoin .")).toBe("Resumo.");
    expect(cleanSummary("Texto Fonte: Título Veja mais notícias sobre Bitcoin. Siga o Livecoins no Facebook")).toBe("Texto");
    expect(cleanSummary("Sem rodapé")).toBe("Sem rodapé");
  });
});

describe("dedupe", () => {
  const mk = (title: string, url: string, t: number) => ({ id: url, title, url, source: "s", publishedAt: t, summary: "" });
  it("remove por URL normalizada e por título sem acentos", () => {
    const r = dedupe([mk("Alta do Bitcoin", "https://A.com/x/?utm=1", 1), mk("outro", "https://a.com/x", 2), mk("ALTA do bitcoín!", "https://b.com/y", 3), mk("Diferente", "https://c.com/z", 0)]);
    expect(r.map((i) => i.publishedAt)).toEqual([3, 2, 0]);
  });
  it("ordena do mais novo ao mais antigo", () => expect(dedupe([mk("a", "https://x.com/1", 1), mk("b", "https://x.com/2", 5)]).map((i) => i.publishedAt)).toEqual([5, 1]));
});

describe("parseIcs", () => {
  const ics = [
    "BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:1@bls", "SUMMARY:Consumer Price Index for October\\, 2026", "DTSTART;TZID=America/New_York:20261112T083000", "END:VEVENT",
    "BEGIN:VEVENT", "UID:2@bls", "SUMMARY:Employment Situation", "DTSTART;TZID=America/New_York:20260306T083000", "END:VEVENT",
    "BEGIN:VEVENT", "UID:3@bls", "SUMMARY:Producer Price Index", "DTSTART:20261113T133000Z", "END:VEVENT",
    "BEGIN:VEVENT", "UID:4", "SUMMARY:Real Earn", " ings", "DTSTART;VALUE=DATE:20261120", "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  const ev = parseIcs(ics, "bls.gov", "US");
  it("converte Nova York para UTC (inverno = UTC-5, verão = UTC-4)", () => {
    expect(ev.find((e) => e.id.endsWith("1@bls"))!.start).toBe(Date.UTC(2026, 10, 12, 13, 30));
    expect(ev.find((e) => e.id.endsWith("2@bls"))!.start).toBe(Date.UTC(2026, 2, 6, 13, 30));
    expect(nyOffsetHours(2026, 7, 1, 9)).toBe(4);
  });
  it("transições do horário de verão", () => { expect(nyOffsetHours(2026, 3, 8, 1)).toBe(5); expect(nyOffsetHours(2026, 3, 8, 3)).toBe(4); expect(nyOffsetHours(2026, 11, 1, 1)).toBe(4); expect(nyOffsetHours(2026, 11, 1, 3)).toBe(5); });
  it("UTC, só data, linhas dobradas e escapes", () => {
    expect(ev.find((e) => e.id.endsWith("3@bls"))!.start).toBe(Date.UTC(2026, 10, 13, 13, 30));
    const d = ev.find((e) => e.id.endsWith("4"))!; expect(d.title).toBe("Real Earnings"); expect(d.start).toBe(Date.UTC(2026, 10, 20));
    expect(ev.find((e) => e.id.endsWith("1@bls"))!.title).toBe("Consumer Price Index for October, 2026");
  });
  it("classifica tipo e importância", () => {
    expect(classifyEvent("Consumer Price Index")).toEqual({ kind: "CPI", importance: "alta" });
    expect(classifyEvent("Employment Situation").kind).toBe("EMPREGO");
    expect(classifyEvent("Producer Price Index").importance).toBe("media");
    expect(classifyEvent("Algo qualquer")).toEqual({ kind: "OUTRO", importance: "baixa" });
  });
  it("lixo devolve []", () => expect(parseIcs("não é ics", "x", "US")).toEqual([]));
});

describe("calendário do Fed e proteção", () => {
  it("FOMC 9 dez 2026 às 14:00 de Nova York = 19:00 UTC", () => expect(fedEvents().find((e) => e.id === "fed:fomc:2026-12-9")!.start).toBe(Date.UTC(2026, 11, 9, 19)));
  it("FOMC de julho (horário de verão) = 18:00 UTC", () => expect(fedEvents().find((e) => e.id === "fed:fomc:2026-7-29")!.start).toBe(Date.UTC(2026, 6, 29, 18)));
  it("limite de uso por IP", () => { let blocked = 0; for (let i = 0; i < 70; i++) if (limited("1.1.1.1", 1000, 60)) blocked++; expect(blocked).toBe(10); expect(limited("1.1.1.1", 1000 + 61e3, 60)).toBe(false); });
  it("CORS só para origens autorizadas (e localhost)", () => {
    expect(corsFor("https://pedronucci.github.io", "https://pedronucci.github.io")["Access-Control-Allow-Origin"]).toBe("https://pedronucci.github.io");
    expect(corsFor("https://evil.com", "https://pedronucci.github.io")["Access-Control-Allow-Origin"]).toBe("https://pedronucci.github.io");
    expect(corsFor("http://localhost:5173", "https://pedronucci.github.io")["Access-Control-Allow-Origin"]).toBe("http://localhost:5173");
  });
});
