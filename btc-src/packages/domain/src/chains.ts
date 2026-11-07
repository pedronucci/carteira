/**
 * Redes EVM suportadas. Adicionar uma rede = adicionar uma entrada aqui
 * (+ endereço dos tokens em assets.ts). Nenhum código novo.
 */
export type ExplorerKind = "etherscan-v2" | "blockscout-pro";

export interface ChainConfig {
  id: number;
  key: string;
  name: string;
  nativeSymbol: string;
  nativeDecimals: number;
  /** Blocos até considerar a transação final (proteção contra reorg). */
  confirmations: number;
  explorer: ExplorerKind;
  /** true quando o plano gratuito do explorador cobre a rede (nov/2026). */
  explorerFreeTier: boolean;
  explorerTxUrl: string;
  defaultRpc: string;
}

export const CHAINS: ChainConfig[] = [
  {
    id: 1, key: "ethereum", name: "Ethereum", nativeSymbol: "ETH", nativeDecimals: 18,
    confirmations: 12, explorer: "etherscan-v2", explorerFreeTier: true,
    explorerTxUrl: "https://etherscan.io/tx/", defaultRpc: "https://ethereum-rpc.publicnode.com",
  },
  {
    id: 42161, key: "arbitrum", name: "Arbitrum One", nativeSymbol: "ETH", nativeDecimals: 18,
    confirmations: 20, explorer: "etherscan-v2", explorerFreeTier: true,
    explorerTxUrl: "https://arbiscan.io/tx/", defaultRpc: "https://arbitrum-one-rpc.publicnode.com",
  },
  {
    id: 8453, key: "base", name: "Base", nativeSymbol: "ETH", nativeDecimals: 18,
    confirmations: 20, explorer: "blockscout-pro", explorerFreeTier: true,
    explorerTxUrl: "https://basescan.org/tx/", defaultRpc: "https://base-rpc.publicnode.com",
  },
  {
    id: 10, key: "optimism", name: "Optimism", nativeSymbol: "ETH", nativeDecimals: 18,
    confirmations: 20, explorer: "blockscout-pro", explorerFreeTier: true,
    explorerTxUrl: "https://optimistic.etherscan.io/tx/", defaultRpc: "https://optimism-rpc.publicnode.com",
  },
  {
    id: 56, key: "bsc", name: "BNB Smart Chain", nativeSymbol: "BNB", nativeDecimals: 18,
    // Etherscan V2 exige plano pago para BSC; Blockscout não cobre BSC.
    confirmations: 15, explorer: "etherscan-v2", explorerFreeTier: false,
    explorerTxUrl: "https://bscscan.com/tx/", defaultRpc: "https://bsc-rpc.publicnode.com",
  },
];

export const CHAIN_BY_ID = new Map(CHAINS.map((c) => [c.id, c]));

export function getChain(id: number): ChainConfig {
  const c = CHAIN_BY_ID.get(id);
  if (!c) throw new Error(`Rede não suportada: ${id}`);
  return c;
}
