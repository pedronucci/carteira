/** Bitcoin: derivação de endereços com os vetores oficiais (BIP-44/49/84) e leitura da mempool.space (simulada). */
import { describe, expect, it } from "vitest";
import { derive, isBtcAddress, parseXKey, syncBitcoin } from "../src/lib/connectors/bitcoin";

// vetores de teste das BIPs (frase pública de teste "abandon … about"; NÃO é uma carteira real)
const ZPUB = "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";
const YPUB = "ypub6Ww3ibxVfGzLrAH1PNcjyAWenMTbbAosGNB6VvmSEgytSER9azLDWCxoJwW7Ke7icmizBMXrzBx9979FfaHxHcrArf3zbeJJJUZPf663zsP";
const XPUB = "xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj";

describe("derivação (vetores BIP)", () => {
  it("BIP-84 zpub → bc1q… (nativo SegWit)", () => {
    expect(derive(parseXKey(ZPUB), 0, 0, 2)).toEqual(["bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu", "bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g"]);
    expect(derive(parseXKey(ZPUB), 1, 0, 1)).toEqual(["bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el"]);
  });
  it("BIP-49 ypub → 3… (SegWit aninhado)", () => {
    expect(derive(parseXKey(YPUB), 0, 0, 1)).toEqual(["37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf"]);
  });
  it("BIP-44 xpub → 1… (legado)", () => {
    expect(derive(parseXKey(XPUB), 0, 0, 1)).toEqual(["1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA"]);
  });
  it("descritor wpkh() com origem", () => {
    const k = parseXKey(`wpkh([73c5da0a/84h/0h/0h]${ZPUB.replace(/^zpub/, "zpub")}/0/*)`);
    expect(k.script).toBe("p2wpkh");
  });
  it("recusa chave privada e taproot com mensagem clara", () => {
    expect(() => parseXKey("xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi")).toThrow(/PRIVADA/);
    expect(() => parseXKey("tr(xpub...)")).toThrow(/taproot/);
    expect(() => parseXKey("qualquer coisa")).toThrow();
  });
  it("valida endereços", () => {
    expect(isBtcAddress("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu")).toBe(true);
    expect(isBtcAddress("1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA")).toBe(true);
    expect(isBtcAddress("0xabc")).toBe(false);
  });
});

describe("leitura na mempool.space (respostas simuladas no formato da API)", () => {
  const A = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu", B = "bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g", EXT = "bc1qexternoxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
  const stats: Record<string, [number, number, number]> = { [A]: [150_000, 50_000, 2], [B]: [20_000, 0, 1] };
  const fake: typeof fetch = async (u) => {
    const url = String(u);
    const addr = url.match(/address\/([^/]+)/)?.[1] ?? "";
    const [f, s, n] = stats[addr] ?? [0, 0, 0];
    let body: unknown;
    if (url.endsWith("/utxo")) body = n ? [{ txid: "u", value: f - s }] : [];
    else if (url.endsWith("/txs")) body = addr === A ? [
      { txid: "t1", status: { confirmed: true, block_time: 1_793_000_000 }, fee: 0, vin: [{ prevout: { scriptpubkey_address: EXT, value: 160_000 } }], vout: [{ scriptpubkey_address: A, value: 150_000 }, { scriptpubkey_address: EXT, value: 9_000 }] },
      { txid: "t2", status: { confirmed: true, block_time: 1_793_100_000 }, fee: 500, vin: [{ prevout: { scriptpubkey_address: A, value: 150_000 } }], vout: [{ scriptpubkey_address: EXT, value: 50_000 }, { scriptpubkey_address: B, value: 99_500 }] },
    ] : [];
    else body = { chain_stats: { funded_txo_sum: f, spent_txo_sum: s, tx_count: n }, mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 } };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  it("soma os saldos e entende as transações (entrada, saída com troco para endereço próprio)", async () => {
    const r = await syncBitcoin({ addresses: [], xkeys: [parseXKey(ZPUB)] }, { gap: 5, fetch: fake });
    expect(r.sats).toBe(100_000 + 20_000);
    expect(r.utxos).toBe(2);
    const t1 = r.txs.find((x) => x.txid === "t1")!, t2 = r.txs.find((x) => x.txid === "t2")!;
    expect(t1.netSats).toBe(150_000);
    expect(t1.counterparty).toBe(EXT);
    // saída: 150.000 saíram, 99.500 voltaram como troco para B (próprio) → líquido −50.500 (inclui a taxa)
    expect(t2.netSats).toBe(-50_500);
    expect(t2.feeSats).toBe(500);
  });
  it("erro de limite da API vira mensagem clara", async () => {
    const limited: typeof fetch = async () => new Response("", { status: 429 });
    await expect(syncBitcoin({ addresses: [A], xkeys: [] }, { fetch: limited })).rejects.toThrow(/limitou/);
  });
});
