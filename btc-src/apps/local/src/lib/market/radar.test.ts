import { describe, expect, it } from "vitest";
import type { PSnapshot } from "@bst/domain";
import { classify, correlate, impactCards, relevance, type CalEvent, type Held, type NewsItem } from "./radar";

const NOW = Date.UTC(2026, 10, 9, 12);
const n = (title: string, ageH = 1, summary = ""): NewsItem => ({ id: title.slice(0, 8) + ageH, title, url: "https://x.com/" + title.length, source: "s", publishedAt: NOW - ageH * 3600e3, summary });
const held: Held = { equity: 1000, spot: { BTC: 800, ETH: 100 }, perps: [{ coin: "ETH", dir: "LONG", notional: 2500, leverage: 5, liqDistance: 0.08 }] };

describe("classify", () => {
  it("detecta ativos e temas em português", () => {
    const t = classify(n("Bitcoin renova máxima após decisão do Fed sobre juros", 1, "ETFs de BTC recebem fluxo"));
    expect(t.assets).toEqual(["BTC"]);
    expect(t.themes).toEqual(expect.arrayContaining(["macro", "etf", "mercado"]));
  });
  it("ativos por palavra inteira; texto sem ativo fica vazio", () => {
    expect(classify(n("O sol brilha hoje")).assets).toContain("SOL");
    expect(classify(n("Receita da empresa cresce")).assets).toEqual([]);
  });
  it("hack envolvendo Ethereum", () => { const t = classify(n("Hacker drena protocolo em Ethereum")); expect(t.assets).toEqual(["ETH"]); expect(t.themes).toContain("seguranca"); });
});

describe("relevance", () => {
  it("ativo que tenho + macro + recente = alta", () => expect(relevance(classify(n("Fed mantém juros; Ethereum reage", 1)), held, NOW).level).toBe("alta"));
  it("sem ativo nem tema = 0", () => expect(relevance(classify(n("Time vence o jogo")), held, NOW)).toEqual({ score: 0, level: "baixa" }));
  it("notícia antiga perde relevância", () => {
    const a = relevance(classify(n("Bitcoin sobe", 1)), held, NOW).score, b = relevance(classify(n("Bitcoin sobe", 100)), held, NOW).score;
    expect(b).toBeLessThan(a);
  });
  it("ativo que não tenho pesa menos", () => expect(relevance(classify(n("Solana sobe")), held, NOW).score).toBeLessThan(relevance(classify(n("Ethereum sobe")), held, NOW).score));
  it("score limitado a 0–100", () => { const r = relevance(classify(n("Fed, Bitcoin, Ethereum, Solana hack ETF regulação SEC")), held, NOW); expect(r.score).toBeLessThanOrEqual(100); });
});

describe("impactCards", () => {
  const ev: CalEvent = { id: "fed:1", title: "FOMC", start: NOW + 5 * 3600e3, source: "fed", kind: "FOMC", country: "US", importance: "alta" };
  it("R1: evento macro em 48h com perpétuos → alta quando liquidação < 15%", () => {
    const c = impactCards(held, [ev], [], NOW).find((x) => x.id === "R1:fed:1")!;
    expect(c.severity).toBe("alta"); expect(c.body).toContain("8,0%"); expect(c.body).toContain("2,5x");
  });
  it("R1 não aparece sem perpétuos nem para evento distante/baixo", () => {
    expect(impactCards({ ...held, perps: [] }, [ev], [], NOW)).toEqual([]);
    expect(impactCards(held, [{ ...ev, start: NOW + 72 * 3600e3 }, { ...ev, id: "b", importance: "baixa" }], [], NOW).filter((x) => x.rule.startsWith("R1"))).toEqual([]);
  });
  it("R2: 3+ notícias de ativo em carteira nas últimas 24h", () => {
    const news = [1, 2, 3].map((i) => classify(n(`Ethereum notícia ${i}`, i)));
    const c = impactCards(held, [], news, NOW).find((x) => x.id === "R2:ETH")!;
    expect(c.title).toContain("3 notícias"); expect(c.body).toContain("long perpétuo");
    expect(impactCards(held, [], news.slice(0, 2), NOW).some((x) => x.id === "R2:ETH")).toBe(false);
  });
  it("R3: segurança só quando o ativo é meu", () => {
    expect(impactCards(held, [], [classify(n("Hacker ataca Ethereum"))], NOW).some((x) => x.rule.startsWith("R3"))).toBe(true);
    expect(impactCards(held, [], [classify(n("Hacker ataca Solana"))], NOW).some((x) => x.rule.startsWith("R3"))).toBe(false);
  });
  it("R4: ETF de BTC", () => expect(impactCards(held, [], [classify(n("BlackRock amplia ETF de Bitcoin"))], NOW).some((x) => x.rule.startsWith("R4"))).toBe(true));
  it("ordena por severidade", () => { const c = impactCards(held, [ev], [classify(n("BlackRock amplia ETF de Bitcoin"))], NOW); expect(c[0]!.severity).toBe("alta"); expect(c.at(-1)!.severity).toBe("info"); });
});

describe("correlate", () => {
  const T = NOW - 3 * 86400e3;
  const snaps: PSnapshot[] = [0, 1, 2, 4, 24, 25, 48, 72].map((h) => ({ t: T + h * 3600e3, byAccount: { a: 1000 + h * 2 }, total: 1000 + h * 2, v: 2, btcUsd: 100000 + h * 100 }) as PSnapshot);
  it("calcula janelas com retratos reais e devolve null sem dado", () => {
    const r = correlate(T, snaps, [], NOW);
    const w = Object.fromEntries(r.map((x) => [x.k, x]));
    expect(w["4h"]!.portfolioPct).toBeCloseTo(8 / 1000, 4);
    expect(w["24h"]!.btcPct).toBeCloseTo(2400 / 100000, 4);
    expect(w["7d"]!.portfolioPct).toBeNull();
  });
  it("janela que ainda não terminou é null", () => expect(correlate(NOW - 3600e3, snaps, [], NOW).every((x) => x.portfolioPct == null)).toBe(true));
  it("aporte não vira performance", () => {
    const r = correlate(T, snaps, [{ t: T + 3.5 * 3600e3, accountId: "a", usd: 500 }], NOW);
    expect(r.find((x) => x.k === "4h")!.portfolioPct ?? 0).toBeLessThan(0.05);
  });
});
