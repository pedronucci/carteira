import {lpFetch} from "./fetch";
import {solFees} from "./solana-fees";

import {PublicKey} from "@solana/web3.js";

import {sha256} from "@noble/hashes/sha256";

import {d} from "@bst/domain";

import {amounts} from "./math";

import type {LPAdapter,LPPosition} from "./types";

import {SPL_KNOWN} from "../connectors/solana";

export const PROGRAMS={orca:"whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",raydium:"CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"};

export const SPL=["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA","TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];

export function bytes(s:string){return Uint8Array.from(atob(s),c=>c.charCodeAt(0));}

export function uint(b:Uint8Array,at:number,len:number){if(at<0||at+len>b.length)throw Error("Conta Solana truncada");let n=0n;for(let i=len-1;i>=0;i--)n=n*256n+BigInt(b[at+i]!);return n;}

const key=(b:Uint8Array,at:number)=>new PublicKey(b.slice(at,at+32)).toBase58();

function check(b:Uint8Array,name:string){const disc=sha256(new TextEncoder().encode("account:"+name)).slice(0,8);if(!disc.every((v,i)=>v===b[i]))throw Error("Discriminador de conta inesperado");}

export function decodePosition(b:Uint8Array,kind:keyof typeof PROGRAMS,mint:string){check(b,kind==="orca"?"Position":"PersonalPositionState");const orca=kind==="orca";const ownMint=key(b,orca?40:9);if(ownMint!==mint)throw Error("NFT não corresponde à posição");return {pool:key(b,orca?8:41),liquidity:uint(b,orca?72:81,16).toString(),lower:Number(BigInt.asIntN(32,uint(b,orca?88:73,4))),upper:Number(BigInt.asIntN(32,uint(b,orca?92:77,4))),checkpoints:[uint(b,orca?96:97,16),uint(b,orca?120:113,16)],owed:[uint(b,orca?112:129,8),uint(b,orca?136:137,8)]};}

export function decodePool(b:Uint8Array,kind:keyof typeof PROGRAMS){check(b,kind==="orca"?"Whirlpool":"PoolState");const orca=kind==="orca";return {mints:[key(b,orca?101:73),key(b,orca?181:105)],sqrt:uint(b,orca?65:253,16),tick:Number(BigInt.asIntN(32,uint(b,orca?81:269,4))),spacing:Number(uint(b,orca?41:235,2)),globals:[uint(b,orca?165:277,16),uint(b,orca?245:293,16)],fee:orca?Number(uint(b,45,2))/10000:null};}

export async function solRpc(method:string,params:unknown[],signal:AbortSignal){let reason="RPC indisponível";for(const url of ["https://solana-rpc.publicnode.com","https://api.mainnet-beta.solana.com"]){try{const r=await lpFetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),signal:AbortSignal.any([signal,AbortSignal.timeout(12000)])});if(!r.ok)throw Error(`HTTP ${r.status}`);const j=await r.json();if(j.error||!j.result)throw Error("RPC recusou a leitura de contas");return j.result;}catch(e){if(signal.aborted)throw Error("Consulta cancelada");reason=(e as Error).message;}}throw Error(`Solana: ${reason}; nenhum saldo zero foi confirmado.`);}

