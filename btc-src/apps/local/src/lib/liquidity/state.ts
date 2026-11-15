import {useSyncExternalStore} from "react";
import {emptyLPData,readLPData,writeLPData,validateLPData,type LPData} from "./store";
import type {LPPosition,PoolMarket} from "./types";
import type {LPHistory} from "./ledger";
let syncing=false;
export const lpSyncing=()=>syncing;
export function setLPSyncing(value:boolean){syncing=value;notify();}
let data:LPData=emptyLPData(),version=0,error:string|null=null,ready=false,loading:Promise<void>|null=null,writes=Promise.resolve(),writable=true;
const subs=new Set<()=>void>();
export const lpPositions=()=>data.positions;
export const lpData=()=>data;
export const lpError=()=>error;
export const lpReady=()=>ready;
export const subscribeLP=(f:()=>void)=>{subs.add(f);return()=>{subs.delete(f);};};
const notify=()=>{version++;subs.forEach(f=>f());};
let dirty=0,saved=0,saving=false;
function persist(){if(!writable)return;dirty++;if(saving)return;saving=true;writes=(async()=>{while(saved!==dirty){const v=dirty;await writeLPData(structuredClone(data));saved=v;}})().catch(e=>{error=`Cache LP não salvo: ${(e as Error).message}`;notify();}).finally(()=>{saving=false;});}
export function initializeLP(){if(loading)return loading;loading=(async()=>{try{data=await readLPData();}catch(e){error=(e as Error).message;writable=false;}ready=true;notify();})();return loading;}
export function setLPPositions(next:LPPosition[]){const alerts=[...(data.alerts??[])];for(const p of next){const old=data.positions.find(x=>x.id===p.id);if(p.status==="OUT OF RANGE"&&old?.status!==p.status)alerts.push({id:`range:${p.id}:${p.block}`,at:Date.now(),text:`${p.protocol} / ${p.tokens.map(t=>t.symbol).join("/")} fora do range (${p.network}).`});}data={...data,positions:next,alerts:alerts.slice(-300)};const seen=new Set(data.observations.map(o=>o.id));const added=next.filter(p=>!seen.has(`${p.id}:${p.block}`)).map(p=>({id:`${p.id}:${p.block}`,positionId:p.id,at:p.at,block:p.block,valueUsd:p.valueUsd,fees:p.pendingFees??null,status:p.status,liquidity:p.liquidity,valuationComplete:p.lowerTick===p.upperTick||p.pendingFees!=null}));data.observations=[...data.observations,...added].filter(o=>o.at>Date.now()-366*86400000).slice(-30000);persist();notify();}
export function setLPHistory(history:LPHistory){data={...data,histories:{...data.histories,[history.positionId]:history}};persist();notify();}
export const useLPPositions=()=>useSyncExternalStore(subscribeLP,lpPositions,lpPositions);
export const useLPVersion=()=>useSyncExternalStore(subscribeLP,()=>version,()=>version);

export function setLPCoverage(key:string,value:{at:number;complete:boolean}){data={...data,coverage:{...data.coverage,[key]:value}};persist();notify();}

export async function observeMarkets(pools:PoolMarket[]){await initializeLP();const facts={...data.marketFacts},alerts=[...(data.alerts??[])];for(const p of pools){const id=`${p.source}:${p.id}`,old=facts[id];if(old&&p.at>old.at){for(const [name,prev,next,drop] of [["TVL",old.tvl,p.tvl,.3],["volume 24h",old.volume,p.volume24,.5],["APY estimado",old.apy,p.apy,.5]] as const){if(prev!=null&&prev>0&&next!=null&&next/prev<=1-drop){const alertId=`market:${id}:${name}`;if(!alerts.some(a=>a.id===alertId&&p.at-a.at<21600000))alerts.push({id:alertId,at:p.at,text:`${p.pair} / ${p.network}: ${name} caiu ${((1-next/prev)*100).toFixed(1)}% desde a última consulta da mesma fonte.`});}}}facts[id]={at:p.at,tvl:p.tvl,volume:p.volume24,apy:p.apy};}data={...data,marketFacts:facts,alerts:alerts.slice(-300)};persist();notify();}

export async function importLPData(input:unknown){if(syncing)throw Error("Aguarde o fim da sincronização LP antes de restaurar.");await initializeLP();if(!writable)throw Error("Cache LP original preservado; restauração não aplicada.");const next=structuredClone(validateLPData(input));await writes;await writeLPData(next);data=next;notify();}
