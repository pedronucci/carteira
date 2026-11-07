/**
 * Classificador de transações EVM.
 *
 * Recebe os fatos brutos de uma transação (tx nativa, transferências ERC-20 e
 * transferências internas) e o conjunto de carteiras do usuário, e devolve uma
 * operação financeira normalizada com trilha de raciocínio (`trace`).
 *
 * Regras essenciais (ver doc, seção 4):
 * - fluxos entre carteiras próprias se anulam (nunca viram compra/venda);
 * - depósito não é lucro, saque não é prejuízo;
 * - só ativos do registro (assets.ts) entram em cálculo; o resto é listado como não reconhecido;
 * - tx revertida consome só a taxa de rede.
 */
import { d, Decimal, fromUnits, sum, ZERO } from "./decimal";
import { AssetClass, AssetDef, assetId, findAsset, nativeAsset } from "./assets";

export interface RawTx {
  chainId: number;
  hash: string;
  blockNumber: number;
  timestamp: number; // unix seconds
  from: string;
  to: string | null;
  valueWei: string;
  gasUsed: string;
  gasPrice: string; // effective gas price (wei)
  l1FeeWei?: string; // OP-stack L1 data fee quando o explorador informa
  isError: boolean;
  functionName?: string;
}

export interface TokenTransfer {
  chainId: number;
  hash: string;
  logIndex: number;
  tokenAddress: string;
  from: string;
  to: string;
  value: string; // unidades inteiras
  tokenSymbol?: string;
  tokenDecimals?: number;
}

export interface InternalTransfer {
  chainId: number;
  hash: string;
  traceId: string;
  from: string;
  to: string;
  valueWei: string;
  isError: boolean;
}

export type OperationKind =
  | "BUY_BTC"
  | "SELL_BTC"
  | "BTC_CONVERSION"
  | "WRAP"
  | "SWAP_OTHER"
  | "TRANSFER_IN"
  | "TRANSFER_OUT"
  | "INTERNAL_TRANSFER"
  | "BRIDGE_OUT"
  | "BRIDGE_IN"
  | "DERIV_DEPOSIT"
  | "DERIV_WITHDRAWAL"
  | "APPROVAL"
  | "CONTRACT_INTERACTION"
  | "FAILED";

export interface Leg {
  assetId: string;
  symbol: string;
  assetClass: AssetClass;
  direction: "IN" | "OUT";
  amount: Decimal;
  unitPriceUsd: Decimal | null;
  valueUsd: Decimal | null;
}

export interface ClassifiedTx {
  chainId: number;
  hash: string;
  blockNumber: number;
  timestamp: number;
  kind: OperationKind;
  legs: Leg[];
  /** Carteira do usuário que iniciou/recebeu (primeira encontrada). */
  wallet: string | null;
  counterparties: string[];
  feeNative: Decimal;
  feeUsd: Decimal | null;
  /** BTC líquido recebido (+) ou entregue (−) nesta operação. */
  btcDelta: Decimal;
  /** Valor em USD da contraparte do BTC (custo na compra, receita na venda). */
  counterValueUsd: Decimal | null;
  /** Preço implícito do BTC em USD (counterValue / |btcDelta|). */
  impliedBtcPriceUsd: Decimal | null;
  unrecognizedTokens: { address: string; symbol?: string }[];
  needsReview: boolean;
  trace: string[];
  bridgeGroup?: string;
}

/** Retorna o preço em USD do ativo de referência no instante, ou null se indisponível. */
export type PriceAt = (ref: "BTC" | "ETH" | "BNB", timestamp: number) => Decimal | null;

export interface ClassifyInput {
  tx: RawTx;
  tokenTransfers: TokenTransfer[];
  internalTransfers: InternalTransfer[];
  ownedAddresses: Set<string>; // minúsculas
  /**
   * Contratos que custodiam fundos do próprio usuário em outra plataforma
   * (ex.: bridge da Hyperliquid). Envio para cá não é saque de capital: o saldo
   * passa a ser contado pela integração da plataforma.
   */
  custodyAddresses?: Set<string>;
  priceAt: PriceAt;
  /** Divergência máxima aceitável entre preço implícito e mercado antes de pedir revisão. */
  priceDeviationTolerance?: number;
}