export const solanaCL:LPAdapter={id:"solana-cl",async discover(accountId,owner,_chain,offset,signal){const ownerKey=new PublicKey(owner);if(!Number.isInteger(offset)||offset<0)throw Error("Página inválida");let all:any[]=[];for(const programId of SPL){const r=await solRpc("getTokenAccountsByOwner",[owner,{programId},{encoding:"jsonParsed",commitment:"finalized"}],signal);if(!Array.isArray(r.value))throw Error("Tokens sem cobertura confirmada");all.push(...r.value);}

 const nfts=all.filter(a=>a.account?.data?.parsed?.info?.tokenAmount?.amount==="1"&&a.account.data.parsed.info.tokenAmount.decimals===0);const page=nfts.slice(offset,offset+20),positions:LPPosition[]=[],notes:string[]=[];

 for(const nft of page){const mint=String(nft.account.data.parsed.info.mint);for(const kind of ["orca","raydium"] as const){const program=new PublicKey(PROGRAMS[kind]);const mintKey=new PublicKey(mint);const [standard]=PublicKey.findProgramAddressSync([new TextEncoder().encode("position"),mintKey.toBytes()],program);const candidates=[standard];if(kind==="orca"){const [bundle]=PublicKey.findProgramAddressSync([new TextEncoder().encode("position_bundle"),mintKey.toBytes()],program);const r=await solRpc("getMultipleAccounts",[[bundle.toBase58()],{encoding:"base64",commitment:"finalized"}],signal);const raw=r.value?.[0];if(raw){if(raw.owner!==program.toBase58())throw Error("Bundle Orca inválido");const b=bytes(raw.data[0]);check(b,"PositionBundle");if(key(b,8)!==mint)throw Error("Mint do bundle divergente");for(let i=0;i<256;i++)if((b[40+Math.floor(i/8)]??0)&(1<<(i%8)))candidates.push(PublicKey.findProgramAddressSync([new TextEncoder().encode("bundled_position"),mintKey.toBytes(),new TextEncoder().encode(String(i))],program)[0]);}}for(const pda of candidates){

 const snapshot=await solRpc("getMultipleAccounts",[[pda.toBase58(),nft.pubkey],{encoding:"base64",commitment:"finalized"}],signal);const [raw,ata]=snapshot.value??[];if(!raw)continue;try{if(raw.owner!==program.toBase58()||!ata||!SPL.includes(ata.owner))throw Error("Dono do programa inválido");const owned=bytes(ata.data[0]);if(key(owned,0)!==mint||key(owned,32)!==ownerKey.toBase58()||uint(owned,64,8)!==1n)throw Error("NFT não pertence mais à carteira");

 const pos=decodePosition(bytes(raw.data[0]),kind,mint);const poolResult=await solRpc("getMultipleAccounts",[[pos.pool],{encoding:"base64",commitment:"finalized",minContextSlot:snapshot.context.slot}],signal);const poolRaw=poolResult.value?.[0];if(!poolRaw||poolRaw.owner!==program.toBase58())throw Error("Pool não pertence ao protocolo");let pool=decodePool(bytes(poolRaw.data[0]),kind);

 const mints=await solRpc("getMultipleAccounts",[pool.mints,{encoding:"base64",commitment:"finalized",minContextSlot:poolResult.context.slot}],signal);const tokens=pool.mints.map((address,i)=>{const a=mints.value?.[i];if(!a||!SPL.includes(a.owner))throw Error("Mint inválido");const b=bytes(a.data[0]),decimals=Number(uint(b,44,1));return {address,symbol:SPL_KNOWN[address]?.symbol??address.slice(0,7),decimals,qty:"0",priceUsd:null};});let pendingFees:string[]|undefined;let finalSlot=poolResult.context.slot;try{const result=await solFees(kind,pos.pool,pos,pool,tokens.map(t=>t.decimals),poolResult.context.slot,signal,{position:pda.toBase58(),ata:nft.pubkey,mint,owner});pendingFees=result.fees;pos.owed=result.position.owed;pool=result.pool;finalSlot=result.slot;}catch(e){if((e as Error).message.startsWith("Posição mudou"))throw e;notes.push(`Fees ${kind}: ${(e as Error).message}`);}

 const quantities=amounts(pos.liquidity,(pool.sqrt<<32n).toString(),pos.lower,pos.upper,tokens[0]!.decimals,tokens[1]!.decimals);tokens.forEach((t,i)=>t.qty=quantities[i]!);const scale=d(10).pow(tokens[0]!.decimals-tokens[1]!.decimals);

 positions.push({id:`solana:${program}:${pda}`,accountId,owner,network:"Solana",chainId:101,protocol:kind==="orca"?"Orca Whirlpools":"Raydium CLMM",pool:pos.pool,positionId:pda.toBase58(),block:`slot:${finalSlot}`,at:Date.now(),tokens,valueUsd:null,pendingFees,owedRaw:pos.owed.map((n,i)=>d(n.toString()).div(d(10).pow(tokens[i]!.decimals)).toString()),tick:pool.tick,lowerTick:pos.lower,upperTick:pos.upper,price:d(pool.sqrt.toString()).div(d(2).pow(64)).pow(2).mul(scale).toNumber(),lower:d("1.0001").pow(pos.lower).mul(scale).toNumber(),upper:d("1.0001").pow(pos.upper).mul(scale).toNumber(),liquidity:pos.liquidity,feeTier:pool.fee,status:pos.liquidity==="0"?"CLOSED":pool.tick>=pos.lower&&pool.tick<pos.upper?"IN RANGE":"OUT OF RANGE",historyComplete:false,receiptAssetKey:`solana:${mint}`});

 }catch(e){notes.push(`${kind}: ${(e as Error).message}`);}}}}

 return {positions,notes,complete:notes.length===0&&offset+20>=nfts.length,next:offset+20<nfts.length?offset+20:null};}};

