import {d, type PHolding} from "@bst/domain";
import {accountLP, type LPHistory} from "./ledger";
import type {LPPosition} from "./types";

/** Rateio explícito: divide o gas da TX entre as posições acompanhadas nessa TX. */
export function allocatedHistory(history:LPHistory, all:Record<string,LPHistory>):LPHistory {
 const shares=new Map<string,Set<string>>();
 for(const h of Object.values(all))for(const e of h.events){const key=`${h.positionId.split(":").slice(0,2).join(":")}:${e.tx}`;const set=shares.get(key)??new Set<string>();set.add(h.positionId);shares.set(key,set);}
 return {...history,events:history.events.map(e=>({...e,gasUsd:e.gasUsd==null?null:e.gasUsd/(shares.get(`${history.positionId.split(":").slice(0,2).join(":")}:${e.tx}`)?.size??1)}))};
}
export function positionMetrics(p:LPPosition,histories:Record<string,LPHistory>,now=Date.now()){
 const h=histories[p.id];if(!h)return null;
 const history=allocatedHistory(h,histories),complete=h.complete&&h.throughBlock===p.block&&now-p.at<600000&&(p.lowerTick===p.upperTick||p.pendingFees!=null);
 const result=accountLP({...history,complete},p.valueUsd,p.owner,p.liquidity);
 const duration=h.at-h.events.filter(e=>e.kind==="DEPOSIT").reduce((min,e)=>Math.min(min,e.at),h.at);
 const apr=result.dietz!=null&&duration>=86400000?result.dietz*365*86400000/duration:null;
 const projected=apr!=null&&1+apr/365>0?Math.expm1(365*Math.log1p(apr/365)):null;
 // Comparação direta verificável para aportes sem resgate: não extrapola 50/50 para CL.
 let hodl:number|null=null,divergence:number|null=null,vsHodl:number|null=null;
 if(result.complete&&!h.events.some(e=>["DECREASE","WITHDRAW","TRANSFER"].includes(e.kind)&&!(e.kind==="TRANSFER"&&/^0x0{40}$/.test(e.transferFrom??"")))&&p.tokens.every(t=>t.priceUsd!=null)){
  const held=[d(0),d(0)];for(const e of h.events)if(e.kind==="DEPOSIT")held.forEach((q,i)=>held[i]=q.plus(e.amounts[i]!));
  hodl=held.reduce((s,q,i)=>s.plus(q.mul(p.tokens[i]!.priceUsd!)),d(0)).toNumber();
  const principal=p.tokens.reduce((s,t)=>s.plus(d(t.qty).mul(t.priceUsd!)),d(0)).toNumber();
  if(hodl>0){divergence=principal/hodl-1;vsHodl=(p.valueUsd!+result.out-result.gas!)/hodl-1;}
 }
 return {...result,apr,projectedApy:projected!=null&&Number.isFinite(projected)?projected:null,hodl,divergence,vsHodl};
}
/** Substitui apenas o recibo exato na mesma conta; nunca subtrai tokens livres. */
export function lpHoldings(base:PHolding[],positions:LPPosition[]):PHolding[]{
 const owned=positions.filter(p=>!p.archived),receipts=new Set(owned.filter(p=>p.receiptAssetKey).map(p=>`${p.accountId}|${p.receiptAssetKey}`));
 return [...base.filter(h=>!receipts.has(`${h.accountId}|${h.assetKey}`)),...owned.map(p=>({accountId:p.accountId,assetKey:`lp:${p.id}`,econ:`LP:${p.id}`,symbol:`LP ${p.tokens.map(t=>t.symbol).join("/")}`,name:p.protocol,network:p.network,qty:"1",valueUsd:p.valueUsd,priceUsd:p.valueUsd,kind:"spot" as const,source:"sync" as const,at:p.at}))];
}
