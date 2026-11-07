/**
 * Registro de ativos reconhecidos. Somente contratos listados aqui entram no cálculo
 * financeiro: tokens com símbolo "USDC" ou "WBTC" em outro endereço são tratados como
 * NÃO RECONHECIDOS (proteção contra tokens falsos / spam airdrops).
 *
 * Endereços verificados manualmente nos exploradores oficiais. Revise antes de adicionar.
 */
export type AssetClass = "BTC" | "STABLE_USD" | "ETH" | "BNB" | "OTHER";

export interface AssetDef {
  chainId: number;
  /** "native" para o ativo nativo da rede. Endereço em minúsculas. */
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  class: AssetClass;
  /** Ativo de referência para preço: BTC, USD, ETH, BNB. */
  priceRef: "BTC" | "USD" | "ETH" | "BNB";
}

const A = (
  chainId: number, address: string, symbol: string, name: string, decimals: number,
  cls: AssetClass, priceRef: AssetDef["priceRef"],
): AssetDef => ({ chainId, address: address.toLowerCase(), symbol, name, decimals, class: cls, priceRef });

export const ASSETS: AssetDef[] = [
  // Ethereum
  A(1, "native", "ETH", "Ether", 18, "ETH", "ETH"),
  A(1, "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", "WETH", "Wrapped Ether", 18, "ETH", "ETH"),
  A(1, "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", "WBTC", "Wrapped BTC", 8, "BTC", "BTC"),
  A(1, "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", "cbBTC", "Coinbase Wrapped BTC", 8, "BTC", "BTC"),
  A(1, "0x18084fbA666a33d37592fA2633fD49a74DD93a88", "tBTC", "tBTC v2", 18, "BTC", "BTC"),
  A(1, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "USDC", "USD Coin", 6, "STABLE_USD", "USD"),
  A(1, "0xdAC17F958D2ee523a2206206994597C13D831ec7", "USDT", "Tether USD", 6, "STABLE_USD", "USD"),
  A(1, "0x6B175474E89094C44Da98b954EedeAC495271d0F", "DAI", "Dai", 18, "STABLE_USD", "USD"),
  // Arbitrum One
  A(42161, "native", "ETH", "Ether", 18, "ETH", "ETH"),
  A(42161, "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", "WETH", "Wrapped Ether", 18, "ETH", "ETH"),
  A(42161, "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", "WBTC", "Wrapped BTC", 8, "BTC", "BTC"),
  A(42161, "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", "cbBTC", "Coinbase Wrapped BTC", 8, "BTC", "BTC"),
  A(42161, "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", "USDC", "USD Coin", 6, "STABLE_USD", "USD"),
  A(42161, "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8", "USDC.e", "Bridged USDC", 6, "STABLE_USD", "USD"),
  A(42161, "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", "USDT", "Tether USD", 6, "STABLE_USD", "USD"),
  // Base
  A(8453, "native", "ETH", "Ether", 18, "ETH", "ETH"),
  A(8453, "0x4200000000000000000000000000000000000006", "WETH", "Wrapped Ether", 18, "ETH", "ETH"),
  A(8453, "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", "cbBTC", "Coinbase Wrapped BTC", 8, "BTC", "BTC"),
  A(8453, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "USDC", "USD Coin", 6, "STABLE_USD", "USD"),
  // Optimism
  A(10, "native", "ETH", "Ether", 18, "ETH", "ETH"),
  A(10, "0x4200000000000000000000000000000000000006", "WETH", "Wrapped Ether", 18, "ETH", "ETH"),
  A(10, "0x68f180fcCe6836688e9084f035309E29Bf0A2095", "WBTC", "Wrapped BTC", 8, "BTC", "BTC"),
  A(10, "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", "USDC", "USD Coin", 6, "STABLE_USD", "USD"),
  A(10, "0x7F5c764cBc14f9669B88837ca1490cCa17c31607", "USDC.e", "Bridged USDC", 6, "STABLE_USD", "USD"),
  A(10, "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", "USDT", "Tether USD", 6, "STABLE_USD", "USD"),
  // BNB Smart Chain
  A(56, "native", "BNB", "BNB", 18, "BNB", "BNB"),
  A(56, "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", "WBNB", "Wrapped BNB", 18, "BNB", "BNB"),
  A(56, "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", "BTCB", "Binance-Peg BTCB", 18, "BTC", "BTC"),
  A(56, "0x55d398326f99059fF775485246999027B3197955", "USDT", "Binance-Peg USDT", 18, "STABLE_USD", "USD"),
  A(56, "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", "USDC", "Binance-Peg USDC", 18, "STABLE_USD", "USD"),
];

const KEY = (chainId: number, address: string) => `${chainId}:${address.toLowerCase()}`;
const BY_KEY = new Map(ASSETS.map((a) => [KEY(a.chainId, a.address), a]));

export function findAsset(chainId: number, address: string): AssetDef | undefined {
  return BY_KEY.get(KEY(chainId, address));
}

export function nativeAsset(chainId: number): AssetDef {
  const a = BY_KEY.get(KEY(chainId, "native"));
  if (!a) throw new Error(`Ativo nativo não registrado para a rede ${chainId}`);
  return a;
}

export function assetsForChain(chainId: number): AssetDef[] {
  return ASSETS.filter((a) => a.chainId === chainId);
}

export function assetId(a: Pick<AssetDef, "chainId" | "address">): string {
  return KEY(a.chainId, a.address);
}
