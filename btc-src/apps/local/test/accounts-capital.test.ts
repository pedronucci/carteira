import { beforeEach, expect, it, vi } from "vitest";
import { evolution, portfolioReturns, returnSince, type PEvent } from "@bst/domain";
import { capitalFlows, hlCapitalEvents } from "../src/lib/portfolio/capital-flows";
import type { HlHistory, HlLedger } from "../src/lib/local/hl";
const T=1800000000000,A="0x"+"a".repeat(40),B="0x"+"b".repeat(40);
const history=(ledger:HlLedger[]=[]):HlHistory=>({at:T,fills:[],funding:[],ledger,accountValue:[],pnl:[],orders:{},truncated:false,syncs:1,v:3});
const move=(key:string,kind:HlLedger["kind"],amount:number):HlLedger=>({key,time:T+500,kind,amount,label:"Transferência",type:"send"});
class MemoryStorage {data=new Map<string,string>();getItem(k:string){return this.data.get(k)??null;}setItem(k:string,v:string){this.data.set(k,String(v));}removeItem(k:string){this.data.delete(k);}}
beforeEach(()=>{vi.resetModules();vi.restoreAllMocks();Object.assign(globalThis,{localStorage:new MemoryStorage()});});
const event=(kind:PEvent["kind"],usd:number,accountId="a"):PEvent=>({id:"e",accountId,t:T+500,kind,econ:"USDC",qty:Math.abs(usd),usd});
it.each(["deposit","transfer_in"] as const)("aporte %s aumenta saldo, sem lucro ou retorno no gráfico",kind=>{
 const f=capitalFlows([event(kind,500)]),s=[{t:T,byAccount:{a:1000}},{t:T+1000,byAccount:{a:1500}}];
 expect(returnSince(portfolioReturns(s,f),null)).toMatchObject({resultUsd:0,pct:0});
 expect(evolution(s,f,"all","USD",T+1000)).toMatchObject({resultUsd:0,twr:0});
});
it("retirada não vira prejuízo",()=>{expect(portfolioReturns([{t:T,byAccount:{a:1000}},{t:T+1000,byAccount:{a:700}}],capitalFlows([event("withdraw",300)])).at(-1)).toMatchObject({resultUsd:0,index:1});});
it("depósito na conta adicional e sincronização repetida não geram lucro",()=>{
 const d=move("dep","IN",500),e=hlCapitalEvents([{id:"extra",history:history([d,d])}]);expect(e).toHaveLength(1);
 expect(portfolioReturns([{t:T,byAccount:{extra:1000}},{t:T+1000,byAccount:{extra:1500}}],capitalFlows(e)).at(-1)).toMatchObject({resultUsd:0,index:1});
});
it("transferência própria é neutra no agregado e nos recortes por conta",()=>{
 const e=hlCapitalEvents([{id:"a",history:history([move("out","OUT",300)])},{id:"b",history:history([move("in","IN",300)])}]);const f=capitalFlows(e.map(x=>({...x,classification:"internal"})));
 for(const ids of [["a","b"],["a"],["b"]]){const sub=(v:Record<string,number>)=>Object.fromEntries(Object.entries(v).filter(([id])=>ids.includes(id)));expect(portfolioReturns([{t:T,byAccount:sub({a:1000,b:500})},{t:T+1000,byAccount:sub({a:700,b:800})}],f).at(-1)).toMatchObject({resultUsd:0,index:1});}
});
it("trading +80, taxas -2, funding -3 e recompensa +5 dão resultado 80; aporte 500 é excluído",()=>{
 const f=capitalFlows(hlCapitalEvents([{id:"a",history:history([move("dep","IN",500),move("reward","INCOME",5),move("spot-perp","INTERNAL",200)])}]));
 const p=portfolioReturns([{t:T,byAccount:{a:1000}},{t:T+1000,byAccount:{a:1580}}],f).at(-1)!;expect(p.resultUsd).toBe(80);expect(p.index-1).toBeCloseTo(80/1250,12);
});
it("taxa de saque é despesa",()=>{const f=capitalFlows(hlCapitalEvents([{id:"a",history:history([{...move("out","OUT",100),fee:1}])}]));expect(portfolioReturns([{t:T,byAccount:{a:1000}},{t:T+1000,byAccount:{a:899}}],f).at(-1)!.resultUsd).toBe(-1);});
async function boot(){
 const live={at:Date.now(),mode:"default",perpValue:1500,withdrawable:1500,total:1500,arbTotal:null,balances:[{coin:"USDC",where:"perp",total:1500,usd:1500}],positions:[]};
 localStorage.setItem("bst.local.v2",JSON.stringify({v:3,initial:{date:"2026-01-01",usdc:"999999"},cycles:[],flows:[{id:"legacy",date:"2026-01-02",kind:"IN",amount:"888888"}],strategies:[],settings:{hl:{address:A},defaultLeverage:"2",maintenanceRate:"0.0125",minLiqDistance:"0.2"}}));
 localStorage.setItem("bst.hl.v2",JSON.stringify({address:A,live,history:history([move("dep","IN",500)]),error:null,syncing:false}));
 localStorage.setItem("bst.hl.extra.v1",JSON.stringify({v:1,accounts:[{id:"extra",name:"Adicional",address:B,live,history:history([move("dep","IN",200)]),error:null,syncing:false}]}));
 return {db:await import("../src/lib/portfolio/db"),engine:await import("../src/lib/portfolio/engine")};
}
it("somente saldos oficiais e fluxos das duas contas, com legado preservado",async()=>{const {engine}=await boot();const v=engine.portfolioView();expect(v.c.totalUsd).toBe(3000);expect(v.accounts.map(a=>a.name).join()).not.toContain("Estratégia");expect(v.flows.map(f=>f.usd).sort()).toEqual([200,500]);expect(localStorage.getItem("bst.local.v2.before-accounts-v1")).not.toBeNull();});
it("OKX com histórico incompleto não mostra rentabilidade",async()=>{const {db,engine}=await boot();await db.updatePortfolio(d=>{d.accounts.push({id:"a",kind:"okx",institution:"OKX",name:"Funding",createdAt:T});d.snapshots=[{t:T,src:"accounts-v1",byAccount:{a:1000}},{t:T+1000,src:"accounts-v1",byAccount:{a:1500}}];d.events=[event("deposit",500)];d.sync.a={state:"ok",at:Date.now(),historyComplete:false};});const v=engine.portfolioView();expect(returnSince(v.series,null)).toBeNull();expect(v.warnings.join()).toMatch(/incompleta/);});
it("depósito sem preço histórico não vira lucro",async()=>{const {db,engine}=await boot();await db.updatePortfolio(d=>{d.events=[{...event("deposit",500),usd:null,econ:"ETH"}];d.snapshots=[{t:T,src:"accounts-v1",byAccount:{a:1000}},{t:T+1000,src:"accounts-v1",byAccount:{a:1500}}];});const v=engine.portfolioView();expect(returnSince(v.series,null)).toBeNull();expect(v.warnings.join()).toMatch(/sem preço histórico/);});
it("retratos legados ficam preservados e fora da série nova",async()=>{const {db,engine}=await boot();await db.updatePortfolio(d=>{d.snapshots=[{t:T,src:"app",byAccount:{strategy:999999}}];});expect(engine.portfolioView().snapshots).toHaveLength(0);expect(db.portfolio().snapshots).toHaveLength(1);});