const lc = (s: string | null | undefined) => (s ?? "").toLowerCase();

function unitPriceUsd(asset: AssetDef, ts: number, priceAt: PriceAt): Decimal | null {
  if (asset.priceRef === "USD") return d(1); // stablecoin assumida em paridade; depeg é limitação documentada
  return priceAt(asset.priceRef, ts);
}

export function classifyTransaction(input: ClassifyInput): ClassifiedTx {
  const { tx, tokenTransfers, internalTransfers, ownedAddresses: owned, priceAt } = input;
  const tolerance = input.priceDeviationTolerance ?? 0.05;
  const trace: string[] = [];
  const isOwned = (a: string | null | undefined) => owned.has(lc(a));
  const native = nativeAsset(tx.chainId);

  // 1) Taxa de rede: paga somente se o remetente é uma carteira própria.
  let feeNative = ZERO;
  if (isOwned(tx.from)) {
    feeNative = fromUnits(d(tx.gasUsed).mul(d(tx.gasPrice)).plus(d(tx.l1FeeWei ?? "0")).toFixed(0), native.decimals);
    trace.push(`Taxa de rede paga por carteira própria: ${feeNative.toString()} ${native.symbol}`);
  }
  const nativePrice = native.priceRef === "USD" ? d(1) : priceAt(native.priceRef, tx.timestamp);
  const feeUsd = nativePrice ? feeNative.mul(nativePrice) : feeNative.isZero() ? ZERO : null;

  const base = {
    chainId: tx.chainId,
    hash: tx.hash,
    blockNumber: tx.blockNumber,
    timestamp: tx.timestamp,
    feeNative,
    feeUsd,
    unrecognizedTokens: [] as ClassifiedTx["unrecognizedTokens"],
  };
  const wallet = isOwned(tx.from) ? lc(tx.from) : isOwned(tx.to) ? lc(tx.to) : null;

  if (tx.isError) {
    trace.push("Transação revertida: nenhum ativo movimentado, apenas a taxa foi consumida.");
    return {
      ...base, kind: "FAILED", legs: [], wallet, counterparties: [], btcDelta: ZERO,
      counterValueUsd: null, impliedBtcPriceUsd: null, needsReview: false, trace,
    };
  }

  // 2) Fluxos: (ativo, de, para, quantidade)
  type Flow = { asset: AssetDef; from: string; to: string; amount: Decimal };
  const flows: Flow[] = [];
  const unrecognized = new Map<string, string | undefined>();

  if (d(tx.valueWei).gt(0)) {
    flows.push({ asset: native, from: lc(tx.from), to: lc(tx.to), amount: fromUnits(tx.valueWei, native.decimals) });
  }
  for (const it of internalTransfers) {
    if (it.isError || d(it.valueWei).lte(0)) continue;
    flows.push({ asset: native, from: lc(it.from), to: lc(it.to), amount: fromUnits(it.valueWei, native.decimals) });
  }
  for (const t of tokenTransfers) {
    const asset = findAsset(tx.chainId, t.tokenAddress);
    if (!asset) {
      if (isOwned(t.from) || isOwned(t.to)) unrecognized.set(lc(t.tokenAddress), t.tokenSymbol);
      continue;
    }
    flows.push({ asset, from: lc(t.from), to: lc(t.to), amount: fromUnits(t.value, asset.decimals) });
  }
  base.unrecognizedTokens = [...unrecognized].map(([address, symbol]) => ({ address, symbol }));
  if (unrecognized.size) trace.push(`${unrecognized.size} token(s) fora do registro ignorado(s) no cálculo.`);

  // 3) Saldo líquido por ativo do ponto de vista do usuário (carteiras somadas).
  const net = new Map<string, { asset: AssetDef; amount: Decimal }>();
  const counterparties = new Set<string>();
  let internalFlowCount = 0;
  for (const f of flows) {
    const fromOwned = isOwned(f.from);
    const toOwned = isOwned(f.to);
    if (!fromOwned && !toOwned) continue;
    if (fromOwned && toOwned) {
      internalFlowCount++;
      continue; // transferência entre carteiras próprias: neutra
    }
    const k = assetId(f.asset);
    const cur = net.get(k) ?? { asset: f.asset, amount: ZERO };
    cur.amount = toOwned ? cur.amount.plus(f.amount) : cur.amount.minus(f.amount);
    net.set(k, cur);
    counterparties.add(toOwned ? f.from : f.to);
  }

  const legs: Leg[] = [];
  for (const { asset, amount } of net.values()) {
    if (amount.isZero()) continue;
    const price = unitPriceUsd(asset, tx.timestamp, priceAt);
    const abs = amount.abs();
    legs.push({
      assetId: assetId(asset), symbol: asset.symbol, assetClass: asset.class,
      direction: amount.gt(0) ? "IN" : "OUT", amount: abs,
      unitPriceUsd: price, valueUsd: price ? abs.mul(price) : null,
    });
  }

  const ins = legs.filter((l) => l.direction === "IN");
  const outs = legs.filter((l) => l.direction === "OUT");
  const btcIn = sum(ins.filter((l) => l.assetClass === "BTC").map((l) => l.amount));
  const btcOut = sum(outs.filter((l) => l.assetClass === "BTC").map((l) => l.amount));
  const btcDelta = btcIn.minus(btcOut);
  const valueOf = (ls: Leg[]) => (ls.some((l) => l.valueUsd === null) ? null : sum(ls.map((l) => l.valueUsd as Decimal)));

  let kind: OperationKind;
  let counterValueUsd: Decimal | null = null;
  let needsReview = false;

  if (legs.length === 0) {
    if (internalFlowCount > 0) {
      kind = "INTERNAL_TRANSFER";
      trace.push("Somente movimentação entre carteiras próprias: sem efeito em custo ou resultado.");
    } else if (/approve/i.test(tx.functionName ?? "")) {
      kind = "APPROVAL";
      trace.push("Aprovação de token: sem movimentação de ativos.");
    } else {
      kind = "CONTRACT_INTERACTION";
      trace.push("Interação com contrato sem fluxo de ativos reconhecidos.");
      if (unrecognized.size) needsReview = true;
    }
  } else if (ins.length && outs.length) {
    const btcSideIn = ins.some((l) => l.assetClass === "BTC");
    const btcSideOut = outs.some((l) => l.assetClass === "BTC");
    if (btcSideIn && !btcSideOut) {
      kind = "BUY_BTC";
      counterValueUsd = valueOf(outs);
      trace.push(`Compra de exposição a BTC: recebeu ${btcIn} BTC, entregou ${outs.map((l) => `${l.amount} ${l.symbol}`).join(" + ")}.`);
    } else if (btcSideOut && !btcSideIn) {
      kind = "SELL_BTC";
      counterValueUsd = valueOf(ins);
      trace.push(`Venda de BTC: entregou ${btcOut} BTC, recebeu ${ins.map((l) => `${l.amount} ${l.symbol}`).join(" + ")}.`);
    } else if (btcSideIn && btcSideOut) {
      kind = "BTC_CONVERSION";
      trace.push("Conversão entre representações de BTC: custo de aquisição preservado.");
      if (legs.some((l) => l.assetClass !== "BTC")) {
        needsReview = true;
        trace.push("Conversão envolve outros ativos além de BTC: revisar manualmente.");
      }
    } else {
      const classes = new Set(legs.map((l) => l.assetClass));
      kind = classes.size === 1 && !classes.has("STABLE_USD") ? "WRAP" : "SWAP_OTHER";
      trace.push(kind === "WRAP" ? "Wrap/unwrap de ativo nativo." : "Swap sem BTC: fora do livro de BTC, entra no patrimônio.");
    }
    if (counterValueUsd === null && (kind === "BUY_BTC" || kind === "SELL_BTC")) {
      needsReview = true;
      trace.push("Preço histórico da contraparte indisponível: valor não calculado.");
    }
  } else if (input.custodyAddresses && counterparties.size > 0 && [...counterparties].every((c) => input.custodyAddresses!.has(c))) {
    kind = ins.length ? "DERIV_WITHDRAWAL" : "DERIV_DEPOSIT";
    trace.push(ins.length
      ? "Retorno de fundos de conta de derivativos própria: não é aporte."
      : "Envio para conta de derivativos própria: não é retirada; o saldo passa a ser contado pela integração da plataforma.");
  } else if (ins.length) {
    kind = "TRANSFER_IN";
    trace.push("Depósito recebido de endereço externo: aumenta o capital aportado, não é lucro.");
  } else {
    kind = "TRANSFER_OUT";
    trace.push("Envio para endereço externo: reduz o capital aportado, não é prejuízo.");
  }

  let impliedBtcPriceUsd: Decimal | null = null;
  if ((kind === "BUY_BTC" || kind === "SELL_BTC") && counterValueUsd && !btcDelta.isZero()) {
    impliedBtcPriceUsd = counterValueUsd.div(btcDelta.abs());
    const market = priceAt("BTC", tx.timestamp);
    if (market) {
      const dev = impliedBtcPriceUsd.minus(market).abs().div(market);
      trace.push(`Preço implícito US$ ${impliedBtcPriceUsd.toFixed(2)} vs mercado US$ ${market.toFixed(2)} (${dev.mul(100).toFixed(2)}%).`);
      if (dev.gt(tolerance)) {
        needsReview = true;
        trace.push(`Divergência acima de ${tolerance * 100}%: revisar (slippage alto, rota exótica ou dado incompleto).`);
      }
    }
  }

  return {
    ...base, kind, legs, wallet, counterparties: [...counterparties], btcDelta, counterValueUsd,
    impliedBtcPriceUsd, needsReview, trace,
  };
}

