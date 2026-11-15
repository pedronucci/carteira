import {d} from "@bst/domain";
export interface LPEvent {id:string;positionId:string;tx:string;block:number;index:number;at:number;kind:"DEPOSIT"|"DECREASE"|"COLLECT"|"WITHDRAW"|"TRANSFER";amounts:[string,string];liquidity:string;prices:[number|null,number|null];gasUsd:number|null;transferFrom?:string;transferTo?:string;feesEmbedded?:boolean}
export interface LPHistory {positionId:string;events:LPEvent[];complete:boolean;at:number;notes:string[];throughBlock:string}
export function valuePair(amounts:string[],prices:(number|null)[]){let value=d(0);for(let i=0;i<2;i++){const q=d(amounts[i]??"0"),p=prices[i];if(!q.isFinite()||q.lt(0))throw Error("Quantidade histórica inválida");if(q.isZero())continue;if(p==null||!Number.isFinite(p)||p<=0)return null;value=value.plus(q.mul(p));}return value;}
export function accountLP(history:LPHistory,current:number|null,owner:string,expectedLiquidity?:string){
 const events=[...new Map(history.events.map(e=>[e.id,e])).values()].sort((a,b)=>a.block-b.block||a.index-b.index);let deposits=d(0),out=d(0),collectedFees=d(0),gas=d(0),basis=d(0),liq=d(0),realized=d(0),complete=history.complete;const principal=[d(0),d(0)],pendingBasis=[d(0),d(0)],paidTx=new Set<string>();const start=events[0]?.at??history.at,end=history.at;
 let weighted=d(0);
 for(const e of events){if(e.kind==="TRANSFER"){if((owner.startsWith("0x")?e.transferTo?.toLowerCase()===owner.toLowerCase():e.transferTo===owner)&&!/^0x0{40}$/.test(e.transferFrom??""))complete=false;continue;}
 const value=valuePair(e.amounts,e.prices);if(value==null){complete=false;continue;}
 if(!paidTx.has(e.tx)){if(e.gasUsd==null)complete=false;else gas=gas.plus(e.gasUsd);paidTx.add(e.tx);}
 const l=d(e.liquidity);if(!l.isFinite()||l.lt(0))throw Error("Liquidez histórica inválida");
 if(e.kind==="DEPOSIT"){deposits=deposits.plus(value);basis=basis.plus(value);liq=liq.plus(l);weighted=weighted.plus(value.mul(Math.max(0,end-e.at)));}
 if(e.kind==="DECREASE"){if(liq.lte(0)||l.gt(liq)){complete=false;continue;}const released=basis.mul(l).div(liq);basis=basis.minus(released);liq=liq.minus(l);for(let i=0;i<2;i++){const q=d(e.amounts[i]!);principal[i]=principal[i]!.plus(q);pendingBasis[i]=pendingBasis[i]!.plus(value.isZero()?released.div(2):released.mul(q).mul(e.prices[i]??0).div(value));}}
 if(e.kind==="COLLECT"){let fees=d(0),cost=d(0);for(let i=0;i<2;i++){const q=d(e.amounts[i]!),p=e.prices[i]??0,taken=q.lt(principal[i]!)?q:principal[i]!;const b=principal[i]!.gt(0)?pendingBasis[i]!.mul(taken).div(principal[i]!):d(0);cost=cost.plus(b);fees=fees.plus(q.minus(taken).mul(p));principal[i]=principal[i]!.minus(taken);pendingBasis[i]=pendingBasis[i]!.minus(b);}out=out.plus(value);collectedFees=collectedFees.plus(fees);realized=realized.plus(value).minus(cost);weighted=weighted.minus(value.mul(Math.max(0,end-e.at)));}
 if(e.kind==="WITHDRAW"){if(liq.lte(0)||l.gt(liq)){complete=false;continue;}const cost=basis.mul(l).div(liq);basis=basis.minus(cost);liq=liq.minus(l);out=out.plus(value);realized=realized.plus(value).minus(cost);weighted=weighted.minus(value.mul(Math.max(0,end-e.at)));}
 }
 if(expectedLiquidity!=null&&!liq.eq(expectedLiquidity))complete=false;
 if(!complete||current==null||!Number.isFinite(current)||current<0||deposits.lte(0))return {complete:false,deposits:deposits.toNumber(),out:out.toNumber(),pnl:null,realized:null,unrealized:null,fees:null,gas:null,dietz:null,feeApr:null};
 const unrealized=d(current).minus(basis).minus(pendingBasis[0]!).minus(pendingBasis[1]!),pnl=d(current).plus(out).minus(deposits).minus(gas),duration=end-start,denominator=duration>0?weighted.div(duration):d(0);
 return {complete:true,deposits:deposits.toNumber(),out:out.toNumber(),pnl:pnl.toNumber(),realized:realized.minus(gas).toNumber(),unrealized:unrealized.toNumber(),fees:events.some(e=>e.feesEmbedded)?null:collectedFees.toNumber(),gas:gas.toNumber(),dietz:denominator.gt(0)?pnl.div(denominator).toNumber():null,feeApr:!events.some(e=>e.feesEmbedded)&&duration>=86400000&&denominator.gt(0)?collectedFees.div(denominator).mul(365*86400000/duration).toNumber():null};
}
