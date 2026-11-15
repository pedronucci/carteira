/** Relay restrito a dados públicos. Chamado somente DEPOIS da autenticação Access. */
const RPCS=new Set(["https://ethereum-rpc.publicnode.com/","https://arbitrum-one-rpc.publicnode.com/","https://base-rpc.publicnode.com/","https://optimism-rpc.publicnode.com/","https://polygon-bor-rpc.publicnode.com/","https://bsc-dataseed.bnbchain.org/","https://solana-rpc.publicnode.com/","https://api.mainnet-beta.solana.com/"]);
const EXPLORERS=new Set(["eth.blockscout.com","base.blockscout.com","optimism.blockscout.com","arbitrum.blockscout.com","polygon.blockscout.com","bnb.blockscout.com"]);
const METHODS=new Set(["eth_blockNumber","eth_call","eth_getTransactionByHash","eth_getTransactionReceipt","eth_getBlockByNumber","getTokenAccountsByOwner","getMultipleAccounts","getSignaturesForAddress","getTransaction","getSlot","getBlock"]);
export function validateLiquidityRequest(input:any){
 if(!input||typeof input.url!=="string")throw Error("Fonte inválida");const url=new URL(input.url);
 if(url.protocol!=="https:"||url.port||url.username||url.password||url.hash)throw Error("Fonte não permitida");
 if(RPCS.has(url.href)){
  const rows=Array.isArray(input.body)?input.body:[input.body];if(rows.length<1||rows.length>10)throw Error("Lote inválido");
  for(const q of rows){if(!q||q.jsonrpc!=="2.0"||!METHODS.has(q.method)||!Array.isArray(q.params)||JSON.stringify(q.params).length>16000)throw Error("RPC somente leitura");if(q.method==="getMultipleAccounts"&&(!Array.isArray(q.params[0])||q.params[0].length>100))throw Error("Lote de contas inválido");if(q.method==="eth_call"&&(!/^0x[a-fA-F0-9]{40}$/.test(q.params[0]?.to)||!/^0x[a-fA-F0-9]*$/.test(q.params[0]?.data)))throw Error("Chamada ABI inválida");}
  return {url:url.href,method:"POST",body:JSON.stringify(input.body)};
 }
 const explorer=EXPLORERS.has(url.hostname)&&(/^\/api\/v2\/addresses\/0x[a-fA-F0-9]{40}\/(tokens|nft|token-transfers)$/.test(url.pathname)||/^\/api\/v2\/transactions\/0x[a-fA-F0-9]{64}\/internal-transactions$/.test(url.pathname)||url.pathname==="/api"&&url.searchParams.get("module")==="logs"&&url.searchParams.get("action")==="getLogs"&&/^0x[a-fA-F0-9]{40}$/.test(url.searchParams.get("address")??""));
 const prices=url.hostname==="coins.llama.fi"&&/^\/prices\/(current|historical\/\d+)\/[a-zA-Z0-9:.,_-]+$/.test(url.pathname);
 const ray=url.hostname==="api-v3.raydium.io"&&url.pathname==="/pools/info/lps"&&/^[1-9A-HJ-NP-Za-km-z,]+$/.test(url.searchParams.get("lps")??"");
 if(!explorer&&!prices&&!ray||input.body!=null)throw Error("Fonte não permitida");return {url:url.href,method:"GET",body:undefined};
}
export async function liquidityData(input:unknown,f:typeof fetch=fetch,solanaRpc?:string){
 const q=validateLiquidityRequest(input);
 if(solanaRpc&&q.method==="POST"&&new URL(q.url).hostname.includes("solana"))q.url=solanaRpc;
 const r=await f(q.url,{method:q.method,body:q.body,headers:{"Content-Type":"application/json"},redirect:"error",signal:AbortSignal.timeout(25000)});
 if(!r.ok)throw Error(`Fonte pública HTTP ${r.status}`);
 const reader=r.body?.getReader();if(!reader)throw Error("Fonte sem resposta");let size=0;const chunks:Uint8Array[]=[];
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8*1024*1024){await reader.cancel();throw Error("Resposta excede limite de 8 MB");}chunks.push(value);}
 const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}return JSON.parse(new TextDecoder().decode(bytes));
}