/**
 * Pareia saídas e entradas do mesmo tipo de ativo em redes diferentes (bridges).
 * Uma saída na rede A + entrada na rede B dentro da janela, com valor entre
 * (1 − maxFee) e 1 da saída, vira BRIDGE_OUT/BRIDGE_IN e preserva o custo.
 */
export function pairBridges(
  txs: ClassifiedTx[],
  opts: { windowSec?: number; maxFeeRatio?: number } = {},
): ClassifiedTx[] {
  const windowSec = opts.windowSec ?? 6 * 3600;
  const maxFee = d(opts.maxFeeRatio ?? 0.03);
  const out = txs.map((t) => ({ ...t, trace: [...t.trace] }));
  const used = new Set<number>();
  const singleClass = (t: ClassifiedTx) => (t.legs.length === 1 ? t.legs[0]! : null);

  out.forEach((o, i) => {
    if (o.kind !== "TRANSFER_OUT" || used.has(i)) return;
    const leg = singleClass(o);
    if (!leg) return;
    let best = -1;
    out.forEach((c, j) => {
      if (best >= 0 || used.has(j) || c.kind !== "TRANSFER_IN" || c.chainId === o.chainId) return;
      const cl = singleClass(c);
      if (!cl || cl.assetClass !== leg.assetClass) return;
      const dt = c.timestamp - o.timestamp;
      if (dt < 0 || dt > windowSec) return;
      const ratio = cl.amount.div(leg.amount);
      if (ratio.lte(1) && ratio.gte(d(1).minus(maxFee))) best = j;
    });
    if (best >= 0) {
      const c = out[best]!;
      const group = `${o.chainId}:${o.hash}->${c.chainId}:${c.hash}`;
      o.kind = "BRIDGE_OUT"; c.kind = "BRIDGE_IN";
      o.bridgeGroup = c.bridgeGroup = group;
      const fee = leg.amount.minus(singleClass(c)!.amount);
      o.trace.push(`Pareado como bridge com ${c.chainId}:${c.hash.slice(0, 10)}… (diferença ${fee} ${leg.symbol} tratada como taxa).`);
      c.trace.push(`Pareado como bridge com ${o.chainId}:${o.hash.slice(0, 10)}…: custo de aquisição preservado.`);
      used.add(i); used.add(best);
    }
  });
  return out;
}
