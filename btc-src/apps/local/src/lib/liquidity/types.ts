export const NETWORKS = [{ id: 1, name: "Ethereum", slug: "ethereum", rpc: "https://ethereum-rpc.publicnode.com" }, { id: 42161, name: "Arbitrum", slug: "arbitrum", rpc: "https://arbitrum-one-rpc.publicnode.com" }, { id: 8453, name: "Base", slug: "base", rpc: "https://base-rpc.publicnode.com" }, { id: 10, name: "Optimism", slug: "optimism", rpc: "https://optimism-rpc.publicnode.com" }, { id: 137, name: "Polygon", slug: "polygon", rpc: "https://polygon-bor-rpc.publicnode.com" }, { id: 56, name: "BNB Chain", slug: "bsc", rpc: "https://bsc-rpc.publicnode.com" }] as const;
export interface LPToken {
    address: string;
    symbol: string;
    decimals: number;
    qty: string;
    priceUsd: number | null;
}
export interface LPPosition {
    id: string;
    accountId: string;
    owner: string;
    network: string;
    chainId: number;
    protocol: string;
    pool: string;
    positionId: string;
    block: string;
    at: number;
    tokens: LPToken[];
    valueUsd: number | null;
    owedRaw: string[];
    pendingFees?: string[];
    tick: number;
    lowerTick: number;
    upperTick: number;
    price: number;
    lower: number;
    upper: number;
    liquidity: string;
    feeTier: number;
    status: "IN RANGE" | "OUT OF RANGE" | "CLOSED";
    historyComplete: false;
}
export interface ScanResult {
    positions: LPPosition[];
    notes: string[];
    complete: boolean;
    next: number | null;
}
export interface LPAdapter {
    id: string;
    discover(accountId: string, owner: string, chainId: number, offset: number, signal: AbortSignal): Promise<ScanResult>;
}
export interface PoolMarket {
    id: string;
    pool: string | null;
    network: string;
    protocol: string;
    pair: string;
    tvl: number | null;
    volume24: number | null;
    volume7: number | null;
    apy: number | null;
    feeTier: string | null;
    created: number | null;
    url: string | null;
    source: "DexScreener" | "DefiLlama";
    at: number;
    risks: string[];
}
