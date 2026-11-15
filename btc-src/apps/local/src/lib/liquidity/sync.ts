import {portfolio} from "../portfolio/db";
import {walletMeta} from "../wallets";
import {NETWORKS,type LPPosition,type ScanResult} from "./types";
import {uniswapV3,pricePositions,rpc} from "./uniswap-v3";
import {discoverIndexed} from "./evm-indexed";
import {solanaCL,solRpc} from "./solana";
import {discoverCpmm} from "./raydium-cpmm";
import {v3History} from "./history";
import {v2History,v4History} from "./evm-history";
import {solanaHistory} from "./solana-history";
import {uniquePositions} from "./math";
import {initializeLP,lpData,setLPHistory,setLPPositions,setLPSyncing,setLPCoverage} from "./state";

let running:Promise<string[]>|null=null;
export function syncLPPositions(signal=new AbortController().signal,progress:(text:string)=>void=()=>{}){
 if(running)return running;
 running=run(signal,progress).finally(()=>{running=null;setLPSyncing(false);});return running;
}
async function run(signal:AbortSignal,progress:(text:string)=>void){
 await initializeLP();setLPSyncing(true);const warnings:string[]=[];
 const accounts=portfolio().accounts.filter(a=>["evm","solana"].includes(a.kind)&&walletMeta(a).enabled).filter((a,i,all)=>all.findIndex(b=>b.kind===a.kind&&String(b.config?.address??b.addresses?.[0])===String(a.config?.address??a.addresses?.[0]))===i);
 let latest=lpData().positions.filter(p=>accounts.some(a=>a.id===p.accountId));
 for(const a of accounts){const owner=String(a.config?.address??a.addresses?.[0]??"");
 for(const net of a.kind==="solana"?[{id:101,name:"Solana",rpc:""}]:NETWORKS){
 const jobs=a.kind==="solana"?[
  {protocols:["Orca Whirlpools","Raydium CLMM"],run:(offset:number)=>solanaCL.discover(a.id,owner,101,offset,signal)},
  {protocols:["Raydium CPMM"],run:()=>discoverCpmm(a.id,owner,signal)}]:[
  {protocols:["Uniswap V3"],run:(offset:number)=>uniswapV3.discover(a.id,owner,net.id,offset,signal)},
  {protocols:["Uniswap V2","Uniswap V4"],run:()=>discoverIndexed(a.id,owner,net.id,signal)}];
 for(const job of jobs){const key=`${a.id}:${net.id}:${job.protocols.join(",")}`;let coverage=false;
 try{if(signal.aborted)throw Error("Consulta cancelada");progress(`${a.name} · ${net.name} · ${job.protocols.join(" / ")}`);
 let offset=0,found:LPPosition[]=[],notes:string[]=[],result:ScanResult;let pages=0;
 do{result=await job.run(offset);found=uniquePositions([...found,...result.positions]);notes.push(...result.notes);if(result.next!=null&&result.next<=offset)throw Error("Paginação não avançou");offset=result.next??0;if(++pages>=500&&result.next!=null)throw Error("Limite de páginas atingido; cache preservado");}while(result.next!=null&&!signal.aborted);
 if(signal.aborted)throw Error("Consulta cancelada");coverage=result.complete&&notes.length===0;
 let priced=found;try{priced=await pricePositions(found,signal);}catch(e){notes.push(`Preços: ${(e as Error).message}`);}
 if(coverage){const ids=new Set(priced.map(p=>p.id));const removed=latest.filter(p=>!p.archived&&p.accountId===a.id&&p.chainId===net.id&&job.protocols.includes(p.protocol)&&!ids.has(p.id));
  if(removed.length){const block=net.id===101?`slot:${await solRpc("getSlot",[{commitment:"finalized"}],signal)}`:await rpc(net.rpc,"eth_blockNumber",[],signal);latest=latest.map(p=>removed.includes(p)?{...p,archived:true,status:"CLOSED",valueUsd:0,liquidity:"0",owedRaw:["0","0"],pendingFees:["0","0"],block,at:Date.now(),tokens:p.tokens.map(t=>({...t,qty:"0"}))}:p);}
 }
 latest=uniquePositions([...latest,...priced.map(p=>({...p,archived:false}))]);setLPPositions(latest);warnings.push(...notes.map(n=>`${net.name}: ${n}`));
 }catch(e){warnings.push(`${net.name} / ${job.protocols.join(" / ")}: ${(e as Error).message}. Último registro preservado.`);}
 setLPCoverage(key,{at:Date.now(),complete:coverage});
 }}}
 for(const p of latest){if(signal.aborted)break;const old=lpData().histories[p.id];if(old?.throughBlock===p.block)continue;progress(`Histórico · ${p.network} · ${p.positionId.slice(0,16)}`);
 try{setLPHistory(await (p.chainId===101?solanaHistory:p.protocol==="Uniswap V2"?v2History:p.protocol==="Uniswap V4"?v4History:v3History)(p,signal));}catch(e){warnings.push(`Histórico ${p.positionId}: ${(e as Error).message}`);}}
 return warnings;
}
