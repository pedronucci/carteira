/**
 * Bitcoin nativo, somente leitura: endereços públicos e chaves públicas estendidas (xpub/ypub/zpub ou descritores
 * pkh(), sh(wpkh()), wpkh()). Os endereços são derivados AQUI, no aparelho; a mempool.space recebe só endereços.
 * Nunca pede frase de recuperação, passphrase BIP-39 ou chave privada.
 */
import { HDKey } from "@scure/bip32";
import { bech32, createBase58check } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2";
import { ripemd160 } from "@noble/hashes/legacy";

export type BtcScript = "p2wpkh" | "p2sh-p2wpkh" | "p2pkh";
export interface XKey { key: string; script: BtcScript }

const b58c = createBase58check(sha256);
const hash160 = (b: Uint8Array) => ripemd160(sha256(b));
const VERSIONS: Record<string, { v: number; script: BtcScript }> = {
  xpub: { v: 0x0488b21e, script: "p2pkh" }, ypub: { v: 0x049d7cb2, script: "p2sh-p2wpkh" }, zpub: { v: 0x04b24746, script: "p2wpkh" },
};
const PRIV = /^(xprv|yprv|zprv|tprv)/i;

export function addressFor(pub: Uint8Array, script: BtcScript): string {
  const h = hash160(pub);
  if (script === "p2wpkh") return bech32.encode("bc", [0, ...bech32.toWords(h)]);
  if (script === "p2sh-p2wpkh") return b58c.encode(Uint8Array.from([0x05, ...hash160(Uint8Array.from([0x00, 0x14, ...h]))]));
  return b58c.encode(Uint8Array.from([0x00, ...h]));
}

/** Converte a entrada do usuário em xpub/ypub/zpub (ou descritor) e tipo de endereço. Recusa chave privada. */
export function parseXKey(raw: string): XKey {
  let s = raw.trim();
  if (PRIV.test(s.replace(/^[a-z()]+\(/i, ""))) throw new Error("Isto é uma chave PRIVADA. Nunca informe chave privada: use só a chave pública (xpub/ypub/zpub).");
  let script: BtcScript | null = null;
  const desc = s.match(/^(wpkh|sh\(wpkh|pkh)\((?:\[[^\]]*\])?([a-z0-9]+)(?:\/[^)]*)?\)\)?$/i);
  if (desc) { script = desc[1]!.toLowerCase() === "wpkh" ? "p2wpkh" : desc[1]!.toLowerCase() === "pkh" ? "p2pkh" : "p2sh-p2wpkh"; s = desc[2]!; }
  if (/^tr\(/i.test(s)) throw new Error("Descritores taproot (tr) ainda não são suportados. Informe os endereços bc1p… diretamente.");
  const pre = s.slice(0, 4).toLowerCase();
  const ver = VERSIONS[pre];
  if (!ver) throw new Error("Chave estendida não reconhecida. Use xpub, ypub, zpub ou um descritor wpkh(), sh(wpkh()) ou pkh().");
  try { HDKey.fromExtendedKey(s, { public: ver.v, private: 0 }); } catch { throw new Error("Chave estendida inválida (soma de verificação)."); }
  return { key: s, script: script ?? ver.script };
}

/** Endereços derivados (0 = recebimento, 1 = troco). */
export function derive(x: XKey, chain: 0 | 1, from: number, count: number): string[] {
  const ver = VERSIONS[x.key.slice(0, 4).toLowerCase()]!;
  const root = HDKey.fromExtendedKey(x.key, { public: ver.v, private: 0 }).deriveChild(chain);
  const out: string[] = [];
  for (let i = from; i < from + count; i++) out.push(addressFor(root.deriveChild(i).publicKey!, x.script));
  return out;
}

export const isBtcAddress = (a: string) => /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(a.trim());

// ───────── mempool.space ─────────

const API = "https://mempool.space/api";
type AddrStats = { chain_stats: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number }; mempool_stats: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number } };
type Tx = { txid: string; status: { confirmed: boolean; block_time?: number }; vin: { prevout: { scriptpubkey_address?: string; value: number } | null }[]; vout: { scriptpubkey_address?: string; value: number }[]; fee: number };

