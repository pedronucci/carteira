import Link from "next/link";
import {useLPPositions} from "@/lib/liquidity/state";
import {portfolio} from "@/lib/portfolio/db";
import {walletMeta} from "@/lib/wallets";
export function LPPortfolioLink(){const rows=useLPPositions().filter(p=>portfolio().accounts.some(a=>a.id===p.accountId&&walletMeta(a).enabled));return <div className="my-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface p-3 text-[12px]"><div><span className="font-semibold">LIQUIDITY POOLS</span><span className="ml-2 text-muted">{rows.length?`${rows.length} posições observadas • avaliação separada até reconciliação de fluxos` : "Acompanhamento de liquidez e Pool Explorer"}</span></div><Link href="/liquidity-pools" className="text-accent">Abrir módulo →</Link></div>;}
