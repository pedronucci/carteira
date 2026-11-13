/**
 * Ordem real das execuções. Uma ordem que preenche contra vários livros gera várias execuções no MESMO milissegundo,
 * e o `tid` da Hyperliquid não segue a sequência em que elas aconteceram. Dentro do mesmo instante e instrumento,
 * a ordem é dada pelo encadeamento das posições: cada execução começa (`startPosition`) onde a anterior terminou.
 * Sem encadeamento possível, mantém a ordem numérica da chave (nada é descartado).
 */
interface Seq { key: string; time: number; coin: string; side: "B" | "A"; sz: number; startPosition: number }

const endOf = (f: Seq) => f.startPosition + (f.side === "B" ? f.sz : -f.sz);
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

function chain<T extends Seq>(g: T[]): T[] {
  if (g.length < 2) return g;
  const rest = [...g], out: T[] = [];
  // começo da sequência: a execução cujo início não é o fim de nenhuma outra do grupo
  let cur: T | undefined = rest.find((f) => !rest.some((o) => o !== f && near(endOf(o), f.startPosition))) ?? rest[0];
  while (rest.length) {
    if (!cur) cur = rest[0]!;
    out.push(cur);
    rest.splice(rest.indexOf(cur), 1);
    const e = endOf(cur);
    cur = rest.find((f) => near(f.startPosition, e));
  }
  return out;
}

export function orderFills<T extends Seq>(fills: T[]): T[] {
  const base = [...fills].sort((a, b) => a.time - b.time || a.coin.localeCompare(b.coin) || a.key.localeCompare(b.key, undefined, { numeric: true }));
  const out: T[] = [];
  for (let i = 0; i < base.length;) {
    let j = i + 1;
    while (j < base.length && base[j]!.time === base[i]!.time && base[j]!.coin === base[i]!.coin) j++;
    out.push(...chain(base.slice(i, j)));
    i = j;
  }
  return out;
}