async function get<T>(path: string, f: typeof fetch = fetch): Promise<T> {
  const r = await f(`${API}${path}`, { signal: AbortSignal.timeout(15000) });
  if (r.status === 429) throw new Error("A mempool.space limitou as consultas. Tente de novo em alguns minutos.");
  if (!r.ok) throw new Error(`mempool.space respondeu ${r.status}.`);
  return (await r.json()) as T;
}

export interface BtcSync {
  sats: number; confirmedSats: number; addresses: { address: string; sats: number; txs: number }[];
  utxos: number; txs: { txid: string; t: number; netSats: number; confirmed: boolean; counterparty: string | null; feeSats: number }[];
}

/** Lê saldos, UTXOs e transações recentes. Com chave estendida, para após 20 endereços seguidos sem uso. */
export async function syncBitcoin(input: { addresses: string[]; xkeys: XKey[] }, opts: { gap?: number; fetch?: typeof fetch } = {}): Promise<BtcSync> {
  const f = opts.fetch ?? fetch, gap = opts.gap ?? 20;
  const seen = new Map<string, { sats: number; confirmed: number; txs: number }>();
  const stat = async (a: string) => {
    const s = await get<AddrStats>(`/address/${a}`, f);
    const confirmed = s.chain_stats.funded_txo_sum - s.chain_stats.spent_txo_sum;
    const v = { sats: confirmed + s.mempool_stats.funded_txo_sum - s.mempool_stats.spent_txo_sum, confirmed, txs: s.chain_stats.tx_count + s.mempool_stats.tx_count };
    seen.set(a, v);
    return v;
  };
  for (const a of input.addresses) await stat(a.trim());
  for (const x of input.xkeys) {
    for (const chain of [0, 1] as const) {
      let i = 0, empty = 0;
      while (empty < gap && i < 1000) {
        const batch = derive(x, chain, i, 5);
        const res = await Promise.all(batch.map(stat));
        for (const r of res) empty = r.txs ? 0 : empty + 1;
        i += 5;
      }
    }
  }
  const used = [...seen.entries()].filter(([, v]) => v.txs > 0).map(([a]) => a);
  const own = new Set(seen.keys());
  // UTXOs e transações (as mais recentes de cada endereço usado)
  let utxos = 0;
  const txMap = new Map<string, Tx>();
  for (const a of used) {
    const [u, t] = await Promise.all([get<unknown[]>(`/address/${a}/utxo`, f), get<Tx[]>(`/address/${a}/txs`, f)]);
    utxos += u.length;
    for (const x of t) txMap.set(x.txid, x);
  }
  const txs = [...txMap.values()].map((x) => {
    const inOwn = x.vin.reduce((s, i) => s + (i.prevout?.scriptpubkey_address && own.has(i.prevout.scriptpubkey_address) ? i.prevout.value : 0), 0);
    const outOwn = x.vout.reduce((s, o) => s + (o.scriptpubkey_address && own.has(o.scriptpubkey_address) ? o.value : 0), 0);
    const net = outOwn - inOwn;
    const other = net > 0 ? x.vin.find((i) => i.prevout?.scriptpubkey_address && !own.has(i.prevout.scriptpubkey_address))?.prevout?.scriptpubkey_address : x.vout.find((o) => o.scriptpubkey_address && !own.has(o.scriptpubkey_address))?.scriptpubkey_address;
    return { txid: x.txid, t: (x.status.block_time ?? Math.floor(Date.now() / 1000)) * 1000, netSats: net, confirmed: x.status.confirmed, counterparty: other ?? null, feeSats: inOwn > 0 && x.vin.every(i => i.prevout?.scriptpubkey_address && own.has(i.prevout.scriptpubkey_address)) ? x.fee : 0 };
  }).sort((a, b) => b.t - a.t);
  const all = [...seen.entries()];
  return {
    sats: all.reduce((s, [, v]) => s + v.sats, 0), confirmedSats: all.reduce((s, [, v]) => s + v.confirmed, 0),
    addresses: all.filter(([a, v]) => v.txs > 0 || input.addresses.includes(a)).map(([address, v]) => ({ address, sats: v.sats, txs: v.txs })),
    utxos, txs,
  };
}
