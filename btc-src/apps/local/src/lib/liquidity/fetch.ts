import {gatewayInfo} from "../connectors/okx";
/** No gateway, evita CORS e mantém o RPC opcional exclusivamente no servidor. */
export async function lpFetch(url:RequestInfo|URL,init?:RequestInit):Promise<Response>{
 if(!gatewayInfo().ok)return fetch(url,init);
 const body=init?.body?JSON.parse(String(init.body)):undefined;
 const request=()=>fetch("/api/liquidity/data",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},signal:init?.signal,body:JSON.stringify({url:String(url),body})});
 let response=await request();for(let retry=0;response.status===429&&retry<3;retry++){await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{init?.signal?.removeEventListener("abort",abort);resolve();},600);const abort=()=>{clearTimeout(timer);reject(Error("Consulta cancelada"));};if(init?.signal?.aborted)abort();else init?.signal?.addEventListener("abort",abort,{once:true});});response=await request();}return response;
}
