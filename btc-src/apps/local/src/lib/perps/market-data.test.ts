import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchCandles = vi.fn();
vi.mock("../local/hl", () => ({ fetchCandles: (...a: unknown[]) => fetchCandles(...a), HL_INTERVALS: ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"] }));
import { applyLive, clearCandleCache, loadCandles, mergeCandles, type HlCandle } from "./market-data";

const c = (t: number, close: number): HlCandle => ({ t, T: t + 59999, o: close, h: close, l: close, c: close, v: 1, n: 1 });
describe("velas: cache, deduplicação e tempo real", () => {
  beforeEach(() => { clearCandleCache(); fetchCandles.mockReset(); fetchCandles.mockResolvedValue([c(0, 1)]); });
  it("pedidos iguais ao mesmo tempo viram UMA consulta; repetir logo depois usa o cache", async () => {
    const [a, b] = await Promise.all([loadCandles("HYPE", "1m", 1_000_000), loadCandles("HYPE", "1m", 1_000_000)]);
    expect(a).toBe(b); expect(fetchCandles).toHaveBeenCalledTimes(1);
    await loadCandles("HYPE", "1m", 1_000_000);
    expect(fetchCandles).toHaveBeenCalledTimes(1);
    await loadCandles("HYPE", "5m", 1_000_000);
    expect(fetchCandles).toHaveBeenCalledTimes(2);
  });
  it("falha não fica em cache (tenta de novo)", async () => {
    fetchCandles.mockRejectedValueOnce(new Error("rede"));
    await expect(loadCandles("SOL", "1h", 5_000_000)).rejects.toThrow("rede");
    await expect(loadCandles("SOL", "1h", 5_000_000)).resolves.toHaveLength(1);
  });
  it("vela ao vivo atualiza a atual, acrescenta a nova e junta histórico sem duplicar", () => {
    const base = [c(0, 1), c(60000, 2)];
    expect(applyLive(base, c(60000, 3)).map((x) => x.c)).toEqual([1, 3]);
    expect(applyLive(base, c(120000, 4)).map((x) => x.t)).toEqual([0, 60000, 120000]);
    expect(mergeCandles([c(60000, 2)], [c(0, 1), c(60000, 9)]).map((x) => [x.t, x.c])).toEqual([[0, 1], [60000, 9]]);
  });
});
