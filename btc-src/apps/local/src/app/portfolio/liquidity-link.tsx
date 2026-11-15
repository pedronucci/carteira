import Link from "next/link";
import {useLPPositions} from "@/lib/liquidity/state";
import {lpFresh} from "@/lib/liquidity/analytics";
import {useFmt} from "@/lib/state";
import {portfolio} from "@/lib/portfolio/db";
import {walletMeta} from "@/lib/wallets";
export function LPPortfolioLink({totalUsd}:{totalUsd:number}){const f=useFmt(),rows=useLPPositions().filter(p=>!p.archived&&portfolio().accounts.some(a=>a.id===p.accountId&&walletMeta(a).enabled)),known=rows.filter(p=>p.valueUsd!=null&&lpFresh(p)),value=known.reduce((sum,p)=>sum+p.valueUsd!,0);return <div className="my-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface p-3 text-[12px]"><div><span className="font-semibold">LIQUIDITY POOLS</span><span className="ml-2 text-muted">{rows.length?`${rows.length} posições • ${known.length?f.usd(value):"Dados insuficientes"}${known.length&&totalUsd>0?` • ${(value/totalUsd*100).toFixed(2)}% do patrimônio conhecido`:""} • recibos substituídos sem duplicação`:"Acompanhamento de liquidez e Pool Explorer"}</span></div><Link href="/liquidity-pools" className="text-accent">Abrir módulo →</Link></div>;}
